'use strict';

const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBrokerSession } = require('../broker-protocol.cjs');
const { startBrowserChildBroker } = require('../browser-child-broker.cjs');
const { createBrowserChildSupervisor } = require('../browser-child-supervisor.cjs');

const parent = { pid: 321, uid: 1000 };
const childUid = 1000;

class MockChild extends EventEmitter {
  constructor(pid = 654) {
    super();
    this.pid = pid;
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
  }
}

function createSupervisor(child = new MockChild(), overrides = {}) {
  const calls = [];
  let closeEmitted = false;
  child.once('close', () => { closeEmitted = true; });
  const supervisor = createBrowserChildSupervisor({
    executablePath: '/opt/parmar/electron',
    appPath: '/opt/parmar/desktop',
    environment: {
      DISPLAY: ':1',
      PARMAR_DESKTOP_BACKEND_URL: 'https://must-not-be-inherited.example',
    },
    parentPid: parent.pid,
    parentUid: parent.uid,
    spawnProcess: (...args) => {
      calls.push(args);
      return child;
    },
    processUidReader: () => childUid,
    killProcessGroup: (process, signal) => {
      calls.push(['kill', process.pid, signal]);
      if (!closeEmitted) setImmediate(() => process.emit('close', null, signal));
    },
    startupTimeoutMs: 1000,
    shutdownGraceMs: 1000,
    ...overrides,
  });
  return { supervisor, child, calls };
}

function childMessage(capability, type = 'browser.status', sequence = 0) {
  return `${JSON.stringify({ capability, payload: {}, sequence, type })}\n`;
}

function parentMessage(capability, type, sequence = 0) {
  return `${JSON.stringify({ capability, payload: {}, sequence, type })}\n`;
}

test('browser supervisor launches only the fixed Electron app path without a shell', async () => {
  const { supervisor, child, calls } = createSupervisor();
  const startup = supervisor.start();
  const [, args, options] = calls[0];
  assert.deepEqual(args, ['/opt/parmar/desktop', '--aether-browser-child']);
  assert.equal(options.shell, false);
  assert.equal(options.detached, true);
  assert.equal(options.env.DISPLAY, ':1');
  assert.equal(
    Object.hasOwn(options.env, 'PARMAR_DESKTOP_BACKEND_URL'),
    false,
  );

  const capability = options.env.PARMAR_AETHER_BROKER_CAPABILITY;
  child.stdout.write(childMessage(capability));
  assert.deepEqual(await startup, { pid: child.pid, state: 'ready' });
  supervisor.focus();
  supervisor.newTab();
  supervisor.closeTab();
  const sent = [];
  child.stdin.on('data', (chunk) => sent.push(String(chunk)));
  await new Promise((resolve) => setImmediate(resolve));
  const messages = sent.join('').trim().split('\n').map(JSON.parse);
  assert.deepEqual(messages.map(({ type, sequence }) => [type, sequence]), [
    ['browser.ready', 0],
    ['browser.focus', 1],
    ['browser.new-tab', 2],
    ['browser.close-tab', 3],
  ]);

  const stopping = supervisor.stop();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(JSON.parse(sent.at(-1)).type, 'browser.stop');
  child.emit('close', 0, null);
  assert.deepEqual(await stopping, { code: 0, signal: null });
  assert.equal(supervisor.state, 'stopped');
  assert.ok(calls.some((call) => call[0] === 'kill' && call[2] === 'SIGKILL'));
});

test('browser supervisor rejects malformed or unauthorized child IPC and cleans its process group', async () => {
  for (const response of [
    'not-json\n',
    childMessage('A'.repeat(43), 'browser.status'),
    childMessage(Buffer.alloc(32, 4).toString('base64url'), 'browser.stop'),
  ]) {
    const { supervisor, child, calls } = createSupervisor();
    const startup = supervisor.start();
    const exited = new Promise((resolve) => supervisor.on('exit', resolve));
    child.stdout.write(response);
    await assert.rejects(startup, /IPC|unauthorized/);
    await exited;
    assert.equal(supervisor.state, 'stopped');
    assert.ok(calls.some((call) => call[0] === 'kill' && call[1] === child.pid));
  }
});

test('browser supervisor reports startup failure and cleans up an early child exit', async () => {
  const { supervisor, child, calls } = createSupervisor();
  const startup = supervisor.start();
  child.emit('close', 19, null);
  await assert.rejects(startup, /exited before readiness/);
  assert.equal(supervisor.state, 'stopped');
  assert.ok(calls.some((call) => call[0] === 'kill'));
});

test('browser supervisor reports a spawn failure without leaving an unhandled child error', async () => {
  const child = new MockChild(0);
  const { supervisor } = createSupervisor(child);
  const startup = supervisor.start();
  child.emit('error', Object.assign(new Error('Executable unavailable.'), { code: 'ENOENT' }));
  child.emit('close', -2, null);
  await assert.rejects(startup, /Executable unavailable/);
  assert.equal(supervisor.state, 'stopped');
});

test('browser supervisor rejects a child running under an unexpected UID', async () => {
  const { supervisor, child } = createSupervisor(undefined, {
    processUidReader: () => childUid + 1,
  });
  const startup = supervisor.start();
  child.emit('close', null, 'SIGKILL');
  await assert.rejects(startup, /unexpected UID/);
  assert.equal(supervisor.state, 'stopped');
});

test('browser supervisor enforces startup timeout and kills the child process group', async () => {
  const { supervisor, child, calls } = createSupervisor(undefined, {
    startupTimeoutMs: 100,
  });
  const exited = new Promise((resolve) => supervisor.on('exit', resolve));
  await assert.rejects(supervisor.start(), /startup timed out/);
  await exited;
  assert.equal(supervisor.state, 'stopped');
  assert.ok(calls.some((call) => call[0] === 'kill' && call[1] === child.pid));
});

test('browser supervisor observes a browser crash after readiness and cleans descendants', async () => {
  const { supervisor, child, calls } = createSupervisor();
  const startup = supervisor.start();
  child.stdout.write(childMessage(calls[0][2].env.PARMAR_AETHER_BROKER_CAPABILITY));
  await startup;
  const exit = new Promise((resolve) => supervisor.on('exit', resolve));
  child.emit('close', 23, null);
  assert.deepEqual(await exit, { code: 23, signal: null, priorState: 'ready' });
  assert.equal(supervisor.state, 'stopped');
  assert.ok(calls.some((call) => call[0] === 'kill' && call[1] === child.pid));
});

test('browser supervisor terminates a ready child that sends an unauthorized action', async () => {
  const { supervisor, child, calls } = createSupervisor();
  const startup = supervisor.start();
  const capability = calls[0][2].env.PARMAR_AETHER_BROKER_CAPABILITY;
  child.stdout.write(childMessage(capability));
  await startup;
  const exited = new Promise((resolve) => supervisor.on('exit', resolve));
  child.stdout.write(childMessage(capability, 'browser.stop', 1));
  await exited;
  assert.equal(supervisor.state, 'stopped');
  assert.ok(calls.some((call) => call[0] === 'kill' && call[1] === child.pid));
});

test('browser child broker permits only authenticated fixed browser actions', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const capability = Buffer.alloc(32, 9).toString('base64url');
  const actions = [];
  const failures = [];
  const broker = startBrowserChildBroker({
    input,
    output,
    environment: { PARMAR_AETHER_BROKER_CAPABILITY: capability },
    parentPid: parent.pid,
    processUidReader: () => parent.uid,
    onFocus: () => actions.push('focus'),
    onNewTab: () => actions.push('new-tab'),
    onCloseTab: () => actions.push('close-tab'),
    onStop: () => actions.push('stop'),
    onFailure: (error) => failures.push(error),
  });
  broker.sendStatus();
  const session = createBrokerSession(parent, Date.now(), capability);
  input.write(parentMessage(capability, 'browser.ready'));
  input.write(parentMessage(capability, 'browser.focus', 1));
  input.write(parentMessage(capability, 'browser.new-tab', 2));
  input.write(parentMessage(capability, 'browser.close-tab', 3));
  input.write(parentMessage(capability, 'browser.stop', 4));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(actions, ['focus', 'new-tab', 'close-tab', 'stop']);
  assert.deepEqual(failures, []);
  const status = JSON.parse(output.read().toString());
  assert.equal(status.type, 'browser.status');
  assert.equal(status.capability, session.capability);
  broker.close();
});

test('browser child broker fails closed on unauthorized, malformed, and parent-disconnected IPC', async () => {
  for (const message of [
    '{\n',
    `${JSON.stringify({ capability: 'A'.repeat(43), payload: {}, sequence: 0, type: 'browser.stop' })}\n`,
    parentMessage(Buffer.alloc(32, 3).toString('base64url'), 'browser.status'),
  ]) {
    const input = new PassThrough();
    const failures = [];
    startBrowserChildBroker({
      input,
      output: new PassThrough(),
      environment: { PARMAR_AETHER_BROKER_CAPABILITY: Buffer.alloc(32, 9).toString('base64url') },
      parentPid: parent.pid,
      processUidReader: () => parent.uid,
      onStop() {},
      onFocus() {},
      onNewTab() {},
      onCloseTab() {},
      onFailure: (error) => failures.push(error),
    });
    input.write(message);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(failures.length, 1);
  }

  const input = new PassThrough();
  const failures = [];
  startBrowserChildBroker({
    input,
    output: new PassThrough(),
    environment: { PARMAR_AETHER_BROKER_CAPABILITY: Buffer.alloc(32, 9).toString('base64url') },
    parentPid: parent.pid,
    processUidReader: () => parent.uid,
    onStop() {},
    onFocus() {},
    onNewTab() {},
    onCloseTab() {},
    onFailure: (error) => failures.push(error),
  });
  input.end();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(failures[0].message, /parent disconnected/);
});
