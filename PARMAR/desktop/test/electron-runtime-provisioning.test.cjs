'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { verifyElectronRuntime } = require('../scripts/verify-electron-runtime.cjs');

function createDesktopDirectory(t) {
  const desktopDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-electron-runtime-'));
  t.after(() => fs.rmSync(desktopDirectory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(desktopDirectory, 'node_modules', 'electron'), { recursive: true });
  fs.writeFileSync(path.join(desktopDirectory, 'package.json'), JSON.stringify({
    devDependencies: { electron: '44.7.0' },
  }));
  fs.writeFileSync(path.join(desktopDirectory, 'package-lock.json'), JSON.stringify({
    packages: { 'node_modules/electron': { version: '44.7.0' } },
  }));
  fs.writeFileSync(path.join(desktopDirectory, 'node_modules', 'electron', 'package.json'), JSON.stringify({
    version: '44.7.0',
  }));
  return desktopDirectory;
}

function createRuntime(desktopDirectory) {
  const runtimeDirectory = path.join(desktopDirectory, 'node_modules', 'electron', 'dist');
  fs.mkdirSync(runtimeDirectory);
  const electronBinary = path.join(runtimeDirectory, 'electron');
  fs.writeFileSync(electronBinary, '');
  fs.chmodSync(electronBinary, 0o755);
}

function testRuntimeOptions(version = 'v44.7.0') {
  return {
    runLibrariesCommand: () => '',
    runVersionCommand: () => version,
  };
}

test('accepts a manifest and lockfile declaring the same pinned Electron version', (t) => {
  const desktopDirectory = createDesktopDirectory(t);
  createRuntime(desktopDirectory);
  const result = verifyElectronRuntime(desktopDirectory, testRuntimeOptions());
  assert.equal(result.pinnedVersion, '44.7.0');
});

test('rejects when the manifest Electron version differs from the lockfile', (t) => {
  const desktopDirectory = createDesktopDirectory(t);
  createRuntime(desktopDirectory);
  fs.writeFileSync(path.join(desktopDirectory, 'package.json'), JSON.stringify({
    devDependencies: { electron: '44.6.0' },
  }));
  assert.throws(
    () => verifyElectronRuntime(desktopDirectory, testRuntimeOptions()),
    /package\.json declares 44\.6\.0, but package-lock\.json pins 44\.7\.0/,
  );
});

test('rejects when the manifest Electron dependency is missing', (t) => {
  const desktopDirectory = createDesktopDirectory(t);
  createRuntime(desktopDirectory);
  fs.writeFileSync(path.join(desktopDirectory, 'package.json'), JSON.stringify({
    devDependencies: {},
  }));
  assert.throws(
    () => verifyElectronRuntime(desktopDirectory, testRuntimeOptions()),
    /Electron dependency is missing from package\.json devDependencies/,
  );
});

test('rejects when the lockfile Electron entry is missing', (t) => {
  const desktopDirectory = createDesktopDirectory(t);
  createRuntime(desktopDirectory);
  fs.writeFileSync(path.join(desktopDirectory, 'package-lock.json'), JSON.stringify({ packages: {} }));
  assert.throws(
    () => verifyElectronRuntime(desktopDirectory, testRuntimeOptions()),
    /Electron package-lock\.json entry is missing/,
  );
});

test('rejects version ranges in the manifest instead of normalizing them', (t) => {
  const desktopDirectory = createDesktopDirectory(t);
  createRuntime(desktopDirectory);
  fs.writeFileSync(path.join(desktopDirectory, 'package.json'), JSON.stringify({
    devDependencies: { electron: '^44.7.0' },
  }));
  assert.throws(
    () => verifyElectronRuntime(desktopDirectory, testRuntimeOptions()),
    /package\.json devDependencies version must be an exact x\.y\.z version/,
  );
});

test('rejects version ranges in the lockfile instead of normalizing them', (t) => {
  const desktopDirectory = createDesktopDirectory(t);
  createRuntime(desktopDirectory);
  fs.writeFileSync(path.join(desktopDirectory, 'package-lock.json'), JSON.stringify({
    packages: { 'node_modules/electron': { version: '^44.7.0' } },
  }));
  assert.throws(
    () => verifyElectronRuntime(desktopDirectory, testRuntimeOptions()),
    /package-lock\.json entry must contain an exact x\.y\.z version/,
  );
});

test('fails clearly when the Electron npm package is missing', (t) => {
  const desktopDirectory = createDesktopDirectory(t);
  fs.rmSync(path.join(desktopDirectory, 'node_modules', 'electron'), { recursive: true });
  assert.throws(
    () => verifyElectronRuntime(desktopDirectory),
    /Electron npm package is missing/,
  );
});

test('fails clearly when the Electron runtime binary is missing', (t) => {
  const desktopDirectory = createDesktopDirectory(t);
  fs.mkdirSync(path.join(desktopDirectory, 'node_modules', 'electron', 'dist'));
  assert.throws(
    () => verifyElectronRuntime(desktopDirectory, testRuntimeOptions()),
    /Electron runtime binary is missing or not executable/,
  );
});

test('fails clearly when the Electron runtime version differs from the lockfile', (t) => {
  const desktopDirectory = createDesktopDirectory(t);
  createRuntime(desktopDirectory);
  assert.throws(
    () => verifyElectronRuntime(desktopDirectory, testRuntimeOptions('v44.6.0')),
    /runtime reports version v44\.6\.0; lockfile pins 44\.7\.0/,
  );
});

test('checks shared libraries before launching Electron for its version', (t) => {
  const desktopDirectory = createDesktopDirectory(t);
  createRuntime(desktopDirectory);
  let versionCommandCalled = false;
  assert.throws(
    () => verifyElectronRuntime(desktopDirectory, {
      runLibrariesCommand: () => 'libatk-1.0.so.0 => not found',
      runVersionCommand: () => {
        versionCommandCalled = true;
        return 'v44.7.0';
      },
    }),
    /unresolved shared libraries:\nlibatk-1\.0\.so\.0 => not found/,
  );
  assert.equal(versionCommandCalled, false);
});

test('fails clearly when the Electron runtime directory is invalid', (t) => {
  const desktopDirectory = createDesktopDirectory(t);
  const runtimeDirectory = path.join(desktopDirectory, 'node_modules', 'electron', 'dist');
  fs.writeFileSync(runtimeDirectory, 'not a directory');
  assert.throws(
    () => verifyElectronRuntime(desktopDirectory, testRuntimeOptions()),
    /Electron runtime directory is invalid/,
  );
});

test('accepts a lockfile-matched executable Electron runtime', (t) => {
  const desktopDirectory = createDesktopDirectory(t);
  createRuntime(desktopDirectory);
  const result = verifyElectronRuntime(desktopDirectory, testRuntimeOptions());
  assert.equal(result.pinnedVersion, '44.7.0');
  assert.equal(result.runtimeDirectory, path.join(desktopDirectory, 'node_modules', 'electron', 'dist'));
});
