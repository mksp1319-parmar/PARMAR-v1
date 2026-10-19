'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const desktopDirectory = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(desktopDirectory, 'package.json'), 'utf8'));
const lockfile = JSON.parse(fs.readFileSync(path.join(desktopDirectory, 'package-lock.json'), 'utf8'));

test('Electron start and test scripts resolve from the desktop package directory', () => {
  assert.equal(manifest.main, 'main.cjs');
  assert.equal(fs.existsSync(path.join(desktopDirectory, manifest.main)), true);
  assert.equal(manifest.scripts.start, 'electron .');
  assert.equal(manifest.scripts.test, 'node --test test/*.test.cjs');
  assert.equal(
    manifest.scripts['test:electron-isolation'],
    'node --test test/electron-isolation-integration.test.cjs',
  );
  assert.equal(manifest.engines.node, '>=22.12.0 <25');
});

test('Electron dependency is an exact version matched by the npm lockfile', () => {
  const manifestElectron = manifest.devDependencies.electron;
  const lockedElectron = lockfile.packages['node_modules/electron'];
  assert.match(manifestElectron, /^\d+\.\d+\.\d+$/);
  assert.equal(lockedElectron.version, manifestElectron);
  assert.equal(lockfile.packages[''].devDependencies.electron, manifestElectron);
  assert.equal(lockfile.lockfileVersion, 3);
});

test('all privileged UI assets exist and webpage renderers have no preload bridge', () => {
  for (const file of [
    'browser.html',
    'browser.css',
    'browser-renderer.cjs',
    'browser-preload.cjs',
    'control-preload.cjs',
    'control-unavailable.html',
    'control-unavailable.cjs',
    'browser-child-broker.cjs',
    'browser-child-supervisor.cjs',
    'isolation-launcher.cjs',
    'isolation-probe.cjs',
    'ISOLATION-READINESS.md',
    'test/electron-isolation-wrapper.cjs',
    'test/electron-isolation-fixture.cjs',
    'test/electron-isolation-fixture.html',
    'test/electron-isolation-renderer.js',
    'test/electron-isolation-integration.test.cjs',
    'test/browser-child.test.cjs',
    'newtab.html',
    'security.cjs',
    'store.cjs',
  ]) {
    assert.equal(fs.existsSync(path.join(desktopDirectory, file)), true, file);
  }

  const main = fs.readFileSync(path.join(desktopDirectory, 'main.cjs'), 'utf8');
  assert.match(main, /preload:\s*BROWSER_PRELOAD/);
  assert.match(main, /preload:\s*CONTROL_PRELOAD/);
  const webpageView = main.match(/const view = new WebContentsView\(\{[\s\S]*?\n  \}\);/)?.[0];
  assert.ok(webpageView);
  assert.match(webpageView, /contextIsolation:\s*true/);
  assert.match(webpageView, /nodeIntegration:\s*false/);
  assert.match(webpageView, /sandbox:\s*true/);
  assert.match(webpageView, /webSecurity:\s*true/);
  assert.doesNotMatch(webpageView, /preload:/);
  assert.doesNotMatch(main, /broker-protocol\.cjs/);
  assert.doesNotMatch(fs.readFileSync(path.join(desktopDirectory, 'browser-preload.cjs'), 'utf8'), /broker-protocol|browser\.(?:start|stop|status)/);
  assert.doesNotMatch(fs.readFileSync(path.join(desktopDirectory, 'control-preload.cjs'), 'utf8'), /broker-protocol|browser\.(?:start|stop|status)/);
  assert.match(main, /REMOTE_BROWSING_ENABLED,\s*state:\s*REMOTE_BROWSING_ENABLED \? 'starting' : 'restricted'/);
  assert.match(fs.readFileSync(path.join(desktopDirectory, 'security.cjs'), 'utf8'), /const REMOTE_BROWSING_ENABLED = false;/);
  assert.doesNotMatch(main, /isolation-launcher/);
  assert.match(main, /process\.argv\.includes\('--aether-browser-child'\)/);
  assert.match(main, /createBrowserChildSupervisor/);
  const browserSupervisor = fs.readFileSync(
    path.join(desktopDirectory, 'browser-child-supervisor.cjs'),
    'utf8',
  );
  assert.match(browserSupervisor, /spawnProcess\(executablePath,\s*\[appPath,\s*CHILD_ARGUMENT\]/);
  assert.match(browserSupervisor, /shell:\s*false/);
  assert.match(browserSupervisor, /detached:\s*true/);
  assert.match(browserSupervisor, /killProcessGroup\(child,\s*'SIGKILL'\)/);

  const electronFixture = fs.readFileSync(
    path.join(desktopDirectory, 'test/electron-isolation-fixture.cjs'),
    'utf8',
  );
  assert.match(electronFixture, /contextIsolation:\s*true/);
  assert.match(electronFixture, /nodeIntegration:\s*false/);
  assert.match(electronFixture, /sandbox:\s*true/);
  assert.match(electronFixture, /webSecurity:\s*true/);
  assert.match(electronFixture, /window\.loadFile/);
  assert.doesNotMatch(electronFixture, /preload:/);
  assert.doesNotMatch(electronFixture, /window\.loadURL/);
});

test('browser chrome has a restrictive CSP and an explicit restricted-mode message', () => {
  const html = fs.readFileSync(path.join(desktopDirectory, 'browser.html'), 'utf8');
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /object-src 'none'/);
  assert.match(html, /data-action="bookmarks"/);
  assert.match(html, /Remote browsing is disabled because this installation has no verified operating-system network boundary/);
});

test('AETHER browser chrome adapts to narrow window widths', () => {
  const css = fs.readFileSync(path.join(desktopDirectory, 'browser.css'), 'utf8');
  const main = fs.readFileSync(path.join(desktopDirectory, 'main.cjs'), 'utf8');
  assert.match(css, /\.browser-shell\s*\{[^}]*min-width:\s*0;/);
  assert.match(css, /@media\s*\(max-width:\s*640px\)/);
  assert.match(css, /@media\s*\(max-width:\s*400px\)/);
  assert.match(css, /grid-template-columns:\s*repeat\(7,\s*minmax\(32px,\s*1fr\)\)/);
  assert.match(main, /width:\s*1320,[\s\S]*?minWidth:\s*360,[\s\S]*?minHeight:\s*480/);
});
