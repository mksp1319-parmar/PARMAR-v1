'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
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
  assert.match(html, /aria-label="Home, return to the AETHER start page"/);
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
  const preflight = fs.readFileSync(
    path.resolve(desktopDirectory, '../../.github/scripts/aether-namespace-preflight.sh'),
    'utf8',
  );
  assert.match(workflow, /bash \.github\/scripts\/aether-namespace-preflight\.sh/);
  assert.match(preflight, /unshare --user --map-current-user --net -- \/bin\/sh -eu -c/);
  assert.match(preflight, /cat \/proc\/self\/uid_map/);
  assert.match(preflight, /cat \/proc\/self\/gid_map/);
  assert.match(preflight, /\/proc\/self\/ns\/user/);
  assert.match(preflight, /\/proc\/self\/ns\/net/);
  assert.match(preflight, /test "\$1" -eq "\$AETHER_HOST_UID"/);
  assert.match(preflight, /test "\$1" -eq "\$AETHER_HOST_GID"/);
  assert.match(preflight, /AETHER_PARENT_USER_NAMESPACE/);
  assert.match(preflight, /AETHER_PARENT_NETWORK_NAMESPACE/);
  assert.match(preflight, /test "\$user_namespace" != "\$AETHER_PARENT_USER_NAMESPACE"/);
  assert.match(preflight, /test "\$network_namespace" != "\$AETHER_PARENT_NETWORK_NAMESPACE"/);
  assert.match(preflight, /set \+e\s+set -o pipefail/);
  assert.doesNotMatch(preflight, /mkfifo|\.fifo/);
  assert.match(preflight, /Parent user namespace ID is empty/);
  assert.match(preflight, /Parent network namespace ID is empty/);
  assert.match(preflight, /Child user namespace ID is empty/);
  assert.match(preflight, /Child network namespace ID is empty/);
  assert.match(preflight, /test "\$3" -eq 1/);
  assert.match(preflight, /Runner UID\/GID: %s\/%s/);
  assert.doesNotMatch(preflight, /Runner identity:.*\$\(id\)/);
  assert.match(preflight, /User\/network namespace creation and UID\/GID mapping succeeded/);
  assert.match(preflight, /Namespace creation failed \(exit status %s\)/);
  assert.match(preflight, /collect_namespace_audit_diagnostics dmesg --color=never/);
  assert.match(preflight, /collect_namespace_audit_diagnostics journalctl -k --no-pager -n 500/);
  assert.match(preflight, /unavailable or denied \(diagnostic exit %s\)/);
  assert.match(preflight, /no matching namespace\/AppArmor records/i);
  assert.match(preflight, /exit "\$status"/);
  assert.match(preflight, /Likely cause: AppArmor unprivileged-userns restriction is enabled/);
  assert.match(preflight, /No AppArmor or sysctl policy was changed/);
  for (const stage of [
    'Required-tool checks',
    'Parent UID-map validation',
    'Parent GID-map validation',
    'Namespace command execution',
    'Child UID/GID-map validation',
    'Namespace identity validation',
  ]) {
    assert.match(preflight, new RegExp(`STAGE (?:START|COMPLETE|FAILURE): ${stage}`));
  }
  assert.match(preflight, /Captured stderr:/);
  assert.match(workflow, /network-namespace-check\.log/);
  assert.match(workflow, /Verify Electron GUI runtime prerequisites/);
  const perlInstallIndex = workflow.search(/^\s*perl\s*\\\s*$/m);
  const preflightInvocationIndex = workflow.indexOf('bash .github/scripts/aether-namespace-preflight.sh');
  assert.ok(
    perlInstallIndex >= 0 && perlInstallIndex < preflightInvocationIndex,
    'Linux runtime workflow must install Perl before invoking the namespace preflight',
  );
  assert.doesNotMatch(workflow, /sysctl\s+-w|kernel\.apparmor_restrict_unprivileged_userns=0/);
  assert.doesNotMatch(workflow, /steps\.enable-userns/);
  assert.match(workflow, /"\.github\/scripts\/\*\*"/);
  assert.match(workflow, /libpangocairo-1\.0-0 \\\n\s+perl \\\n\s+libx11-xcb1/);
  assert.match(workflow, /PARMAR_ELECTRON_RUNTIME_REQUIRED:\s*"1"/);
  assert.match(workflow, /PARMAR_AETHER_UI_SMOKE:\s*"1"/);
  assert.match(workflow, /PARMAR_AETHER_UI_SMOKE_REQUIRED:\s*"1"/);
  assert.match(workflow, /PARMAR_AETHER_UI_SCREENSHOT_DIR:/);
  assert.match(workflow, /npm run test:electron-isolation/);
  assert.match(workflow, /getAppImageTools\(undefined,\s*Arch\.x64\)/);
  assert.match(
    workflow,
    /const requiredAccess = name === 'runtime' \|\| name === 'runtimeLibraries'\s+\? fs\.constants\.R_OK\s+:\s+fs\.constants\.X_OK/,
  );
  assert.match(workflow, /fs\.accessSync\(toolPath,\s*requiredAccess\)/);
  assert.match(workflow, /ldd "\$electron_binary"/);
  assert.match(workflow, /grep -F 'not found'/);
  assert.match(workflow, /--appimage-extract/);
  assert.match(workflow, /cmp \.\.\/interface\/static\/assets\/parmar-emblem\.png/);
  assert.match(workflow, /PARMAR_AETHER_LINUX_DIR_PATH:/);
  assert.match(workflow, /appimage-toolset\.log/);
  assert.match(workflow, /full-suite\/test\.log/);
  assert.match(workflow, /if:\s*always\(\)\s*&&\s*steps\.outputs\.outputs\.evidence_dir != ''/);
  assert.match(workflow, /uses:\s*actions\/upload-artifact@v4/);
});

test('Ubuntu 24.04 Electron runtime workflows use current t64 package names', () => {
  const workflows = [
    {
      contents: fs.readFileSync(
        path.resolve(desktopDirectory, '../../.github/workflows/aether-linux-runtime.yml'),
        'utf8',
      ),
      packageNames: [
        'libatk-bridge2.0-0t64',
        'libatk1.0-0t64',
        'libatspi2.0-0t64',
        'libcups2t64',
        'libglib2.0-0t64',
        'libgtk-3-0t64',
        'x11-xkb-utils',
        'xkb-data',
      ],
      needsXvfbPreflight: true,
    },
    {
      contents: fs.readFileSync(
        path.resolve(desktopDirectory, '../../.github/workflows/aether-profile-storage-runtime.yml'),
        'utf8',
      ),
      packageNames: [
        'libatk-bridge2.0-0t64',
        'libatk1.0-0t64',
        'libatspi2.0-0t64',
        'libcups2t64',
        'libgtk-3-0t64',
        'x11-xkb-utils',
        'xkb-data',
      ],
      needsXvfbPreflight: true,
    },
  ];
  for (const { contents, packageNames, needsXvfbPreflight } of workflows) {
    for (const packageName of packageNames) {
      assert.match(contents, new RegExp(`\\b${packageName}\\b`));
    }
    if (needsXvfbPreflight) {
      assert.match(contents, /\/usr\/bin\/xkbcomp/);
      assert.match(contents, /\/usr\/share\/X11\/xkb\/rules\/evdev/);
      assert.match(contents, /xvfb-run -a bash -euc '/);
      assert.match(contents, /test -n "\$DISPLAY"/);
      assert.match(contents, /\/usr\/bin\/xkbcomp -xkb "\$DISPLAY" - >\/dev\/null/);
    }
    assert.doesNotMatch(
      contents,
      /\blibatk-bridge2\.0-0\b|\blibatk1\.0-0\b|\blibatspi2\.0-0\b|\blibcups2\b|\blibglib2\.0-0\b|\blibgtk-3-0\b/,
    );
  }
});

function runProfileStorageHarnessFixture(harnessStatus, teeShouldFail) {
  const workflow = fs.readFileSync(
    path.resolve(desktopDirectory, '../../.github/workflows/aether-profile-storage-runtime.yml'),
    'utf8',
  );
  const step = workflow.match(
    /      - name: Run isolated profile storage harness\n([\s\S]*?)(?=\n      - name: Upload runtime test log)/,
  )?.[0];
  assert.ok(step, 'Profile-storage harness step must exist');
  const runBlock = step.match(/        run: \|\n([\s\S]*)/)?.[1];
  assert.ok(runBlock, 'Profile-storage harness run block must exist');
  const runScript = runBlock
    .split('\n')
    .map((line) => (line.startsWith('          ') ? line.slice(10) : line))
    .join('\n');
  const workflowPipeline = /xvfb-run -a env PARMAR_AETHER_PROFILE_STORAGE_RUNTIME=1 \\\n\s+npm run test:profile-storage-runtime \\\n\s+2>&1 \| tee -a "\$RUNNER_TEMP\/aether-profile-storage-runtime\.log"/;
  const fixturePipeline = '"$HARNESS_FIXTURE" 2>&1 | tee -a "$RUNNER_TEMP/aether-profile-storage-runtime.log"';
  assert.match(runScript, workflowPipeline, 'Workflow harness pipeline must match the test fixture');
  const fixtureScript = runScript.replace(workflowPipeline, fixturePipeline);

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-profile-storage-pipeline-'));
  try {
    const harnessFixture = path.join(temporaryDirectory, 'harness');
    const logPath = path.join(temporaryDirectory, 'aether-profile-storage-runtime.log');
    fs.writeFileSync(
      harnessFixture,
      `#!/bin/sh\nprintf '%s\\n' 'fixture harness output'\nexit ${harnessStatus}\n`,
      { mode: 0o700 },
    );
    if (teeShouldFail) {
      fs.mkdirSync(logPath);
    }

    const result = spawnSync('bash', ['-c', fixtureScript], {
      cwd: desktopDirectory,
      encoding: 'utf8',
      env: {
        ...process.env,
        HARNESS_FIXTURE: harnessFixture,
        RUNNER_TEMP: temporaryDirectory,
      },
    });
    assert.ifError(result.error);
    return result;
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

test('profile-storage harness pipeline succeeds when harness and log capture succeed', () => {
  const result = runProfileStorageHarnessFixture(0, false);
  assert.equal(result.status, 0, result.stderr);
});

test('profile-storage harness pipeline preserves harness failure when log capture succeeds', () => {
  const result = runProfileStorageHarnessFixture(23, false);
  assert.equal(result.status, 23, result.stderr);
});

test('profile-storage harness pipeline fails when log capture fails', () => {
  const result = runProfileStorageHarnessFixture(0, true);
  assert.equal(result.status, 1, result.stderr);
});

test('profile-storage harness pipeline preserves harness failure when log capture also fails', () => {
  const result = runProfileStorageHarnessFixture(23, true);
  assert.equal(result.status, 23, result.stderr);
});

test('hosted namespace candidate workflow installs Perl and runs only the shared preflight', () => {
  const workflow = fs.readFileSync(
    path.resolve(desktopDirectory, '../../.github/workflows/aether-namespace-preflight.yml'),
    'utf8',
  );
  assert.match(workflow, /^\s{2}workflow_dispatch:\s*$/m);
  assert.doesNotMatch(workflow, /^\s{2}(?:push|pull_request|schedule):/m);
  assert.match(workflow, /permissions:\s*\n\s+contents:\s*read/);
  assert.match(workflow, /runner:\s*\n\s+- ubuntu-22\.04\s*\n\s+- ubuntu-24\.04/);
  const perlInstallStart = workflow.indexOf('Install Perl preflight dependency');
  const perlInstallCommandIndex = workflow.search(
    /^\s*sudo\s+apt-get\s+install\s+--no-install-recommends\s+-y\s+perl\s*$/m,
  );
  const preflightInvocationIndex = workflow.indexOf('bash .github/scripts/aether-namespace-preflight.sh');
  assert.ok(perlInstallStart >= 0 && perlInstallCommandIndex > perlInstallStart);
  assert.ok(
    perlInstallCommandIndex < preflightInvocationIndex,
    'Standalone workflow must provision Perl before invoking the namespace preflight',
  );
  assert.match(
    workflow.slice(perlInstallStart, perlInstallCommandIndex),
    /Install Perl preflight dependency[\s\S]*sudo\s+apt-get\s+update/,
  );
  assert.deepEqual(
    (workflow.match(/^\s*sudo\b.*$/gm) || []).map((command) => command.trim()),
    ['sudo apt-get update', 'sudo apt-get install --no-install-recommends -y perl'],
    'Standalone workflow may use sudo only for its approved Perl installation',
  );
  assert.deepEqual(
    (workflow.match(/^\s*(?:sudo\s+)?(?:apt-get|apt|apk|dnf|yum|zypper|pacman)\s+(?:install|add)\b.*$|^\s*dpkg\s+-i\b.*$|^\s*(?:pip|pip3|npm|pnpm|yarn|gem)\s+install\b.*$/gim) || [])
      .map((command) => command.trim()),
    ['sudo apt-get install --no-install-recommends -y perl'],
    'Standalone workflow may install only the approved Perl package',
  );
  assert.match(workflow, /if:\s*always\(\)/);
  assert.match(workflow, /if-no-files-found:\s*error/);
  assert.doesNotMatch(workflow, /npm\s+(?:ci|install|run)|electron-builder|test:electron|AppImage|PARMAR_AETHER_UI_SMOKE/i);
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./);
});

test('namespace preflight preserves unshare failure when optional kernel logs are denied', (context) => {
  if (process.platform !== 'linux') {
    context.skip('The hosted Linux namespace preflight is Linux-specific.');
    return;
  }
  const script = fs.readFileSync(
    path.resolve(desktopDirectory, '../../.github/scripts/aether-namespace-preflight.sh'),
    'utf8',
  );

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-namespace-preflight-'));
  context.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  const fakeBinDirectory = path.join(temporaryDirectory, 'bin');
  fs.mkdirSync(fakeBinDirectory);
  const createCommand = (name, contents) => {
    const executable = path.join(fakeBinDirectory, name);
    fs.writeFileSync(executable, `#!/bin/sh\n${contents}\n`, { mode: 0o700 });
    return executable;
  };
  const fakeUnshare = createCommand(
    'unshare',
    'echo "unshare: write failed /proc/self/uid_map: Operation not permitted" >&2\nexit 73',
  );
  createCommand('setpriv', 'exit 0');
  createCommand('ip', 'exit 0');
  createCommand(
    'cat',
    `case "$1" in
  /proc/self/uid_map) printf '%s %s 1\\n' "$AETHER_PREFLIGHT_HOST_UID" "$AETHER_PREFLIGHT_HOST_UID"; exit 0 ;;
  /proc/self/gid_map) printf '%s %s 1\\n' "$AETHER_PREFLIGHT_HOST_GID" "$AETHER_PREFLIGHT_HOST_GID"; exit 0 ;;
esac
exec /bin/cat "$@"`,
  );
  for (const command of ['dmesg', 'journalctl']) {
    createCommand(command, `echo "${command}: restricted kernel-log access" >&2\nexit 1`);
  }
  const isolatedScript = script
    .replaceAll('/usr/bin/unshare', fakeUnshare)
    .replaceAll('/usr/bin/setpriv', path.join(fakeBinDirectory, 'setpriv'))
    .replaceAll('/usr/sbin/ip', path.join(fakeBinDirectory, 'ip'));
  const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', isolatedScript, 'preflight',
    path.join(temporaryDirectory, 'network-namespace-check.log')], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeBinDirectory}${path.delimiter}${process.env.PATH || ''}`,
      AETHER_EVIDENCE_DIR: temporaryDirectory,
      AETHER_PREFLIGHT_HOST_UID: String(process.getuid()),
      AETHER_PREFLIGHT_HOST_GID: String(process.getgid()),
    },
  });
  const log = fs.readFileSync(path.join(temporaryDirectory, 'network-namespace-check.log'), 'utf8');

  assert.equal(result.status, 73, `${result.stdout}\n${result.stderr}\n${log}`);
  assert.match(log, /Namespace creation failed \(exit status 73\)/);
  assert.match(log, /STAGE FAILURE: Namespace command execution \(exit code 73\)/);
  assert.match(log, /write failed \/proc\/self\/uid_map: Operation not permitted/);
  assert.match(log, /  \| stderr: unshare: write failed \/proc\/self\/uid_map: Operation not permitted/);
  assert.match(log, /dmesg: unavailable or denied/);
  assert.match(log, /journalctl: unavailable or denied/);
  assert.doesNotMatch(log, /User\/network namespace creation and UID\/GID mapping succeeded/);
});

function runNamespacePreflightFixture(context, {
  failReadlink = '',
  failParentMap = '',
  missingTool = '',
  missingSetpriv = '',
  missingIp = '',
  unshareContents = 'exec /usr/bin/env AETHER_PREFLIGHT_FIXTURE_CHILD=1 /bin/sh -eu -c "$8"',
  logFilePath = '',
  headFailureStream = '',
  formatterFailure = false,
  cleanupFailure = false,
  mktempPartialFailure = false,
  stdoutSinkFailure = false,
  logSinkFailure = false,
  symlinkLog = false,
  symlinkSubstitution = false,
  existingLog = false,
  invalidLogDestination = false,
  fifoLogDestination = false,
  captureSizesFile = false,
  capturePidFile = false,
  timeout = 5000,
  parentUidMap = '1201 1201 1',
  parentGidMap = '1301 1301 1',
  parentUserNamespace = 'user:[100]',
  parentNetworkNamespace = 'net:[200]',
  childUidMap = '1201 1201 1',
  childGidMap = '1301 1301 1',
  childUserNamespace = 'user:[101]',
  childNetworkNamespace = 'net:[201]',
} = {}) {
  const script = fs.readFileSync(
    path.resolve(desktopDirectory, '../../.github/scripts/aether-namespace-preflight.sh'),
    'utf8',
  );
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-namespace-fixture-'));
  context.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  const captureSizeLog = captureSizesFile ? path.join(temporaryDirectory, 'capture-sizes') : '';
  const capturePidLog = capturePidFile ? path.join(temporaryDirectory, 'capture-pids') : '';
  const fakeBinDirectory = path.join(temporaryDirectory, 'bin');
  fs.mkdirSync(fakeBinDirectory);
  const writeExecutable = (name, contents) => {
    const executable = path.join(fakeBinDirectory, name);
    fs.writeFileSync(executable, `#!/bin/sh\n${contents}\n`, { mode: 0o700 });
    return executable;
  };
  const fakeUnshare = writeExecutable(
    'unshare',
    unshareContents,
  );
  if (headFailureStream || capturePidFile) {
    writeExecutable(
      'head',
      `${capturePidFile ? `printf '%s\\n' "$PPID" >> "$AETHER_CAPTURE_PID_LOG"\n` : ''}if [ "\${AETHER_CAPTURE_STREAM:-}" = "${headFailureStream}" ]; then exit 74; fi\nexec /usr/bin/head "$@"`,
    );
  }
  if (formatterFailure || captureSizesFile) {
    writeExecutable(
      'od',
      `${captureSizesFile ? `for argument do last_argument="$argument"; done
case "$last_argument" in
  */stdout|*/stderr|*/audit-dmesg|*/audit-journal)
    printf '%s %s\\n' "\${last_argument##*/}" "$(/usr/bin/stat -c %s "$last_argument")" >> "$AETHER_CAPTURE_SIZE_LOG"
    ;;
esac
` : ''}${formatterFailure ? 'exit 75' : 'exec /usr/bin/od "$@"'}`,
    );
  }
  if (cleanupFailure) {
    writeExecutable('rmdir', 'exit 76');
  }
  if (logSinkFailure || symlinkSubstitution) {
    writeExecutable(
      'perl',
      `${symlinkSubstitution ? `if [ "\${AETHER_PREFLIGHT_SYMLINK_SUBSTITUTION:-0}" = 1 ]; then
  mv -- "$AETHER_PREFLIGHT_LOG_PATH" "$AETHER_PREFLIGHT_LOG_PATH.pre-open"
  ln -s -- "$AETHER_PREFLIGHT_LOG_SENTINEL" "$AETHER_PREFLIGHT_LOG_PATH"
fi
` : ''}${logSinkFailure ? `if [ "\${AETHER_PREFLIGHT_LOG_SINK_FAILURE:-0}" = 1 ]; then
  exec /usr/bin/perl -e 'use strict; $| = 1; my $path = shift @ARGV; open(my $log, ">", $path) or exit 1; binmode($log); binmode(STDIN); print STDOUT "READY\\n"; while (1) { my $count = sysread(STDIN, my $buffer, 65536); exit 74 if !defined $count; last if $count == 0; print {$log} $buffer or exit 74; } close($log); exit 74;' -- "$AETHER_PREFLIGHT_LOG_PATH"
fi
` : ''}exec /usr/bin/perl "$@"`,
    );
  }
  if (mktempPartialFailure) {
    writeExecutable(
      'mktemp',
      'created_directory=$(/usr/bin/mktemp -d "$@") || exit $?; printf "%s" "$created_directory"; exit 74',
    );
  }
  writeExecutable(
    'readlink',
    `if [ "\${AETHER_PREFLIGHT_FIXTURE_CHILD:-0}" = 1 ]; then
  case "$1" in
    /proc/self/ns/user) printf '%s\\n' "\${AETHER_PREFLIGHT_CHILD_USER_NAMESPACE-}"; exit 0 ;;
    /proc/self/ns/net) printf '%s\\n' "\${AETHER_PREFLIGHT_CHILD_NETWORK_NAMESPACE-}"; exit 0 ;;
  esac
else
  if [ "\${AETHER_PREFLIGHT_FAIL_READLINK:-}" = "$1" ]; then
    echo "fixture readlink failed for $1" >&2
    exit 41
  fi
  case "$1" in
    /proc/self/ns/user) printf '%s\\n' "\${AETHER_PREFLIGHT_PARENT_USER_NAMESPACE-}"; exit 0 ;;
    /proc/self/ns/net) printf '%s\\n' "\${AETHER_PREFLIGHT_PARENT_NETWORK_NAMESPACE-}"; exit 0 ;;
  esac
fi
exec /usr/bin/readlink "$@"`,
  );
  writeExecutable(
    'cat',
    `if [ "\${AETHER_PREFLIGHT_FIXTURE_CHILD:-0}" = 1 ]; then
  case "$1" in
    /proc/self/uid_map) printf '%s\\n' "$AETHER_PREFLIGHT_CHILD_UID_MAP"; exit 0 ;;
    /proc/self/gid_map) printf '%s\\n' "$AETHER_PREFLIGHT_CHILD_GID_MAP"; exit 0 ;;
  esac
fi
if [ "\${AETHER_PREFLIGHT_FAIL_PARENT_MAP:-}" = "$1" ]; then
  echo "fixture could not read $1" >&2
  exit 42
fi
case "$1" in
  /proc/self/uid_map) printf '%s\\n' "\${AETHER_PREFLIGHT_PARENT_UID_MAP-}"; exit 0 ;;
  /proc/self/gid_map) printf '%s\\n' "\${AETHER_PREFLIGHT_PARENT_GID_MAP-}"; exit 0 ;;
esac
exec /bin/cat "$@"`,
  );
  writeExecutable(
    'id',
    'case "$1" in -u) echo 1201 ;; -g) echo 1301 ;; *) exec /usr/bin/id "$@" ;; esac',
  );
  writeExecutable('dmesg', 'exit 0');
  writeExecutable('journalctl', 'exit 0');
  const isolatedScript = script
    .replaceAll('/usr/bin/unshare', missingTool || fakeUnshare)
    .replaceAll('/usr/bin/setpriv', missingSetpriv || '/usr/bin/setpriv')
    .replaceAll('/usr/sbin/ip', missingIp || '/usr/sbin/ip');
  const symlinkTarget = path.join(temporaryDirectory, 'symlink-target.log');
  const symlinkPath = path.join(temporaryDirectory, 'symlink-log.log');
  const defaultLogPath = symlinkLog
    ? symlinkPath
    : path.join(temporaryDirectory, 'network-namespace-check.log');
  const logFile = logFilePath || (invalidLogDestination
    ? path.join(temporaryDirectory, 'log-directory')
    : fifoLogDestination
      ? path.join(temporaryDirectory, 'log-fifo')
      : defaultLogPath);
  if (symlinkLog || symlinkSubstitution) {
    fs.writeFileSync(symlinkTarget, 'leave this target unchanged');
  }
  if (symlinkLog) {
    fs.symlinkSync(symlinkTarget, symlinkPath);
  }
  if (existingLog || symlinkSubstitution) {
    fs.writeFileSync(logFile, 'pre-existing log contents must be preserved only when opening fails');
    fs.chmodSync(logFile, 0o640);
  }
  if (invalidLogDestination) {
    fs.mkdirSync(logFile);
  }
  if (fifoLogDestination) {
    const fifoResult = spawnSync('mkfifo', [logFile], { encoding: 'utf8' });
    assert.equal(fifoResult.status, 0, `${fifoResult.stdout}\n${fifoResult.stderr}`);
  }
  const stdoutSinkFd = stdoutSinkFailure ? fs.openSync('/dev/full', 'w') : undefined;
  const result = spawnSync(
    'bash',
    ['-e', '-o', 'pipefail', '-c', isolatedScript, 'preflight', logFile],
    {
      encoding: 'utf8',
      timeout,
      stdio: stdoutSinkFailure
        ? ['ignore', stdoutSinkFd, 'pipe']
        : ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: `${fakeBinDirectory}${path.delimiter}${process.env.PATH || ''}`,
        AETHER_EVIDENCE_DIR: temporaryDirectory,
        AETHER_PREFLIGHT_FAIL_READLINK: failReadlink,
        AETHER_PREFLIGHT_FAIL_PARENT_MAP: failParentMap,
        AETHER_PREFLIGHT_PARENT_UID_MAP: parentUidMap,
        AETHER_PREFLIGHT_PARENT_GID_MAP: parentGidMap,
        AETHER_PREFLIGHT_PARENT_USER_NAMESPACE: parentUserNamespace,
        AETHER_PREFLIGHT_PARENT_NETWORK_NAMESPACE: parentNetworkNamespace,
        AETHER_PREFLIGHT_CHILD_UID_MAP: childUidMap,
        AETHER_PREFLIGHT_CHILD_GID_MAP: childGidMap,
        AETHER_PREFLIGHT_CHILD_USER_NAMESPACE: childUserNamespace,
        AETHER_PREFLIGHT_CHILD_NETWORK_NAMESPACE: childNetworkNamespace,
        AETHER_CAPTURE_SIZE_LOG: captureSizeLog,
        AETHER_CAPTURE_PID_LOG: capturePidLog,
        AETHER_PREFLIGHT_LOG_PATH: logFile,
        AETHER_PREFLIGHT_LOG_SENTINEL: symlinkTarget,
        AETHER_PREFLIGHT_SYMLINK_SUBSTITUTION: symlinkSubstitution ? '1' : '0',
        AETHER_PREFLIGHT_LOG_SINK_FAILURE: logSinkFailure ? '1' : '0',
      },
    },
  );
  if (stdoutSinkFd !== undefined) {
    fs.closeSync(stdoutSinkFd);
  }
  return {
    result,
    log: fs.existsSync(logFile) && !fs.lstatSync(logFile).isSymbolicLink()
      && fs.statSync(logFile).isFile()
      ? fs.readFileSync(logFile, 'utf8')
      : '',
    temporaryDirectory,
    symlinkTarget,
    captureSizes: captureSizeLog && fs.existsSync(captureSizeLog)
      ? fs.readFileSync(captureSizeLog, 'utf8').trim().split('\n')
      : [],
    capturePids: capturePidLog && fs.existsSync(capturePidLog)
      ? fs.readFileSync(capturePidLog, 'utf8').trim().split('\n').map(Number)
      : [],
  };
}

for (const [tool, option] of [
  ['/usr/bin/unshare', 'missingTool'],
  ['/usr/bin/setpriv', 'missingSetpriv'],
  ['/usr/sbin/ip', 'missingIp'],
]) {
  test(`namespace preflight reports missing required tool ${tool} before execution`, (context) => {
    const missingPath = path.join(os.tmpdir(), `missing-${path.basename(tool)}-${process.pid}`);
    const { result, log } = runNamespacePreflightFixture(context, {
      [option]: missingPath,
    });

    assert.equal(result.status, 127, `${result.stdout}\n${result.stderr}\n${log}`);
    assert.match(log, /STAGE START: Required-tool checks/);
    assert.match(log, /STAGE FAILURE: Required-tool checks \(exit code 127\)/);
    assert.ok(log.includes(missingPath));
    assert.doesNotMatch(log, /STAGE START: Parent UID-map validation/);
    assert.doesNotMatch(log, /Namespace command:/);
  });
}

for (const [mapName, option, badMapping] of [
  ['uid_map', 'childUidMap', '1202 1202 1'],
  ['gid_map', 'childGidMap', '1302 1302 1'],
]) {
  test(`namespace preflight reports invalid child ${mapName} stage`, (context) => {
    const { result, log } = runNamespacePreflightFixture(context, {
      [option]: badMapping,
    });

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}\n${log}`);
    assert.match(log, /STAGE FAILURE: Child UID\/GID-map validation \(exit code 1\)/);
    assert.match(log, new RegExp(`Child ${mapName} does not match`));
    assert.equal((log.match(/STAGE FAILURE: Child UID\/GID-map validation/g) || []).length, 1);
    assert.doesNotMatch(log, /STAGE FAILURE: Namespace command execution/);
    assert.ok(
      log.indexOf('STAGE FAILURE: Child UID/GID-map validation')
        < log.indexOf('Namespace creation failed (exit status 1)'),
    );
    assert.doesNotMatch(log, /STAGE COMPLETE: Child UID\/GID-map validation/);
    assert.doesNotMatch(log, /User\/network namespace creation and UID\/GID mapping succeeded/);
  });
}

for (const mapName of ['uid_map', 'gid_map']) {
  const mapPath = `/proc/self/${mapName}`;
  const mapOption = mapName === 'uid_map' ? 'parentUidMap' : 'parentGidMap';

  test(`namespace preflight fails when parent ${mapName} cannot be read`, (context) => {
    const { result, log } = runNamespacePreflightFixture(context, {
      failParentMap: mapPath,
    });

    assert.equal(result.status, 42, `${result.stdout}\n${result.stderr}\n${log}`);
    assert.match(log, new RegExp(`Parent ${mapName} could not be read \\(exit status 42\\)`));
    assert.match(log, new RegExp(`STAGE FAILURE: Parent ${mapName === 'uid_map' ? 'UID' : 'GID'}-map validation \\(exit code 42\\)`));
    assert.match(log, /Parent ID-map diagnostic was suppressed/);
    assert.doesNotMatch(log, /fixture could not read/);
    assert.doesNotMatch(log, /Namespace command:/);
  });

  for (const [description, mapping, expectedDiagnostic] of [
    ['is empty', '', /exactly one mapping line with three numeric fields/],
    ['is malformed', '1201 invalid 1', /exactly one mapping line with three numeric fields/],
    ['has multiple entries', '1201 1201 1\n1202 1202 1', /exactly one mapping line with three numeric fields/],
    ['has a wrong mapped ID', '1202 1201 1', /mapping must be/],
    ['has a wrong namespace ID', '1201 1202 1', /mapping must be/],
    ['has a zero range', '1201 1201 0', /mapping must be/],
    ['has a multi-ID range', '1201 1201 2', /mapping must be/],
  ]) {
    test(`namespace preflight rejects parent ${mapName} that ${description}`, (context) => {
      const { result, log } = runNamespacePreflightFixture(context, {
        [mapOption]: mapping,
      });

      assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}\n${log}`);
      assert.match(log, expectedDiagnostic);
      assert.match(log, new RegExp(`STAGE FAILURE: Parent ${mapName === 'uid_map' ? 'UID' : 'GID'}-map validation \\(exit code 1\\)`));
      assert.doesNotMatch(log, /Namespace command:/);
      assert.doesNotMatch(log, /User\/network namespace creation and UID\/GID mapping succeeded/);
    });
  }
}

for (const namespace of ['user', 'network']) {
  test(`namespace preflight fails when parent ${namespace} namespace readlink fails`, (context) => {
    const namespacePath = namespace === 'network'
      ? '/proc/self/ns/net'
      : '/proc/self/ns/user';
    const { result, log } = runNamespacePreflightFixture(context, {
      failReadlink: namespacePath,
    });

    assert.equal(result.status, 41, `${result.stdout}\n${result.stderr}\n${log}`);
    assert.match(log, /Parent (?:user|network) namespace ID could not be read/);
    assert.doesNotMatch(log, /fixture readlink failed/);
    assert.match(log, /STAGE FAILURE: Parent namespace identity discovery \(exit code 41\)/);
    assert.doesNotMatch(log, /User\/network namespace creation and UID\/GID mapping succeeded/);
    assert.doesNotMatch(log, /Namespace command:/);
  });
}

for (const namespace of ['user', 'network']) {
  test(`namespace preflight rejects an empty parent ${namespace} namespace ID`, (context) => {
    const values = namespace === 'user'
      ? { parentUserNamespace: '' }
      : { parentNetworkNamespace: '' };
    const { result, log } = runNamespacePreflightFixture(context, values);

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}\n${log}`);
    assert.match(log, new RegExp(`Parent ${namespace} namespace ID is empty`));
    assert.match(log, /STAGE FAILURE: Parent namespace identity discovery \(exit code 1\)/);
    assert.doesNotMatch(log, /User\/network namespace creation and UID\/GID mapping succeeded/);
    assert.doesNotMatch(log, /Namespace command:/);
  });
}

for (const namespace of ['user', 'network']) {
  test(`namespace preflight rejects an empty child ${namespace} namespace ID`, (context) => {
    const values = namespace === 'user'
      ? { childUserNamespace: '' }
      : { childNetworkNamespace: '' };
    const { result, log } = runNamespacePreflightFixture(context, values);

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}\n${log}`);
    assert.match(log, new RegExp(`Child ${namespace} namespace ID is empty`));
    assert.match(log, /STAGE FAILURE: Namespace identity validation \(exit code 1\)/);
    assert.doesNotMatch(log, /User\/network namespace creation and UID\/GID mapping succeeded/);
  });
}

for (const namespace of ['user', 'network']) {
  test(`namespace preflight rejects an unchanged child ${namespace} namespace ID`, (context) => {
    const values = namespace === 'user'
      ? { childUserNamespace: 'user:[100]' }
      : { childNetworkNamespace: 'net:[200]' };
    const { result, log } = runNamespacePreflightFixture(context, values);

    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}\n${log}`);
    assert.match(log, /STAGE FAILURE: Namespace identity validation \(exit code 1\)/);
    assert.match(log, new RegExp(`Child ${namespace} namespace matches the parent namespace`));
    assert.doesNotMatch(log, /User\/network namespace creation and UID\/GID mapping succeeded/);
  });
}

test('namespace preflight accepts exact mappings and distinct non-empty namespace IDs', (context) => {
  const { result, log } = runNamespacePreflightFixture(context);

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${log}`);
  for (const stage of [
    'Required-tool checks',
    'Parent namespace identity discovery',
    'Parent UID-map validation',
    'Parent GID-map validation',
    'Namespace command execution',
    'Child UID/GID-map validation',
    'Namespace identity validation',
  ]) {
    assert.match(log, new RegExp(`STAGE COMPLETE: ${stage}`));
  }
  assert.match(log, /User\/network namespace creation and UID\/GID mapping succeeded/);
  assert.match(log, /Child uid_map: 1201 1201 1/);
  assert.match(log, /Child gid_map: 1301 1301 1/);
  assert.match(log, /Child user namespace: user:\[101\]/);
  assert.match(log, /Child network namespace: net:\[201\]/);
  assert.ok(
    log.indexOf('STAGE COMPLETE: Child UID/GID-map validation')
      < log.indexOf('STAGE START: Namespace identity validation'),
  );
  assert.ok(
    log.indexOf('STAGE COMPLETE: Namespace identity validation')
      < log.indexOf('STAGE COMPLETE: Namespace command execution'),
  );
  assert.ok(
    log.indexOf('STAGE START: Child UID/GID-map validation')
      < log.indexOf('  | stdout: Child uid_map: 1201 1201 1'),
  );
  assert.ok(
    log.indexOf('  | stdout: Child network namespace: net:[201]')
      < log.indexOf('User/network namespace creation and UID/GID mapping succeeded.'),
  );
  for (const stage of [
    'Required-tool checks',
    'Parent namespace identity discovery',
    'Parent UID-map validation',
    'Parent GID-map validation',
    'Namespace diagnostic capture',
    'Namespace command execution',
    'Namespace diagnostic formatting',
    'Child UID/GID-map validation',
    'Namespace identity validation',
  ]) {
    assert.equal((log.match(new RegExp(`STAGE START: ${stage}`, 'g')) || []).length, 1, stage);
    assert.equal((log.match(new RegExp(`STAGE COMPLETE: ${stage}`, 'g')) || []).length, 1, stage);
  }
});

function capturedDiagnosticLines(log) {
  return log.split('\n').filter((line) => line.startsWith('  | '));
}

function capturedDiagnosticBytes(log) {
  const lines = capturedDiagnosticLines(log);
  return Buffer.byteLength(lines.length ? `${lines.join('\n')}\n` : '');
}

test('namespace preflight bounds the combined sanitized diagnostics by 40 lines and 4096 bytes', (context) => {
  const contents = 'i=0\nwhile [ "$i" -lt 50 ]; do printf "line-%02d %s\\n" "$i" "$(printf "%0300d" 0)"; i=$((i + 1)); done\nexit 73';
  const { result, log } = runNamespacePreflightFixture(context, {
    unshareContents: contents,
  });
  const capturedLines = capturedDiagnosticLines(log);

  assert.equal(result.status, 73, `${result.stdout}\n${result.stderr}\n${log}`);
  assert.ok(capturedLines.length <= 40, `emitted ${capturedLines.length} diagnostic lines`);
  assert.equal(capturedDiagnosticBytes(log), 4096);
  assert.equal(capturedLines.at(-1), '  | diagnostic: [truncated]');
  assert.match(capturedLines[0], /^  \| stdout: line-00 /);
});

test('namespace preflight handles empty stderr without adding an empty diagnostic', (context) => {
  const { result, log } = runNamespacePreflightFixture(context, {
    unshareContents: 'exit 73',
  });

  assert.equal(result.status, 73);
  assert.doesNotMatch(log, /  \| stderr:/);
  assert.equal((log.match(/STAGE FAILURE: Namespace command execution/g) || []).length, 1);
});

test('namespace preflight prefixes multiline stderr safely', (context) => {
  const { result, log } = runNamespacePreflightFixture(context, {
    unshareContents: 'printf "first diagnostic\\nsecond diagnostic\\n" >&2\nexit 73',
  });

  assert.equal(result.status, 73);
  assert.match(log, /  \| stderr: first diagnostic\n  \| stderr: second diagnostic/);
});

test('namespace preflight truncates an oversized diagnostic line', (context) => {
  const { result, log } = runNamespacePreflightFixture(context, {
    unshareContents: 'printf "%05000d\\n" 0 >&2\nexit 73',
  });
  const capturedLine = log.split('\n').find((line) => line.startsWith('  | stderr:'));

  assert.equal(result.status, 73);
  assert.ok(capturedLine);
  assert.ok(capturedDiagnosticBytes(log) <= 4096);
  assert.ok(capturedDiagnosticLines(log).length <= 40);
  assert.match(log, /  \| diagnostic: \[truncated\]/);
});

test('namespace preflight keeps hostile multiline and control-byte output inert', (context) => {
  const { result, log } = runNamespacePreflightFixture(context, {
    unshareContents: `printf '::error::injected\\n::warning::injected\\nSTAGE COMPLETE: Namespace command execution\\r\\nSTAGE FAILURE: Namespace command execution (exit code 0)\\nUser/network namespace creation and UID/GID mapping succeeded.\\nplain\\rline\\ttab\\033[31mred\\033[0m\\n\\377\\000\\n' >&2\nexit 73`,
  });

  assert.equal(result.status, 73);
  assert.match(log, /  \| stderr: ::error::injected\n  \| stderr: ::warning::injected/);
  assert.match(log, /  \| stderr: STAGE COMPLETE: Namespace command execution\\x0D/);
  assert.match(log, /  \| stderr: STAGE FAILURE: Namespace command execution \(exit code 0\)/);
  assert.match(log, /  \| stderr: User\/network namespace creation and UID\/GID mapping succeeded\./);
  assert.match(log, /plain\\x0Dline\\x09tab\\x1B\[31mred\\x1B\[0m/);
  assert.match(log, /\\xFF\\x00/);
  assert.equal((log.match(/^STAGE COMPLETE: Namespace command execution$/gm) || []).length, 0);
  assert.equal((log.match(/^User\/network namespace creation and UID\/GID mapping succeeded\.$/gm) || []).length, 0);
  assert.doesNotMatch(log, /[\r\t\u001b\u007f]/);
  assert.doesNotMatch(log, /^::(?:error|warning)::/m);
});

test('namespace preflight preserves unshare status when log reporting fails', (context) => {
  const { result } = runNamespacePreflightFixture(context, {
    unshareContents: 'printf "diagnostic\\n" >&2\nexit 73',
    logSinkFailure: true,
  });
  assert.equal(result.status, 73, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /Namespace preflight log writer failed \(exit code 74\)/);
});

test('namespace preflight reports log-writer failure after a successful namespace command', (context) => {
  const { result } = runNamespacePreflightFixture(context, {
    logSinkFailure: true,
  });

  assert.equal(result.status, 74, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /Namespace preflight log writer failed \(exit code 74\)/);
  assert.match(result.stdout, /User\/network namespace creation and UID\/GID mapping succeeded/);
});

test('namespace preflight safely truncates an existing regular log file', (context) => {
  const { result, log, temporaryDirectory } = runNamespacePreflightFixture(context, {
    existingLog: true,
  });
  const logFile = path.join(temporaryDirectory, 'network-namespace-check.log');

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.ok(log.startsWith('STAGE START: Diagnostic output sinks\n'));
  assert.doesNotMatch(log, /pre-existing log contents/);
  assert.equal(fs.statSync(logFile).mode & 0o777, 0o640);
});

test('namespace preflight securely creates a missing regular log file', (context) => {
  const { result, log, temporaryDirectory } = runNamespacePreflightFixture(context);
  const logFile = path.join(temporaryDirectory, 'network-namespace-check.log');

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.ok(log.startsWith('STAGE START: Diagnostic output sinks\n'));
  assert.equal(fs.statSync(logFile).mode & 0o777, 0o600);
});

test('namespace preflight rejects a symlink log path without changing its target', (context) => {
  const { result, symlinkTarget } = runNamespacePreflightFixture(context, {
    symlinkLog: true,
  });

  assert.equal(result.status, 1);
  assert.equal(fs.readFileSync(symlinkTarget, 'utf8'), 'leave this target unchanged');
  assert.match(result.stderr, /must not be a symbolic link/);
});

test('namespace preflight rejects a symlink substituted immediately before atomic open', (context) => {
  const { result, temporaryDirectory, symlinkTarget } = runNamespacePreflightFixture(context, {
    symlinkSubstitution: true,
  });
  const logFile = path.join(temporaryDirectory, 'network-namespace-check.log');

  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.equal(fs.readFileSync(symlinkTarget, 'utf8'), 'leave this target unchanged');
  assert.equal(fs.readFileSync(`${logFile}.pre-open`, 'utf8'),
    'pre-existing log contents must be preserved only when opening fails');
  assert.equal(fs.lstatSync(logFile).isSymbolicLink(), true);
  assert.match(`${result.stdout}\n${result.stderr}`, /Unable to securely open the namespace preflight log file/);
  assert.doesNotMatch(result.stdout, /STAGE START: Required-tool checks/);
});

test('namespace preflight rejects an invalid log destination without modifying it', (context) => {
  const { result, temporaryDirectory } = runNamespacePreflightFixture(context, {
    invalidLogDestination: true,
  });
  const logDirectory = path.join(temporaryDirectory, 'log-directory');

  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.equal(fs.statSync(logDirectory).isDirectory(), true);
  assert.match(`${result.stdout}\n${result.stderr}`, /Unable to securely open the namespace preflight log file/);
  assert.doesNotMatch(result.stdout, /STAGE START: Required-tool checks/);
});

test('namespace preflight rejects a FIFO log destination without blocking', (context) => {
  const { result, temporaryDirectory } = runNamespacePreflightFixture(context, {
    fifoLogDestination: true,
    timeout: 2000,
  });
  const logFifo = path.join(temporaryDirectory, 'log-fifo');

  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.equal(fs.statSync(logFifo).isFIFO(), true);
  assert.match(result.stderr, /Unable to securely open the namespace preflight log file/);
  assert.doesNotMatch(result.stdout, /STAGE START: Required-tool checks/);
});

test('namespace preflight cleans a private directory after partial setup failure', (context) => {
  const { result, log, temporaryDirectory } = runNamespacePreflightFixture(context, {
    mktempPartialFailure: true,
  });

  assert.equal(result.status, 1);
  assert.match(log, /STAGE FAILURE: Namespace diagnostic setup \(exit code 1\)/);
  assert.deepEqual(
    fs.readdirSync(temporaryDirectory).filter((entry) => entry.startsWith('.namespace-preflight.')),
    [],
  );
});

for (const stream of ['stdout', 'stderr']) {
  test(`namespace preflight drains ${stream} after its capture reader fails`, (context) => {
    const { result, log } = runNamespacePreflightFixture(context, {
      unshareContents: 'printf "output\\n"; printf "error\\n" >&2; exit 73',
      headFailureStream: stream,
    });

    assert.equal(result.status, 73, `${result.stdout}\n${result.stderr}\n${log}`);
    assert.match(log, /STAGE FAILURE: Namespace diagnostic capture \(exit code 74\)/);
    assert.match(log, /Namespace creation failed \(exit status 73\)/);
    assert.doesNotMatch(log, /User\/network namespace creation and UID\/GID mapping succeeded/);
  });
}

test('namespace preflight drains beyond the capture limit without SIGPIPE or a hang', (context) => {
  const { result, log } = runNamespacePreflightFixture(context, {
    unshareContents: 'head -c 4194304 /dev/zero || exit $?; exec /usr/bin/env AETHER_PREFLIGHT_FIXTURE_CHILD=1 /bin/sh -eu -c "$8"',
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${log}`);
  assert.match(log, /User\/network namespace creation and UID\/GID mapping succeeded/);
  assert.ok(capturedDiagnosticBytes(log) <= 4096);
  assert.ok(capturedDiagnosticLines(log).length <= 40);
});

test('namespace preflight does not leave capture readers or temporary directories after completion', (context) => {
  const { result, capturePids, temporaryDirectory } = runNamespacePreflightFixture(context, {
    capturePidFile: true,
    unshareContents: 'printf "stdout\\n"; printf "stderr\\n" >&2; exit 73',
  });

  assert.equal(result.status, 73);
  assert.equal(capturePids.length, 4);
  for (const pid of capturePids) {
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  }
  assert.deepEqual(
    fs.readdirSync(temporaryDirectory).filter((entry) => entry.startsWith('.namespace-preflight.')),
    [],
  );
});

for (const [description, command, expectedRawBytes] of [
  ['exactly 4096 bytes', 'head -c 4096 /dev/zero; exit 73', 4096],
  ['4097 bytes', 'head -c 4097 /dev/zero; exit 73', 4096],
  ['very large output', 'head -c 4194304 /dev/zero; exit 73', 4096],
]) {
  test(`namespace preflight captures stdout at its raw byte limit for ${description}`, (context) => {
    const { result, log, captureSizes } = runNamespacePreflightFixture(context, {
      unshareContents: command,
      captureSizesFile: true,
    });

    assert.equal(result.status, 73);
    assert.ok(captureSizes.includes(`stdout ${expectedRawBytes}`), captureSizes.join('\n'));
    assert.ok(capturedDiagnosticBytes(log) <= 4096);
    assert.ok(capturedDiagnosticLines(log).length <= 40);
    assert.match(log, /  \| diagnostic: \[truncated\]/);
  });
}

test('namespace preflight independently caps raw stderr at 4096 bytes', (context) => {
  const { result, log, captureSizes } = runNamespacePreflightFixture(context, {
    unshareContents: 'head -c 4097 /dev/zero >&2; exit 73',
    captureSizesFile: true,
  });

  assert.equal(result.status, 73);
  assert.ok(captureSizes.includes('stderr 4096'), captureSizes.join('\n'));
  assert.ok(capturedDiagnosticBytes(log) <= 4096);
  assert.ok(capturedDiagnosticLines(log).length <= 40);
  assert.match(log, /  \| diagnostic: \[truncated\]/);
});

test('namespace preflight escapes valid multibyte UTF-8 deterministically', (context) => {
  const { result, log } = runNamespacePreflightFixture(context, {
    unshareContents: "printf '\\303\\251\\n' >&2; exit 73",
  });

  assert.equal(result.status, 73);
  assert.match(log, /  \| stderr: \\xC3\\xA9/);
  assert.ok(capturedDiagnosticBytes(log) <= 4096);
});

for (const [description, count, expectedLines] of [
  ['exactly 40 lines', 40, 40],
  ['41 lines', 41, 40],
]) {
  test(`namespace preflight enforces the combined diagnostic line limit at ${description}`, (context) => {
    const { result, log } = runNamespacePreflightFixture(context, {
      unshareContents: `i=0\nwhile [ "$i" -lt ${count} ]; do printf 'line-%02d\\n' "$i"; i=$((i + 1)); done\nexit 73`,
    });
    const lines = capturedDiagnosticLines(log);

    assert.equal(result.status, 73);
    assert.equal(lines.length, expectedLines);
    assert.ok(capturedDiagnosticBytes(log) <= 4096);
    if (count === 40) {
      assert.equal(lines.at(-1), '  | stdout: line-39');
    } else {
      assert.equal(lines.at(-1), '  | diagnostic: [truncated]');
    }
  });
}

test('namespace preflight applies byte and line ceilings across both streams', (context) => {
  const { result, log, captureSizes } = runNamespacePreflightFixture(context, {
    unshareContents: 'head -c 8192 /dev/zero; i=0; while [ "$i" -lt 50 ]; do printf "stderr-%s\\n" "$i" >&2; i=$((i + 1)); done; exit 73',
    captureSizesFile: true,
  });

  assert.equal(result.status, 73);
  assert.ok(capturedDiagnosticBytes(log) <= 4096);
  assert.ok(capturedDiagnosticLines(log).length <= 40);
  assert.match(log, /  \| diagnostic: \[truncated\]/);
  assert.ok(captureSizes.includes('stderr 490'), captureSizes.join('\n'));
});

test('namespace preflight handles empty stdout, empty stderr, and both streams empty', (context) => {
  for (const command of [
    'exit 73',
    'printf "stdout only\\n"; exit 73',
    'printf "stderr only\\n" >&2; exit 73',
  ]) {
    const { result, log } = runNamespacePreflightFixture(context, {
      unshareContents: command,
    });

    assert.equal(result.status, 73);
    assert.match(log, /Namespace creation failed \(exit status 73\)/);
    assert.equal(capturedDiagnosticBytes(log) <= 4096, true);
    assert.equal(capturedDiagnosticLines(log).length <= 40, true);
  }
});

for (const failure of [
  { headFailureStream: 'stdout', unshareContents: 'exit 73', expectedStatus: 73 },
  { headFailureStream: 'stderr', unshareContents: 'exit 73', expectedStatus: 73 },
  { formatterFailure: true, unshareContents: 'exit 73', expectedStatus: 73 },
  { stdoutSinkFailure: true, unshareContents: 'exit 73', expectedStatus: 73 },
  { logSinkFailure: true, unshareContents: 'exit 73', expectedStatus: 73 },
  { cleanupFailure: true, unshareContents: 'exit 73', expectedStatus: 73 },
  { formatterFailure: true, expectedStatus: 75 },
  { cleanupFailure: true, expectedStatus: 76 },
  { headFailureStream: 'stdout', expectedStatus: 74 },
  { stdoutSinkFailure: true, expectedStatus: 1 },
  { logSinkFailure: true, expectedStatus: 74 },
]) {
  test(`namespace preflight preserves the configured status precedence ${JSON.stringify(failure)}`, (context) => {
    const { result, log } = runNamespacePreflightFixture(context, failure);
    assert.equal(result.status, failure.expectedStatus, `${result.stdout}\n${result.stderr}\n${log}`);
    if (failure.expectedStatus === 73) {
      assert.match(log, /Namespace creation failed \(exit status 73\)/);
    } else if (failure.cleanupFailure) {
      assert.match(log, /User\/network namespace creation and UID\/GID mapping succeeded/);
      assert.match(log, /Temporary resource cleanup failed \(exit code 76\)/);
    } else if (failure.stdoutSinkFailure) {
      assert.match(log, /Namespace command completed, but diagnostic capture or output delivery failed/);
      assert.doesNotMatch(log, /User\/network namespace creation and UID\/GID mapping succeeded/);
    } else if (failure.logSinkFailure) {
      assert.match(log, /User\/network namespace creation and UID\/GID mapping succeeded/);
    } else {
      assert.doesNotMatch(log, /User\/network namespace creation and UID\/GID mapping succeeded/);
    }
    if (failure.logSinkFailure) {
      assert.match(result.stderr, /Namespace preflight log writer failed \(exit code 74\)/);
    }
  });
}

for (const exitCode of [1, 73, 91]) {
  test(`namespace preflight preserves namespace exit code ${exitCode}`, (context) => {
    const { result, log } = runNamespacePreflightFixture(context, {
      unshareContents: `printf 'exit ${exitCode}\\n' >&2; exit ${exitCode}`,
    });
    assert.equal(result.status, exitCode);
    assert.match(log, new RegExp(`Namespace creation failed \\(exit status ${exitCode}\\)`));
  });
}

for (const [signalName, expectedStatus] of [
  ['SIGINT', 130],
  ['SIGHUP', 129],
  ['SIGTERM', 143],
]) {
test(`namespace preflight handles ${signalName} during capture without leaking children`, { timeout: 10000 }, async (context) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-namespace-interrupt-'));
  context.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  const fakeBinDirectory = path.join(temporaryDirectory, 'bin');
  fs.mkdirSync(fakeBinDirectory);
  const capturePidFile = path.join(temporaryDirectory, 'capture-pids');
  const writeExecutable = (name, contents) => {
    const executable = path.join(fakeBinDirectory, name);
    fs.writeFileSync(executable, `#!/bin/sh\n${contents}\n`, { mode: 0o700 });
    return executable;
  };
  const startedFile = path.join(temporaryDirectory, 'unshare-started');
  const fakeUnshare = writeExecutable(
    'unshare',
    `printf 'captured before interrupt\\n'; printf '%s\\n' "$$" > "$AETHER_PREFLIGHT_START_FILE.tmp"; mv -- "$AETHER_PREFLIGHT_START_FILE.tmp" "$AETHER_PREFLIGHT_START_FILE"; exec /bin/bash -c 'exec -a "$1" /bin/sleep 30' _ "$AETHER_PREFLIGHT_START_FILE"`,
  );
  writeExecutable(
    'head',
    `printf '%s\\n' "$PPID" >> "$AETHER_CAPTURE_PID_LOG"; exec /usr/bin/head "$@"`,
  );
  writeExecutable(
    'readlink',
    `case "$1" in
  /proc/self/ns/user) printf '%s\\n' "user:[100]" ;;
  /proc/self/ns/net) printf '%s\\n' "net:[200]" ;;
  *) exec /usr/bin/readlink "$@" ;;
esac`,
  );
  writeExecutable(
    'cat',
    `case "$1" in
  /proc/self/uid_map) printf '%s\\n' '1201 1201 1' ;;
  /proc/self/gid_map) printf '%s\\n' '1301 1301 1' ;;
  *) exec /bin/cat "$@" ;;
esac`,
  );
  writeExecutable('id', 'case "$1" in -u) echo 1201 ;; -g) echo 1301 ;; *) exec /usr/bin/id "$@" ;; esac');
  writeExecutable('dmesg', 'exit 0');
  writeExecutable('journalctl', 'exit 0');

  const isolatedScript = fs.readFileSync(
    path.resolve(desktopDirectory, '../../.github/scripts/aether-namespace-preflight.sh'),
    'utf8',
  ).replaceAll('/usr/bin/unshare', fakeUnshare);
  const logFile = path.join(temporaryDirectory, 'network-namespace-check.log');
  let startedResolve;
  const started = new Promise((resolve) => {
    startedResolve = resolve;
  });
  const watcher = fs.watch(temporaryDirectory, (_event, fileName) => {
    if (fileName === 'unshare-started') {
      startedResolve();
    }
  });
  context.after(() => watcher.close());
  const unrelatedProcess = spawn('/bin/sleep', ['30'], { stdio: 'ignore' });
  context.after(() => {
    if (unrelatedProcess.exitCode === null && unrelatedProcess.signalCode === null) {
      unrelatedProcess.kill('SIGKILL');
    }
  });
  let namespacePid;
  let namespaceStartTime;
  let namespaceCommandExited = false;
  const readProcessStartTime = (pid) => {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)[19];
  };
  const child = spawn(
    'bash',
    ['-e', '-o', 'pipefail', '-c', isolatedScript, 'preflight', logFile],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: `${fakeBinDirectory}${path.delimiter}${process.env.PATH || ''}`,
        AETHER_EVIDENCE_DIR: temporaryDirectory,
        AETHER_PREFLIGHT_START_FILE: startedFile,
        AETHER_CAPTURE_PID_LOG: capturePidFile,
      },
    },
  );
  context.after(() => {
    try {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
    if (!namespaceCommandExited && namespacePid && namespaceStartTime) {
      try {
        if (readProcessStartTime(namespacePid) === namespaceStartTime) {
          process.kill(namespacePid, 'SIGKILL');
        }
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
  const closed = once(child, 'close');
  await started;
  namespacePid = Number(fs.readFileSync(startedFile, 'utf8').trim());
  namespaceStartTime = readProcessStartTime(namespacePid);
  while (true) {
    assert.equal(child.exitCode, null, `${stdout}\n${stderr}`);
    const waitChannel = fs.readFileSync(`/proc/${child.pid}/wchan`, 'utf8').trim();
    if (waitChannel === 'do_wait') break;
    await new Promise((resolve) => setImmediate(resolve));
  }
  child.kill(signalName);
  const [exitCode, signal] = await closed;
  namespaceCommandExited = true;
  const log = fs.readFileSync(logFile, 'utf8');
  let remainingCommandLine = '';
  try {
    remainingCommandLine = fs.readFileSync(`/proc/${namespacePid}/cmdline`, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  assert.equal(exitCode, expectedStatus, `${stdout}\n${stderr}\n${log}; signal=${signal}`);
  assert.equal(remainingCommandLine.includes(startedFile), false);
  assert.match(log, new RegExp(`Namespace creation failed \\(exit status ${expectedStatus}\\)`));
  assert.doesNotMatch(log, /User\/network namespace creation and UID\/GID mapping succeeded/);
  assert.match(log, /  \| stdout: captured before interrupt/);
  assert.equal(unrelatedProcess.exitCode, null, 'the unrelated fixture process must not be signaled');
  const capturePids = fs.readFileSync(capturePidFile, 'utf8').trim().split('\n').map(Number);
  assert.ok(capturePids.length >= 2, capturePids.join('\n'));
  for (const pid of capturePids) {
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  }
  assert.deepEqual(
    fs.readdirSync(temporaryDirectory).filter((entry) => entry.startsWith('.namespace-preflight.')),
    [],
  );
  unrelatedProcess.kill('SIGTERM');
  await once(unrelatedProcess, 'close');
});
}

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
  const uiSmoke = fs.readFileSync(path.join(desktopDirectory, 'test/electron-ui-smoke.test.cjs'), 'utf8');
  assert.match(uiSmoke, /assertScreenshotDimensions\('09-responsive-360\.png',\s*360,\s*720\)/);
  assert.match(uiSmoke, /assertScreenshotDimensions\('10-responsive-640\.png',\s*640,\s*720\)/);
  assert.match(uiSmoke, /assertScreenshotDimensions\('11-responsive-tablet-768\.png',\s*768,\s*1024\)/);
  assert.match(uiSmoke, /assertScreenshotDimensions\('12-responsive-desktop-1480\.png',\s*1480,\s*920\)/);
  const screenshotValidation = uiSmoke.match(/function assertScreenshotDimensions\([\s\S]*?\n\}/)?.[0];
  assert.ok(screenshotValidation);
  assert.match(screenshotValidation, /'%w %h %k'/);
  assert.match(screenshotValidation, /distinctColors > 20/);
});
