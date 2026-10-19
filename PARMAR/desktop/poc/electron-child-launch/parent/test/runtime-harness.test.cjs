'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const parentDirectory = path.resolve(__dirname, '..');
const defaultArtifact = path.join(parentDirectory, 'out', 'ParmarChildLaunch-linux-x64');
const artifactSource = process.env.PARMAR_POC_ARTIFACT
  ? path.resolve(process.env.PARMAR_POC_ARTIFACT)
  : defaultArtifact;
const executableName = 'parmar-child-launch';
const childResourceName = 'aether-child';
const startupTimeoutMs = 15000;
const childTerminationGraceMs = 3000;
const perScenarioTimeoutMs = startupTimeoutMs + childTerminationGraceMs + 7000;
const maxCapturedBytes = 1024 * 1024;

function runtimeBlocker() {
  const blockers = [];
  if (process.platform !== 'linux' || process.arch !== 'x64') blockers.push('Linux x64 is required');
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    blockers.push('no active DISPLAY or WAYLAND_DISPLAY');
  }
  if (!fs.existsSync(path.join(artifactSource, executableName))) {
    blockers.push(`packaged artifact not found at ${artifactSource}`);
  } else {
    try {
      const linkage = execFileSync('ldd', [path.join(artifactSource, executableName)], {
        encoding: 'utf8',
        timeout: 5000,
      });
      const missing = linkage.split('\n').filter((line) => line.includes('not found'));
      if (missing.length > 0) {
        blockers.push(`unresolved shared libraries: ${missing.map((line) => line.trim()).join(', ')}`);
      }
    } catch (error) {
      blockers.push(`could not inspect packaged Electron libraries: ${error.message}`);
    }
  }
  return blockers.length > 0 ? `Runtime scenarios blocked: ${blockers.join('; ')}.` : null;
}

function parseProcStat(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const endCommand = stat.lastIndexOf(')');
    if (endCommand < 0) return null;
    const fields = stat.slice(endCommand + 2).trim().split(/\s+/);
    return {
      pid,
      state: fields[0],
      parentPid: Number(fields[1]),
      startTime: fields[19],
    };
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ESRCH' || error.code === 'EACCES') return null;
    throw error;
  }
}

function processTree(rootPid) {
  const processes = [];
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    const info = parseProcStat(Number(entry));
    if (info) processes.push(info);
  }
  const byParent = new Map();
  for (const info of processes) {
    const children = byParent.get(info.parentPid) || [];
    children.push(info);
    byParent.set(info.parentPid, children);
  }

  const result = [];
  const pending = [rootPid];
  const visited = new Set(pending);
  while (pending.length > 0) {
    const parentPid = pending.shift();
    for (const child of byParent.get(parentPid) || []) {
      if (visited.has(child.pid)) continue;
      visited.add(child.pid);
      result.push(child);
      pending.push(child.pid);
    }
  }
  return result;
}

function pidStillMatches(info) {
  const current = parseProcStat(info.pid);
  return Boolean(current && current.startTime === info.startTime);
}

function waitFor(predicate, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const check = () => {
      try {
        const value = predicate();
        if (value) {
          resolve(value);
          return;
        }
      } catch (error) {
        reject(error);
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error(`Timed out waiting for ${description}.`));
        return;
      }
      setTimeout(check, 25);
    };
    check();
  });
}

function startInstalledParent(executablePath, cwd) {
  const child = spawn(executablePath, [], {
    cwd,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const records = [];
  const rawStdout = [];
  const rawStderr = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let partialLine = '';
  let outputError = null;
  const observedProcesses = new Map();
  const observeTree = () => {
    for (const info of [parseProcStat(child.pid), ...processTree(child.pid)]) {
      if (info) observedProcesses.set(`${info.pid}:${info.startTime}`, info);
    }
    for (const record of records) {
      if (Number.isInteger(record.childPid)) {
        const info = parseProcStat(record.childPid);
        if (info) observedProcesses.set(`${info.pid}:${info.startTime}`, info);
      }
    }
  };
  let closeResult = null;
  let closeResolve;
  const closed = new Promise((resolve) => {
    closeResolve = resolve;
  });
  const appendBounded = (list, chunk, currentBytes) => {
    const remaining = Math.max(0, maxCapturedBytes - currentBytes);
    if (remaining > 0) list.push(Buffer.from(chunk).subarray(0, remaining).toString('utf8'));
    return currentBytes + Math.min(Buffer.byteLength(chunk), remaining);
  };

  child.stdout.on('data', (chunk) => {
    stdoutBytes = appendBounded(rawStdout, chunk, stdoutBytes);
    partialLine += chunk.toString('utf8');
    if (Buffer.byteLength(partialLine) > 16384 && !partialLine.includes('\n')) {
      outputError = new Error('Parent emitted an oversized structured log record.');
      return;
    }
    const lines = partialLine.split('\n');
    partialLine = lines.pop();
    for (const line of lines) {
      try {
        records.push(JSON.parse(line));
        observeTree();
      } catch {
        outputError = new Error(`Parent emitted malformed structured output: ${line.slice(0, 200)}`);
      }
    }
  });
  child.stderr.on('data', (chunk) => {
    stderrBytes = appendBounded(rawStderr, chunk, stderrBytes);
  });
  child.once('close', (code, signal) => {
    observeTree();
    clearInterval(processMonitor);
    if (partialLine.length > 0) {
      try {
        records.push(JSON.parse(partialLine));
        observeTree();
      } catch {
        outputError = new Error(`Unparsed trailing stdout: ${partialLine.slice(0, 200)}`);
      }
    }
    closeResult = { code, signal };
    closeResolve(closeResult);
  });

  const overallTimer = setTimeout(() => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }, 2000).unref();
  }, perScenarioTimeoutMs);
  child.once('close', () => clearTimeout(overallTimer));
  child.once('error', (error) => {
    outputError = error;
    closeResult = { code: null, signal: null, error: error.message };
    closeResolve(closeResult);
  });
  const processMonitor = setInterval(observeTree, 50);
  processMonitor.unref();
  observeTree();

  return {
    child,
    records,
    rawStdout,
    rawStderr,
    observedProcesses,
    closed,
    get closeResult() { return closeResult; },
    get outputError() { return outputError; },
    waitRecord(predicate, description, timeoutMs = perScenarioTimeoutMs) {
      return waitFor(
        () => {
          if (outputError) throw outputError;
          return records.find(predicate);
        },
        timeoutMs,
        description,
      );
    },
  };
}

function protocolFixture(mode) {
  const afterReady = mode === 'exit-after-ready'
    ? 'setTimeout(() => app.exit(0), 300);'
    : '';
  const signalHandler = mode === 'ignore-term'
    ? "process.on('SIGTERM', () => {});"
    : '';
  return `'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
${signalHandler}
app.whenReady().then(async () => {
  ${mode === 'exit-before-ready' ? 'app.exit(17); return;' : ''}
  const window = new BrowserWindow({
    width: 480, height: 320,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const localPage = path.join(__dirname, 'index.html');
  await window.loadFile(localPage);
  ${mode === 'never-ready' ? 'return;' : ''}
  process.stdout.write(JSON.stringify({
    protocol: 1,
    component: 'aether-child-poc',
    event: 'ready',
    electronVersion: process.versions.electron,
    executablePath: process.execPath,
    entryPoint: __filename,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    pid: process.pid,
    parentPid: process.ppid,
    localPage,
  }) + '\\n');
  ${afterReady}
}).catch((error) => {
  process.stdout.write(JSON.stringify({
    protocol: 1,
    component: 'aether-child-poc',
    event: 'startup-failed',
    electronVersion: process.versions.electron,
    executablePath: process.execPath,
    entryPoint: __filename,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    pid: process.pid,
    parentPid: process.ppid,
    reason: String(error.message).slice(0, 1024),
  }) + '\\n');
  app.exit(1);
});
`;
}

function copyInstalledArtifact(tempRoot) {
  const installedDirectory = path.join(tempRoot, 'installed-app');
  fs.cpSync(artifactSource, installedDirectory, { recursive: true });
  return {
    installedDirectory,
    executablePath: path.join(installedDirectory, executableName),
    childDirectory: path.join(installedDirectory, 'resources', childResourceName),
  };
}

async function waitForParentClose(run) {
  return waitFor(() => run.closeResult, 10000, 'parent process exit');
}

async function verifyOwnedProcessesExited(run, tracked) {
  await waitFor(() => tracked.every((info) => !pidStillMatches(info)), 5000, 'test process cleanup');
  assert.ok(run.closeResult, 'parent close status was not observed');
  assert.ok(run.records.some((entry) => entry.event === 'parent-exit'));
}

async function cleanupOwnedProcesses(run, tracked) {
  tracked.push(...run.observedProcesses.values());
  tracked.push(...processTree(run.child.pid));
  if (run.child.exitCode === null && run.child.signalCode === null) run.child.kill('SIGTERM');
  await Promise.race([
    run.closed,
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
  for (const info of [...tracked].reverse()) {
    if (!pidStillMatches(info)) continue;
    try {
      process.kill(info.pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
  await waitFor(() => tracked.every((info) => !pidStillMatches(info)), 5000, 'owned-process cleanup');
}

const blockedReason = runtimeBlocker();

test('packaged Electron parent/child runtime scenarios', {
  skip: blockedReason || false,
  timeout: 180000,
}, async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'parmar-child-runtime-'));
  const installed = copyInstalledArtifact(tempRoot);
  const childEntry = path.join(installed.childDirectory, 'main.cjs');
  const childPage = path.join(installed.childDirectory, 'index.html');
  const originalEntry = fs.readFileSync(childEntry);
  const originalPage = fs.readFileSync(childPage);

  async function scenario(name, prepare, exercise) {
    await t.test(name, { timeout: perScenarioTimeoutMs + 10000 }, async () => {
      prepare();
      const run = startInstalledParent(installed.executablePath, tempRoot);
      const tracked = [];
      const rootInfo = parseProcStat(run.child.pid);
      if (rootInfo) tracked.push(rootInfo);
      try {
        await exercise(run, tracked);
        await waitForParentClose(run);
        await verifyOwnedProcessesExited(run, tracked);
      } finally {
        await cleanupOwnedProcesses(run, tracked);
        fs.writeFileSync(childEntry, originalEntry);
        fs.writeFileSync(childPage, originalPage);
      }
    });
  }

  const readyRecord = (record) => record.event === 'child-message'
    && record.message?.component === 'aether-child-poc'
    && record.message.event === 'ready';

  try {
    await scenario('child entry missing before launch', () => {
      fs.unlinkSync(childEntry);
    }, async (run) => {
      await run.waitRecord((record) => record.event === 'launch-failed', 'missing-entry failure');
      assert.equal(run.closeResult, null);
      await waitForParentClose(run);
      assert.equal(run.closeResult.code, 1);
      assert.equal(run.records.some((record) => record.event === 'child-spawned'), false);
    });

    await scenario('child reports startup failure for a missing local page', () => {
      fs.unlinkSync(childPage);
    }, async (run, tracked) => {
      const spawned = await run.waitRecord((record) => record.event === 'child-spawned', 'child spawn');
      const childInfo = await waitFor(() => parseProcStat(spawned.childPid), 3000, 'child PID');
      tracked.push(childInfo, ...processTree(run.child.pid));
      await run.waitRecord((record) => record.message?.event === 'startup-failed', 'child startup failure');
      await waitForParentClose(run);
      assert.equal(run.closeResult.code, 1);
    });

    for (const mode of ['exit-before-ready', 'never-ready', 'exit-after-ready', 'ignore-term']) {
      await scenario(`child lifecycle: ${mode}`, () => {
        fs.writeFileSync(childEntry, protocolFixture(mode));
      }, async (run, tracked) => {
        const spawned = await run.waitRecord((record) => record.event === 'child-spawned', 'child spawn');
        const childInfo = await waitFor(() => parseProcStat(spawned.childPid), 3000, 'child PID');
        tracked.push(childInfo, ...processTree(run.child.pid));
        if (mode === 'exit-before-ready') {
          await run.waitRecord(
            (record) => record.event === 'startup-failed' && record.kind === 'child-exited-before-ready',
            'early child exit',
          );
        } else if (mode === 'never-ready') {
          await run.waitRecord(
            (record) => record.event === 'startup-failed' && record.kind === 'startup-timeout',
            'startup timeout',
          );
        } else if (mode === 'exit-after-ready') {
          await run.waitRecord(readyRecord, 'child readiness');
          tracked.push(...processTree(run.child.pid));
          await run.waitRecord((record) => record.event === 'child-exit', 'normal child exit');
          assert.equal(run.records.find((record) => record.event === 'child-exit').code, 0);
        } else {
          await run.waitRecord(readyRecord, 'child readiness');
          tracked.push(...processTree(run.child.pid));
          run.child.kill('SIGUSR1');
          await run.waitRecord(
            (record) => record.event === 'graceful-shutdown-failed',
            'forced child shutdown',
          );
        }
        await waitForParentClose(run);
        assert.equal(run.closeResult.code, mode === 'exit-after-ready' ? 0 : 1);
      });
    }

    await scenario('normal shutdown from an installed copy outside checkout', () => {
      fs.writeFileSync(childEntry, originalEntry);
      fs.writeFileSync(childPage, originalPage);
    }, async (run, tracked) => {
      const parentReady = await run.waitRecord(
        (record) => record.event === 'parent-ready',
        'parent readiness',
      );
      assert.ok(parentReady.executablePath.startsWith(installed.installedDirectory));
      assert.ok(parentReady.appPath.includes('app.asar'));
      assert.equal(parentReady.parentPid, process.pid);
      assert.equal(
        parentReady.resourcesPath,
        path.join(installed.installedDirectory, 'resources'),
      );
      assert.equal(fs.readlinkSync(`/proc/${run.child.pid}/exe`), installed.executablePath);
      const spawned = await run.waitRecord((record) => record.event === 'child-spawned', 'child spawn');
      const childInfo = await waitFor(() => parseProcStat(spawned.childPid), 3000, 'child PID');
      tracked.push(childInfo, ...processTree(run.child.pid));
      const childReady = await run.waitRecord(readyRecord, 'child readiness');
      const message = childReady.message;
      assert.equal(message.entryPoint, childEntry);
      assert.equal(message.appPath, installed.childDirectory);
      assert.equal(
        message.resourcesPath,
        path.join(installed.installedDirectory, 'resources'),
      );
      assert.equal(message.executablePath, installed.executablePath);
      assert.equal(message.parentPid, run.child.pid);
      assert.equal(message.electronVersion, '44.7.0');
      assert.equal(fs.readlinkSync(`/proc/${spawned.childPid}/exe`), installed.executablePath);
      const childCommandLine = fs.readFileSync(`/proc/${spawned.childPid}/cmdline`, 'utf8');
      assert.ok(childCommandLine.includes(installed.childDirectory));
      assert.ok(!childCommandLine.includes('/node_modules/'));
      assert.ok(!JSON.stringify(run.records).includes(process.cwd()));
      assert.equal(parseProcStat(spawned.childPid).parentPid, run.child.pid);
      assert.ok(
        processTree(run.child.pid).some((info) => info.pid === spawned.childPid),
        'child PID was not observed under the parent in /proc',
      );
      run.child.kill('SIGUSR1');
      await run.waitRecord(
        (record) => record.event === 'shutdown-requested'
          && record.reason === 'parent-window-closed',
        'window-close shutdown request',
      );
      await run.waitRecord((record) => record.event === 'child-exit', 'child shutdown');
      assert.equal(run.records.find((record) => record.event === 'child-exit').signal, null);
      assert.equal(run.closeResult, null);
    });
  } finally {
    fs.writeFileSync(childEntry, originalEntry);
    fs.writeFileSync(childPage, originalPage);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

if (blockedReason) {
  test('runtime prerequisite status', { skip: false }, (t) => {
    t.diagnostic(`Runtime tests blocked: ${blockedReason}`);
  });
}
