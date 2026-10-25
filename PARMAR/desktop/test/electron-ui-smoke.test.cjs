'use strict';

const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const desktopDirectory = path.resolve(__dirname, '..');
const appImagePath = process.env.PARMAR_AETHER_APPIMAGE_PATH
  || path.join(desktopDirectory, 'dist', 'PARMAR AETHER-1.0.0.AppImage');
const evidenceDirectory = process.env.PARMAR_AETHER_UI_SCREENSHOT_DIR;
const screenshotDirectory = evidenceDirectory
  ? path.join(evidenceDirectory, 'screenshots')
  : null;
const enabled = process.env.PARMAR_AETHER_UI_SMOKE === '1';
const required = process.env.PARMAR_AETHER_UI_SMOKE_REQUIRED === '1';
const requiredExecutables = [
  '/usr/bin/Xvfb',
  '/usr/bin/xdotool',
  '/usr/bin/import',
  '/usr/bin/convert',
  '/usr/bin/unshare',
  '/usr/bin/setpriv',
];
let xvfbDisplay = null;

function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    encoding: 'utf8',
    timeout: 10_000,
    env: xvfbDisplay ? { ...process.env, DISPLAY: xvfbDisplay } : process.env,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${executable} ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRunning(pid) {
  try {
    const status = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const match = status.match(/^\d+ \(.*\) ([A-Z])/);
    return Boolean(match && match[1] !== 'Z' && match[1] !== 'X');
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ESRCH') return false;
    throw error;
  }
}

function processArguments(pid) {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
  } catch (error) {
    if (['ENOENT', 'ESRCH', 'EACCES'].includes(error.code)) return [];
    throw error;
  }
}

function processEnvironment(pid) {
  return fs.readFileSync(`/proc/${pid}/environ`, 'utf8')
    .split('\0')
    .filter(Boolean);
}

function assertNoProxyEnvironment(pid) {
  const proxyEntries = processEnvironment(pid)
    .filter((entry) => entry.slice(0, entry.indexOf('=')).toLowerCase().includes('proxy'));
  assert.deepEqual(proxyEntries, [], `Test-launched process ${pid} inherited proxy settings.`);
}

function hasProcessArgument(pid, expected) {
  return processArguments(pid).some((argument) => argument.split(/\s+/).includes(expected));
}

function processTree(rootPid) {
  const descendants = new Map();
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const match = stat.match(/^\d+ \(.*\) [A-Z] (\d+)/);
      if (!match) continue;
      const parentPid = Number(match[1]);
      const children = descendants.get(parentPid) || [];
      children.push(pid);
      descendants.set(parentPid, children);
    } catch (error) {
      if (!['ENOENT', 'ESRCH', 'EACCES'].includes(error.code)) throw error;
    }
  }

  const result = [];
  const pending = [rootPid];
  const seen = new Set();
  while (pending.length) {
    const parent = pending.pop();
    if (seen.has(parent)) continue;
    seen.add(parent);
    for (const child of descendants.get(parent) || []) {
      result.push(child);
      pending.push(child);
    }
  }
  return result;
}

function processGroupId(pid) {
  const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
  const match = stat.match(/^\d+ \(.*\) [A-Z] \d+ (\d+)/);
  if (!match) throw new Error(`Could not read process group for ${pid}.`);
  return Number(match[1]);
}

function assertNotHarnessProcessGroup(groupId, description) {
  assert.notEqual(
    groupId,
    processGroupId(process.pid),
    `Refusing to signal the test harness process group while cleaning up ${description}.`,
  );
}

function processGroupMembers(groupId) {
  const members = [];
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    try {
      if (processGroupId(pid) === groupId) members.push(pid);
    } catch (error) {
      if (!['ENOENT', 'ESRCH', 'EACCES'].includes(error.code)) throw error;
    }
  }
  return members;
}

function processNetworkInterfaces(pid) {
  return fs.readFileSync(`/proc/${pid}/net/dev`, 'utf8')
    .split('\n')
    .slice(2)
    .map((line) => line.split(':', 1)[0].trim())
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

function assertProductionProcessIsolation(rootPid, hostNamespace, phase) {
  assert.ok(isRunning(rootPid), `Production browser child is not running during ${phase}.`);
  const rootNamespace = fs.readlinkSync(`/proc/${rootPid}/ns/net`);
  const hostUserNamespace = fs.readlinkSync('/proc/self/ns/user');
  assert.notEqual(rootNamespace, hostNamespace, `Production browser child shares the host namespace during ${phase}.`);
  const processIds = new Set([rootPid, ...processTree(rootPid)]);
  const inspected = [];
  for (const pid of processIds) {
    if (!isRunning(pid)) continue;
    assertNoProxyEnvironment(pid);
    const namespace = fs.readlinkSync(`/proc/${pid}/ns/net`);
    assert.notEqual(namespace, hostNamespace, `Production descendant ${pid} shares the host namespace during ${phase}.`);
    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    const noNewPrivileges = status.match(/^NoNewPrivs:\s+(\d+)$/m)?.[1];
    const effectiveCapabilities = status.match(/^CapEff:\s+([0-9a-f]+)$/mi)?.[1];
    const userNamespace = fs.readlinkSync(`/proc/${pid}/ns/user`);
    const argumentsForProcess = processArguments(pid)
      .flatMap((argument) => argument.split(/\s+/));
    const processType = argumentsForProcess
      .find((argument) => argument.startsWith('--type='))
      ?.slice('--type='.length) || 'electron-main';
    const networkService = argumentsForProcess.includes(
      '--utility-sub-type=network.mojom.NetworkService',
    );
    assert.equal(noNewPrivileges, '1', `Production process ${pid} lacks no_new_privs during ${phase}.`);
    const effectiveCapabilityMask = BigInt(`0x${effectiveCapabilities || '0'}`);
    if (userNamespace === hostUserNamespace) {
      assert.equal(
        effectiveCapabilityMask,
        0n,
        `Production process ${pid} has effective capabilities in the host user namespace during ${phase}.`,
      );
    } else {
      const chromiumSandboxCapability = 1n << 21n;
      assert.equal(
        effectiveCapabilityMask & ~chromiumSandboxCapability,
        0n,
        `Production process ${pid} has unexpected capabilities in its isolated user namespace during ${phase}: ${effectiveCapabilities}; ${argumentsForProcess.join(' ')}`,
      );
    }
    assert.deepEqual(
      processNetworkInterfaces(pid),
      ['lo'],
      `Production process ${pid} has an unexpected interface during ${phase}.`,
    );
    assert.equal(
      processHasExternalRoutes(pid),
      false,
      `Production process ${pid} has a route outside loopback during ${phase}.`,
    );
    inspected.push({
      pid,
      namespace,
      userNamespace,
      processType,
      networkService,
      noNewPrivileges,
      effectiveCapabilities,
    });
  }
  assert.ok(inspected.some(({ pid }) => pid === rootPid), `Production child was not inspected during ${phase}.`);
  assert.ok(
    inspected.some(({ pid }) => hasProcessArgument(pid, '--type=renderer')),
    `A real Chromium renderer was not inspected during ${phase}.`,
  );
  return inspected;
}

function startTcpListener(host) {
  const connections = [];
  const server = net.createServer((socket) => {
    connections.push({ remoteAddress: socket.remoteAddress, remotePort: socket.remotePort });
    socket.destroy();
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host, port: 0, ipv6Only: host === '::1' }, () => {
      server.removeListener('error', reject);
      resolve({ server, connections, port: server.address().port });
    });
  });
}

function verifyRunnerCanReachListener(listener, host) {
  return new Promise((resolve, reject) => {
    const initialConnections = listener.connections.length;
    const socket = net.createConnection({ host, port: listener.port });
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`The test runner could not reach its controlled ${host} listener.`));
    }, 3000);
    socket.once('connect', () => {
      clearTimeout(timeout);
      socket.destroy();
      const deadline = Date.now() + 1000;
      const waitForAccept = () => {
        if (listener.connections.length > initialConnections) {
          resolve();
        } else if (Date.now() >= deadline) {
          reject(new Error(`The controlled ${host} listener did not observe the test-runner connection.`));
        } else {
          setTimeout(waitForAccept, 10);
        }
      };
      waitForAccept();
    });
    socket.once('error', (error) => {
      clearTimeout(timeout);
      reject(new Error(`The test runner could not reach its controlled ${host} listener: ${error.message}`));
    });
  });
}

function closeTcpListener(listener) {
  if (!listener?.server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    listener.server.close((error) => (error ? reject(error) : resolve()));
  });
}

function findBrowserElectronProcess(parentPid, excludedPid = null) {
  for (const pid of processTree(parentPid)) {
    try {
      if (
        pid !== excludedPid
        && isRunning(pid)
        && hasProcessArgument(pid, '--aether-browser-child')
        && path.basename(fs.readlinkSync(`/proc/${pid}/exe`)) === 'parmar-aether-desktop'
      ) return pid;
    } catch (error) {
      if (!['ENOENT', 'ESRCH', 'EACCES'].includes(error.code)) throw error;
    }
  }
  return null;
}

function waitFor(check, description, { timeoutMs = 20_000, processHandle } = {}) {
  return (async () => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (
        processHandle
        && (processHandle.exitCode !== null || processHandle.signalCode !== null)
      ) {
        throw new Error(
          `AETHER exited before ${description} (${processHandle.exitCode ?? processHandle.signalCode}).`,
        );
      }
      if (processHandle?.spawnError) throw processHandle.spawnError;
      const result = check();
      if (result) return result;
      await wait(100);
    }
    throw new Error(`Timed out waiting for ${description}.`);
  })();
}

async function startXvfb() {
  const server = spawn('/usr/bin/Xvfb', [
    '-displayfd', '1', '-screen', '0', '1600x1000x24', '-nolisten', 'tcp', '-ac',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let diagnostic = '';
  server.stderr.setEncoding('utf8');
  server.stderr.on('data', (chunk) => { diagnostic += chunk; });
  const display = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Xvfb startup timed out: ${diagnostic}`)), 5000);
    let output = '';
    server.stdout.setEncoding('utf8');
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
    server.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    server.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Xvfb exited before readiness (${code}): ${diagnostic}`));
    });
  });
  return { server, display };
}

function windowByTitle(title) {
  const result = spawnSync('/usr/bin/xdotool', ['search', '--onlyvisible', '--name', title], {
    encoding: 'utf8',
    timeout: 2000,
    env: xvfbDisplay ? { ...process.env, DISPLAY: xvfbDisplay } : process.env,
  });
  if (result.status !== 0) return null;
  const windows = result.stdout.trim().split('\n').filter(Boolean);
  return windows.length ? windows[windows.length - 1] : null;
}

function focusWindow(windowId) {
  command('/usr/bin/xdotool', ['windowfocus', '--sync', windowId]);
}

function focusAddressBar(windowId) {
  command('/usr/bin/xdotool', [
    'mousemove', '--window', windowId, '500', '70', 'click', '1',
  ]);
}

function press(...keys) {
  command('/usr/bin/xdotool', ['key', '--clearmodifiers', ...keys]);
}

async function saveScreenshot(windowId, filename) {
  const destination = path.join(screenshotDirectory, filename);
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    command('/usr/bin/import', ['-window', windowId, destination]);
    const image = fs.statSync(destination);
    if (image.size > 10_000) return destination;
    await wait(100);
  }
  throw new Error(`${filename} remained blank after waiting for the window to render.`);
}

function assertPanelVisible(filename) {
  const screenshot = path.join(screenshotDirectory, filename);
  const [width, height] = command('/usr/bin/convert', [
    screenshot,
    '-format',
    '%w %h',
    'info:',
  ]).split(/\s+/).map(Number);
  const panelWidth = Math.min(330, width);
  const panelTop = Math.min(180, height - 1);
  const distinctColors = Number(command('/usr/bin/convert', [
    screenshot,
    '-crop',
    `${panelWidth}x160+${width - panelWidth}+${panelTop}`,
    '-format',
    '%k',
    'info:',
  ]));
  assert.ok(
    distinctColors > 20,
    `${filename} does not show visible panel content.`,
  );
}

function savedBrowserStates(homeDirectory) {
  const configDirectory = path.join(homeDirectory, '.config');
  if (!fs.existsSync(configDirectory)) return [];
  const states = [];
  for (const applicationDirectory of fs.readdirSync(configDirectory, { withFileTypes: true })) {
    if (!applicationDirectory.isDirectory()) continue;
    const profileDirectory = path.join(configDirectory, applicationDirectory.name, 'aether-browser-profile');
    const filename = path.join(profileDirectory, 'aether-state.json');
    if (fs.existsSync(filename)) states.push(JSON.parse(fs.readFileSync(filename, 'utf8')));
  }
  return states;
}

test('packaged AETHER UI launches isolated Chromium and supports real browser chrome interactions', {
  skip: !enabled && !required
    ? 'Set PARMAR_AETHER_UI_SMOKE=1 to run the packaged Electron UI and screenshot smoke test.'
    : false,
  timeout: 240_000,
}, async (context) => {
  assert.equal(enabled, true, 'PARMAR_AETHER_UI_SMOKE must be set to "1" for required UI verification.');
  for (const executable of requiredExecutables) {
    assert.ok(fs.existsSync(executable), `Required GUI test executable is missing: ${executable}`);
  }
  assert.ok(fs.existsSync(appImagePath), `Packaged AETHER AppImage is missing: ${appImagePath}`);
  if (required) {
    assert.ok(
      process.env.PARMAR_AETHER_APPIMAGE_PATH
        && path.isAbsolute(process.env.PARMAR_AETHER_APPIMAGE_PATH),
      'Required UI smoke needs an explicit absolute path to the fresh AppImage.',
    );
    const distDirectory = path.resolve(desktopDirectory, 'dist');
    const appImageRelativeToDist = path.relative(distDirectory, path.resolve(appImagePath));
    assert.ok(
      appImageRelativeToDist.startsWith('..') || path.isAbsolute(appImageRelativeToDist),
      'Required UI smoke must not use a package from the existing dist directory.',
    );
    assert.ok(fs.statSync(appImagePath).isFile(), 'The required AppImage path is not a file.');
    fs.accessSync(appImagePath, fs.constants.X_OK);
  }
  assert.ok(
    evidenceDirectory && path.isAbsolute(evidenceDirectory),
    'PARMAR_AETHER_UI_SCREENSHOT_DIR must be an absolute evidence directory.',
  );
  assert.ok(
    fs.statSync(evidenceDirectory).isDirectory(),
    'PARMAR_AETHER_UI_SCREENSHOT_DIR must identify an existing fresh evidence directory.',
  );
  fs.mkdirSync(screenshotDirectory);

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'parmar-aether-ui-'));
  const controlledListeners = [];
  const homeDirectory = path.join(temporaryDirectory, 'home');
  const seedState = JSON.stringify({
    version: 1,
    bookmarks: [],
    history: [],
    session: {
      tabs: ['https://example.com/restored-one', 'https://example.net/restored-two'],
      activeIndex: 1,
    },
  });
  let xvfb = null;
  let application = null;
  let mainPid = null;
  let browserChildPid = null;
  let applicationOutput = '';
  let applicationError = '';
  let applicationClose;
  let resolveApplicationClose;
  applicationClose = new Promise((resolve) => { resolveApplicationClose = resolve; });

  context.after(async () => {
    if (mainPid && isRunning(mainPid)) {
      try {
        process.kill(mainPid, 'SIGTERM');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
    if (browserChildPid && isRunning(browserChildPid)) {
      try {
        const groupId = processGroupId(browserChildPid);
        assertNotHarnessProcessGroup(groupId, 'the browser child');
        process.kill(-groupId, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
    if (application && application.exitCode === null) {
      await Promise.race([
        applicationClose,
        wait(10_000).then(() => {
          if (application.exitCode === null) application.kill('SIGKILL');
        }),
      ]);
    }
    if (xvfb && xvfb.exitCode === null && xvfb.signalCode === null) {
      const xvfbClosed = new Promise((resolve) => xvfb.once('close', resolve));
      xvfb.kill('SIGTERM');
      const closedGracefully = await Promise.race([
        xvfbClosed.then(() => true),
        wait(3000).then(() => false),
      ]);
      if (!closedGracefully && xvfb.exitCode === null && xvfb.signalCode === null) {
        xvfb.kill('SIGKILL');
        await Promise.race([xvfbClosed, wait(3000)]);
      }
      assert.ok(
        xvfb.exitCode !== null || xvfb.signalCode !== null,
        'Xvfb did not exit during smoke-test cleanup.',
      );
    }
    await Promise.all(controlledListeners.map(closeTcpListener));
    assert.ok(
      controlledListeners.every(({ server }) => !server.listening),
      'A controlled production-probe listener remained open during cleanup.',
    );
    if (controlledListeners.length) console.log('Controlled production-probe listeners closed.');
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    xvfbDisplay = null;
  });

  const ipv4Listener = await startTcpListener('127.0.0.1');
  controlledListeners.push(ipv4Listener);
  const ipv6Listener = await startTcpListener('::1');
  controlledListeners.push(ipv6Listener);
  await verifyRunnerCanReachListener(ipv4Listener, '127.0.0.1');
  await verifyRunnerCanReachListener(ipv6Listener, '::1');
  assert.ok(ipv4Listener.connections.length > 0, 'The runner IPv4 listener reachability check did not execute.');
  assert.ok(ipv6Listener.connections.length > 0, 'The runner IPv6 listener reachability check did not execute.');
  ipv4Listener.connections.length = 0;
  ipv6Listener.connections.length = 0;
  for (const applicationName of ['parmar-aether-desktop', 'PARMAR AETHER']) {
    const profileDirectory = path.join(
      homeDirectory,
      '.config',
      applicationName,
      'aether-browser-profile',
    );
    fs.mkdirSync(profileDirectory, { recursive: true });
    fs.writeFileSync(path.join(profileDirectory, 'aether-state.json'), seedState);
  }

  const xvfbResult = await startXvfb();
  xvfb = xvfbResult.server;
  const { display } = xvfbResult;
  xvfbDisplay = display;

  const applicationEnvironment = {
    ...process.env,
    DISPLAY: display,
    HOME: homeDirectory,
    PARMAR_DESKTOP_BACKEND_URL: 'http://127.0.0.1:1',
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
    appImagePath,
    '--appimage-extract-and-run',
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
  application.once('exit', (code, signal) => resolveApplicationClose({ code, signal }));
  application.once('error', (error) => {
    application.spawnError = error;
    applicationError += `AppImage spawn failed: ${error.message}\n`;
    resolveApplicationClose({ error });
  });
  application.stdout.setEncoding('utf8');
  application.stderr.setEncoding('utf8');
  application.stdout.on('data', (chunk) => { applicationOutput += chunk; });
  application.stderr.on('data', (chunk) => { applicationError += chunk; });

  const controlWindow = await waitFor(
    () => windowByTitle('Control plane unavailable'),
    'the PARMAR control window',
    { timeoutMs: 30_000, processHandle: application },
  ).catch((error) => {
    throw new Error(`${error.message}\n${applicationOutput}\n${applicationError}`);
  });
  mainPid = Number(command('/usr/bin/xdotool', ['getwindowpid', controlWindow]));
  assert.ok(Number.isSafeInteger(mainPid) && mainPid > 0, 'Could not identify the Electron parent PID.');
  focusWindow(controlWindow);
  await wait(500);
  await saveScreenshot(controlWindow, '00-control-plane-unavailable.png');
  press('Tab', 'Return');
  const browserWindow = await waitFor(
    () => windowByTitle('AETHER'),
    'the AETHER browser window',
    {
      timeoutMs: 30_000,
      processHandle: application,
    },
  ).catch((error) => {
    throw new Error(`${error.message}\n${applicationOutput}\n${applicationError}`);
  });
  await wait(500);
  focusWindow(browserWindow);
  await saveScreenshot(browserWindow, '00-browser-startup.png');
  const hostNamespace = fs.readlinkSync('/proc/self/ns/net');
  assert.notEqual(
    fs.readlinkSync(`/proc/${mainPid}/ns/net`),
    hostNamespace,
    'The test-launched PARMAR control process shares the host network namespace.',
  );
  assert.deepEqual(
    processNetworkInterfaces(mainPid),
    ['lo'],
    'The test-launched PARMAR control process has an unexpected network interface.',
  );
  assert.equal(
    processHasExternalRoutes(mainPid),
    false,
    'The test-launched PARMAR control process has an external network route.',
  );
  const parentStatus = fs.readFileSync(`/proc/${mainPid}/status`, 'utf8');
  assert.equal(
    parentStatus.match(/^NoNewPrivs:\s+(\d+)$/m)?.[1],
    '1',
    'The test-launched PARMAR control process lacks no_new_privs.',
  );
  assert.match(
    parentStatus,
    /^CapEff:\s+0{16,}$/mi,
    'The test-launched PARMAR control process retained effective capabilities.',
  );
  browserChildPid = await waitFor(
    () => findBrowserElectronProcess(mainPid),
    'the isolated Electron browser process',
    { timeoutMs: 10_000, processHandle: application },
  ).catch((error) => {
    const descendants = processTree(mainPid).map((pid) => {
      let executable = 'unknown';
      try {
        executable = fs.readlinkSync(`/proc/${pid}/exe`);
      } catch (readError) {
        if (!['ENOENT', 'ESRCH', 'EACCES'].includes(readError.code)) throw readError;
      }
      return `${pid} exe=${executable} args=${JSON.stringify(processArguments(pid))}`;
    });
    throw new Error(`${error.message}\n${descendants.join('\n')}\n${applicationOutput}\n${applicationError}`);
  });
  let browserGroupId = processGroupId(browserChildPid);
  const browserNamespace = fs.readlinkSync(`/proc/${browserChildPid}/ns/net`);
  assert.notEqual(browserNamespace, hostNamespace, 'Production Electron child shares the host network namespace.');
  assert.equal(
    fs.readFileSync(`/proc/${browserChildPid}/status`, 'utf8')
      .split('\n').find((line) => line.startsWith('NoNewPrivs:'))?.trim().split(/\s+/)[1],
    '1',
    'Production Electron child did not enable no_new_privs.',
  );
  assert.match(
    fs.readFileSync(`/proc/${browserChildPid}/status`, 'utf8'),
    /CapEff:\s+0{16,}/,
    'Production Electron child retained effective capabilities.',
  );
  const chromiumDescendants = await waitFor(
    () => processTree(browserChildPid).filter((pid) => (
      hasProcessArgument(pid, '--type=renderer')
    )),
    'a real Chromium renderer process',
    { timeoutMs: 15_000, processHandle: application },
  );
  assert.ok(chromiumDescendants.length, 'The browser child did not start a Chromium renderer.');
  const initialProductionProcesses = assertProductionProcessIsolation(
    browserChildPid,
    hostNamespace,
    'initial startup',
  );
  assert.ok(
    initialProductionProcesses.some(({ pid }) => chromiumDescendants.includes(pid)),
    'The Chromium renderer security properties were not inspected.',
  );
  console.log(`Packaged production isolation at startup: ${JSON.stringify(initialProductionProcesses)}`);

  focusWindow(browserWindow);
  focusAddressBar(browserWindow);
  press('ctrl+r');
  await saveScreenshot(browserWindow, '01-local-reload.png');
  await wait(1000);
  await saveScreenshot(browserWindow, '02-paused-session-desktop.png');
  assert.ok(
    savedBrowserStates(homeDirectory).some((state) => (
      JSON.stringify(state.session.tabs) === JSON.stringify([
        'https://example.com/restored-one',
        'https://example.net/restored-two',
      ])
      && state.session.activeIndex === 1
    )),
    'The selected restored tab did not remain paused at its saved address.',
  );

  const crashedProcessIds = [browserChildPid, ...processGroupMembers(browserGroupId)];
  assertNotHarnessProcessGroup(browserGroupId, 'browser crash recovery');
  process.kill(-browserGroupId, 'SIGKILL');
  const crashedBrowserChildPid = browserChildPid;
  await waitFor(
    () => !isRunning(crashedBrowserChildPid),
    'crashed browser child cleanup',
    { timeoutMs: 10_000, processHandle: application },
  );
  await waitFor(
    () => crashedProcessIds.every((pid) => !isRunning(pid)),
    'crashed Chromium descendant cleanup',
    { timeoutMs: 10_000, processHandle: application },
  );
  await waitFor(
    () => !windowByTitle('AETHER'),
    'crashed browser window closure',
    { timeoutMs: 10_000, processHandle: application },
  );
  browserChildPid = await waitFor(
    () => findBrowserElectronProcess(mainPid, crashedBrowserChildPid),
    'bounded production browser crash recovery',
    { timeoutMs: 20_000, processHandle: application },
  );
  browserGroupId = processGroupId(browserChildPid);
  const recoveredBrowserWindow = await waitFor(
    () => windowByTitle('AETHER'),
    'the recovered AETHER window',
    { timeoutMs: 20_000, processHandle: application },
  );
  assert.notEqual(browserChildPid, crashedBrowserChildPid);
  const recoveredProductionProcesses = assertProductionProcessIsolation(
    browserChildPid,
    hostNamespace,
    'crash recovery',
  );
  assert.ok(
    recoveredProductionProcesses.some(({ pid }) => hasProcessArgument(pid, '--type=renderer')),
    'Crash recovery did not produce a security-checked Chromium renderer.',
  );
  console.log(`Packaged production isolation after recovery: ${JSON.stringify(recoveredProductionProcesses)}`);
  focusWindow(recoveredBrowserWindow);
  focusAddressBar(recoveredBrowserWindow);
  await wait(500);
  await saveScreenshot(recoveredBrowserWindow, '03-after-crash-recovery.png');
  assert.ok(
    savedBrowserStates(homeDirectory).some((state) => (
      state.session.activeIndex === 1
      && state.session.tabs[1] === 'https://example.net/restored-two'
    )),
    'Crash recovery did not preserve the paused session address.',
  );

  const attemptedDestinations = [
    `https://127.0.0.1:${ipv4Listener.port}/aether-controlled-probe`,
    `https://[::1]:${ipv6Listener.port}/aether-controlled-probe`,
  ];
  for (const destination of attemptedDestinations) {
    focusAddressBar(recoveredBrowserWindow);
    press('ctrl+l');
    command('/usr/bin/xdotool', ['key', '--clearmodifiers', 'ctrl+a']);
    command('/usr/bin/xdotool', ['type', '--clearmodifiers', '--delay', '5', destination]);
    await saveScreenshot(
      recoveredBrowserWindow,
      destination.includes('[::1]')
        ? '12-production-ipv6-address-entered.png'
        : '11-production-ipv4-address-entered.png',
    );
    press('Return');
    await wait(500);
    await saveScreenshot(
      recoveredBrowserWindow,
      destination.includes('[::1]')
        ? '12-production-ipv6-navigation-blocked.png'
        : '11-production-ipv4-navigation-blocked.png',
    );
    assert.equal(application.exitCode, null, 'AETHER exited during restricted navigation.');
  }
  await wait(500);
  assert.deepEqual(
    ipv4Listener.connections,
    [],
    'The packaged browser process reached the controlled IPv4 loopback listener.',
  );
  assert.deepEqual(
    ipv6Listener.connections,
    [],
    'The packaged browser process reached the controlled IPv6 loopback listener.',
  );
  assert.equal(
    savedBrowserStates(homeDirectory).some((state) => attemptedDestinations.some(
      (destination) => state.session.tabs.includes(destination),
    )),
    false,
    'A controlled loopback destination was accepted into the production browser session.',
  );
  console.log(`Packaged production restricted-navigation probes: ${JSON.stringify({
    ipv4: { destination: attemptedDestinations[0], acceptedConnections: ipv4Listener.connections.length },
    ipv6: { destination: attemptedDestinations[1], acceptedConnections: ipv6Listener.connections.length },
  })}`);

  focusAddressBar(recoveredBrowserWindow);
  press('ctrl+t');
  await wait(500);
  await saveScreenshot(recoveredBrowserWindow, '04-new-tab.png');
  focusAddressBar(recoveredBrowserWindow);
  press('ctrl+Tab');
  await wait(250);
  focusAddressBar(recoveredBrowserWindow);
  press('ctrl+Tab');
  await wait(250);
  await saveScreenshot(recoveredBrowserWindow, '05-tab-switching.png');
  focusAddressBar(recoveredBrowserWindow);
  press('ctrl+w');
  await wait(500);

  focusAddressBar(recoveredBrowserWindow);
  press('ctrl+l');
  command('/usr/bin/xdotool', ['type', '--clearmodifiers', '--delay', '15', 'https://example.com/']);
  press('Return');
  await wait(750);
  await saveScreenshot(recoveredBrowserWindow, '06-navigation-restricted-error.png');

  focusWindow(recoveredBrowserWindow);
  focusAddressBar(recoveredBrowserWindow);
  press('ctrl+l', 'Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Return');
  await wait(350);
  await saveScreenshot(recoveredBrowserWindow, '07-history-empty.png');
  assertPanelVisible('07-history-empty.png');
  press('shift+Tab', 'Return');
  await wait(350);
  await saveScreenshot(recoveredBrowserWindow, '08-bookmarks-empty.png');
  assertPanelVisible('08-bookmarks-empty.png');

  command('/usr/bin/xdotool', ['windowsize', recoveredBrowserWindow, '360', '720']);
  await wait(500);
  await saveScreenshot(recoveredBrowserWindow, '09-responsive-360.png');
  command('/usr/bin/xdotool', ['windowsize', recoveredBrowserWindow, '640', '720']);
  await wait(500);
  await saveScreenshot(recoveredBrowserWindow, '10-responsive-640.png');
  command('/usr/bin/xdotool', ['windowsize', recoveredBrowserWindow, '1480', '920']);
  await wait(500);
  await saveScreenshot(recoveredBrowserWindow, '11-responsive-large.png');

  const stored = savedBrowserStates(homeDirectory).find((state) => (
    JSON.stringify(state.session.tabs) === JSON.stringify(['https://example.com/restored-one', null])
    && state.session.activeIndex === 1
  ));
  assert.ok(stored, 'The real browser process did not persist its session state.');
  assert.equal(stored.session.tabs.length, 2, 'Real tab creation, switching, or closing did not persist correctly.');
  assert.deepEqual(
    stored.session.tabs,
    ['https://example.com/restored-one', null],
    'The real tab close action did not retain the remaining restored tab and new tab.',
  );
  assert.equal(stored.session.activeIndex, 1, 'The active tab was not synchronized after closing the selected tab.');
  assert.equal(stored.bookmarks.length, 0, 'Restricted browsing unexpectedly created bookmarks.');
  assert.equal(stored.history.length, 0, 'Restricted browsing unexpectedly created browsing history.');
  assert.equal(application.exitCode, null, 'AETHER exited during browser interaction.');

  const shutdownProcessIds = new Set([
    ...initialProductionProcesses.map(({ pid }) => pid),
    ...recoveredProductionProcesses.map(({ pid }) => pid),
    browserChildPid,
    ...processTree(browserChildPid),
    ...processGroupMembers(browserGroupId),
  ]);
  console.log(`Requesting packaged application shutdown; recorded process IDs: ${JSON.stringify([...shutdownProcessIds])}`);
  process.kill(mainPid, 'SIGTERM');
  await waitFor(() => !isRunning(mainPid), 'graceful parent application shutdown', { timeoutMs: 15_000 });
  console.log('Packaged application parent exited.');
  await waitFor(() => !isRunning(browserChildPid), 'browser child process cleanup', { timeoutMs: 15_000 });
  console.log('Packaged browser child exited.');
  await waitFor(
    () => processGroupMembers(browserGroupId).every((pid) => !isRunning(pid)),
    'all Electron and Chromium process cleanup',
    { timeoutMs: 15_000 },
  );
  console.log('Packaged browser process group is empty.');
  await waitFor(
    () => [...shutdownProcessIds].every((pid) => !isRunning(pid)),
    'cleanup of every recorded production Electron and Chromium process',
    { timeoutMs: 15_000 },
  );
  console.log('All recorded production processes exited.');
  const result = await Promise.race([
    applicationClose,
    wait(10_000).then(() => null),
  ]);
  assert.ok(
    result,
    `The AppImage launcher process ${application.pid} did not report exit after its GUI and browser processes stopped.`,
  );
  if (result.error) throw result.error;
  if (result.code !== 0 && result.signal !== 'SIGTERM') {
    throw new Error(
      `AppImage process exited with ${result.code ?? result.signal}.\n${applicationOutput}\n${applicationError}`,
    );
  }
});
