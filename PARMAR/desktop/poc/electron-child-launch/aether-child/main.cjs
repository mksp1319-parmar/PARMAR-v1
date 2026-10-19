'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('node:path');

function protocolMessage(event, details = {}) {
  return {
    protocol: 1,
    component: 'aether-child-poc',
    event,
    electronVersion: process.versions.electron,
    executablePath: process.execPath,
    entryPoint: __filename,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    pid: process.pid,
    parentPid: process.ppid,
    ...details,
  };
}

function emitProtocol(event, details) {
  process.stdout.write(`${JSON.stringify(protocolMessage(event, details))}\n`);
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 720,
    height: 480,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const localPage = path.join(__dirname, 'index.html');
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== `file://${localPage}`) event.preventDefault();
  });

  await window.loadFile(localPage);
  window.show();
  emitProtocol('ready', { localPage });
}).catch((error) => {
  emitProtocol('startup-failed', {
    reason: error instanceof Error ? error.message.slice(0, 1024) : 'Startup failed.',
  });
  app.exit(1);
});

app.on('window-all-closed', () => app.quit());
process.on('SIGTERM', () => app.quit());
process.on('SIGINT', () => app.quit());
