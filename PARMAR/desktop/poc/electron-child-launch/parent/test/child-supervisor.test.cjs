'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ChildSupervisor, MAX_PROTOCOL_LINE_BYTES } = require('../child-supervisor.cjs');
const { resolveFixedLaunchTarget } = require('../fixed-launch-target.cjs');

const executablePath = '/fixed/electron';
const childAppPath = '/fixed/resources/aether-child';
const childEntryPoint = path.join(childAppPath, 'main.cjs');
const resourcesPath = '/fixed/resources';
const childPage = path.join(childAppPath, 'index.html');
const electronVersion = '44.7.0';
const parentPid = process.pid;

class FakeChild extends EventEmitter {
  constructor({ pid = 42001, terminateOnTerm = true } = {}) {
    super();
    this.pid = pid;
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.signals = [];
    this.terminateOnTerm = terminateOnTerm;
  }

  kill(signal) {
    this.signals.push(signal);
    if (signal === 'SIGTERM' && !this.terminateOnTerm) return true;
    setImmediate(() => this.emit('exit', null, signal));
    return true;
  }

  send(message) {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }
}

function messageFor(child, event = 'ready', details = {}) {
  return {
    protocol: 1,
    component: 'aether-child-poc',
    event,
    electronVersion,
    executablePath,
    entryPoint: childEntryPoint,
    appPath: childAppPath,
    resourcesPath,
    pid: child.pid,
    parentPid,
    ...(event === 'ready' ? { localPage: childPage } : {}),
    ...details,
  };
}

function createSupervisor(child, options = {}) {
  const records = [];
  const supervisor = new ChildSupervisor({
    spawnChild: () => child,
    executablePath,
    childAppPath,
    childEntryPoint,
    resourcesPath,
    electronVersion,
    parentPid,
    startupTimeoutMs: options.startupTimeoutMs ?? 100,
    terminationGraceMs: options.terminationGraceMs ?? 20,
    forceExitTimeoutMs: options.forceExitTimeoutMs ?? 100,
    record: (event, details) => records.push({ event, ...details }),
  });
  return { supervisor, records };
}

function afterStart(callback) {
  setImmediate(callback);
}

test('fixed launch target rejects a missing child entry before any spawn', {
  timeout: 2000,
}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parmar-child-target-'));
  const executable = path.join(root, 'electron');
  const resources = path.join(root, 'resources');
  fs.mkdirSync(resources);
  fs.writeFileSync(executable, '');
  try {
    assert.throws(
      () => resolveFixedLaunchTarget(executable, resources),
      /Fixed child entry point is not a file/,
    );

    const childDirectory = path.join(resources, 'aether-child');
    fs.mkdirSync(childDirectory);
    fs.writeFileSync(path.join(childDirectory, 'main.cjs'), '');
    assert.deepEqual(resolveFixedLaunchTarget(executable, resources), {
      executablePath: executable,
      childAppPath: childDirectory,
      childEntryPoint: path.join(childDirectory, 'main.cjs'),
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('synchronous spawn failure resolves the supervisor as a bounded failure', {
  timeout: 2000,
}, async () => {
  const records = [];
  const supervisor = new ChildSupervisor({
    spawnChild: () => {
      throw new Error('fixture spawn failure');
    },
    executablePath,
    childAppPath,
    childEntryPoint,
    resourcesPath,
    electronVersion,
    parentPid,
    record: (event, details) => records.push({ event, ...details }),
  });
  await assert.rejects(supervisor.start(), { code: 'spawn-error' });
  assert.equal((await supervisor.waitForExit()).failureStatus, 1);
  assert.ok(records.some((record) => record.event === 'startup-failed'));
});

test('accepts one complete readiness message for the fixed child identity', {
  timeout: 2000,
}, async () => {
  const child = new FakeChild();
  const { supervisor, records } = createSupervisor(child);
  const ready = supervisor.start();
  afterStart(() => child.send(messageFor(child)));

  const result = await ready;
  assert.equal(result.pid, child.pid);
  assert.equal(supervisor.state, 'ready');
  assert.equal(records.filter((record) => record.event === 'child-ready').length, 1);
  const stopped = supervisor.stop('test-stop');
  const exit = await stopped;
  assert.equal(exit.failureStatus, 0);
});

test('rejects malformed, unexpected-identity, and duplicate readiness messages', {
  timeout: 2000,
}, async (t) => {
  await t.test('malformed line', async () => {
    const child = new FakeChild();
    const { supervisor, records } = createSupervisor(child);
    const ready = supervisor.start();
    afterStart(() => child.stdout.write('not-json\n'));
    await assert.rejects(ready, { code: 'protocol-error' });
    assert.ok(records.some((record) => record.kind === 'protocol-error'));
    assert.equal((await supervisor.waitForExit()).failureStatus, 1);
  });

  await t.test('wrong identity', async () => {
    const child = new FakeChild();
    const { supervisor } = createSupervisor(child);
    const ready = supervisor.start();
    afterStart(() => child.send(messageFor(child, 'ready', { parentPid: parentPid + 1 })));
    await assert.rejects(ready, { code: 'protocol-error' });
    assert.equal((await supervisor.waitForExit()).failureStatus, 1);
  });

  await t.test('duplicate readiness after ready', async () => {
    const child = new FakeChild();
    const { supervisor, records } = createSupervisor(child);
    const ready = supervisor.start();
    afterStart(() => child.send(messageFor(child)));
    await ready;
    child.send(messageFor(child));
    assert.equal((await supervisor.waitForExit()).failureStatus, 1);
    assert.ok(records.some((record) => record.event === 'protocol-error'));
  });
});

test('rejects oversized protocol messages', { timeout: 2000 }, async () => {
  const child = new FakeChild();
  const { supervisor } = createSupervisor(child);
  const ready = supervisor.start();
  afterStart(() => child.stdout.write(`${'x'.repeat(MAX_PROTOCOL_LINE_BYTES + 1)}\n`));
  await assert.rejects(ready, { code: 'protocol-error' });
  assert.equal((await supervisor.waitForExit()).failureStatus, 1);
});

test('child startup failure is a reported failure and terminates the child', {
  timeout: 2000,
}, async () => {
  const child = new FakeChild();
  const { supervisor, records } = createSupervisor(child);
  const ready = supervisor.start();
  afterStart(() => child.send(messageFor(child, 'startup-failed', { reason: 'fixture error' })));
  await assert.rejects(ready, { code: 'child-startup-failed' });
  const result = await supervisor.waitForExit();
  assert.equal(result.failureStatus, 1);
  assert.ok(records.some((record) => record.reason === 'fixture error'));
  assert.deepEqual(child.signals, ['SIGTERM']);
});

test('child exit before readiness rejects startup', { timeout: 2000 }, async () => {
  const child = new FakeChild();
  const { supervisor, records } = createSupervisor(child);
  const ready = supervisor.start();
  afterStart(() => child.emit('exit', 7, null));
  await assert.rejects(ready, { code: 'child-exited-before-ready' });
  assert.equal((await supervisor.waitForExit()).failureStatus, 1);
  assert.ok(records.some((record) => record.event === 'child-exit' && record.code === 7));
});

test('startup timeout terminates then escalates within bounded time', {
  timeout: 2000,
}, async () => {
  const child = new FakeChild({ terminateOnTerm: false });
  const { supervisor, records } = createSupervisor(child, {
    startupTimeoutMs: 20,
    terminationGraceMs: 20,
  });
  const ready = supervisor.start();
  await assert.rejects(ready, { code: 'startup-timeout' });
  const result = await supervisor.waitForExit();
  assert.equal(result.failureStatus, 1);
  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL']);
  assert.ok(records.some((record) => record.event === 'graceful-shutdown-failed'));
  assert.ok(records.some((record) => record.event === 'child-exit' && record.signal === 'SIGKILL'));
});

test('late readiness after startup timeout is rejected', { timeout: 2000 }, async () => {
  const child = new FakeChild({ terminateOnTerm: false });
  const { supervisor, records } = createSupervisor(child, {
    startupTimeoutMs: 20,
    terminationGraceMs: 100,
  });
  const ready = supervisor.start();
  await assert.rejects(ready, { code: 'startup-timeout' });
  child.send(messageFor(child));
  assert.equal((await supervisor.waitForExit()).failureStatus, 1);
  assert.equal(records.some((record) => record.event === 'child-ready'), false);
  assert.ok(records.some((record) => record.event === 'protocol-error'));
});

test('a clean child exit after readiness is not a startup failure', {
  timeout: 2000,
}, async () => {
  const child = new FakeChild();
  const { supervisor } = createSupervisor(child);
  const ready = supervisor.start();
  afterStart(() => child.send(messageFor(child)));
  await ready;
  child.emit('exit', 0, null);
  assert.deepEqual(await supervisor.waitForExit(), { code: 0, signal: null, failureStatus: 0 });
});

test('shutdown ignoring SIGTERM is escalated and reported as failure', {
  timeout: 2000,
}, async () => {
  const child = new FakeChild({ terminateOnTerm: false });
  const { supervisor, records } = createSupervisor(child, { terminationGraceMs: 20 });
  const ready = supervisor.start();
  afterStart(() => child.send(messageFor(child)));
  await ready;
  const result = await supervisor.stop('test-window-close');
  assert.equal(result.failureStatus, 1);
  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL']);
  assert.ok(records.some((record) => record.event === 'graceful-shutdown-failed'));
});

test('a real Node fixture reports exact PID ancestry and exits cleanly', {
  timeout: 4000,
}, async () => {
  const fixture = new ChildProcessFixture();
  const supervisor = new ChildSupervisor({
    spawnChild: () => spawn(process.execPath, ['-e', fixture.source], {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
    executablePath: process.execPath,
    childAppPath,
    childEntryPoint,
    resourcesPath,
    electronVersion,
    parentPid: process.pid,
    startupTimeoutMs: 1000,
    terminationGraceMs: 500,
    forceExitTimeoutMs: 500,
    record: fixture.record.bind(fixture),
  });

  const ready = await supervisor.start();
  const childPid = supervisor.child.pid;
  assert.equal(ready.pid, childPid);
  assert.equal(ready.parentPid, process.pid);
  const stat = fs.readFileSync(`/proc/${childPid}/stat`, 'utf8');
  const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  assert.equal(Number(fields[1]), process.pid);

  const result = await supervisor.stop('fixture-complete');
  assert.equal(result.failureStatus, 0);
  assert.equal(fs.existsSync(`/proc/${childPid}`), false);
});

class ChildProcessFixture {
  constructor() {
    this.records = [];
    this.source = `
      const path = require('node:path');
      const childAppPath = ${JSON.stringify(childAppPath)};
      process.stdout.write(JSON.stringify({
        protocol: 1,
        component: 'aether-child-poc',
        event: 'ready',
        electronVersion: ${JSON.stringify(electronVersion)},
        executablePath: process.execPath,
        entryPoint: ${JSON.stringify(childEntryPoint)},
        appPath: childAppPath,
        resourcesPath: ${JSON.stringify(resourcesPath)},
        pid: process.pid,
        parentPid: process.ppid,
        localPage: path.join(childAppPath, 'index.html')
      }) + '\\n');
      process.on('SIGTERM', () => process.exit(0));
    `;
  }

  record(event, details) {
    this.records.push({ event, ...details });
  }
}
