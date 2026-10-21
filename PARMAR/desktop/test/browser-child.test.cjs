'use strict';

const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const path = require('node:path');
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
      PARMAR_AETHER_PRODUCTION_NETWORK_PROBE: '1',
      PARMAR_AETHER_PRODUCTION_NETWORK_PROBE_TARGETS: '{"targets":[]}',
    },
    parentPid: parent.pid,
    parentUid: parent.uid,
    resolveIsolationExecutable: (name) => `/tools/${name}`,
    parentNamespaceReader: () => 'net:[100]',
    processNamespaceReader: () => 'net:[200]',
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

test('browser supervisor launches the fixed Electron app through the shell-free isolation argv', async () => {
  const { supervisor, child, calls } = createSupervisor();
  const startup = supervisor.start();
  const [executable, args, options] = calls[0];
  assert.equal(executable, '/tools/unshare');
  assert.deepEqual(args.slice(0, 7), [
    '--user', '--map-current-user', '--net', '--fork', '--kill-child=SIGKILL', '--', '/tools/setpriv',
  ]);
  assert.deepEqual(args.slice(7, 13), [
    '--inh-caps=-all', '--ambient-caps=-all', '--no-new-privs', '--',
    '/opt/parmar/electron', '/opt/parmar/desktop',
  ]);
  assert.equal(args.at(-1), '--aether-browser-child');
  assert.equal(options.shell, false);
  assert.equal(options.detached, true);
  assert.equal(options.env.DISPLAY, ':1');
  assert.equal(options.env.PARMAR_AETHER_PARENT_NETNS, 'net:[100]');
  assert.equal(options.env.PARMAR_AETHER_IP_PATH, '/tools/ip');
  assert.equal(Object.hasOwn(options.env, 'LD_LIBRARY_PATH'), false);
  assert.equal(Object.hasOwn(options.env, 'PARMAR_AETHER_PRODUCTION_NETWORK_PROBE'), false);
  assert.equal(Object.hasOwn(options.env, 'PARMAR_AETHER_PRODUCTION_NETWORK_PROBE_TARGETS'), false);
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

test('browser supervisor passes the packaged app.asar path as a fixed child argument', async () => {
  const { supervisor, child, calls } = createSupervisor(undefined, {
    executablePath: '/opt/parmar-aether/parmar-aether-desktop',
    appPath: '/opt/parmar-aether/resources/app.asar',
  });
  const startup = supervisor.start();
  const [, args, options] = calls[0];
  assert.equal(options.shell, false);
  assert.equal(args.includes('/opt/parmar-aether/resources/app.asar'), true);
  assert.equal(args.includes('/opt/parmar-aether/parmar-aether-desktop'), true);
  assert.equal(args.at(-1), '--aether-browser-child');
  child.stdout.write(childMessage(options.env.PARMAR_AETHER_BROKER_CAPABILITY));
  await startup;
  const stopping = supervisor.stop();
  child.emit('close', 0, null);
  await stopping;
});

test('AppImage child receives only builder-owned runtime library and data paths', async () => {
  const { supervisor, child, calls } = createSupervisor(undefined, {
    executablePath: '/tmp/.mount_aether/parmar-aether-desktop',
    appPath: '/tmp/.mount_aether/resources/app.asar',
    environment: {
      APPDIR: '/tmp/.mount_aether',
      LD_LIBRARY_PATH: '/tmp/.mount_aether/usr/lib:/tmp/untrusted-libraries',
      DISPLAY: ':1',
    },
  });
  const startup = supervisor.start();
  const options = calls[0][2];
  assert.equal(options.env.APPDIR, '/tmp/.mount_aether');
  assert.equal(options.env.LD_LIBRARY_PATH, '/tmp/.mount_aether/usr/lib');
  assert.equal(
    options.env.GSETTINGS_SCHEMA_DIR,
    '/tmp/.mount_aether/usr/share/glib-2.0/schemas',
  );
  assert.equal(options.env.XDG_DATA_DIRS, [
    '/tmp/.mount_aether/usr/share', '/usr/share/gnome', '/usr/local/share', '/usr/share',
  ].join(path.delimiter));
  child.stdout.write(childMessage(options.env.PARMAR_AETHER_BROKER_CAPABILITY));
  await startup;
  const stopping = supervisor.stop();
  child.emit('close', 0, null);
  await stopping;
});

test('built Linux artifact contains launchable app.asar paths and required browser isolation assets', {
  skip: !require('node:fs').existsSync(
    require('node:path').resolve(__dirname, '../dist/linux-unpacked/resources/app.asar'),
  ),
}, async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const asar = require('@electron/asar');
  const artifactDirectory = path.resolve(__dirname, '../dist/linux-unpacked');
  const electronExecutable = path.join(artifactDirectory, 'parmar-aether-desktop');
  const appArchive = path.join(artifactDirectory, 'resources/app.asar');
  assert.equal(fs.statSync(electronExecutable).mode & 0o111 ? true : false, true);
  const files = asar.listPackage(appArchive);
  for (const required of [
    '/main.cjs',
    '/browser-child-supervisor.cjs',
    '/browser-child-broker.cjs',
    '/isolation-launcher.cjs',
    '/isolation-probe.cjs',
    '/browser-preload.cjs',
    '/browser.html',
    '/newtab.html',
  ]) {
    assert.ok(files.includes(required), `Packaged app.asar omits ${required}.`);
  }
  assert.equal(
    fs.existsSync(path.join(artifactDirectory, 'resources/aether/parmar-emblem.png')),
    true,
    'Packaged resources omit the original PARMAR emblem.',
  );

  const { supervisor, child, calls } = createSupervisor(undefined, {
    executablePath: electronExecutable,
    appPath: appArchive,
  });
  const startup = supervisor.start();
  const [, args, options] = calls[0];
  assert.equal(options.shell, false);
  assert.ok(args.includes(electronExecutable));
  assert.ok(args.includes(appArchive));
  assert.equal(args.at(-1), '--aether-browser-child');
  child.stdout.write(childMessage(options.env.PARMAR_AETHER_BROKER_CAPABILITY));
  await startup;
  const stopping = supervisor.stop();
  child.emit('close', 0, null);
  await stopping;
});

test('browser supervisor rejects a child that reports readiness in the host namespace', async () => {
  const { supervisor, child, calls } = createSupervisor(undefined, {
    processNamespaceReader: () => 'net:[100]',
  });
  const startup = supervisor.start();
  const exited = new Promise((resolve) => supervisor.on('exit', resolve));
  child.stdout.write(childMessage(calls[0][2].env.PARMAR_AETHER_BROKER_CAPABILITY));
  await assert.rejects(startup, /shares the host network namespace/);
  await exited;
  assert.equal(supervisor.state, 'stopped');
  assert.ok(calls.some((call) => call[0] === 'kill' && call[1] === child.pid));
});

test('browser supervisor fails closed when a required isolation executable is unavailable', async () => {
  let spawnCount = 0;
  const { supervisor } = createSupervisor(undefined, {
    resolveIsolationExecutable(name) {
      if (name === 'unshare') throw new Error('Required isolation command is unavailable: unshare.');
      return `/tools/${name}`;
    },
    spawnProcess() {
      spawnCount += 1;
      throw new Error('unrestricted fallback must not run');
    },
  });

  await assert.rejects(supervisor.start(), /Required isolation command is unavailable: unshare/);
  assert.equal(supervisor.state, 'stopped');
  assert.equal(spawnCount, 0);
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
  const { supervisor, child, calls } = createSupervisor(undefined, { maxCrashRestarts: 0 });
  const startup = supervisor.start();
  child.stdout.write(childMessage(calls[0][2].env.PARMAR_AETHER_BROKER_CAPABILITY));
  await startup;
  const exit = new Promise((resolve) => supervisor.on('exit', resolve));
  child.emit('close', 23, null);
  assert.deepEqual(await exit, { code: 23, signal: null, priorState: 'ready' });
  assert.equal(supervisor.state, 'stopped');
  assert.ok(calls.some((call) => call[0] === 'kill' && call[1] === child.pid));
});

test('browser supervisor retries a crashed child within its bounded recovery budget', async () => {
  const children = [new MockChild(654), new MockChild(655)];
  const calls = [];
  let spawnCount = 0;
  let resolveSecondSpawn;
  const secondSpawn = new Promise((resolve) => { resolveSecondSpawn = resolve; });
  const supervisor = createBrowserChildSupervisor({
    executablePath: '/opt/parmar/electron',
    appPath: '/opt/parmar/desktop',
    parentPid: parent.pid,
    parentUid: parent.uid,
    resolveIsolationExecutable: (name) => `/tools/${name}`,
    parentNamespaceReader: () => 'net:[100]',
    processNamespaceReader: () => 'net:[200]',
    processUidReader: () => childUid,
    spawnProcess: (...args) => {
      calls.push(args);
      const child = children[spawnCount++];
      if (spawnCount === 2) resolveSecondSpawn(child);
      return child;
    },
    killProcessGroup() {},
    startupTimeoutMs: 1000,
    crashRestartDelayMs: 10,
    maxCrashRestarts: 1,
  });

  const firstStart = supervisor.start();
  children[0].stdout.write(childMessage(calls[0][2].env.PARMAR_AETHER_BROKER_CAPABILITY));
  await firstStart;
  const recoveryReady = new Promise((resolve) => supervisor.on('ready', resolve));
  children[0].emit('close', 23, null);
  await secondSpawn;
  children[1].stdout.write(childMessage(calls[1][2].env.PARMAR_AETHER_BROKER_CAPABILITY));
  await recoveryReady;
  assert.equal(spawnCount, 2);
  children[1].emit('close', 23, null);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(spawnCount, 2);
  assert.equal(supervisor.state, 'stopped');
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
