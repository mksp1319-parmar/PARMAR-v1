'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createHash, randomBytes } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const test = require('node:test');
const { buildIsolatedLaunch } = require('../isolation-launcher.cjs');

const desktopDirectory = path.resolve(__dirname, '..');
const wrapperPath = path.join(__dirname, 'electron-isolation-wrapper.cjs');
const electronPath = path.join(desktopDirectory, 'node_modules/electron/dist/electron');
const xvfbPath = '/usr/bin/Xvfb';
const runtimeLibraryDirectory = process.env.PARMAR_ELECTRON_RUNTIME_LIB_DIR;
const runtimeRequired = process.env.PARMAR_ELECTRON_RUNTIME_REQUIRED === '1';
const hasRuntime = Boolean(
  runtimeLibraryDirectory
  && fs.existsSync(path.join(runtimeLibraryDirectory, 'libgtk-3.so.0')),
);
const requiredLinuxExecutables = [
  '/usr/bin/unshare',
  '/usr/bin/setpriv',
  '/usr/sbin/ip',
  xvfbPath,
  electronPath,
];
const missingLinuxExecutables = requiredLinuxExecutables
  .filter((command) => !fs.existsSync(command));
const hasLinuxTools = process.platform === 'linux' && missingLinuxExecutables.length === 0;

function listen(server, host, ipv6Only = false) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen({ host, port: 0, ipv6Only }, () => {
      server.removeListener('error', onError);
      resolve(server.address().port);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

function waitForClose(session, description, timeoutMs = 15_000) {
  let timeout;
  return Promise.race([
    session.closed,
    new Promise((_, reject) => {
      timeout = setTimeout(() => {
        reject(new Error(
          `Timed out waiting for ${description}; received ${JSON.stringify(session.events)}. ${session.stderr}`,
        ));
      }, timeoutMs);
    }),
  ]).finally(() => clearTimeout(timeout));
}

function parentCanReach(host, port, family) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port, family });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`The parent could not reach its controlled ${family === 4 ? 'IPv4' : 'IPv6'} listener.`));
    }, 3000);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve();
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function processInfo(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const statMatch = stat.match(/^\d+ \(.*\) ([A-Z]) (\d+) (\d+)/);
    if (!statMatch) return null;
    const commandLine = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8')
      .split('\0')
      .filter(Boolean);
    return {
      pid,
      state: statMatch[1],
      parentPid: Number(statMatch[2]),
      processGroupId: Number(statMatch[3]),
      namespace: fs.readlinkSync(`/proc/${pid}/ns/net`),
      executable: fs.readlinkSync(`/proc/${pid}/exe`),
      commandLine,
    };
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ESRCH') return null;
    throw error;
  }
}

function processParentInfo(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const statMatch = stat.match(/^\d+ \(.*\) ([A-Z]) (\d+) (\d+)/);
    if (!statMatch) return null;
    return {
      pid,
      state: statMatch[1],
      parentPid: Number(statMatch[2]),
      processGroupId: Number(statMatch[3]),
    };
  } catch (error) {
    if (['ENOENT', 'ESRCH', 'EACCES'].includes(error.code)) return null;
    throw error;
  }
}

function processTree(rootPid) {
  const all = [];
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    const info = processParentInfo(Number(entry));
    if (info) all.push(info);
  }
  const descendants = new Map();
  for (const info of all) {
    const children = descendants.get(info.parentPid) || [];
    children.push(info);
    descendants.set(info.parentPid, children);
  }

  const result = [];
  const pending = [rootPid];
  const seen = new Set();
  while (pending.length) {
    const parent = pending.pop();
    if (seen.has(parent)) continue;
    seen.add(parent);
    for (const child of descendants.get(parent) || []) {
      const details = processInfo(child.pid);
      if (details) result.push(details);
      pending.push(child.pid);
    }
  }
  return result;
}

function isRunning(pid) {
  const info = processParentInfo(pid);
  return info !== null && info.state !== 'Z' && info.state !== 'X';
}

function processGroup(groupId) {
  const members = [];
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    const info = processParentInfo(Number(entry));
    if (info?.processGroupId === groupId) {
      const identity = processInfo(info.pid);
      if (identity) members.push({ ...info, ...identity });
    }
  }
  return members;
}

function startXvfb() {
  const server = spawn(xvfbPath, [
    '-displayfd',
    '1',
    '-screen',
    '0',
    '1280x800x24',
    '-nolisten',
    'tcp',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let diagnostics = '';

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.kill('SIGKILL');
      reject(new Error(`Xvfb did not start: ${diagnostics}`));
    }, 5000);
    server.stderr.setEncoding('utf8');
    server.stderr.on('data', (chunk) => { diagnostics += chunk; });
    server.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    server.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Xvfb exited before readiness (${code}): ${diagnostics}`));
    });
    server.stdout.once('data', (chunk) => {
      clearTimeout(timeout);
      const displayNumber = Number(String(chunk).trim());
      if (!Number.isSafeInteger(displayNumber) || displayNumber < 0) {
        server.kill('SIGKILL');
        reject(new Error(`Xvfb returned an invalid display number: ${String(chunk)}`));
        return;
      }
      resolve({ server, display: `:${displayNumber}` });
    });
  });
}

function createRendererPage(ports) {
  const endpoints = [
    `http://127.0.0.1:${ports.ipv4LoopbackPort}`,
    `http://[::1]:${ports.ipv6LoopbackPort}`,
  ];
  const websocketEndpoints = endpoints.map((endpoint) => endpoint.replace(/^http:/, 'ws:'));
  const redirectEndpoints = endpoints.map((endpoint, index) => (
    `${endpoint}/redirect?target=${encodeURIComponent(endpoints[(index + 1) % endpoints.length])}`
  ));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'parmar-aether-electron-test-'));
  const userData = path.join(directory, 'user-data');
  fs.mkdirSync(userData);
  const template = fs.readFileSync(path.join(__dirname, 'electron-isolation-fixture.html'), 'utf8');
  const html = template.replace(
    '__AETHER_TEST_CONNECT_SOURCES__',
    [...endpoints, ...websocketEndpoints].map((endpoint) => endpoint.replace(/\/$/, '')).join(' '),
  );
  if (html === template) throw new Error('The renderer fixture CSP placeholder was not replaced.');
  fs.writeFileSync(path.join(directory, 'electron-isolation-fixture.html'), html);
  fs.copyFileSync(
    path.join(__dirname, 'electron-isolation-renderer.js'),
    path.join(directory, 'electron-isolation-renderer.js'),
  );
  return {
    directory,
    page: path.join(directory, 'electron-isolation-fixture.html'),
    userData,
    endpoints,
    websocketEndpoints,
    redirectEndpoints,
  };
}

function launchIsolatedElectron({
  display,
  ports,
  rendererPage,
  userData,
  endpoints,
  websocketEndpoints,
  redirectEndpoints,
  startupDelayMs = 0,
}) {
  const inheritedEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.toLowerCase().includes('proxy')),
  );
  const launch = buildIsolatedLaunch({
    targetExecutable: electronPath,
    targetArguments: [wrapperPath],
    parentNamespaceId: fs.readlinkSync('/proc/self/ns/net'),
    capability: randomBytes(32).toString('base64url'),
    environment: {
      ...inheritedEnvironment,
      DISPLAY: display,
      LD_LIBRARY_PATH: [
        runtimeLibraryDirectory,
        process.env.LD_LIBRARY_PATH,
      ].filter(Boolean).join(path.delimiter),
      PARMAR_TEST_IPV4_LOOPBACK_PORT: String(ports.ipv4LoopbackPort),
      PARMAR_TEST_IPV6_LOOPBACK_PORT: String(ports.ipv6LoopbackPort),
      PARMAR_TEST_RENDERER_PAGE: rendererPage,
      PARMAR_TEST_USER_DATA: userData,
      PARMAR_TEST_RENDERER_TARGETS: JSON.stringify(endpoints),
      PARMAR_TEST_RENDERER_WEBSOCKET_TARGETS: JSON.stringify(websocketEndpoints),
      PARMAR_TEST_RENDERER_REDIRECT_TARGETS: JSON.stringify(redirectEndpoints),
      PARMAR_TEST_STARTUP_DELAY_MS: String(startupDelayMs),
    },
  });
  const child = spawn(launch.executable, launch.arguments, {
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: launch.environment,
    shell: false,
  });
  const events = [];
  let outputBuffer = '';
  let stderr = '';
  let resolveClosed;
  const closed = new Promise((resolve) => { resolveClosed = resolve; });

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    outputBuffer += chunk;
    const lines = outputBuffer.split('\n');
    outputBuffer = lines.pop();
    for (const line of lines) {
      const marker = line.includes('AETHER_WRAPPER_EVENT ')
        ? 'AETHER_WRAPPER_EVENT '
        : 'AETHER_ELECTRON_EVENT ';
      const offset = line.indexOf(marker);
      if (offset < 0) {
        if (stderr.length < 16_384) stderr += `Electron stdout: ${line}\n`;
        continue;
      }
      try {
        events.push(JSON.parse(line.slice(offset + marker.length)));
      } catch {
        stderr += `Invalid fixture event: ${line}\n`;
      }
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    if (stderr.length < 16_384) stderr += chunk.slice(0, 16_384 - stderr.length);
  });
  child.once('error', (error) => {
    stderr += `Isolation launcher error: ${error.message}\n`;
  });
  child.once('exit', (code, signal) => resolveClosed({ code, signal }));

  return {
    child,
    events,
    closed,
    get stderr() { return stderr; },
    waitFor(predicate, timeoutMs) {
      return new Promise((resolve, reject) => {
        const existing = events.find(predicate);
        if (existing) {
          resolve(existing);
          return;
        }
        const timer = setTimeout(() => {
          clearInterval(interval);
          reject(new Error(
            `Timed out waiting for Electron event; received ${JSON.stringify(events)}. ${stderr}`,
          ));
        }, timeoutMs);
        const interval = setInterval(() => {
          const event = events.find(predicate);
          if (event) {
            clearInterval(interval);
            clearTimeout(timer);
            resolve(event);
          } else if (child.exitCode !== null || child.signalCode !== null) {
            clearInterval(interval);
            clearTimeout(timer);
            reject(new Error(`Electron exited before the expected event. ${stderr}`));
          }
        }, 10);
      });
    },
    send(type) {
      child.stdin.write(`${JSON.stringify({ type })}\n`);
    },
    killGroup(signal) {
      try {
        process.kill(-child.pid, signal);
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    },
  };
}

async function assertCleanedUp(session, recordedPids) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && recordedPids.some(isRunning)) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.deepEqual(
    recordedPids.filter(isRunning),
    [],
    `Live Electron processes remain after cleanup: ${JSON.stringify(processTree(session.child.pid))}`,
  );
  const liveGroupMembers = processGroup(session.child.pid)
    .filter((info) => info.state !== 'Z' && info.state !== 'X');
  assert.deepEqual(
    liveGroupMembers,
    [],
    `Live test process-group members remain after cleanup: ${JSON.stringify(liveGroupMembers)}`,
  );
  const tree = processTree(session.child.pid);
  assert.equal(
    tree.some((info) => info.executable === electronPath && isRunning(info.pid)),
    false,
    'An Electron descendant remains after cleanup.',
  );
}

test('live Electron and Chromium descendants stay outside the host namespace and cannot reach controlled listeners', {
  skip: (!hasLinuxTools || !hasRuntime) && !runtimeRequired
    ? 'Requires Linux namespace tools, pinned Electron, Xvfb, and PARMAR_ELECTRON_RUNTIME_LIB_DIR pointing to the user-local GTK libraries.'
    : false,
  timeout: 180_000,
}, async (context) => {
  assert.equal(process.platform, 'linux', 'The Electron isolation integration requires Linux.');
  assert.deepEqual(
    missingLinuxExecutables,
    [],
    `Required Linux namespace/Electron/Xvfb executables are missing: ${missingLinuxExecutables.join(', ')}`,
  );
  assert.ok(
    hasRuntime,
    'PARMAR_ELECTRON_RUNTIME_LIB_DIR must point to a directory containing libgtk-3.so.0.',
  );
  const listeners = [];
  const sessions = [];
  let rendererFixture;
  let xvfb;
  context.after(async () => {
    for (const session of sessions) {
      if (session.child.exitCode === null && session.child.signalCode === null) {
        session.killGroup('SIGKILL');
      }
    }
    await Promise.all(listeners.map(closeServer));
    if (rendererFixture) fs.rmSync(rendererFixture.directory, { recursive: true, force: true });
    if (xvfb?.server.exitCode === null && xvfb?.server.signalCode === null) {
      const xvfbClosed = new Promise((resolve) => xvfb.server.once('close', resolve));
      xvfb.server.kill('SIGTERM');
      const closedGracefully = await Promise.race([
        xvfbClosed.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 3000)),
      ]);
      if (
        !closedGracefully
        && xvfb.server.exitCode === null
        && xvfb.server.signalCode === null
      ) {
        xvfb.server.kill('SIGKILL');
        await Promise.race([
          xvfbClosed,
          new Promise((resolve) => setTimeout(resolve, 3000)),
        ]);
      }
      assert.ok(
        xvfb.server.exitCode !== null || xvfb.server.signalCode !== null,
        'Xvfb did not exit during integration-test cleanup.',
      );
    }
  });

  const connectionCounts = {
    ipv4Loopback: 0,
    ipv6Loopback: 0,
    websocketIpv4Loopback: 0,
    websocketIpv6Loopback: 0,
  };
  const createControlledListener = (name) => {
    const server = http.createServer((request, response) => {
      connectionCounts[name] += 1;
      const requestUrl = new URL(request.url, 'http://127.0.0.1');
      const redirectTarget = requestUrl.searchParams.get('target');
      if (requestUrl.pathname === '/redirect' && redirectTarget) {
        response.writeHead(302, { Location: redirectTarget });
      } else {
        response.writeHead(request.method === 'OPTIONS' ? 204 : 200, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Private-Network': 'true',
        });
      }
      response.end();
    });
    const websocketName = `websocket${name[0].toUpperCase()}${name.slice(1)}`;
    server.on('upgrade', (request, socket) => {
      connectionCounts[websocketName] += 1;
      const key = request.headers['sec-websocket-key'];
      if (typeof key !== 'string') {
        socket.destroy();
        return;
      }
      const accept = createHash('sha1')
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest('base64');
      socket.write([
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '',
        '',
      ].join('\r\n'));
      socket.end();
    });
    return server;
  };
  const ipv4LoopbackListener = createControlledListener('ipv4Loopback');
  const ipv6LoopbackListener = createControlledListener('ipv6Loopback');
  listeners.push(ipv4LoopbackListener, ipv6LoopbackListener);

  const ipv4LoopbackPort = await listen(ipv4LoopbackListener, '127.0.0.1');
  const ipv6LoopbackPort = await listen(ipv6LoopbackListener, '::1', true);
  const ports = {
    ipv4LoopbackPort,
    ipv6LoopbackPort,
  };

  await parentCanReach('127.0.0.1', ipv4LoopbackPort, 4);
  await parentCanReach('::1', ipv6LoopbackPort, 6);
  connectionCounts.ipv4Loopback = 0;
  connectionCounts.ipv6Loopback = 0;

  xvfb = await startXvfb();
  rendererFixture = createRendererPage(ports);
  const parentNamespace = fs.readlinkSync('/proc/self/ns/net');

  const launchOptions = {
    display: xvfb.display,
    ports,
    rendererPage: rendererFixture.page,
    userData: rendererFixture.userData,
    endpoints: rendererFixture.endpoints,
    websocketEndpoints: rendererFixture.websocketEndpoints,
    redirectEndpoints: rendererFixture.redirectEndpoints,
  };
  const normal = launchIsolatedElectron(launchOptions);
  sessions.push(normal);
  const wrapper = await normal.waitFor((event) => event.event === 'wrapper-ready', 10_000);
  const ready = await normal.waitFor((event) => event.event === 'ready', 20_000);
  assert.notEqual(wrapper.namespace, parentNamespace, 'The Electron wrapper shares the parent network namespace.');
  assert.equal(ready.namespace, wrapper.namespace);
  assert.notEqual(ready.namespace, parentNamespace);

  const rootProcess = processInfo(wrapper.pid);
  assert.ok(rootProcess, 'The test wrapper process identity could not be inspected.');
  assert.equal(rootProcess.namespace, wrapper.namespace);
  const supervisor = processInfo(normal.child.pid);
  assert.ok(supervisor, 'The namespace supervisor process identity could not be inspected.');
  assert.equal(supervisor.namespace, wrapper.namespace);
  const liveDescendants = processTree(wrapper.pid).filter((info) => isRunning(info.pid));
  const liveGroup = processGroup(normal.child.pid).filter((info) => isRunning(info.pid));
  assert.ok(liveDescendants.length >= 3, 'Electron main and renderer descendants were not observed.');
  assert.ok(liveGroup.length >= liveDescendants.length, 'The isolated browser process group was not fully observed.');
  const parent = processInfo(process.pid);
  assert.ok(parent, 'The test parent process identity could not be inspected.');
  assert.equal(parent.namespace, parentNamespace);
  for (const info of liveGroup) {
    assert.notEqual(
      info.namespace,
      parentNamespace,
      `Process-group member ${info.pid} (${info.commandLine.join(' ')}) escaped into the host network namespace.`,
    );
    if (info.namespace !== wrapper.namespace) {
      assert.match(
        info.commandLine.join(' '),
        /--type=(?:zygote|renderer)(?:\s|$)/,
        `Process ${info.pid} entered an unexpected non-host network namespace.`,
      );
    }
  }
  for (const info of liveDescendants) {
    assert.notEqual(
      info.namespace,
      parentNamespace,
      `Process ${info.pid} (${info.commandLine.join(' ')}) escaped into the host network namespace.`,
    );
  }

  const renderer = processInfo(ready.rendererPid);
  assert.ok(renderer, 'The Electron renderer process identity could not be inspected.');
  assert.notEqual(renderer.namespace, parentNamespace);
  assert.equal(ready.metrics.some((metric) => metric.pid === ready.electronMainPid), true);
  assert.equal(ready.metrics.some((metric) => metric.pid === ready.rendererPid), true);
  assert.equal(processInfo(ready.electronMainPid).namespace, wrapper.namespace);
  const metricIdentities = ready.metrics.map((metric) => {
    const identity = processInfo(metric.pid);
    assert.ok(identity, `Electron ${metric.type} process ${metric.pid} could not be inspected.`);
    assert.notEqual(identity.namespace, parentNamespace);
    if (['Browser', 'Utility', 'GPU'].includes(metric.type)) {
      assert.equal(
        identity.namespace,
        wrapper.namespace,
        `Electron ${metric.type} process ${metric.pid} did not inherit the wrapper namespace.`,
      );
    }
    return { ...metric, namespace: identity.namespace };
  });

  const recordedPids = new Set([
    wrapper.pid,
    wrapper.electronPid,
    ready.electronMainPid,
    ready.rendererPid,
    ...ready.metrics.map((metric) => metric.pid),
    ...liveDescendants.map((info) => info.pid),
  ]);
  for (const pid of recordedPids) {
    const info = processInfo(pid);
    if (info) {
      assert.notEqual(info.namespace, parentNamespace, `Recorded PID ${pid} escaped into the host network namespace.`);
    }
  }

  assert.equal(ready.probes.length, 2);
  assert.ok(ready.probes.every((probe) => !probe.connected), JSON.stringify(ready.probes));
  assert.equal(ready.rendererProbes.length, 2);
  assert.ok(
    ready.rendererProbes.every((probe) => !probe.connected),
    JSON.stringify(ready.rendererProbes),
  );
  assert.equal(ready.rendererRedirectProbes.length, 2);
  assert.ok(
    ready.rendererRedirectProbes.every((probe) => !probe.connected),
    JSON.stringify(ready.rendererRedirectProbes),
  );
  assert.equal(ready.rendererWebSocketProbes.length, 2);
  assert.ok(
    ready.rendererWebSocketProbes.every((probe) => !probe.connected),
    JSON.stringify(ready.rendererWebSocketProbes),
  );
  assert.deepEqual(connectionCounts, {
    ipv4Loopback: 0,
    ipv6Loopback: 0,
    websocketIpv4Loopback: 0,
    websocketIpv6Loopback: 0,
  });
  const metricTypes = new Map(ready.metrics.map((metric) => [metric.pid, metric.type]));
  console.log(`Live Electron namespace evidence: ${JSON.stringify({
    parentPid: process.pid,
    parentNamespace,
    testSupervisorPid: normal.child.pid,
    testSupervisorNamespace: supervisor.namespace,
    wrapperPid: wrapper.pid,
    electronMainPid: ready.electronMainPid,
    rendererPid: ready.rendererPid,
    metrics: metricIdentities,
    descendants: liveDescendants.map(({ pid, parentPid, commandLine, namespace }) => ({
      pid,
      parentPid,
      role: pid === wrapper.pid
        ? 'test-only wrapper'
        : pid === ready.electronMainPid
          ? 'Electron main'
          : pid === ready.rendererPid
            ? 'Chromium renderer'
            : metricTypes.get(pid) || commandLine.find((argument) => argument.startsWith('--type='))
              || 'Chromium helper',
      namespace,
    })),
    processGroupPids: liveGroup.map(({
      pid,
      parentPid,
      namespace,
      executable,
      commandLine,
    }) => ({ pid, parentPid, namespace, executable, commandLine })),
    socketProbes: ready.probes,
    rendererProbes: ready.rendererProbes,
    rendererRedirectProbes: ready.rendererRedirectProbes,
    rendererWebSocketProbes: ready.rendererWebSocketProbes,
    listenerRequests: connectionCounts,
  })}`);

  normal.send('shutdown');
  await normal.waitFor((event) => event.event === 'shutdown-command-received', 5000);
  await normal.waitFor((event) => event.event === 'graceful-shutdown-requested', 5000);
  await normal.waitFor((event) => event.event === 'before-quit', 5000);
  await normal.waitFor((event) => event.event === 'window-closed', 5000);
  const electronExit = await normal.waitFor((event) => event.event === 'electron-exit', 5000);
  assert.equal(electronExit.code, 0, JSON.stringify(electronExit));
  assert.equal((await waitForClose(normal, 'graceful Electron fixture shutdown')).code, 0, normal.stderr);
  await assertCleanedUp(normal, [...recordedPids]);

  const unexpected = launchIsolatedElectron(launchOptions);
  sessions.push(unexpected);
  const unexpectedWrapper = await unexpected.waitFor(
    (event) => event.event === 'wrapper-ready',
    10_000,
  );
  const unexpectedReady = await unexpected.waitFor((event) => event.event === 'ready', 20_000);
  const unexpectedPids = new Set([
    unexpectedWrapper.pid,
    unexpectedWrapper.electronPid,
    unexpectedReady.electronMainPid,
    unexpectedReady.rendererPid,
    ...processTree(unexpectedWrapper.pid).map((info) => info.pid),
  ]);
  unexpected.send('crash');
  await unexpected.waitFor((event) => event.event === 'crash-command-received', 5000);
  assert.equal((await waitForClose(unexpected, 'controlled Electron fixture crash')).code, 23, unexpected.stderr);
  await assertCleanedUp(unexpected, [...unexpectedPids]);

  const timedOut = launchIsolatedElectron({
    ...launchOptions,
    startupDelayMs: 10_000,
  });
  sessions.push(timedOut);
  const timeoutWrapper = await timedOut.waitFor((event) => event.event === 'wrapper-ready', 10_000);
  await assert.rejects(
    timedOut.waitFor((event) => event.event === 'ready', 750),
    /Timed out waiting for Electron event/,
  );
  const timeoutPids = new Set([
    timeoutWrapper.pid,
    timeoutWrapper.electronPid,
    ...processTree(timeoutWrapper.pid).map((info) => info.pid),
  ]);
  timedOut.killGroup('SIGKILL');
  await waitForClose(timedOut, 'timed-out Electron fixture cleanup');
  await assertCleanedUp(timedOut, [...timeoutPids]);

  const forced = launchIsolatedElectron(launchOptions);
  sessions.push(forced);
  const forcedWrapper = await forced.waitFor((event) => event.event === 'wrapper-ready', 10_000);
  const forcedReady = await forced.waitFor((event) => event.event === 'ready', 20_000);
  const forcedPids = new Set([
    forcedWrapper.pid,
    forcedWrapper.electronPid,
    forcedReady.electronMainPid,
    forcedReady.rendererPid,
    ...processTree(forcedWrapper.pid).map((info) => info.pid),
  ]);
  forced.killGroup('SIGKILL');
  await waitForClose(forced, 'forced Electron fixture cleanup');
  await assertCleanedUp(forced, [...forcedPids]);
});
