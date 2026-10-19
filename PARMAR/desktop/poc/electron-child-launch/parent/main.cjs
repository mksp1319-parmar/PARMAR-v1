'use strict';

const { app, BrowserWindow } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { ChildSupervisor } = require('./child-supervisor.cjs');
const { resolveFixedLaunchTarget } = require('./fixed-launch-target.cjs');

const CHILD_STARTUP_TIMEOUT_MS = 15000;
const CHILD_SHUTDOWN_TIMEOUT_MS = 3000;
const CHILD_FORCE_EXIT_TIMEOUT_MS = 2000;
let supervisor = null;
let parentExitStatus = 0;
let exitStarted = false;
let shutdownStarted = false;

function record(event, details = {}) {
  process.stdout.write(`${JSON.stringify({
    component: 'poc-parent',
    event,
    timestamp: new Date().toISOString(),
    electronVersion: process.versions.electron,
    executablePath: process.execPath,
    parentEntryPoint: __filename,
    pid: process.pid,
    parentPid: process.ppid,
    ...details,
  })}\n`);
}

function finishParent(status) {
  if (exitStarted) return;
  exitStarted = true;
  parentExitStatus = status;
  record('parent-exit-requested', { status });
  app.exit(status);
}

function beginShutdown(reason) {
  if (shutdownStarted) {
    record('duplicate-shutdown-ignored', { reason });
    return;
  }
  shutdownStarted = true;
  if (!supervisor) {
    finishParent(parentExitStatus);
    return;
  }
  supervisor.stop(reason);
  supervisor.waitForExit().then((result) => {
    if (result.processStillRunning) parentExitStatus = 1;
    else if (result.failureStatus !== 0) parentExitStatus = result.failureStatus;
    finishParent(parentExitStatus);
  });
}

function launchChild() {
  const executablePath = process.execPath;
  let target;
  try {
    target = resolveFixedLaunchTarget(executablePath, process.resourcesPath);
  } catch (error) {
    parentExitStatus = 1;
    record('launch-failed', { reason: error.message });
    finishParent(1);
    return;
  }
  const { childAppPath, childEntryPoint } = target;
  record('launch-request', { childAppPath, childEntryPoint, shell: false });

  supervisor = new ChildSupervisor({
    spawnChild: () => spawn(executablePath, [childAppPath], {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
    executablePath,
    childAppPath,
    childEntryPoint,
    resourcesPath: process.resourcesPath,
    electronVersion: process.versions.electron,
    parentPid: process.pid,
    startupTimeoutMs: CHILD_STARTUP_TIMEOUT_MS,
    terminationGraceMs: CHILD_SHUTDOWN_TIMEOUT_MS,
    forceExitTimeoutMs: CHILD_FORCE_EXIT_TIMEOUT_MS,
    record,
  });

  supervisor.on('exit', (result) => {
    if (result.failureStatus !== 0) parentExitStatus = result.failureStatus;
    if (shutdownStarted || result.failureStatus !== 0 || result.code !== null) {
      finishParent(parentExitStatus);
    }
  });

  supervisor.start().then((message) => {
    record('startup-ready', { childPid: message.pid });
  }).catch((error) => {
    parentExitStatus = 1;
    record('startup-failed', { kind: error.code || 'startup-error', reason: error.message });
  });
}

app.on('before-quit', (event) => {
  if (exitStarted) return;
  event.preventDefault();
  beginShutdown('parent-quit');
});

process.on('SIGTERM', () => beginShutdown('parent-sigterm'));
process.on('SIGINT', () => beginShutdown('parent-sigint'));
process.on('SIGUSR1', () => {
  const windows = BrowserWindow.getAllWindows();
  if (windows.length === 0) {
    beginShutdown('parent-window-close-signal');
    return;
  }
  for (const window of windows) window.close();
});

process.on('exit', (code) => {
  fs.writeSync(1, `${JSON.stringify({
    component: 'poc-parent',
    event: 'parent-exit',
    timestamp: new Date().toISOString(),
    electronVersion: process.versions.electron,
    executablePath: process.execPath,
    parentEntryPoint: __filename,
    pid: process.pid,
    parentPid: process.ppid,
    status: parentExitStatus || code,
  })}\n`);
});

app.whenReady().then(() => {
  record('parent-ready', { appPath: app.getAppPath(), resourcesPath: process.resourcesPath });
  const window = new BrowserWindow({
    width: 480,
    height: 240,
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.loadFile(path.join(__dirname, 'index.html')).catch((error) => {
    record('parent-window-failed', { reason: error.message });
    parentExitStatus = 1;
    beginShutdown('parent-window-failed');
  });
  window.on('closed', () => beginShutdown('parent-window-closed'));
  launchChild();
}).catch((error) => {
  parentExitStatus = 1;
  record('parent-startup-failed', { reason: error.message });
  beginShutdown('parent-startup-failed');
});
