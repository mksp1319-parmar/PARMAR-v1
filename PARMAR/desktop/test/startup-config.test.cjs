'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const desktopDirectory = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(desktopDirectory, 'package.json'), 'utf8'));
const lockfile = JSON.parse(fs.readFileSync(path.join(desktopDirectory, 'package-lock.json'), 'utf8'));
const packaging = require('../electron-builder.config.cjs');
const approvedProductionFiles = [
  'main.cjs',
  'broker-protocol.cjs',
  'browser-child-broker.cjs',
  'browser-child-supervisor.cjs',
  'browser-preload.cjs',
  'browser-renderer.cjs',
  'browser.css',
  'browser.html',
  'control-preload.cjs',
  'control-unavailable.cjs',
  'control-unavailable.html',
  'isolation-launcher.cjs',
  'isolation-probe.cjs',
  'newtab.html',
  'package.json',
  'security.cjs',
  'store.cjs',
];

test('Electron start and test scripts resolve from the desktop package directory', () => {
  assert.equal(manifest.main, 'main.cjs');
  assert.equal(manifest.desktopName, 'com.parmar.aether');
  assert.equal(fs.existsSync(path.join(desktopDirectory, manifest.main)), true);
  assert.equal(manifest.scripts.start, 'electron .');
  assert.equal(manifest.scripts.test, 'node --test --test-concurrency=1 test/*.test.cjs');
  assert.equal(
    manifest.scripts['test:electron-isolation'],
    'node --test test/electron-isolation-integration.test.cjs',
  );
  assert.equal(
    manifest.scripts['test:production-child-network-probe'],
    'node --test test/production-child-network-probe.test.cjs',
  );
  assert.equal(manifest.scripts['package:dir'], 'electron-builder --dir --config electron-builder.config.cjs');
  assert.equal(manifest.scripts['package:linux'], 'electron-builder --linux AppImage --config electron-builder.config.cjs');
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

test('Linux packaging includes the asar application and all production browser isolation assets', () => {
  assert.equal(manifest.devDependencies['electron-builder'], '26.15.3');
  assert.equal(lockfile.packages['node_modules/electron-builder']?.version, '26.15.3');
  assert.equal(packaging.asar, true);
  assert.equal(packaging.publish, null);
  assert.equal(packaging.linux.category, 'Network');
  assert.deepEqual(packaging.linux.executableArgs, []);
  assert.equal(packaging.linux.icon, '../interface/static/assets/parmar-emblem.png');
  assert.equal(packaging.linux.syncDesktopName, true);
  assert.deepEqual(packaging.linux.target, ['AppImage']);
  assert.deepEqual(packaging.files, approvedProductionFiles);
  assert.ok(
    packaging.files.every((file) => !/[*?[\]{}!]/.test(file)),
    'Production packaging must not use wildcard or exclusion patterns.',
  );
  for (const required of [
    'main.cjs',
    'browser-child-supervisor.cjs',
    'browser-child-broker.cjs',
    'broker-protocol.cjs',
    'browser-preload.cjs',
    'browser-renderer.cjs',
    'browser.css',
    'browser.html',
    'control-preload.cjs',
    'control-unavailable.cjs',
    'control-unavailable.html',
    'isolation-launcher.cjs',
    'isolation-probe.cjs',
    'newtab.html',
    'package.json',
    'security.cjs',
    'store.cjs',
  ]) {
    assert.ok(packaging.files.includes(required), `Production packaging omits ${required}.`);
    assert.equal(fs.existsSync(path.join(desktopDirectory, required)), true, required);
  }
  for (const forbidden of [
    'electron-builder.config.cjs',
    'production-network-probe.cjs',
    'test/production-child-network-probe.test.cjs',
    'test/production-child-network-probe-bootstrap.cjs',
    'test',
    'poc',
    'strace',
  ]) {
    assert.equal(
      packaging.files.some((file) => file === forbidden || file.startsWith(`${forbidden}/`)),
      false,
      `Production packaging includes forbidden entry ${forbidden}.`,
    );
  }
  assert.deepEqual(packaging.extraResources, [{
    from: '../interface/static/assets/parmar-emblem.png',
    to: 'aether/parmar-emblem.png',
  }]);
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
    'electron-builder.config.cjs',
    'ISOLATION-READINESS.md',
    'test/electron-isolation-wrapper.cjs',
    'test/electron-ui-smoke.test.cjs',
    'test/electron-isolation-fixture.cjs',
    'test/electron-isolation-fixture.html',
    'test/electron-isolation-renderer.js',
    'test/electron-isolation-integration.test.cjs',
    'test/production-child-network-probe.test.cjs',
    'test/production-child-network-probe-bootstrap.cjs',
    'test/browser-child.test.cjs',
    'newtab.html',
    'security.cjs',
    'store.cjs',
  ]) {
    assert.equal(fs.existsSync(path.join(desktopDirectory, file)), true, file);
  }

  const main = fs.readFileSync(path.join(desktopDirectory, 'main.cjs'), 'utf8');
  const unavailablePage = fs.readFileSync(
    path.join(desktopDirectory, 'control-unavailable.html'),
    'utf8',
  );
  assert.match(unavailablePage, /<script\s+src=["']\.\/control-unavailable\.cjs["']\s+defer><\/script>/);
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
  assert.match(main, /remoteBrowsing:\s*REMOTE_BROWSING_ENABLED,[\s\S]*?state:\s*REMOTE_BROWSING_ENABLED \? 'starting' : 'restricted'/);
  assert.match(fs.readFileSync(path.join(desktopDirectory, 'security.cjs'), 'utf8'), /const REMOTE_BROWSING_ENABLED = false;/);
  assert.match(main, /verifyCurrentIsolation/);
  assert.match(main, /app\.getAppPath\(\)/);
  assert.match(main, /process\.argv\.includes\('--aether-browser-child'\)/);
  assert.match(main, /createBrowserChildSupervisor/);
  assert.match(main, /createdWindow\.webContents\.on\('before-input-event'/);
  assert.doesNotMatch(
    main,
    /production-network-probe|runProductionNetworkProbe|PARMAR_AETHER_PRODUCTION_NETWORK_PROBE/,
  );
  const browserSupervisor = fs.readFileSync(
    path.join(desktopDirectory, 'browser-child-supervisor.cjs'),
    'utf8',
  );
  assert.doesNotMatch(
    browserSupervisor,
    /production-network-probe|PARMAR_AETHER_PRODUCTION_NETWORK_PROBE/,
  );
  const uiSmoke = fs.readFileSync(
    path.join(desktopDirectory, 'test/electron-ui-smoke.test.cjs'),
    'utf8',
  );
  assert.doesNotMatch(uiSmoke, /PARMAR_AETHER_PRODUCTION_NETWORK_PROBE|production-network-probe/);
  assert.match(uiSmoke, /attemptedDestinations\s*=\s*\[/);
  assert.match(uiSmoke, /The packaged browser process reached the controlled IPv[46] loopback listener/);
  assert.match(browserSupervisor, /buildIsolatedLaunch/);
  assert.match(browserSupervisor, /targetArguments:\s*\[appPath,\s*CHILD_ARGUMENT\]/);
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
  assert.match(electronFixture, /browserWindow\.loadFile/);
  assert.doesNotMatch(electronFixture, /preload:/);
  assert.doesNotMatch(electronFixture, /window\.loadURL/);
});

test('browser chrome has a restrictive CSP and an explicit restricted-mode message', () => {
  const html = fs.readFileSync(path.join(desktopDirectory, 'browser.html'), 'utf8');
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /object-src 'none'/);
  assert.match(html, /data-action="bookmarks"/);
  assert.match(html, /data-action="focus-address"/);
  assert.match(html, /aria-label="Home, open a new AETHER tab"/);
  assert.match(html, /class="sidebar" aria-label="Browser shortcuts"/);
  assert.match(html, /Remote browsing is disabled because this installation has no verified operating-system network boundary/);
  assert.match(html, /id="brand-emblem"[^>]*aria-hidden="true"/);
  assert.match(html, /id="tab-state" role="status" aria-live="polite"/);
  assert.match(html, /<svg[^>]*aria-hidden="true"/);
  assert.doesNotMatch(html, /[←→↻×☆★◷↓⚙⌕]/u);
  const renderer = fs.readFileSync(path.join(desktopDirectory, 'browser-renderer.cjs'), 'utf8');
  assert.match(renderer, /setAttribute\('role', 'tab'\)/);
  assert.match(renderer, /createIcon\('close'\)/);
});

test('Linux runtime workflow requires namespace, Electron UI, isolation, and screenshot checks', () => {
  const workflow = fs.readFileSync(
    path.resolve(desktopDirectory, '../../.github/workflows/aether-linux-runtime.yml'),
    'utf8',
  );
  assert.match(workflow, /unshare --user --map-current-user --net true/);
  assert.match(workflow, /Namespace creation failed \(exit status %s\)/);
  assert.match(workflow, /Verify Electron GUI runtime prerequisites/);
  assert.doesNotMatch(workflow, /sysctl\s+-w|kernel\.apparmor_restrict_unprivileged_userns=0/);
  assert.doesNotMatch(workflow, /steps\.enable-userns/);
  assert.match(workflow, /PARMAR_ELECTRON_RUNTIME_REQUIRED:\s*"1"/);
  assert.match(workflow, /PARMAR_AETHER_UI_SMOKE:\s*"1"/);
  assert.match(workflow, /PARMAR_AETHER_UI_SMOKE_REQUIRED:\s*"1"/);
  assert.match(workflow, /PARMAR_AETHER_UI_SCREENSHOT_DIR:/);
  assert.match(workflow, /npm run test:electron-isolation/);
  assert.match(workflow, /uses:\s*actions\/upload-artifact@v4/);
});

test('AETHER browser chrome adapts to narrow window widths', () => {
  const css = fs.readFileSync(path.join(desktopDirectory, 'browser.css'), 'utf8');
  const main = fs.readFileSync(path.join(desktopDirectory, 'main.cjs'), 'utf8');
  assert.match(css, /\.browser-shell\s*\{[^}]*min-width:\s*0;/);
  assert.match(css, /@media\s*\(max-width:\s*640px\)/);
  assert.match(css, /@media\s*\(max-width:\s*400px\)/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /grid-template-columns:\s*repeat\(5,\s*minmax\(32px,\s*1fr\)\)/);
  assert.match(css, /@media\s*\(max-width:\s*900px\)/);
  assert.doesNotMatch(css, /\.sidebar-action span\s*\{\s*display:\s*none/);
  assert.match(css, /\.sidebar\s*\{[^}]*overflow-x:\s*auto/);
  assert.match(css, /@media\s*\(pointer:\s*coarse\)/);
  assert.match(main, /width:\s*1320,[\s\S]*?minWidth:\s*360,[\s\S]*?minHeight:\s*480/);
});
