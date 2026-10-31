'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  DISPLAY_SERVER_WESTON,
  DISPLAY_SERVER_XVFB,
  displayConfiguration,
  imageCommand,
  processGroupHasLiveMembers,
  requiredExecutables,
  startHeadlessDisplay,
  stopDisplay,
} = require('./headless-display.cjs');

class FixtureChild extends EventEmitter {
  constructor(pid = 43210) {
    super();
    this.pid = pid;
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.exitCode = null;
    this.signalCode = null;
    this.signals = [];
  }

  kill(signal) {
    this.signals.push(signal);
    this.close(signal);
    return true;
  }

  close(signal = null) {
    this.signalCode = signal;
    this.emit('exit', null, signal);
    this.emit('close', null, signal);
  }
}

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-display-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('display configuration preserves Xvfb and legacy image defaults', () => {
  assert.deepEqual(displayConfiguration({}), { backend: DISPLAY_SERVER_XVFB, imageMode: 'legacy' });
  assert.deepEqual(displayConfiguration({
    PARMAR_AETHER_UI_DISPLAY_SERVER: DISPLAY_SERVER_WESTON,
    PARMAR_AETHER_UI_IMAGE_MODE: 'magick',
  }), { backend: DISPLAY_SERVER_WESTON, imageMode: 'magick' });
  assert.throws(
    () => displayConfiguration({ PARMAR_AETHER_UI_DISPLAY_SERVER: 'simulated' }),
    /Unsupported AETHER UI display server/,
  );
});

test('required executable paths keep isolation tools fixed and require real Xwayland', () => {
  const executables = requiredExecutables({
    backend: DISPLAY_SERVER_WESTON,
    imageMode: 'magick',
    toolDirectory: '/user/qa/bin',
  });
  assert.deepEqual(executables, [
    '/user/qa/bin/weston',
    '/user/qa/bin/xdotool',
    '/user/qa/bin/magick',
    '/usr/bin/unshare',
    '/usr/bin/setpriv',
    '/user/qa/bin/Xwayland',
  ]);
});

test('process-group cleanup fails closed when procfs cannot verify a process entry', () => {
  const denied = Object.assign(new Error('permission denied'), { code: 'EACCES' });
  assert.throws(() => processGroupHasLiveMembers(43210, {
    readdirSync: () => ['12345'],
    readFileSync: () => { throw denied; },
  }), { code: 'EACCES' });
  assert.throws(() => processGroupHasLiveMembers(43210, {
    readdirSync: () => { throw Object.assign(new Error('procfs unavailable'), { code: 'ENOENT' }); },
    readFileSync() {},
  }), { code: 'ENOENT' });
});

test('Weston waits for its real Xwayland display and Wayland socket', async (t) => {
  const runtimeDirectory = path.join(temporaryDirectory(t), 'runtime');
  let spawnOptions;
  let server;
  let waylandSocket;
  const sessionPromise = startHeadlessDisplay({
    backend: DISPLAY_SERVER_WESTON,
    toolDirectory: '/user/qa/bin',
    runtimeDirectory,
    environment: { PATH: '/usr/bin', DISPLAY: ':host', WAYLAND_DISPLAY: 'host-wayland' },
    timeoutMs: 1000,
    spawnProcess(executable, args, options) {
      assert.equal(executable, '/user/qa/bin/weston');
      assert.ok(args.includes('--backend=headless-backend.so'));
      assert.ok(args.includes('--xwayland'));
      spawnOptions = options;
      server = new FixtureChild();
      setImmediate(() => {
        const socketName = args.find((argument) => argument.startsWith('--socket=')).slice(9);
        waylandSocket = net.createServer();
        waylandSocket.listen(path.join(runtimeDirectory, socketName), () => {
          server.stderr.write('xserver listening on display :37\n');
        });
      });
      return server;
    },
    signalProcessGroup() {},
    hasLiveGroupMembers: () => false,
  });

  const session = await sessionPromise;
  assert.equal(session.display, ':37');
  assert.match(session.waylandDisplay, /^aether-[a-f0-9]{16}$/);
  assert.equal(fs.statSync(runtimeDirectory).mode & 0o777, 0o700);
  assert.equal(spawnOptions.detached, true);
  assert.equal(spawnOptions.env.XDG_RUNTIME_DIR, runtimeDirectory);
  assert.equal(spawnOptions.env.DISPLAY, undefined);
  assert.equal(spawnOptions.env.WAYLAND_DISPLAY, undefined);
  assert.ok(spawnOptions.env.PATH.startsWith('/user/qa/bin:'));
  await new Promise((resolve, reject) => {
    waylandSocket.close((error) => (error ? reject(error) : resolve()));
  });
  await stopDisplay(session, {
    signalProcessGroup(_groupId, signal) { server.close(signal); },
    hasLiveGroupMembers: () => false,
  });
});

test('startup failures report errors and stop the started server', async () => {
  const server = new FixtureChild();
  const failure = new Error('fixture spawn failure');
  const start = startHeadlessDisplay({
    backend: DISPLAY_SERVER_XVFB,
    spawnProcess() {
      queueMicrotask(() => server.emit('error', failure));
      return server;
    },
  });
  await assert.rejects(start, /fixture spawn failure/);
  assert.deepEqual(server.signals, ['SIGTERM']);
});

test('a display process that exits before readiness is reported as a startup failure', async () => {
  const server = new FixtureChild();
  await assert.rejects(startHeadlessDisplay({
    backend: DISPLAY_SERVER_XVFB,
    spawnProcess() {
      queueMicrotask(() => {
        server.exitCode = 1;
        server.emit('exit', 1, null);
      });
      return server;
    },
  }), /xvfb exited before readiness \(1\)/);
});

test('readiness timeout fails closed and terminates the display process', async () => {
  const server = new FixtureChild();
  await assert.rejects(startHeadlessDisplay({
    backend: DISPLAY_SERVER_XVFB,
    timeoutMs: 20,
    spawnProcess() { return server; },
  }), /xvfb readiness timed out/);
  assert.deepEqual(server.signals, ['SIGTERM']);
});

test('Xvfb readiness returns its allocated display and normal shutdown is graceful', async () => {
  const server = new FixtureChild();
  const sessionPromise = startHeadlessDisplay({
    backend: DISPLAY_SERVER_XVFB,
    spawnProcess() {
      queueMicrotask(() => server.stdout.write('6\n'));
      return server;
    },
  });
  const session = await sessionPromise;
  assert.equal(session.display, ':6');
  await stopDisplay(session);
  assert.deepEqual(server.signals, ['SIGTERM']);
});

test('Weston shutdown signals the whole process group and verifies child cleanup', async () => {
  const server = new FixtureChild(7654);
  const signals = [];
  let childProcessAlive = true;
  await stopDisplay({ backend: DISPLAY_SERVER_WESTON, server }, {
    signalProcessGroup(groupId, signal) {
      signals.push([groupId, signal]);
      childProcessAlive = false;
      server.close(signal);
    },
    hasLiveGroupMembers: () => childProcessAlive,
    sleepFor: async () => {},
  });
  assert.deepEqual(signals, [[7654, 'SIGTERM']]);
  assert.equal(childProcessAlive, false);
});

test('Weston cleanup still kills Xwayland if the Weston leader already exited', async () => {
  const server = new FixtureChild(7655);
  server.exitCode = 0;
  let xwaylandAlive = true;
  const signals = [];
  await stopDisplay({ backend: DISPLAY_SERVER_WESTON, server }, {
    signalProcessGroup(groupId, signal) {
      signals.push([groupId, signal]);
      xwaylandAlive = false;
    },
    hasLiveGroupMembers: () => xwaylandAlive,
    sleepFor: async () => {},
  });
  assert.deepEqual(signals, [[7655, 'SIGTERM']]);
  assert.equal(xwaylandAlive, false);
});

test('Weston cleanup escalates to SIGKILL when a child ignores graceful shutdown', async () => {
  const server = new FixtureChild(7656);
  let xwaylandAlive = true;
  const signals = [];
  await stopDisplay({ backend: DISPLAY_SERVER_WESTON, server }, {
    gracePeriodMs: 1,
    killPeriodMs: 10,
    signalProcessGroup(groupId, signal) {
      signals.push([groupId, signal]);
      if (signal === 'SIGKILL') {
        xwaylandAlive = false;
        server.close(signal);
      }
    },
    hasLiveGroupMembers: () => xwaylandAlive,
    sleepFor: async () => {},
  });
  assert.deepEqual(signals, [[7656, 'SIGTERM'], [7656, 'SIGKILL']]);
  assert.equal(xwaylandAlive, false);
});

test('ImageMagick 7 uses its genuine magick import and conversion commands', () => {
  assert.deepEqual(imageCommand('import', ['-window', '0x1', '/tmp/window.png'], {
    imageMode: 'magick',
    toolDirectory: '/user/qa/bin',
  }), {
    executable: '/user/qa/bin/magick',
    arguments: ['import', '-window', '0x1', '/tmp/window.png'],
  });
  assert.deepEqual(imageCommand('convert', ['screen.png', '-format', '%w %h', 'info:'], {
    imageMode: 'magick',
    toolDirectory: '/user/qa/bin',
  }), {
    executable: '/user/qa/bin/magick',
    arguments: ['screen.png', '-format', '%w %h', 'info:'],
  });
});
