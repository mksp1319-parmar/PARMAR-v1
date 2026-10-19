'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const desktopDirectory = path.resolve(__dirname, '..');
const electronPath = path.join(desktopDirectory, 'node_modules/electron/dist/electron');
const fixturePath = path.join(__dirname, 'electron-isolation-fixture.cjs');

if (!fs.existsSync(electronPath) || !fs.existsSync(fixturePath)) {
  process.stderr.write('The pinned Electron runtime or fixture is unavailable.\n');
  process.exit(2);
}

const electron = spawn(electronPath, [fixturePath], {
  cwd: desktopDirectory,
  env: process.env,
  stdio: ['pipe', 'pipe', 'pipe'],
});

function sendSignal(signal) {
  if (electron.exitCode !== null || electron.signalCode !== null) return;
  electron.kill(signal);
}

process.stdout.write(`AETHER_WRAPPER_EVENT ${JSON.stringify({
  event: 'wrapper-ready',
  pid: process.pid,
  namespace: fs.readlinkSync('/proc/self/ns/net'),
  electronPid: electron.pid,
})}\n`);

process.stdin.pipe(electron.stdin);
electron.stdout.pipe(process.stdout);
electron.stderr.pipe(process.stderr);

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => sendSignal(signal));
}

electron.once('error', (error) => {
  process.stderr.write(`Electron spawn failed: ${error.message}\n`);
  process.exitCode = 1;
});

electron.once('close', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
