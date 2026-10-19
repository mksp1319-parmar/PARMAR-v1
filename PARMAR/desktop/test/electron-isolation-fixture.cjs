'use strict';

const net = require('node:net');
const readline = require('node:readline');
const { app, BrowserWindow } = require('electron');

function emit(event, details = {}) {
  process.stdout.write(`AETHER_ELECTRON_EVENT ${JSON.stringify({ event, ...details })}\n`);
}

function probe(address, port, family) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: address, port, family });
    let completed = false;
    const finish = (result) => {
      if (completed) return;
      completed = true;
      socket.destroy();
      resolve({ address, port, family, ...result });
    };

    socket.setTimeout(1500, () => finish({ connected: false, error: 'ETIMEDOUT' }));
    socket.once('connect', () => finish({ connected: true }));
    socket.once('error', (error) => finish({ connected: false, error: error.code || error.message }));
  });
}

async function main() {
  const startupDelay = Number(process.env.PARMAR_TEST_STARTUP_DELAY_MS || 0);
  app.setPath('userData', process.env.PARMAR_TEST_USER_DATA);
  await app.whenReady();
  if (startupDelay > 0) await new Promise((resolve) => setTimeout(resolve, startupDelay));

  const window = new BrowserWindow({
    show: true,
    webPreferences: {
      allowRunningInsecureContent: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  await window.loadFile(process.env.PARMAR_TEST_RENDERER_PAGE, {
    query: {
      targets: process.env.PARMAR_TEST_RENDERER_TARGETS,
      websockets: process.env.PARMAR_TEST_RENDERER_WEBSOCKET_TARGETS,
      redirects: process.env.PARMAR_TEST_RENDERER_REDIRECT_TARGETS,
    },
  });

  const probes = await Promise.all([
    probe(
      process.env.PARMAR_TEST_IPV4_HOST,
      Number(process.env.PARMAR_TEST_IPV4_PORT),
      4,
    ),
    probe('127.0.0.1', Number(process.env.PARMAR_TEST_IPV4_LOOPBACK_PORT), 4),
    probe('::1', Number(process.env.PARMAR_TEST_IPV6_LOOPBACK_PORT), 6),
  ]);
  const rendererProbes = await window.webContents.executeJavaScript(
    'window.__AETHER_TEST_PROBES__',
  );
  const rendererRedirectProbes = await window.webContents.executeJavaScript(
    'window.__AETHER_TEST_REDIRECT_PROBES__',
  );
  const rendererWebSocketProbes = await window.webContents.executeJavaScript(
    'window.__AETHER_TEST_WEBSOCKET_PROBES__',
  );
  const metrics = app.getAppMetrics().map(({ pid, type }) => ({ pid, type }));

  emit('ready', {
    electronMainPid: process.pid,
    rendererPid: window.webContents.getOSProcessId(),
    metrics,
    probes,
    rendererProbes,
    rendererRedirectProbes,
    rendererWebSocketProbes,
    namespace: require('node:fs').readlinkSync('/proc/self/ns/net'),
  });

  const commands = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  commands.on('line', (line) => {
    let command;
    try {
      command = JSON.parse(line);
    } catch {
      return;
    }

    if (command?.type === 'shutdown') {
      emit('graceful-shutdown-requested');
      window.close();
      app.quit();
    } else if (command?.type === 'crash') {
      emit('unexpected-exit-requested');
      app.exit(23);
    }
  });

  app.on('before-quit', () => emit('before-quit'));
}

main().catch((error) => {
  emit('fixture-error', { message: error.message });
  app.exit(1);
});
