'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { AetherProfiles } = require('../profiles.cjs');
const { profilePartition } = require('../profile-partitions.cjs');

const enabled = process.env.PARMAR_AETHER_PROFILE_STORAGE_RUNTIME === '1';
const electronPath = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron');
const workerPath = path.join(__dirname, 'profile-storage-runtime-worker.cjs');

function runWorker(config) {
  return new Promise((resolve, reject) => {
    const child = spawn(electronPath, [workerPath, JSON.stringify(config)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    let forceKillTimer = null;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
    }, 60_000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (timedOut) {
        reject(new Error(`Profile runtime worker timed out for ${config.profileId}.`));
        return;
      }
      if (code !== 0) {
        reject(new Error(
          `Profile runtime worker failed (${code ?? signal}) for ${config.profileId}:\n${stderr.join('')}`,
        ));
        return;
      }
      try {
        resolve(JSON.parse(fs.readFileSync(config.reportPath, 'utf8')));
      } catch (error) {
        reject(new Error(`Profile runtime worker did not produce valid evidence: ${stdout.join('')}`, {
          cause: error,
        }));
      }
    });
  });
}

test('persistent Chromium profile storage remains isolated across process restarts', {
  skip: enabled
    ? false
    : 'Set PARMAR_AETHER_PROFILE_STORAGE_RUNTIME=1 to launch the opt-in Electron storage test.',
  timeout: 240_000,
}, async (context) => {
  assert.equal(fs.existsSync(electronPath), true, 'Pinned Electron runtime is unavailable.');
  const temporaryBase = fs.realpathSync(os.tmpdir());
  const temporaryRoot = fs.mkdtempSync(path.join(temporaryBase, 'aether-profile-storage-'));
  const ownerToken = randomBytes(32).toString('hex');
  const ownerPath = path.join(temporaryRoot, '.aether-profile-storage-owner');
  fs.writeFileSync(ownerPath, ownerToken, { flag: 'wx', mode: 0o600 });
  context.after(() => {
    const rootStat = fs.lstatSync(temporaryRoot);
    assert.ok(rootStat.isDirectory() && !rootStat.isSymbolicLink());
    assert.equal(fs.realpathSync(temporaryRoot), temporaryRoot);
    assert.equal(path.dirname(temporaryRoot), temporaryBase);
    assert.ok(path.basename(temporaryRoot).startsWith('aether-profile-storage-'));
    assert.equal(fs.readFileSync(ownerPath, 'utf8'), ownerToken);
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  });
  const userDataPath = path.join(temporaryRoot, 'user-data');
  const evidencePath = path.join(temporaryRoot, 'evidence');
  fs.mkdirSync(userDataPath, { mode: 0o700 });
  fs.mkdirSync(evidencePath, { mode: 0o700 });
  assert.deepEqual(fs.readdirSync(userDataPath), []);

  const profiles = new AetherProfiles(userDataPath);
  const profileA = profiles.createProfile('Runtime Test A').profiles.at(-1).id;
  const profileB = profiles.createProfile('Runtime Test B').profiles.at(-1).id;
  assert.notEqual(profileA, profileB);
  assert.notEqual(profilePartition(profileA), profilePartition(profileB));
  assert.throws(() => profilePartition('../invalid-profile'), /profile ID is invalid/);
  const markers = {
    [profileA]: randomBytes(24).toString('hex'),
    [profileB]: randomBytes(24).toString('hex'),
  };
  const reports = [];

  for (const profileId of [profileA, profileB, profileA, profileB]) {
    profiles.selectProfile(profileId);
    const reportPath = path.join(evidencePath, `${reports.length + 1}-${profileId}.json`);
    reports.push(await runWorker({
      userDataPath,
      temporaryRoot,
      evidencePath,
      ownerToken,
      reportPath,
      profileId,
      expectedMarker: markers[profileId],
      otherMarker: markers[profileId === profileA ? profileB : profileA],
      operation: reports.length < 2 ? 'seed' : 'verify',
    }));
  }

  const partitionPaths = new Map();
  for (const [index, report] of reports.entries()) {
    assert.equal(report.profileId === profileA || report.profileId === profileB, true);
    assert.equal(report.partition, profilePartition(report.profileId));
    assert.equal(report.operation === 'seed' || report.operation === 'verify', true);
    assert.equal(typeof report.electronVersion, 'string');
    assert.equal(typeof report.chromiumVersion, 'string');
    const relativeStoragePath = path.relative(userDataPath, report.storagePath);
    assert.ok(
      relativeStoragePath
      && !relativeStoragePath.startsWith('..')
      && !path.isAbsolute(relativeStoragePath),
      'Chromium storage path must remain inside the test-only user-data directory.',
    );
    if (index < 2) {
      assert.equal(report.operation, 'seed');
      assert.deepEqual(report.categories, {
        cookies: 'seeded',
        localStorage: 'seeded',
        indexedDB: 'seeded',
        serviceWorkerRegistration: 'seeded',
        serviceWorkerStorage: 'seeded',
        cacheStorage: 'seeded',
        crossProfileIsolation: 'not-checked',
        httpCache: 'unverified',
      });
    } else {
      assert.equal(report.operation, 'verify');
      assert.deepEqual(report.categories, {
        cookies: true,
        localStorage: true,
        indexedDB: true,
        serviceWorkerRegistration: true,
        serviceWorkerStorage: true,
        cacheStorage: true,
        crossProfileIsolation: true,
        httpCache: 'unverified',
      });
    }
    const previousPath = partitionPaths.get(report.profileId);
    if (previousPath) assert.equal(report.storagePath, previousPath);
    else partitionPaths.set(report.profileId, report.storagePath);
  }
  assert.equal(partitionPaths.size, 2);
  assert.notEqual(partitionPaths.get(profileA), partitionPaths.get(profileB));
  console.log(`AETHER_PROFILE_STORAGE_EVIDENCE ${JSON.stringify({
    results: reports.map((report) => ({
      profileId: report.profileId,
      partition: report.partition,
      storagePath: report.storagePath,
      operation: report.operation,
      electronVersion: report.electronVersion,
      chromiumVersion: report.chromiumVersion,
      categories: report.categories,
    })),
  })}`);
});
