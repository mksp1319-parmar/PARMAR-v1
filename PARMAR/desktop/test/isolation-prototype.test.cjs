'use strict';

const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const readline = require('node:readline');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildIsolatedLaunch,
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

test('offline verifier rejects a shared namespace, extra interfaces, routes, or capabilities', () => {
  assert.equal(verifyIsolationSnapshot(validSnapshot()).ipv4Routes, 0);

  const invalidCases = [
    [(snapshot) => { snapshot.parentNamespaceId = snapshot.namespaceId; }, /distinct network namespace/],
    [(snapshot) => { snapshot.interfaces.push({ ifname: 'eth0' }); }, /unexpected or active network interface/],
    [(snapshot) => { snapshot.interfaces[0].operstate = 'UP'; }, /unexpected or active network interface/],
    [(snapshot) => { snapshot.ipv4Routes.push({ dst: 'default' }); }, /unexpected IP route/],
    [(snapshot) => { snapshot.ipv6Routes.push({ dst: 'default' }); }, /unexpected IP route/],
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
    () => verifyIsolationReport({ ...summary, interfaces: ['eth0'] }),
    /invalid network-isolation state/,
  );
});

test('production isolation launch builder uses fixed executables and never invokes a shell', () => {
  const launch = buildIsolatedLaunch({
    targetExecutable: '/opt/aether/electron',
    targetArguments: ['/opt/aether/app.asar', '--aether-browser-child'],
    parentNamespaceId: 'net:[4026531840]',
    capability: Buffer.alloc(32, 5).toString('base64url'),
    resolveExecutable: (name) => `/fixed/${name}`,
  });

  assert.equal(launch.executable, '/fixed/unshare');
  assert.deepEqual(launch.arguments, [
    '--user', '--map-current-user', '--net', '--fork', '--kill-child=SIGKILL', '--',
    '/fixed/setpriv', '--inh-caps=-all', '--ambient-caps=-all', '--no-new-privs', '--',
    '/opt/aether/electron', '/opt/aether/app.asar', '--aether-browser-child',
  ]);
  assert.equal(launch.environment.PARMAR_AETHER_IP_PATH, '/fixed/ip');
  assert.equal(Object.hasOwn(launch.environment, 'PARMAR_AETHER_NFT_PATH'), false);
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
    || !['/usr/bin/unshare', '/usr/bin/setpriv', '/usr/sbin/ip']
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
  assert.equal(session.isolation.effectiveCapabilities, '0');
  assert.equal(session.isolation.noNewPrivileges, true);

  const result = await session.stop();
  assert.equal(result.code, 0);
  assert.throws(() => process.kill(session.pid, 0), { code: 'ESRCH' });
  assert.equal(fs.readlinkSync('/proc/self/ns/net'), parentNamespace);
});

test('live broker disconnection terminates the isolated child fail-closed', {
  skip: process.platform !== 'linux'
    || !['/usr/bin/unshare', '/usr/bin/setpriv', '/usr/sbin/ip']
      .every((command) => fs.existsSync(command)),
}, async (context) => {
  const session = await launchOfflineProbe({ startupTimeoutMs: 5000 });
  context.after(() => session.stop());
  const result = await session.disconnect();

  assert.notEqual(result.code, 0);
  assert.throws(() => process.kill(session.pid, 0), { code: 'ESRCH' });
});

test('live production namespace launch cannot reach controlled IPv4, IPv6, loopback, redirect, or WebSocket listeners', {
  skip: process.platform !== 'linux'
    || !['/usr/bin/unshare', '/usr/bin/setpriv', '/usr/sbin/ip']
      .every((command) => fs.existsSync(command))
    || typeof WebSocket !== 'function',
}, async (context) => {
  const listeners = [];
  const requests = { ipv4Host: 0, ipv4Loopback: 0, ipv6Loopback: 0, redirect: 0, websocket: 0 };
  const createListener = (name) => {
    const server = http.createServer((request, response) => {
      requests[name] += 1;
      if (request.url === '/redirect') {
        requests.redirect += 1;
        response.writeHead(302, { Location: redirectTarget });
      } else {
        response.writeHead(200, { 'Access-Control-Allow-Origin': '*' });
      }
      response.end();
    });
    server.on('upgrade', (_request, socket) => {
      requests.websocket += 1;
      socket.destroy();
    });
    listeners.push(server);
    return server;
  };
  const listen = (server, host, ipv6Only = false) => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host, port: 0, ipv6Only }, () => {
      server.removeListener('error', reject);
      resolve(server.address().port);
    });
  });
  const activeHost = Object.values(os.networkInterfaces()).flat()
    .find((entry) => entry && (entry.family === 'IPv4' || entry.family === 4)
      && !entry.internal && !entry.address.startsWith('169.254.'))?.address;
  assert.ok(activeHost, 'A non-loopback IPv4 address is required for the controlled listener.');

  const hostPort = await listen(createListener('ipv4Host'), '0.0.0.0');
  const ipv4LoopbackPort = await listen(createListener('ipv4Loopback'), '127.0.0.1');
  const ipv6LoopbackPort = await listen(createListener('ipv6Loopback'), '::1', true);
  const hostUrl = `http://${activeHost}:${hostPort}`;
  const ipv4LoopbackUrl = `http://127.0.0.1:${ipv4LoopbackPort}`;
  const ipv6LoopbackUrl = `http://[::1]:${ipv6LoopbackPort}`;
  const redirectTarget = `${ipv4LoopbackUrl}/redirect`;
  const script = [
    'const fs=require("node:fs");',
    'const endpoints=JSON.parse(process.env.PARMAR_TEST_ENDPOINTS);',
    'const probe=async(url)=>{try{const response=await fetch(url,{signal:AbortSignal.timeout(1000)});return response.ok}catch{return false}};',
    'const websocket=(url)=>new Promise(resolve=>{let done=false;const finish=value=>{if(done)return;done=true;resolve(value)};const socket=new WebSocket(url);const timer=setTimeout(()=>{socket.close();finish(false)},1000);socket.addEventListener("open",()=>{clearTimeout(timer);socket.close();finish(true)},{once:true});socket.addEventListener("error",()=>{clearTimeout(timer);finish(false)},{once:true})});',
    'Promise.all([probe(endpoints.ipv4Host),probe(endpoints.ipv4Loopback),probe(endpoints.ipv6Loopback),probe(endpoints.redirect),websocket(endpoints.websocket)]).then(results=>process.stdout.write(JSON.stringify({namespace:fs.readlinkSync("/proc/self/ns/net"),results})+"\\n"));',
  ].join('');
  const launch = buildIsolatedLaunch({
    targetExecutable: process.execPath,
    targetArguments: ['-e', script],
    parentNamespaceId: fs.readlinkSync('/proc/self/ns/net'),
    capability: randomBytes(32).toString('base64url'),
    environment: {
      PARMAR_TEST_ENDPOINTS: JSON.stringify({
        ipv4Host: hostUrl,
        ipv4Loopback: ipv4LoopbackUrl,
        ipv6Loopback: ipv6LoopbackUrl,
        redirect: `${hostUrl}/redirect`,
        websocket: hostUrl.replace(/^http:/, 'ws:'),
      }),
      PARMAR_TEST_REDIRECT_TARGET: redirectTarget,
    },
  });
  const child = spawn(launch.executable, launch.arguments, {
    detached: true,
    env: launch.environment,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const closed = new Promise((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  let diagnostics = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { diagnostics += chunk; });
  context.after(async () => {
    if (child.exitCode === null && child.signalCode === null) terminateProcessGroup(child);
    await Promise.all(listeners.map((server) => new Promise((resolve) => server.close(resolve))));
  });

  const report = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Isolated network probes timed out: ${diagnostics}`)), 5000);
    const output = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    output.once('line', (line) => {
      clearTimeout(timeout);
      try {
        resolve(JSON.parse(line));
      } catch (error) {
        reject(new Error(`Isolated network probe report was invalid: ${line}`, { cause: error }));
      }
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      if (code !== 0) reject(new Error(`Isolated network probe exited (${code ?? signal}): ${diagnostics}`));
    });
  });
  const exit = await closed;

  assert.equal(exit.code, 0, diagnostics);
  assert.notEqual(report.namespace, fs.readlinkSync('/proc/self/ns/net'));
  assert.deepEqual([...report.results], [false, false, false, false, false]);
  assert.deepEqual(requests, {
    ipv4Host: 0,
    ipv4Loopback: 0,
    ipv6Loopback: 0,
    redirect: 0,
    websocket: 0,
  });
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
    const output = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    output.once('line', (line) => {
      clearTimeout(timeout);
      const pid = Number(line.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, ''));
      if (!Number.isSafeInteger(pid) || pid < 1) {
        reject(new Error(`Child fixture returned an invalid descendant PID: ${line}`));
      } else {
        resolve(pid);
      }
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      reject(new Error(`Child fixture exited before reporting its descendant (${code ?? signal}).`));
    });
  });
  context.after(() => terminateProcessGroup(child));

  terminateProcessGroup(child);
  await new Promise((resolve) => child.once('close', resolve));
  await new Promise((resolve, reject) => {
    const deadline = Date.now() + 3000;
    const check = () => {
      try {
        const stat = fs.readFileSync(`/proc/${descendantPid}/stat`, 'utf8');
        if (/^\d+ \(.*\) [ZX] /.test(stat)) {
          resolve();
          return;
        }
        if (Date.now() >= deadline) {
          reject(new Error('Process-group cleanup left a descendant alive.'));
          return;
        }
        setTimeout(check, 20);
      } catch (error) {
        if (error.code === 'ESRCH' || error.code === 'ENOENT') resolve();
        else reject(error);
      }
    };
    check();
  });
});
