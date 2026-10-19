'use strict';

const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createLauncher,
  launchOfflineProbe,
  terminateProcessGroup,
  validateOptions,
} = require('../isolation-launcher.cjs');
const {
  verifyIsolationReport,
  verifyIsolationSnapshot,
} = require('../isolation-probe.cjs');

const validSnapshot = () => ({
  namespaceId: 'net:[4026532228]',
  parentNamespaceId: 'net:[4026531840]',
  interfaces: [{
    ifname: 'lo',
    flags: ['LOOPBACK'],
    operstate: 'DOWN',
  }],
  ipv4Routes: [],
  ipv6Routes: [],
  firewall: { nftables: [{ metainfo: { version: 'test' } }] },
  effectiveCapabilities: '0',
  noNewPrivileges: '1',
});

class MockChild extends EventEmitter {
  constructor(pid = 999999) {
    super();
    this.pid = pid;
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
  }
}

function mockedLauncher({ spawnProcess, killProcessGroup, platform = 'linux' }) {
  return createLauncher({
    platform,
    spawnProcess,
    killProcessGroup,
    resolveExecutable: (name) => `/mock/${name}`,
    parentNamespace: () => 'net:[4026531840]',
    brokerPeerUid: 1000,
    processUidReader: () => 1000,
  });
}

test('offline verifier rejects a shared namespace, extra interfaces, routes, rules, or capabilities', () => {
  assert.equal(verifyIsolationSnapshot(validSnapshot()).ipv4Routes, 0);

  const invalidCases = [
    [(snapshot) => { snapshot.parentNamespaceId = snapshot.namespaceId; }, /distinct network namespace/],
    [(snapshot) => { snapshot.interfaces.push({ ifname: 'eth0' }); }, /unexpected or active network interface/],
    [(snapshot) => { snapshot.interfaces[0].operstate = 'UP'; }, /unexpected or active network interface/],
    [(snapshot) => { snapshot.ipv4Routes.push({ dst: 'default' }); }, /unexpected IP route/],
    [(snapshot) => { snapshot.ipv6Routes.push({ dst: 'default' }); }, /unexpected IP route/],
    [(snapshot) => { snapshot.firewall.nftables.push({ table: {} }); }, /unexpected firewall rule or table/],
    [(snapshot) => { snapshot.effectiveCapabilities = '1'; }, /privilege state is not restricted/],
    [(snapshot) => { snapshot.noNewPrivileges = '0'; }, /privilege state is not restricted/],
  ];
  for (const [mutate, message] of invalidCases) {
    const snapshot = validSnapshot();
    mutate(snapshot);
    assert.throws(() => verifyIsolationSnapshot(snapshot), message);
  }
});

test('mocked verifier accepts only the prototype isolation report shape', () => {
  const snapshot = validSnapshot();
  const summary = verifyIsolationSnapshot(snapshot);
  assert.equal(verifyIsolationReport(summary), summary);
  assert.throws(
    () => verifyIsolationReport({ ...summary, firewallObjects: 1 }),
    /invalid network-isolation state/,
  );
});

test('launcher rejects unsupported platforms and absent, malformed, or unimplemented proxy setup', async () => {
  assert.throws(() => validateOptions({ mode: 'offline' }, 'win32'), /Linux only/);
  assert.throws(() => validateOptions({}, 'linux'), /offline isolation mode/);
  assert.throws(() => validateOptions({ mode: 'proxy' }, 'linux'), /remote browsing is unavailable/);
  assert.throws(
    () => validateOptions({ mode: 'offline', proxy: { host: 'not-a-proxy' } }, 'linux'),
    /no isolated proxy integration/,
  );
  assert.throws(
    () => validateOptions({ mode: 'offline', proxy: null }, 'linux'),
    /no isolated proxy integration/,
  );
  assert.throws(() => validateOptions({ mode: 'offline', startupTimeoutMs: 99 }, 'linux'), /timeout/);

  let spawnCount = 0;
  const launcher = mockedLauncher({
    spawnProcess() { spawnCount += 1; throw new Error('must not start'); },
    killProcessGroup() {},
  });
  await assert.rejects(launcher.launch({ mode: 'proxy' }), /remote browsing is unavailable/);
  await assert.rejects(launchOfflineProbe({ proxy: { host: '127.0.0.1' } }), /no isolated proxy integration/);
  assert.equal(spawnCount, 0);
});

test('mocked namespace setup failure rejects startup and cleans up the child', async () => {
  const child = new MockChild();
  let killed = false;
  const launcher = mockedLauncher({
    spawnProcess() {
      setImmediate(() => child.emit('close', 1, null));
      return child;
    },
    killProcessGroup() { killed = true; },
  });

  await assert.rejects(launcher.launch({ mode: 'offline' }), /isolated startup failed/);
  assert.equal(killed, true);
});

test('mocked startup timeout kills the isolated process and fails closed', async () => {
  const child = new MockChild();
  let killed = false;
  const launcher = mockedLauncher({
    spawnProcess() { return child; },
    killProcessGroup() {
      killed = true;
      child.emit('close', null, 'SIGKILL');
    },
  });

  await assert.rejects(
    launcher.launch({ mode: 'offline', startupTimeoutMs: 100 }),
    /startup timed out/,
  );
  assert.equal(killed, true);
});

test('live Linux namespace prototype keeps the launcher outside and cleans up its isolated child', {
  skip: process.platform !== 'linux'
    || !['/usr/bin/unshare', '/usr/bin/setpriv', '/usr/bin/ip', '/usr/sbin/nft']
      .every((command) => fs.existsSync(command)),
}, async (context) => {
  const parentNamespace = fs.readlinkSync('/proc/self/ns/net');
  const session = await launchOfflineProbe({ startupTimeoutMs: 5000 });
  context.after(() => session.stop());

  assert.equal(fs.readlinkSync('/proc/self/ns/net'), parentNamespace);
  assert.equal(fs.readlinkSync(`/proc/${session.pid}/ns/net`), session.isolation.namespaceId);
  assert.notEqual(session.isolation.namespaceId, parentNamespace);
  assert.equal(session.isolation.parentNamespaceId, parentNamespace);
  assert.deepEqual(session.isolation.interfaces, ['lo (down)']);
  assert.equal(session.isolation.ipv4Routes, 0);
  assert.equal(session.isolation.ipv6Routes, 0);
  assert.equal(session.isolation.firewallObjects, 0);
  assert.equal(session.isolation.effectiveCapabilities, '0');
  assert.equal(session.isolation.noNewPrivileges, true);

  const result = await session.stop();
  assert.equal(result.code, 0);
  assert.throws(() => process.kill(session.pid, 0), { code: 'ESRCH' });
  assert.equal(fs.readlinkSync('/proc/self/ns/net'), parentNamespace);
});

test('live broker disconnection terminates the isolated child fail-closed', {
  skip: process.platform !== 'linux'
    || !['/usr/bin/unshare', '/usr/bin/setpriv', '/usr/bin/ip', '/usr/sbin/nft']
      .every((command) => fs.existsSync(command)),
}, async (context) => {
  const session = await launchOfflineProbe({ startupTimeoutMs: 5000 });
  context.after(() => session.stop());
  const result = await session.disconnect();

  assert.notEqual(result.code, 0);
  assert.throws(() => process.kill(session.pid, 0), { code: 'ESRCH' });
});

test('live process-group cleanup terminates a generic fixture child and its descendant', async (context) => {
  const child = spawn(process.execPath, [
    '-e',
    "const {spawn}=require('node:child_process'); const descendant=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); console.log(descendant.pid); setInterval(()=>{},1000)",
  ], {
    detached: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const descendantPid = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Child fixture did not start in time.')), 3000);
    child.stdout.once('data', (line) => {
      clearTimeout(timeout);
      resolve(Number(String(line).trim()));
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
  context.after(() => terminateProcessGroup(child));

  terminateProcessGroup(child);
  await new Promise((resolve) => child.once('close', resolve));
  await new Promise((resolve, reject) => {
    const deadline = Date.now() + 3000;
    const check = () => {
      try {
        process.kill(descendantPid, 0);
        if (Date.now() >= deadline) {
          reject(new Error('Process-group cleanup left a descendant alive.'));
          return;
        }
        setTimeout(check, 20);
      } catch (error) {
        if (error.code === 'ESRCH') resolve();
        else reject(error);
      }
    };
    check();
  });
});
