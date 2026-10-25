'use strict';

const net = require('node:net');
const { app, BrowserWindow } = require('electron');

let browserWindow = null;
let gracefulShutdownRequested = false;

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

  browserWindow = new BrowserWindow({
    show: true,
    webPreferences: {
      allowRunningInsecureContent: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  browserWindow.once('closed', () => {
    emit('window-closed');
    if (gracefulShutdownRequested) process.exit(0);
  });
  await browserWindow.loadFile(process.env.PARMAR_TEST_RENDERER_PAGE, {
    query: {
      targets: process.env.PARMAR_TEST_RENDERER_TARGETS,
      websockets: process.env.PARMAR_TEST_RENDERER_WEBSOCKET_TARGETS,
      redirects: process.env.PARMAR_TEST_RENDERER_REDIRECT_TARGETS,
    },
  });

  const probes = await Promise.all([
    probe('127.0.0.1', Number(process.env.PARMAR_TEST_IPV4_LOOPBACK_PORT), 4),
    probe('::1', Number(process.env.PARMAR_TEST_IPV6_LOOPBACK_PORT), 6),
  ]);
  const rendererProbes = await browserWindow.webContents.executeJavaScript(
    'window.__AETHER_TEST_PROBES__',
  );
  const rendererRedirectProbes = await browserWindow.webContents.executeJavaScript(
    'window.__AETHER_TEST_REDIRECT_PROBES__',
  );
  const rendererWebSocketProbes = await browserWindow.webContents.executeJavaScript(
    'window.__AETHER_TEST_WEBSOCKET_PROBES__',
  );
  const metrics = app.getAppMetrics().map(({ pid, type }) => ({ pid, type }));

  emit('ready', {
    electronMainPid: process.pid,
    rendererPid: browserWindow.webContents.getOSProcessId(),
    metrics,
    probes,
    rendererProbes,
    rendererRedirectProbes,
    rendererWebSocketProbes,
    namespace: require('node:fs').readlinkSync('/proc/self/ns/net'),
  });

  app.on('before-quit', () => emit('before-quit'));
}

process.on('SIGUSR1', () => {
  gracefulShutdownRequested = true;
  emit('graceful-shutdown-requested');
  browserWindow?.close();
  app.quit();
});

process.on('SIGUSR2', () => {
  emit('unexpected-exit-requested');
  app.exit(23);
});

main().catch((error) => {
  emit('fixture-error', { message: error.message });
  app.exit(1);
});
