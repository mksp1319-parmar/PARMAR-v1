'use strict';

const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { randomBytes } = require('node:crypto');
const { authorizeBrokerMessage, createBrokerSession } = require('./broker-protocol.cjs');
const { buildIsolatedLaunch } = require('./isolation-launcher.cjs');

const CHILD_ARGUMENT = '--aether-browser-child';
const GUI_ENVIRONMENT_KEYS = [
  'DBUS_SESSION_BUS_ADDRESS',
  'DISPLAY',
  'HOME',
  'LANG',
  'LC_ALL',
  'PATH',
  'WAYLAND_DISPLAY',
  'XAUTHORITY',
  'XDG_CURRENT_DESKTOP',
  'XDG_RUNTIME_DIR',
  'XDG_SESSION_TYPE',
];

function readEffectiveUid(pid) {
  const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
  const line = status.split('\n').find((entry) => entry.startsWith('Uid:'));
  if (!line) throw new Error('The AETHER browser child UID could not be verified.');
  const uid = Number(line.trim().split(/\s+/)[2]);
  if (!Number.isSafeInteger(uid) || uid < 0) {
    throw new Error('The AETHER browser child UID is invalid.');
  }
  return uid;
}

function readNetworkNamespace(pid = 'self') {
  return fs.readlinkSync(`/proc/${pid}/ns/net`);
}

function terminateProcessGroup(child, signal = 'SIGKILL') {
  if (!Number.isSafeInteger(child?.pid) || child.pid < 1) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

function childEnvironment(source, capability, executablePath) {
  const environment = {};
  for (const key of GUI_ENVIRONMENT_KEYS) {
    if (typeof source[key] === 'string') environment[key] = source[key];
  }
  if (typeof source.APPDIR === 'string' && path.isAbsolute(source.APPDIR)) {
    const appDirectory = path.resolve(source.APPDIR);
    const executableRelativePath = path.relative(appDirectory, executablePath);
    if (
      executableRelativePath !== '..'
      && !executableRelativePath.startsWith(`..${path.sep}`)
      && !path.isAbsolute(executableRelativePath)
    ) {
      environment.APPDIR = appDirectory;
      environment.LD_LIBRARY_PATH = path.join(appDirectory, 'usr', 'lib');
      environment.GSETTINGS_SCHEMA_DIR = path.join(appDirectory, 'usr', 'share', 'glib-2.0', 'schemas');
      environment.XDG_DATA_DIRS = [
        path.join(appDirectory, 'usr', 'share'),
        '/usr/share/gnome',
        '/usr/local/share',
        '/usr/share',
      ].join(path.delimiter);
    }
  }
  environment.PARMAR_AETHER_BROKER_CAPABILITY = capability;
  return environment;
}

function createBrowserChildSupervisor({
  executablePath = process.execPath,
  appPath = path.resolve(__dirname),
  environment = process.env,
  platform = process.platform,
  parentPid = process.pid,
  parentUid = process.geteuid?.(),
  spawnProcess = spawn,
  resolveIsolationExecutable,
  parentNamespaceReader = readNetworkNamespace,
  processNamespaceReader = readNetworkNamespace,
  processUidReader = readEffectiveUid,
  killProcessGroup = terminateProcessGroup,
  startupTimeoutMs = 15_000,
  shutdownGraceMs = 3_000,
  crashRestartDelayMs = 500,
  maxCrashRestarts = 2,
} = {}) {
  if (
    platform !== 'linux'
    || !path.isAbsolute(executablePath)
    || !path.isAbsolute(appPath)
    || !Number.isSafeInteger(parentPid)
    || parentPid < 1
    || !Number.isSafeInteger(parentUid)
    || parentUid < 0
    || !Number.isSafeInteger(startupTimeoutMs)
    || startupTimeoutMs < 100
    || !Number.isSafeInteger(shutdownGraceMs)
    || shutdownGraceMs < 100
    || !Number.isSafeInteger(crashRestartDelayMs)
    || crashRestartDelayMs < 10
    || !Number.isSafeInteger(maxCrashRestarts)
    || maxCrashRestarts < 0
    || maxCrashRestarts > 5
  ) {
    throw new TypeError('The AETHER browser child launch configuration is invalid.');
  }

  const events = new EventEmitter();
  let child = null;
  let state = 'stopped';
  let capability = null;
  let brokerSession = null;
  let sequence = 0;
  let output = null;
  let startupTimer = null;
  let closeResult = null;
  let closedPromise = null;
  let resolveClosed = null;
  let rejectStartup = null;
  let resolveStartup = null;
  let startupPromise = null;
  let shutdownPromise = null;
  let cleanupError = null;
  let parentNamespaceId = null;
  let recoveryTimer = null;
  let recoveryAttempts = 0;

  const cleanupGroup = () => {
    if (!child?.pid) return;
    try {
      killProcessGroup(child, 'SIGKILL');
    } catch (error) {
      cleanupError = error;
      events.emit('cleanup-error', error);
    }
  };

  const failStartup = (error) => {
    if (state === 'starting') {
      state = 'stopping';
      clearTimeout(startupTimer);
      rejectStartup(error);
      cleanupGroup();
    }
  };

  const failChild = (error) => {
    if (state === 'starting') {
      failStartup(error);
      return;
    }
    if (state === 'ready') {
      state = 'stopping';
      events.emit('protocol-error', error);
      cleanupGroup();
    }
  };

  const send = (type) => {
    if (!child || child.stdin.destroyed || !child.stdin.writable) {
      throw new Error('The AETHER browser child broker is disconnected.');
    }
    child.stdin.write(`${JSON.stringify({
      capability,
      payload: {},
      sequence: sequence++,
      type,
    })}\n`);
  };

  const handleChildLine = (line) => {
    const authorization = authorizeBrokerMessage(
      brokerSession,
      { pid: child.pid, uid: processUidReader(child.pid) },
      line,
    );
    if (!authorization.ok || authorization.type !== 'browser.status') {
      failChild(new Error(
        authorization.ok
          ? 'The AETHER browser child sent an unauthorized action.'
          : `AETHER browser child IPC was rejected: ${authorization.error}`,
      ));
      return;
    }
    if (state === 'starting') {
      try {
        if (processNamespaceReader(child.pid) === parentNamespaceId) {
          throw new Error('The AETHER browser child shares the host network namespace.');
        }
        send('browser.ready');
      } catch (error) {
        failStartup(error);
        return;
      }
      state = 'ready';
      clearTimeout(startupTimer);
      resolveStartup({ pid: child.pid, state });
      events.emit('ready', { pid: child.pid });
    }
  };

  const start = () => {
    if (state === 'ready') return Promise.resolve({ pid: child.pid, state });
    if (state === 'starting') return startupPromise;
    if (state === 'stopping') return Promise.reject(new Error('The AETHER browser child is stopping.'));

    capability = randomBytes(32).toString('base64url');
    state = 'starting';
    sequence = 0;
    closeResult = null;
    cleanupError = null;
    rejectStartup = null;
    resolveStartup = null;
    let spawnError = null;
    try {
      parentNamespaceId = parentNamespaceReader();
      const launch = buildIsolatedLaunch({
        targetExecutable: executablePath,
        targetArguments: [appPath, CHILD_ARGUMENT],
        parentNamespaceId,
        capability,
        environment: childEnvironment(environment, capability, executablePath),
        ...(resolveIsolationExecutable ? { resolveExecutable: resolveIsolationExecutable } : {}),
        platform,
      });
      child = spawnProcess(launch.executable, launch.arguments, {
        cwd: path.dirname(appPath),
        detached: true,
        env: launch.environment,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      child.on('error', (error) => {
        spawnError = error;
        if (state === 'starting' && rejectStartup) failStartup(error);
        else if (state === 'ready') failChild(error);
      });
    } catch (error) {
      state = 'stopped';
      return Promise.reject(error);
    }
    if (!Number.isSafeInteger(child.pid) || child.pid < 1) {
      state = 'stopping';
      return new Promise((resolve, reject) => {
        child.once('close', () => {
          state = 'stopped';
          reject(spawnError || new Error('The AETHER browser child did not start.'));
        });
      });
    }

    closedPromise = new Promise((resolve) => { resolveClosed = resolve; });
    try {
      const childUid = processUidReader(child.pid);
      if (childUid !== parentUid) {
        throw new Error('The AETHER browser child is running under an unexpected UID.');
      }
      brokerSession = createBrokerSession(
        { pid: child.pid, uid: childUid },
        Date.now(),
        capability,
      );
    } catch (error) {
      state = 'stopping';
      const waitForExit = new Promise((resolve) => child.once('close', resolve));
      cleanupGroup();
      return waitForExit.then(() => {
        state = 'stopped';
        closeResult = { code: null, signal: 'SIGKILL' };
        resolveClosed(closeResult);
        throw error;
      });
    }

    startupPromise = new Promise((resolve, reject) => {
      resolveStartup = resolve;
      rejectStartup = reject;
    });
    output = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    output.on('line', (line) => {
      try {
        handleChildLine(line);
      } catch (error) {
        failChild(new Error(`AETHER browser child IPC could not be validated: ${error.message}`));
      }
    });
    child.stderr.on('data', (chunk) => {
      events.emit('stderr', String(chunk).slice(0, 4096));
    });
    child.on('close', (code, signal) => {
      clearTimeout(startupTimer);
      output.close();
      cleanupGroup();
      closeResult = cleanupError
        ? { code, signal, cleanupError: cleanupError.message }
        : { code, signal };
      const priorState = state;
      state = 'stopped';
      if (priorState === 'starting') {
        rejectStartup(spawnError || new Error(
          `AETHER browser child exited before readiness (exit ${code ?? signal}).`,
        ));
      }
      resolveClosed(closeResult);
      events.emit('exit', { ...closeResult, priorState });
      if (priorState === 'ready' && recoveryAttempts < maxCrashRestarts) {
        recoveryAttempts += 1;
        recoveryTimer = setTimeout(() => {
          recoveryTimer = null;
          start().catch((error) => events.emit('recovery-error', error));
        }, crashRestartDelayMs);
        recoveryTimer.unref?.();
      }
    });
    startupTimer = setTimeout(
      () => failStartup(new Error('AETHER browser child startup timed out.')),
      startupTimeoutMs,
    );
    startupTimer.unref?.();
    return startupPromise;
  };

  const sendAction = (type) => {
    if (state !== 'ready') throw new Error('The AETHER browser child is not ready.');
    send(type);
  };

  const stop = () => {
    if (shutdownPromise) return shutdownPromise;
    if (recoveryTimer) {
      clearTimeout(recoveryTimer);
      recoveryTimer = null;
    }
    if (!child || state === 'stopped') return Promise.resolve(closeResult);
    shutdownPromise = (async () => {
      if (state === 'starting') {
        try {
          await startupPromise;
        } catch {
          return closedPromise ? closedPromise : closeResult;
        }
      }
      if (state === 'ready') {
        state = 'stopping';
        try {
          send('browser.stop');
        } catch {
          cleanupGroup();
        }
      }
      let timeout;
      const graceExpired = new Promise((resolve) => {
        timeout = setTimeout(() => {
          cleanupGroup();
          resolve();
        }, shutdownGraceMs);
        timeout.unref?.();
      });
      await Promise.race([closedPromise, graceExpired]);
      clearTimeout(timeout);
      if (state !== 'stopped') cleanupGroup();
      if (state !== 'stopped') await closedPromise;
      return closeResult;
    })().finally(() => {
      shutdownPromise = null;
    });
    return shutdownPromise;
  };

  return {
    start,
    stop,
    focus: () => sendAction('browser.focus'),
    newTab: () => sendAction('browser.new-tab'),
    closeTab: () => sendAction('browser.close-tab'),
    on: (event, listener) => {
      events.on(event, listener);
      return () => events.off(event, listener);
    },
    get state() { return state; },
  };
}

module.exports = {
  CHILD_ARGUMENT,
  createBrowserChildSupervisor,
  terminateProcessGroup,
};
