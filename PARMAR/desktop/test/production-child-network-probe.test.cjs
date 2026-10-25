'use strict';

const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { createHash, randomBytes } = require('node:crypto');
const fs = require('node:fs');
const { createReadStream } = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const asar = require('@electron/asar');

const desktopDirectory = path.resolve(__dirname, '..');
const required = process.env.PARMAR_AETHER_PRODUCTION_CHILD_PROBE_REQUIRED === '1';
const linuxDirectory = process.env.PARMAR_AETHER_LINUX_DIR_PATH;
const evidenceDirectory = process.env.PARMAR_AETHER_UI_SCREENSHOT_DIR;
const requiredExecutables = [
  '/usr/bin/Xvfb',
  '/usr/bin/xdotool',
  '/usr/bin/setpriv',
  '/usr/bin/unshare',
];

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function optionalTextFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch (error) {
    if (['EACCES', 'ENOENT'].includes(error.code)) return null;
    throw error;
  }
}

function isReadable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch (error) {
    if (['EACCES', 'ENOENT'].includes(error.code)) return false;
    throw error;
  }
}

function kernelInstrumentationAvailability() {
  return {
    unprivilegedBpfDisabled: optionalTextFile('/proc/sys/kernel/unprivileged_bpf_disabled'),
    perfEventParanoid: optionalTextFile('/proc/sys/kernel/perf_event_paranoid'),
    tracefsAvailableEventsReadable: isReadable('/sys/kernel/tracing/available_events'),
    bpftraceAvailable: ['/usr/bin/bpftrace', '/usr/sbin/bpftrace'].some((file) => fs.existsSync(file)),
    perfAvailable: ['/usr/bin/perf', '/usr/sbin/perf'].some((file) => fs.existsSync(file)),
    evidence: 'No syscall tracing is enabled by this test; CDP events are not kernel syscall evidence.',
  };
}

function readJsonLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function runCommand(executable, arguments_, display, options = {}) {
  const result = spawnSync(executable, arguments_, {
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, DISPLAY: display },
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${executable} ${arguments_.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function isRunning(pid) {
  try {
    const status = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const state = status.match(/^\d+ \(.*\) ([A-Z])/);
    return Boolean(state && state[1] !== 'Z' && state[1] !== 'X');
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ESRCH') return false;
    throw error;
  }
}

function processArguments(pid) {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8')
      .split('\0')
      .filter(Boolean)
      .flatMap((argument) => argument.split(/\s+/));
  } catch (error) {
    if (['ENOENT', 'ESRCH', 'EACCES'].includes(error.code)) return [];
    throw error;
  }
}

function processTree(rootPid) {
  const childrenByPid = new Map();
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const match = stat.match(/^\d+ \(.*\) [A-Z] (\d+)/);
      if (!match) continue;
      const parentPid = Number(match[1]);
      const children = childrenByPid.get(parentPid) || [];
      children.push(pid);
      childrenByPid.set(parentPid, children);
    } catch (error) {
      if (!['ENOENT', 'ESRCH', 'EACCES'].includes(error.code)) throw error;
    }
  }

  const result = [];
  const pending = [rootPid];
  const visited = new Set();
  while (pending.length) {
    const parentPid = pending.pop();
    if (visited.has(parentPid)) continue;
    visited.add(parentPid);
    for (const childPid of childrenByPid.get(parentPid) || []) {
      result.push(childPid);
      pending.push(childPid);
    }
  }
  return result;
}

function processGroupMembers(groupId) {
  const members = [];
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const match = stat.match(/^\d+ \(.*\) [A-Z] \d+ (\d+)/);
      if (match && Number(match[1]) === groupId && isRunning(pid)) members.push(pid);
    } catch (error) {
      if (!['ENOENT', 'ESRCH', 'EACCES'].includes(error.code)) throw error;
    }
  }
  return members;
}

function processGroupId(pid) {
  const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
  const commandEnd = stat.lastIndexOf(')');
  const fields = stat.slice(commandEnd + 1).trim().split(/\s+/);
  const groupId = Number(fields[2]);
  if (commandEnd < 0 || !Number.isSafeInteger(groupId) || groupId < 1) {
    throw new Error(`Could not read process group for ${pid}: ${JSON.stringify(stat)}`);
  }
  return groupId;
}

function processNetworkInterfaces(pid) {
  return fs.readFileSync(`/proc/${pid}/net/dev`, 'utf8')
    .trim()
    .split('\n')
    .slice(2)
    .map((line) => line.split(':')[0].trim())
    .filter(Boolean)
    .sort();
}

function processHasExternalRoutes(pid) {
  const ipv4Routes = fs.readFileSync(`/proc/${pid}/net/route`, 'utf8')
    .trim()
    .split('\n')
    .slice(1)
    .filter(Boolean);
  const ipv6Routes = fs.readFileSync(`/proc/${pid}/net/ipv6_route`, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean);
  return ipv4Routes.some((route) => route.split(/\s+/)[0] !== 'lo')
    || ipv6Routes.some((route) => route.split(/\s+/).at(-1) !== 'lo');
}

function inspectProductionProcessIsolation(rootPid, hostNamespace) {
  assert.ok(isRunning(rootPid), 'The production browser child is not running.');
  const processIds = new Set([rootPid, ...processTree(rootPid)]);
  const hostUserNamespace = fs.readlinkSync('/proc/self/ns/user');
  const inspected = [];
  for (const pid of processIds) {
    if (!isRunning(pid)) continue;
    assert.notEqual(
      fs.readlinkSync(`/proc/${pid}/ns/net`),
      hostNamespace,
      `Production process ${pid} shares the host network namespace.`,
    );
    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    const noNewPrivileges = status.match(/^NoNewPrivs:\s+(\d+)$/m)?.[1];
    assert.equal(noNewPrivileges, '1', `Production process ${pid} lacks no_new_privs.`);
    const effectiveCapabilities = status.match(/^CapEff:\s+([0-9a-f]+)$/mi)?.[1];
    assert.ok(effectiveCapabilities, `Production process ${pid} has no readable effective capability mask.`);
    const effectiveMask = BigInt(`0x${effectiveCapabilities}`);
    if (fs.readlinkSync(`/proc/${pid}/ns/user`) === hostUserNamespace) {
      assert.equal(effectiveMask, 0n, `Production process ${pid} has host-user-namespace capabilities.`);
    } else {
      const chromiumSandboxCapability = 1n << 21n;
      assert.equal(
        effectiveMask & ~chromiumSandboxCapability,
        0n,
        `Production process ${pid} has unexpected capabilities in its user namespace.`,
      );
    }
    const interfaces = processNetworkInterfaces(pid);
    const hasExternalRoutes = processHasExternalRoutes(pid);
    assert.deepEqual(interfaces, ['lo'], `Production process ${pid} has unexpected interfaces.`);
    assert.equal(hasExternalRoutes, false, `Production process ${pid} has an external route.`);
    const argumentsForProcess = processArguments(pid);
    const processType = argumentsForProcess
      .find((argument) => argument.startsWith('--type='))
      ?.slice('--type='.length) || 'electron-main';
    inspected.push({
      pid,
      processType,
      networkService: argumentsForProcess.includes('--utility-sub-type=network.mojom.NetworkService'),
      networkNamespaceId: fs.readlinkSync(`/proc/${pid}/ns/net`),
      userNamespaceId: fs.readlinkSync(`/proc/${pid}/ns/user`),
      interfaces,
      hasExternalRoutes,
      noNewPrivileges,
      effectiveCapabilities,
      executable: fs.readlinkSync(`/proc/${pid}/exe`),
    });
  }
  assert.ok(
    inspected.some(({ pid }) => pid === rootPid),
    `The production child ${rootPid} was not inspected; running=${isRunning(rootPid)}; inspected=${JSON.stringify(inspected)}.`,
  );
  assert.ok(
    inspected.some(({ pid }) => processArguments(pid).includes('--type=renderer')),
    'A Chromium renderer was not found in the production child process tree.',
  );
  return inspected;
}

function findProductionChild(parentPid) {
  return processTree(parentPid).find((pid) => (
    isRunning(pid) && processArguments(pid).includes('--aether-browser-child')
  )) || null;
}

function findPackagedParent(tracerPid, executablePath) {
  const expectedExecutable = fs.realpathSync(executablePath);
  return processTree(tracerPid).find((pid) => {
    if (!isRunning(pid) || processArguments(pid).includes('--aether-browser-child')) return false;
    try {
      return fs.realpathSync(`/proc/${pid}/exe`) === expectedExecutable;
    } catch (error) {
      if (['ENOENT', 'ESRCH'].includes(error.code)) return false;
      throw error;
    }
  }) || null;
}

async function sha256(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

function windowByTitle(title, display) {
  const result = spawnSync('/usr/bin/xdotool', ['search', '--onlyvisible', '--name', title], {
    encoding: 'utf8',
    timeout: 2000,
    env: { ...process.env, DISPLAY: display },
  });
  if (result.status !== 0) return null;
  return result.stdout.trim().split('\n').filter(Boolean).at(-1) || null;
}

async function waitFor(check, description, display, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = check();
    if (result) return result;
    await wait(100);
  }
  throw new Error(`Timed out waiting for ${description}${display ? ` on ${display}` : ''}.`);
}

async function startXvfb() {
  const server = spawn('/usr/bin/Xvfb', [
    '-displayfd', '1', '-screen', '0', '1280x800x24', '-nolisten', 'tcp', '-ac',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const display = await new Promise((resolve, reject) => {
      let output = '';
      let diagnostic = '';
      const timeout = setTimeout(() => reject(new Error(`Xvfb startup timed out: ${diagnostic}`)), 5000);
      server.stdout.setEncoding('utf8');
      server.stderr.setEncoding('utf8');
      server.stdout.on('data', (chunk) => {
        output += chunk;
        const newline = output.indexOf('\n');
        if (newline < 0) return;
        clearTimeout(timeout);
        const number = Number(output.slice(0, newline).trim());
        if (!Number.isSafeInteger(number) || number < 0) {
          reject(new Error(`Xvfb returned an invalid display number: ${output}`));
        } else {
          resolve(`:${number}`);
        }
      });
      server.stderr.on('data', (chunk) => { diagnostic += chunk; });
      server.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      server.once('exit', (code) => {
        clearTimeout(timeout);
        reject(new Error(`Xvfb exited before readiness (${code}): ${diagnostic}`));
      });
    });
    return { display, server };
  } catch (error) {
    if (server.exitCode === null && server.signalCode === null) {
      const closed = new Promise((resolve) => server.once('close', resolve));
      server.kill('SIGTERM');
      await Promise.race([closed, wait(3000)]).then(() => {
        if (server.exitCode === null && server.signalCode === null) server.kill('SIGKILL');
      });
    }
    throw error;
  }
}

async function startListener(host) {
  const connections = [];
  const server = net.createServer((socket) => {
    connections.push({ remoteAddress: socket.remoteAddress, timestamp: Date.now() });
    socket.destroy();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host, port: 0, exclusive: true }, resolve);
  });
  return { connections, host, port: server.address().port, server };
}

async function startHttpListener(host, { redirectUrl = null, websocket = false } = {}) {
  const connections = [];
  const requests = [];
  const upgrades = [];
  const server = http.createServer((request, response) => {
    requests.push({ method: request.method, path: request.url });
    if (redirectUrl) {
      response.writeHead(302, { location: redirectUrl });
    } else {
      response.writeHead(204);
    }
    response.end();
  });
  server.on('connection', (socket) => {
    connections.push({ remoteAddress: socket.remoteAddress, timestamp: Date.now() });
  });
  server.on('upgrade', (request, socket) => {
    upgrades.push({ path: request.url, timestamp: Date.now() });
    if (!websocket) {
      socket.destroy();
      return;
    }
    const accept = createHash('sha1')
      .update(`${request.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '',
      '',
    ].join('\r\n'));
    socket.destroy();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host, port: 0, exclusive: true }, resolve);
  });
  return { connections, host, port: server.address().port, requests, server, upgrades };
}

function requestHttp(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      response.resume();
      response.once('end', () => resolve({
        statusCode: response.statusCode,
        location: response.headers.location || null,
      }));
    });
    request.setTimeout(5000, () => request.destroy(new Error(`HTTP test request timed out: ${url}`)));
    request.once('error', reject);
  });
}

async function verifyControlledRedirectFixture(source, target) {
  const sourceUrl = `http://127.0.0.1:${source.port}/redirect`;
  const sourceResponse = await requestHttp(sourceUrl);
  const expectedTargetUrl = `http://127.0.0.1:${target.port}/redirect-target`;
  assert.equal(sourceResponse.statusCode, 302, 'The controlled redirect fixture did not return HTTP 302.');
  assert.equal(
    sourceResponse.location,
    expectedTargetUrl,
    'The controlled redirect source did not point to its numeric-loopback target.',
  );
  const targetResponse = await requestHttp(sourceResponse.location);
  assert.equal(targetResponse.statusCode, 204, 'The controlled redirect target returned an unexpected response.');
  const evidence = {
    client: 'Node HTTP test client, not Chromium',
    sourceUrl,
    sourceReached: source.connections.length > 0 && source.requests.length === 1,
    real302ResponseReturned: sourceResponse.statusCode === 302,
    location: sourceResponse.location,
    clientFollowAttempted: true,
    targetUrl: expectedTargetUrl,
    targetReached: target.connections.length > 0 && target.requests.length === 1,
    targetStatusCode: targetResponse.statusCode,
  };
  assert.equal(evidence.sourceReached, true, 'The test client did not reach the redirect source listener.');
  assert.equal(evidence.targetReached, true, 'The test client did not reach the redirect target listener.');
  source.connections.length = 0;
  source.requests.length = 0;
  target.connections.length = 0;
  target.requests.length = 0;
  return evidence;
}

async function verifyParentCanReach(listener, family) {
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({
      host: listener.host,
      port: listener.port,
      family,
    });
    socket.once('connect', () => {
      socket.destroy();
      resolve();
    });
    socket.once('error', reject);
  });
  await wait(25);
  assert.ok(listener.connections.length > 0, `The parent did not reach the ${listener.host} listener.`);
  listener.connections.length = 0;
}

async function closeListener(listener) {
  if (!listener.server.listening) return;
  await new Promise((resolve, reject) => {
    listener.server.close((error) => (error ? reject(error) : resolve()));
  });
}

function waitForProcessExit(child, timeoutMs = 15_000) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return Promise.race([
    new Promise((resolve) => child.once('close', resolve)),
    wait(timeoutMs).then(() => {
      if (child.exitCode === null && child.signalCode === null) {
        throw new Error('The packaged AETHER process did not exit during cleanup.');
      }
    }),
  ]);
}

test('test-only harness records packaged Chromium renderer requests in the isolated network namespace', {
  skip: required ? false : 'Set PARMAR_AETHER_PRODUCTION_CHILD_PROBE_REQUIRED=1 with a fresh Linux directory package.',
  timeout: 180_000,
}, async (context) => {
  assert.equal(process.platform, 'linux', 'The production-child network probe requires Linux.');
  assert.ok(path.isAbsolute(linuxDirectory || ''), 'PARMAR_AETHER_LINUX_DIR_PATH must be an absolute path.');
  for (const executable of requiredExecutables) {
    assert.ok(fs.existsSync(executable), `Required test executable is missing: ${executable}`);
  }
  if (required) {
    assert.ok(
      evidenceDirectory && path.isAbsolute(evidenceDirectory),
      'PARMAR_AETHER_UI_SCREENSHOT_DIR must identify an absolute evidence directory in required mode.',
    );
    assert.ok(
      fs.statSync(evidenceDirectory).isDirectory(),
      'The required production-child evidence directory does not exist.',
    );
  }

  const packageDirectory = path.resolve(linuxDirectory);
  const sourceExecutablePath = path.join(packageDirectory, 'parmar-aether-desktop');
  const sourceArchive = path.join(packageDirectory, 'resources', 'app.asar');
  assert.ok(fs.existsSync(sourceExecutablePath), `Packaged Electron executable is missing: ${sourceExecutablePath}`);
  assert.ok(fs.existsSync(sourceArchive), `Packaged app.asar is missing: ${sourceArchive}`);

  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'parmar-aether-ui-probe-'));
  const extractedArchive = path.join(workspace, 'app');
  const testArchive = path.join(workspace, 'production-network-probe.asar');
  const instrumentedPackageDirectory = path.join(workspace, 'linux-unpacked');
  const reportDirectory = path.join(workspace, 'report');
  const homeDirectory = path.join(workspace, 'home');
  fs.mkdirSync(reportDirectory);
  fs.mkdirSync(homeDirectory);
  const reportPath = path.join(reportDirectory, 'production-network-probe.jsonl');
  const chromiumReportPath = path.join(reportDirectory, 'production-chromium-network-probe.jsonl');
  const runId = randomBytes(12).toString('hex');
  const listeners = [];
  let xvfb = null;
  let application = null;
  let packagedParentPid = null;
  let productionChildPid = null;
  let productionChildGroupId = null;
  let applicationOutput = '';
  let applicationError = '';
  let display = null;
  let rendererRedirectSourcePort = null;
  let rendererRedirectTargetPort = null;
  let testPassed = false;
  let processIsolationEvidence = [];
  let packagedParentEvidence = null;
  let rendererRequestEvidence = [];
  let tabRendererRequestEvidence = [];
  let redirectFixtureEvidence = null;
  let chromiumRedirectFollowAttempted = null;
  const kernelInstrumentation = kernelInstrumentationAvailability();

  context.after(async () => {
    const supervisedChildPid = productionChildPid
      || (application?.pid ? findProductionChild(application.pid) : null);
    const childProcessGroupId = productionChildGroupId
      || (supervisedChildPid && isRunning(supervisedChildPid)
        ? processGroupId(supervisedChildPid)
        : null);
    if (packagedParentPid && isRunning(packagedParentPid)) {
      try {
        process.kill(packagedParentPid, 'SIGTERM');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
    if (application && isRunning(application.pid)) {
      await waitForProcessExit(application, 15_000).catch(async () => {
        terminateGroup(application.pid);
        await waitForProcessExit(application, 5000);
      });
    }
    if (supervisedChildPid && isRunning(supervisedChildPid)) {
      await waitFor(() => !isRunning(supervisedChildPid), 'production child shutdown', display, 10_000)
        .catch(() => terminateGroup(supervisedChildPid));
    }
    if (childProcessGroupId && processGroupMembers(childProcessGroupId).length) {
      terminateGroup(childProcessGroupId);
      await waitFor(
        () => processGroupMembers(childProcessGroupId).length === 0,
        'production child process-group cleanup',
        display,
        5000,
      );
    }
    if (application && processGroupMembers(application.pid).length) {
      terminateGroup(application.pid);
      await waitFor(() => processGroupMembers(application.pid).length === 0, 'application process-group cleanup', display, 5000);
    }
    if (supervisedChildPid && isRunning(supervisedChildPid)) {
      terminateGroup(supervisedChildPid);
      await waitFor(() => !isRunning(supervisedChildPid), 'forced production child cleanup', display, 5000);
    }
    if (xvfb && xvfb.exitCode === null && xvfb.signalCode === null) {
      const closed = new Promise((resolve) => xvfb.once('close', resolve));
      xvfb.kill('SIGTERM');
      await Promise.race([closed, wait(3000)]).then(async () => {
        if (xvfb.exitCode === null && xvfb.signalCode === null) xvfb.kill('SIGKILL');
      });
      assert.ok(xvfb.exitCode !== null || xvfb.signalCode !== null, 'Xvfb did not exit during cleanup.');
    }
    await Promise.all(listeners.map(closeListener));
    assert.ok(listeners.every(({ server }) => !server.listening), 'A controlled listener remained open.');
    if (evidenceDirectory) {
      const mainProbeReports = readJsonLines(reportPath);
      const rendererProbeReports = readJsonLines(chromiumReportPath);
      const tabRendererProbeReports = rendererProbeReports.filter((record) => (
        record.event === 'production-chromium-tab-renderer-network-probe'
      ));
      const listenerEvidence = listeners.map(({ host, port, connections, requests, upgrades }) => ({
        host,
        port,
        acceptedConnections: connections.length,
        httpRequests: requests?.length || 0,
        websocketUpgrades: upgrades?.length || 0,
      }));
      const evidence = {
        schemaVersion: 1,
        runId,
        testStatus: testPassed ? 'passed' : 'failed-or-interrupted',
        productionPolicy: { remoteBrowsingEnabled: false },
        package: {
          directory: packageDirectory,
          instrumentedExecutableSha256: fs.existsSync(
            path.join(instrumentedPackageDirectory, 'parmar-aether-desktop'),
          )
            ? await sha256(path.join(instrumentedPackageDirectory, 'parmar-aether-desktop'))
            : null,
          productionMainSourceVerified: true,
          productionSupervisorSourceVerified: true,
          productionLauncherSourceVerified: true,
          productionSupervisorModifiedForTest: false,
          productionEntryPointWrappedForTest: true,
          testWrapperRequiresProductionMain: true,
          testOnlyCsp: 'browser.html and newtab.html connect-src http: ws:; request targets are separately validated as numeric loopback.',
        },
        testParent: packagedParentEvidence,
        processTreeIsolation: processIsolationEvidence,
        separateElectronMainProcessSocketProbe: {
          provenance: 'Node sockets in the production Electron main process; not Chromium renderer evidence.',
          reports: mainProbeReports,
        },
        renderer: {
          provenance: 'CDP events from the packaged browser.html shell renderer under a test-only entrypoint wrapper.',
          reports: rendererProbeReports,
          processEvidence: processIsolationEvidence.filter(({ pid }) => (
            pid === rendererProbeReports[0]?.rendererPid
            || rendererProbeReports.some((probe) => (
              probe.metrics?.some((metric) => metric.pid === pid) || false
            ))
          )),
          requests: rendererRequestEvidence,
          networkServiceCorrelation: {
            status: 'same-electron-instance-candidates-only',
            candidatePids: rendererProbeReports[0]?.metrics
              ?.filter(({ pid }) => processIsolationEvidence.some((process) => (
                process.pid === pid && process.networkService
              )))
              .map(({ pid }) => pid) || [],
            requestAttribution: 'unavailable; renderer CDP request IDs do not identify the NetworkService process that handled a request.',
          },
          kernelSocketAttribution: {
            status: 'unavailable',
            observed: null,
            reason: 'CDP identifies renderer request events but cannot identify the NetworkService connect syscall or kernel errno; safe unprivileged syscall tracing is unavailable.',
          },
        },
        tabRenderer: {
          provenance: 'CDP events from the actual WebContentsView.webContents identified by the test-only setBounds hook and its newtab.html main-frame URL.',
          reports: tabRendererProbeReports,
          processEvidence: processIsolationEvidence.filter(({ pid }) => (
            pid === tabRendererProbeReports[0]?.rendererPid
            || tabRendererProbeReports.some((probe) => (
              probe.metrics?.some((metric) => metric.pid === pid) || false
            ))
          )),
          requests: tabRendererRequestEvidence,
          networkServiceCorrelation: {
            status: 'same-electron-instance-candidates-only',
            rendererPid: tabRendererProbeReports[0]?.rendererPid || null,
            candidatePids: tabRendererProbeReports[0]?.metrics
              ?.filter(({ pid }) => processIsolationEvidence.some((process) => (
                process.pid === pid && process.networkService
              )))
              .map(({ pid }) => pid) || [],
            requestAttribution: 'unavailable; renderer CDP request IDs do not identify the NetworkService process that handled a request.',
          },
          kernelSocketAttribution: {
            status: 'unavailable',
            observed: null,
            reason: 'CDP and Electron request policy events do not correlate tab-renderer requests with a NetworkService connect syscall or kernel errno.',
          },
        },
        listeners: listenerEvidence,
        redirect: {
          sourceReached: (listenerEvidence.find(({ port }) => port === rendererRedirectSourcePort)
            ?.acceptedConnections || 0) > 0,
          targetReached: (listenerEvidence.find(({ port }) => port === rendererRedirectTargetPort)
            ?.acceptedConnections || 0) > 0,
          followedRedirectVerified: false,
          chromiumSourceAttemptObserved: tabRendererRequestEvidence.some((request) => (
            request.name === 'redirect' && request.initiatedEvent !== null
          )),
          chromiumSourceCancelledBySessionPolicy: tabRendererRequestEvidence.some((request) => (
            request.name === 'redirect'
            && request.failureEvent?.parameters.errorText === 'net::ERR_BLOCKED_BY_CLIENT'
          )),
          chromiumFollowAttempted: chromiumRedirectFollowAttempted,
          real302ResponseObservedByChromium: false,
          reason: 'The production tab request is cancelled by the session policy before reaching the source listener; the separate Node fixture check does not represent Chromium follow-through.',
        },
        controlledRedirectFixture: redirectFixtureEvidence,
        kernelInstrumentation: {
          status: 'unavailable',
          methodUsed: null,
          availability: kernelInstrumentation,
          conclusion: 'No kernel connect attempt or errno is correlated to any renderer request.',
        },
        cleanup: {
          applicationRunning: application?.pid ? isRunning(application.pid) : false,
          productionChildRunning: productionChildPid ? isRunning(productionChildPid) : false,
          xvfbRunning: Boolean(xvfb && xvfb.exitCode === null && xvfb.signalCode === null),
          listenersClosed: listeners.every(({ server }) => !server.listening),
        },
      };
      fs.writeFileSync(
        path.join(evidenceDirectory, `production-child-network-probe-${runId}.json`),
        `${JSON.stringify(evidence, null, 2)}\n`,
        { encoding: 'utf8', flag: 'wx', mode: 0o600 },
      );
      fs.writeFileSync(
        path.join(evidenceDirectory, `production-child-network-probe-${runId}.log`),
        `${applicationOutput}\n${applicationError}`,
        { encoding: 'utf8', flag: 'wx', mode: 0o600 },
      );
    }
    if (application?.pid) assert.equal(isRunning(application.pid), false, 'The packaged parent remained running.');
    if (productionChildPid) {
      assert.equal(isRunning(productionChildPid), false, 'The probed production child remained running.');
    }
    if (childProcessGroupId) {
      assert.equal(
        processGroupMembers(childProcessGroupId).length,
        0,
        'A production child descendant remained in its process group.',
      );
    }
    assert.equal(
      Boolean(xvfb && xvfb.exitCode === null && xvfb.signalCode === null),
      false,
      'Xvfb remained running.',
    );
    console.log('Production-child cleanup verified: parent, child process group, Xvfb, and listeners exited.');
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  asar.extractAll(sourceArchive, extractedArchive);
  const originalMain = fs.readFileSync(path.join(desktopDirectory, 'main.cjs'));
  assert.deepEqual(
    fs.readFileSync(path.join(extractedArchive, 'main.cjs')),
    originalMain,
    'The test package must contain the exact production main process source.',
  );
  for (const file of ['browser-child-supervisor.cjs', 'isolation-launcher.cjs', 'isolation-probe.cjs']) {
    assert.deepEqual(
      fs.readFileSync(path.join(extractedArchive, file)),
      fs.readFileSync(path.join(desktopDirectory, file)),
      `The test package must contain the exact production ${file}.`,
    );
  }
  assert.match(
    fs.readFileSync(path.join(extractedArchive, 'security.cjs'), 'utf8'),
    /const REMOTE_BROWSING_ENABLED = false;/,
    'The packaged production security policy must remain fail-closed.',
  );

  const packageJsonPath = path.join(extractedArchive, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  packageJson.main = 'test/production-child-network-probe-bootstrap.cjs';
  fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
  const browserHtmlPath = path.join(extractedArchive, 'browser.html');
  const browserHtml = fs.readFileSync(browserHtmlPath, 'utf8');
  const productionConnectPolicy = "connect-src 'none';";
  const controlledLoopbackConnectPolicy = 'connect-src http: ws:;';
  assert.equal(browserHtml.split(productionConnectPolicy).length - 1, 1);
  fs.writeFileSync(
    browserHtmlPath,
    browserHtml.replace(productionConnectPolicy, controlledLoopbackConnectPolicy),
  );
  const newTabHtmlPath = path.join(extractedArchive, 'newtab.html');
  const newTabHtml = fs.readFileSync(newTabHtmlPath, 'utf8');
  const productionNewTabPolicy = "content=\"default-src 'none'; img-src 'self' file:;";
  const controlledNewTabPolicy = "content=\"default-src 'none'; connect-src http: ws:; img-src 'self' file:;";
  assert.equal(newTabHtml.split(productionNewTabPolicy).length - 1, 1);
  fs.writeFileSync(
    newTabHtmlPath,
    newTabHtml.replace(productionNewTabPolicy, controlledNewTabPolicy),
  );
  fs.mkdirSync(path.join(extractedArchive, 'test'), { recursive: true });
  fs.copyFileSync(
    path.join(__dirname, 'production-child-network-probe-bootstrap.cjs'),
    path.join(extractedArchive, 'test', 'production-child-network-probe-bootstrap.cjs'),
  );
  fs.copyFileSync(
    path.join(desktopDirectory, 'production-network-probe.cjs'),
    path.join(extractedArchive, 'production-network-probe.cjs'),
  );

  const ipv4Listener = await startListener('127.0.0.1');
  listeners.push(ipv4Listener);
  const ipv6Listener = await startListener('::1');
  listeners.push(ipv6Listener);
  const rendererHttpListener = await startHttpListener('127.0.0.1');
  listeners.push(rendererHttpListener);
  const rendererIpv6HttpListener = await startHttpListener('::1');
  listeners.push(rendererIpv6HttpListener);
  const rendererRedirectTarget = await startHttpListener('127.0.0.1');
  listeners.push(rendererRedirectTarget);
  rendererRedirectTargetPort = rendererRedirectTarget.port;
  const rendererRedirectListener = await startHttpListener('127.0.0.1', {
    redirectUrl: `http://127.0.0.1:${rendererRedirectTarget.port}/redirect-target`,
  });
  listeners.push(rendererRedirectListener);
  rendererRedirectSourcePort = rendererRedirectListener.port;
  const rendererWebSocketListener = await startHttpListener('127.0.0.1', { websocket: true });
  listeners.push(rendererWebSocketListener);
  await verifyParentCanReach(ipv4Listener, 4);
  await verifyParentCanReach(ipv6Listener, 6);
  for (const listener of [
    rendererHttpListener,
    rendererIpv6HttpListener,
    rendererRedirectListener,
    rendererRedirectTarget,
    rendererWebSocketListener,
  ]) {
    await verifyParentCanReach(listener, 4);
  }
  redirectFixtureEvidence = await verifyControlledRedirectFixture(
    rendererRedirectListener,
    rendererRedirectTarget,
  );
  const unavailableBackend = await startListener('127.0.0.1');
  const unavailableBackendPort = unavailableBackend.port;
  await closeListener(unavailableBackend);
  const targets = [
    { family: 'ipv4', host: '127.0.0.1', port: ipv4Listener.port },
    { family: 'ipv6', host: '::1', port: ipv6Listener.port },
  ];
  const chromiumTargets = [
    {
      name: 'http',
      protocol: 'http',
      host: '127.0.0.1',
      port: rendererHttpListener.port,
      path: '/fetch',
    },
    {
      name: 'ipv6-http',
      protocol: 'http',
      host: '::1',
      port: rendererIpv6HttpListener.port,
      path: '/ipv6-fetch',
    },
    {
      name: 'redirect',
      protocol: 'http',
      host: '127.0.0.1',
      port: rendererRedirectListener.port,
      path: '/redirect',
    },
    {
      name: 'redirect-target',
      protocol: 'http',
      host: '127.0.0.1',
      port: rendererRedirectTarget.port,
      path: '/redirect-target',
    },
    {
      name: 'websocket',
      protocol: 'ws',
      host: '127.0.0.1',
      port: rendererWebSocketListener.port,
      path: '/socket',
    },
  ];
  const probeConfiguration = {
    version: 1,
    runId,
    reportPath,
    targets,
  };
  const chromiumProbeConfiguration = {
    version: 1,
    runId,
    reportPath: chromiumReportPath,
    targets: chromiumTargets,
  };
  fs.writeFileSync(
    path.join(extractedArchive, 'test', 'production-network-probe-config.json'),
    `${JSON.stringify({
      version: 1,
      networkConfiguration: probeConfiguration,
      chromiumConfiguration: chromiumProbeConfiguration,
    }, null, 2)}\n`,
    { encoding: 'utf8', flag: 'wx', mode: 0o600 },
  );
  await asar.createPackage(extractedArchive, testArchive);
  assert.ok(fs.existsSync(testArchive), 'The isolated test-only app.asar was not created.');

  await fs.promises.cp(packageDirectory, instrumentedPackageDirectory, { recursive: true });
  const instrumentedArchive = path.join(instrumentedPackageDirectory, 'resources', 'app.asar');
  const executablePath = path.join(instrumentedPackageDirectory, 'parmar-aether-desktop');
  fs.copyFileSync(testArchive, instrumentedArchive);
  assert.equal(
    fs.statSync(executablePath).size,
    fs.statSync(sourceExecutablePath).size,
    'The test package Electron executable differs from the supplied production package.',
  );
  assert.equal(
    await sha256(executablePath),
    await sha256(sourceExecutablePath),
    'The test package must use the byte-identical packaged Electron executable.',
  );

  const xvfbResult = await startXvfb();
  xvfb = xvfbResult.server;
  display = xvfbResult.display;

  const applicationEnvironment = {
    ...process.env,
    DISPLAY: display,
    HOME: homeDirectory,
    PARMAR_DESKTOP_BACKEND_URL: `http://127.0.0.1:${unavailableBackendPort}`,
  };
  for (const key of Object.keys(applicationEnvironment)) {
    if (key.toLowerCase().includes('proxy')) delete applicationEnvironment[key];
  }
  delete applicationEnvironment.XDG_CONFIG_HOME;
  application = spawn('/usr/bin/unshare', [
    '--user',
    '--map-current-user',
    '--net',
    '--fork',
    '--kill-child=SIGKILL',
    '--',
    '/usr/bin/setpriv',
    '--no-new-privs',
    '--',
    executablePath,
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--no-proxy-server',
    '--no-first-run',
  ], {
    detached: true,
    env: applicationEnvironment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  application.stdout.setEncoding('utf8');
  application.stderr.setEncoding('utf8');
  application.stdout.on('data', (chunk) => { applicationOutput += chunk; });
  application.stderr.on('data', (chunk) => { applicationError += chunk; });
  application.once('error', (error) => { applicationError += `Application spawn failed: ${error.message}\n`; });

  const controlWindow = await waitFor(
    () => windowByTitle('Control plane unavailable', display),
    'the packaged control window',
    display,
  ).catch((error) => {
    throw new Error(`${error.message}\n${applicationOutput}\n${applicationError}`);
  });
  packagedParentPid = await waitFor(
    () => findPackagedParent(application.pid, executablePath),
    'the isolated packaged Electron parent',
    display,
  );
  const testParentNamespace = fs.readlinkSync(`/proc/${packagedParentPid}/ns/net`);
  assert.notEqual(testParentNamespace, fs.readlinkSync('/proc/self/ns/net'));
  assert.deepEqual(
    processNetworkInterfaces(packagedParentPid),
    ['lo'],
    'The test-instrumented packaged parent has an unexpected network interface.',
  );
  assert.equal(
    processHasExternalRoutes(packagedParentPid),
    false,
    'The test-instrumented packaged parent has an external network route.',
  );
  const testParentStatus = fs.readFileSync(`/proc/${packagedParentPid}/status`, 'utf8');
  assert.equal(testParentStatus.match(/^NoNewPrivs:\s+(\d+)$/m)?.[1], '1');
  assert.match(testParentStatus, /^CapEff:\s+0{16,}$/mi);
  packagedParentEvidence = {
    pid: packagedParentPid,
    networkNamespaceId: testParentNamespace,
    interfaces: processNetworkInterfaces(packagedParentPid),
    hasExternalRoutes: processHasExternalRoutes(packagedParentPid),
    noNewPrivileges: testParentStatus.match(/^NoNewPrivs:\s+(\d+)$/m)?.[1],
    effectiveCapabilities: testParentStatus.match(/^CapEff:\s+([0-9a-f]+)$/mi)?.[1],
  };
  await wait(500);
  runCommand('/usr/bin/xdotool', ['windowfocus', '--sync', controlWindow], display);
  runCommand('/usr/bin/xdotool', ['key', '--clearmodifiers', 'Tab', 'Return'], display);
  await waitFor(
    () => windowByTitle('AETHER', display),
    'the production AETHER browser window',
    display,
  ).catch((error) => {
    throw new Error(`${error.message}\n${applicationOutput}\n${applicationError}`);
  });

  const reportText = await waitFor(() => (
    fs.existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf8').trim() : null
  ), 'the production-child socket attempt report', display, 30_000).catch((error) => {
    throw new Error(`${error.message}\n${applicationOutput}\n${applicationError}`);
  });
  const records = reportText.split('\n').map((line) => JSON.parse(line));
  assert.equal(records.length, 1, 'Expected exactly one main-process probe report from one production child startup.');
  const report = records[0];
  assert.equal(report.event, 'production-network-probe');
  assert.equal(report.runId, runId);
  assert.equal(report.results.length, 2);
  productionChildPid = report.results[0].pid;
  assert.ok(Number.isSafeInteger(productionChildPid) && productionChildPid > 1);
  const supervisedProcesses = await waitFor(
    () => {
      const processIds = processTree(application.pid);
      return processIds.includes(productionChildPid) ? processIds : null;
    },
    'the supervised production browser child process tree',
    display,
  );
  assert.ok(
    supervisedProcesses.includes(productionChildPid),
    'The socket probe PID was not a descendant of the packaged production parent.',
  );
  assert.equal(
    fs.realpathSync(`/proc/${productionChildPid}/exe`),
    fs.realpathSync(executablePath),
    'The socket probe did not run in the packaged Electron executable.',
  );
  assert.ok(
    processArguments(productionChildPid).includes('--aether-browser-child'),
    'The probed process is missing the production browser-child argument.',
  );
  assert.equal(
    fs.readlinkSync(`/proc/${productionChildPid}/ns/net`),
    report.results[0].namespaceId,
    'The reported network namespace does not belong to the probed process.',
  );
  productionChildGroupId = processGroupId(productionChildPid);
  assert.notEqual(report.results[0].namespaceId, report.results[0].parentNamespaceId);
  const packagedParentNamespace = fs.readlinkSync(`/proc/${packagedParentPid}/ns/net`);
  assert.notEqual(
    packagedParentNamespace,
    fs.readlinkSync('/proc/self/ns/net'),
    'The test-instrumented packaged parent must remain isolated from the test runner.',
  );
  assert.equal(report.results[0].parentNamespaceId, packagedParentNamespace);
  assert.deepEqual(report.results[0].networkIsolation.interfaces, ['lo (down)']);
  assert.equal(report.results[0].networkIsolation.ipv4Routes, 0);
  assert.equal(report.results[0].networkIsolation.ipv6Routes, 0);
  assert.equal(report.results[0].networkIsolation.effectiveCapabilities, '0');
  assert.equal(report.results[0].networkIsolation.noNewPrivileges, true);
  const resultByFamily = new Map(report.results.map((result) => [result.family, result]));
  assert.deepEqual([...resultByFamily.keys()].sort(), ['ipv4', 'ipv6']);
  for (const [family, listener] of [['ipv4', ipv4Listener], ['ipv6', ipv6Listener]]) {
    const result = resultByFamily.get(family);
    assert.equal(result.pid, productionChildPid);
    assert.equal(result.executable, executablePath);
    assert.equal(result.attempted, true, `${family} socket connect was not attempted.`);
    assert.equal(result.connected, false, `${family} socket connect unexpectedly succeeded.`);
    assert.equal(result.result, 'blocked', `${family} socket result was not a definite OS-level block.`);
    assert.ok(
      ['EACCES', 'EADDRNOTAVAIL', 'EHOSTUNREACH', 'ENETUNREACH', 'EPERM'].includes(result.errorCode),
      `${family} socket connect failed for an unrecognized reason: ${result.errorCode}`,
    );
    assert.equal(
      listener.connections.length,
      0,
      `The production child reached the controlled ${family} listener.`,
    );
  }
  console.log(`Production-child direct socket denial: ${JSON.stringify(report)}`);

  const chromiumReportLines = await waitFor(() => {
    const records = readJsonLines(chromiumReportPath);
    return records.some((record) => record.event === 'production-chromium-renderer-network-probe')
      ? records
      : null;
  }, 'the production Chromium renderer request report', display, 30_000);
  const chromiumStartReports = chromiumReportLines.filter(
    (record) => record.event === 'production-chromium-renderer-network-probe',
  );
  assert.equal(chromiumStartReports.length, 1, 'Expected one production Chromium renderer probe report.');
  const chromiumReport = chromiumStartReports[0];
  assert.equal(chromiumReport.event, 'production-chromium-renderer-network-probe');
  assert.equal(chromiumReport.runId, runId);
  assert.equal(chromiumReport.mainPid, productionChildPid);
  assert.ok(
    supervisedProcesses.includes(chromiumReport.rendererPid),
    'The injected requests did not execute in a Chromium renderer of the supervised production child.',
  );
  assert.ok(
    processArguments(chromiumReport.rendererPid).includes('--type=renderer'),
    'The reported renderer PID is not a Chromium renderer process.',
  );
  const rendererProcesses = inspectProductionProcessIsolation(
    productionChildPid,
    fs.readlinkSync('/proc/self/ns/net'),
    'renderer network probes',
  );
  processIsolationEvidence = rendererProcesses;
  assert.ok(
    rendererProcesses.some(({ pid, processType }) => (
      pid === chromiumReport.rendererPid && processType === 'renderer'
    )),
    'The reported renderer PID was not among the live process-tree isolation records.',
  );
  const networkServicePids = rendererProcesses
    .filter(({ networkService }) => networkService)
    .map(({ pid }) => pid);
  assert.ok(networkServicePids.length > 0, 'Chromium did not expose an identifiable out-of-process network service.');
  assert.deepEqual(
    new Set(chromiumReport.metrics.map(({ pid }) => pid)).size,
    chromiumReport.metrics.length,
    'Chromium process metrics contained duplicate PIDs.',
  );
  assert.ok(
    networkServicePids.every((pid) => chromiumReport.metrics.some((metric) => metric.pid === pid)),
    'The identified network-service PID was not present in the packaged app process metrics.',
  );

  const expectedRendererRequests = new Map([
    ['http', chromiumTargets.find(({ name }) => name === 'http')],
    ['ipv6-http', chromiumTargets.find(({ name }) => name === 'ipv6-http')],
    ['redirect', chromiumTargets.find(({ name }) => name === 'redirect')],
    ['websocket', chromiumTargets.find(({ name }) => name === 'websocket')],
  ]);
  assert.equal(chromiumReport.probeStarted, true);
  assert.equal(chromiumReport.rendererResultCollection, 'not-collected');
  await waitFor(() => {
    const records = readJsonLines(chromiumReportPath)
      .filter((record) => record.event === 'production-chromium-network-event');
    return [...expectedRendererRequests].every(([name, target]) => {
      const targetUrl = `${target.protocol}://${target.host === '::1' ? `[${target.host}]` : target.host}:${target.port}${target.path}`;
      const method = name === 'websocket'
        ? 'Network.webSocketCreated'
        : 'Network.requestWillBeSent';
      return records.some((record) => record.method === method && (
        record.parameters.request?.url === targetUrl || record.parameters.url === targetUrl
      ));
    });
  }, 'the controlled renderer CDP request events', display, 15_000);
  const networkEvents = readJsonLines(chromiumReportPath)
    .filter((record) => record.event === 'production-chromium-network-event')
    .map(({ method, parameters, mainPid, rendererPid }) => {
      assert.equal(mainPid, productionChildPid);
      assert.equal(rendererPid, chromiumReport.rendererPid);
      return { method, parameters };
    });
  const requestEvents = networkEvents
    .filter((event) => event.method === 'Network.requestWillBeSent');
  const websocketEvents = networkEvents
    .filter((event) => event.method === 'Network.webSocketCreated');
  rendererRequestEvidence = [...expectedRendererRequests].map(([name, target]) => {
    const targetUrl = `${target.protocol}://${target.host === '::1' ? `[${target.host}]` : target.host}:${target.port}${target.path}`;
    const initiatedEvent = name === 'websocket'
      ? websocketEvents.find((event) => event.parameters.url === targetUrl)
      : requestEvents.find((event) => event.parameters.request.url === targetUrl);
    const requestId = initiatedEvent?.parameters.requestId;
    const failedEvent = requestId
      ? networkEvents.find((event) => (
        event.method === 'Network.loadingFailed'
        && event.parameters.requestId === requestId
      ))
      : null;
    const errorText = failedEvent?.parameters.errorText || null;
    const chromiumClassification = failedEvent?.parameters.blockedReason
      || /^net::ERR_BLOCKED_BY_/.test(errorText || '')
      ? 'browser-or-chromium-policy-rejection'
      : errorText === 'net::ERR_NAME_NOT_RESOLVED'
        ? 'dns-failure'
        : errorText === 'net::ERR_CONNECTION_REFUSED'
          ? 'connection-refused'
          : 'chromium-network-error-not-kernel-attributed';
    return {
      name,
      url: targetUrl,
      rendererPid: chromiumReport.rendererPid,
      networkServiceCandidates: networkServicePids,
      javascriptOutcome: 'not-collected',
      initiatedEvent: initiatedEvent || null,
      failureEvent: failedEvent || null,
      chromiumClassification,
      kernelConnectAttempt: null,
      kernelErrno: null,
      kernelObservation: 'unavailable',
    };
  });
  for (const [name, target] of expectedRendererRequests) {
    const targetUrl = `${target.protocol}://${target.host === '::1' ? `[${target.host}]` : target.host}:${target.port}${target.path}`;
    const initiatedEvent = name === 'websocket'
      ? websocketEvents.find((event) => event.parameters.url === targetUrl)
      : requestEvents.find((event) => event.parameters.request.url === targetUrl);
    assert.ok(
      initiatedEvent,
      `Chromium did not report dispatch of the controlled ${name} request from its renderer target.`,
    );
    if (name !== 'websocket') {
      const requestId = initiatedEvent.parameters.requestId;
      const failedEvent = networkEvents.find((event) => (
        event.method === 'Network.loadingFailed'
        && event.parameters.requestId === requestId
      ));
      assert.ok(failedEvent, `${name} has no Chromium network failure event.`);
      assert.match(
        failedEvent.parameters.errorText,
        /^net::ERR_/,
        `${name} was rejected by a non-network policy: ${JSON.stringify(failedEvent.parameters)}`,
      );
    }
  }

  const tabRendererStartReports = await waitFor(() => {
    const records = readJsonLines(chromiumReportPath)
      .filter((record) => record.event === 'production-chromium-tab-renderer-network-probe');
    return records.length ? records : null;
  }, 'the actual WebContentsView tab renderer report', display, 15_000);
  assert.equal(tabRendererStartReports.length, 1, 'Expected exactly one actual tab renderer probe.');
  const tabRendererReport = tabRendererStartReports[0];
  assert.equal(tabRendererReport.runId, runId);
  assert.equal(tabRendererReport.mainPid, productionChildPid);
  assert.equal(tabRendererReport.webContentsViewIdentified, true);
  assert.match(tabRendererReport.tabUrl, /\/newtab\.html$/);
  assert.notEqual(
    tabRendererReport.rendererPid,
    chromiumReport.rendererPid,
    'The tab renderer must be distinct from the browser.html shell renderer.',
  );
  assert.ok(
    supervisedProcesses.includes(tabRendererReport.rendererPid),
    'The tab renderer is not a descendant of this packaged production child.',
  );
  assert.ok(
    processArguments(tabRendererReport.rendererPid).includes('--type=renderer'),
    'The identified WebContentsView process is not a Chromium renderer.',
  );
  assert.ok(
    rendererProcesses.some(({ pid, processType }) => (
      pid === tabRendererReport.rendererPid && processType === 'renderer'
    )),
    'The tab renderer is missing from the independently inspected isolation records.',
  );
  const tabNetworkServicePids = networkServicePids.filter((pid) => (
    tabRendererReport.metrics.some((metric) => metric.pid === pid)
  ));
  assert.ok(
    tabNetworkServicePids.length > 0,
    'The actual tab renderer report does not identify a NetworkService in this Electron instance.',
  );
  const expectedTabRequests = new Map([...expectedRendererRequests]);
  await waitFor(() => {
    const records = readJsonLines(chromiumReportPath)
      .filter((record) => record.event === 'production-chromium-tab-network-event');
    return [...expectedTabRequests].every(([name, target]) => {
      const targetUrl = `${target.protocol}://${target.host === '::1' ? `[${target.host}]` : target.host}:${target.port}${target.path}`;
      const eventMethod = name === 'websocket'
        ? 'Network.webSocketCreated'
        : 'Network.requestWillBeSent';
      const initiated = records.find((record) => (
        record.method === eventMethod
        && (record.parameters.request?.url === targetUrl || record.parameters.url === targetUrl)
      ));
      return initiated && (name === 'websocket'
        ? records.some((record) => (
          record.parameters.requestId === initiated.parameters.requestId
          && [
            'Network.webSocketFrameError',
            'Network.webSocketHandshakeResponseReceived',
          ].includes(record.method)
        ))
        : records.some((record) => (
          record.method === 'Network.loadingFailed'
          && record.parameters.requestId === initiated.parameters.requestId
        )));
    });
  }, 'tab-renderer CDP request and failure events', display, 15_000);
  const tabEvents = readJsonLines(chromiumReportPath)
    .filter((record) => record.event === 'production-chromium-tab-network-event')
    .map((record) => {
      assert.equal(record.mainPid, productionChildPid);
      assert.equal(record.rendererPid, tabRendererReport.rendererPid);
      assert.equal(record.tabWebContentsId, tabRendererReport.tabWebContentsId);
      assert.equal(record.tabUrl, tabRendererReport.tabUrl);
      return record;
    });
  const redirectTargetUrl = `http://127.0.0.1:${rendererRedirectTargetPort}/redirect-target`;
  chromiumRedirectFollowAttempted = tabEvents.some((record) => (
    record.method === 'Network.requestWillBeSent'
    && record.parameters.request?.url === redirectTargetUrl
  ));
  assert.equal(
    chromiumRedirectFollowAttempted,
    false,
    'The production tab unexpectedly reported a redirect-target request despite source-policy cancellation.',
  );
  tabRendererRequestEvidence = [...expectedTabRequests].map(([name, target]) => {
    const targetUrl = `${target.protocol}://${target.host === '::1' ? `[${target.host}]` : target.host}:${target.port}${target.path}`;
    const method = name === 'websocket'
      ? 'Network.webSocketCreated'
      : 'Network.requestWillBeSent';
    const initiatedEvent = tabEvents.find((record) => (
      record.method === method
      && (record.parameters.request?.url === targetUrl || record.parameters.url === targetUrl)
    ));
    const failureEvent = tabEvents.find((record) => (
      record.method === 'Network.loadingFailed'
      && record.parameters.requestId === initiatedEvent?.parameters.requestId
    ));
    const websocketOutcome = name === 'websocket'
      ? tabEvents.find((record) => (
        record.parameters.requestId === initiatedEvent?.parameters.requestId
        && [
          'Network.webSocketFrameError',
          'Network.webSocketHandshakeResponseReceived',
        ].includes(record.method)
      )) || null
      : null;
    const websocketHandshakeRequest = name === 'websocket'
      ? tabEvents.find((record) => (
        record.method === 'Network.webSocketWillSendHandshakeRequest'
        && record.parameters.requestId === initiatedEvent?.parameters.requestId
      )) || null
      : null;
    const websocketHandshakeResponse = name === 'websocket'
      ? tabEvents.find((record) => (
        record.method === 'Network.webSocketHandshakeResponseReceived'
        && record.parameters.requestId === initiatedEvent?.parameters.requestId
      )) || null
      : null;
    const websocketClosed = name === 'websocket'
      ? tabEvents.find((record) => (
        record.method === 'Network.webSocketClosed'
        && record.parameters.requestId === initiatedEvent?.parameters.requestId
      )) || null
      : null;
    assert.ok(initiatedEvent, `The actual tab renderer did not dispatch ${name}.`);
    if (name === 'websocket') {
      assert.ok(websocketOutcome, 'The actual tab renderer has no correlated WebSocket handshake outcome.');
      assert.equal(
        websocketOutcome.method,
        'Network.webSocketFrameError',
        `The production WebSocket did not fail before receiving a handshake response: ${JSON.stringify(websocketOutcome)}`,
      );
      assert.equal(
        websocketHandshakeResponse,
        null,
        'The controlled WebSocket unexpectedly received a handshake response.',
      );
    } else {
      assert.ok(failureEvent, `The actual tab renderer has no failure event for ${name}.`);
      assert.equal(
        failureEvent.parameters.errorText,
        'net::ERR_BLOCKED_BY_CLIENT',
        `The production session request policy did not cancel tab ${name}: ${JSON.stringify(failureEvent.parameters)}`,
      );
    }
    return {
      name,
      url: targetUrl,
      rendererPid: tabRendererReport.rendererPid,
      networkServiceCandidates: tabNetworkServicePids,
      initiatedEvent,
      failureEvent: failureEvent || null,
      websocketOutcome,
      websocketHandshakeRequest,
      websocketHandshakeResponse,
      websocketClosed,
      classification: name === 'websocket'
        ? `webSocketFrameError-correlated-to-tab-renderer-request-id; errorMessage=${JSON.stringify(websocketOutcome.parameters.errorMessage)}; cause-not-attributed`
        : 'production-session-webRequest-policy-cancellation',
      kernelConnectAttempt: null,
      kernelErrno: null,
    };
  });
  console.log(`Production WebContentsView tab renderer policy evidence: ${JSON.stringify({
    rendererPid: tabRendererReport.rendererPid,
    webContentsId: tabRendererReport.tabWebContentsId,
    networkServiceCandidates: tabNetworkServicePids,
    requests: tabRendererRequestEvidence.map(({ name, failureEvent, websocketOutcome }) => ({
      name,
      outcome: failureEvent?.parameters.errorText
        || websocketOutcome?.method
        || null,
      error: failureEvent?.parameters.errorText
        || websocketOutcome?.parameters.errorMessage
        || null,
    })),
  })}`);

  for (const [name, listener] of [
    ['http', rendererHttpListener],
    ['ipv6-http', rendererIpv6HttpListener],
    ['redirect', rendererRedirectListener],
    ['redirect-target', rendererRedirectTarget],
    ['websocket', rendererWebSocketListener],
  ]) {
    assert.equal(listener.connections.length, 0, `The production Chromium ${name} request reached its listener.`);
    assert.equal(listener.requests?.length || 0, 0, `The production Chromium ${name} sent an HTTP request to its listener.`);
    assert.equal(listener.upgrades?.length || 0, 0, `The production Chromium ${name} upgraded a WebSocket connection.`);
  }
  console.log(`Production Chromium renderer request-dispatch evidence: ${JSON.stringify({
    rendererPid: chromiumReport.rendererPid,
    networkServiceCandidates: networkServicePids,
    requests: [...expectedRendererRequests.keys()],
    cdpRequestEvents: requestEvents.length,
    websocketEvents: websocketEvents.length,
    redirectResponseObserved: rendererRedirectListener.requests.length > 0,
    listenerConnections: listeners.map(({ host, port, connections }) => ({
      host,
      port,
      count: connections.length,
    })),
  })}`);
  testPassed = true;
});

function terminateGroup(groupId) {
  if (groupId === processGroupId(process.pid)) {
    throw new Error(`Refusing to signal the test harness process group ${groupId}.`);
  }
  try {
    process.kill(-groupId, 'SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}
