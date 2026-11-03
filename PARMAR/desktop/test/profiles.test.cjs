'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { AetherProfiles, MAX_PROFILES } = require('../profiles.cjs');
const {
  LEGACY_DEFAULT_PROFILE_PARTITION,
  PROFILE_PARTITION_PREFIX,
  profilePartition,
} = require('../profile-partitions.cjs');
const { AetherStore } = require('../store.cjs');

function createDirectory(context) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'parmar-aether-profiles-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('profile partitions are deterministic, validated, and preserve the default partition', () => {
  const firstProfileId = '123e4567-e89b-12d3-a456-426614174000';
  const secondProfileId = '223e4567-e89b-12d3-a456-426614174000';

  assert.equal(profilePartition('default'), LEGACY_DEFAULT_PROFILE_PARTITION);
  assert.equal(profilePartition(firstProfileId), `${PROFILE_PARTITION_PREFIX}${firstProfileId}`);
  assert.equal(profilePartition(firstProfileId), profilePartition(firstProfileId));
  assert.notEqual(profilePartition(firstProfileId), profilePartition(secondProfileId));
  for (const invalidId of [null, '', 'Default', '../profile', 'not-a-uuid']) {
    assert.throws(() => profilePartition(invalidId), /profile ID is invalid/);
  }
});

test('legacy browser data remains in place and becomes the default profile without merging', (context) => {
  const directory = createDirectory(context);
  const legacyStatePath = path.join(directory, 'aether-state.json');
  const legacy = new AetherStore(directory);
  legacy.addBookmark({ title: 'Legacy bookmark', url: 'https://legacy.example/' });
  legacy.addHistory({
    title: 'Legacy history',
    url: 'https://legacy.example/history',
    visitedAt: 123,
  });
  legacy.saveSession({
    tabs: [{ url: 'https://legacy.example/tab', pinned: false }],
    activeIndex: 0,
    zoomFactor: 1.2,
    zoomFactors: [1.3],
  });
  legacy.updatePreferences({ defaultZoom: 1.4 });
  const originalContent = fs.readFileSync(legacyStatePath, 'utf8');

  const profiles = new AetherProfiles(directory);
  const loadedDefault = new AetherStore(profiles.profileDataPath('default'));

  assert.equal(profiles.startupProfileId, 'default');
  assert.equal(profiles.snapshot().profiles.length, 1);
  assert.equal(profiles.snapshot().profiles[0].name, 'Default');
  assert.equal(profiles.profileDataPath('default'), directory);
  assert.equal(loadedDefault.snapshot().bookmarks[0].title, 'Legacy bookmark');
  assert.equal(loadedDefault.snapshot().history[0].visitedAt, 123);
  assert.deepEqual(loadedDefault.sessionSnapshot().tabs, [
    { url: 'https://legacy.example/tab', pinned: false },
  ]);
  assert.equal(loadedDefault.preferencesSnapshot().defaultZoom, 1.4);
  assert.equal(fs.existsSync(legacyStatePath), true);
  assert.equal(fs.readFileSync(legacyStatePath, 'utf8'), originalContent);
  assert.equal(fs.existsSync(path.join(directory, 'profile-data')), false);
});

test('profile IDs are unique, stable, and independent from names and filesystem paths', (context) => {
  const directory = createDirectory(context);
  const profiles = new AetherProfiles(directory);
  const result = profiles.createProfile('Research Group');
  const created = result.profiles.at(-1);
  const secondProfile = profiles.createProfile('Second workspace').profiles.at(-1);

  assert.match(created.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.notEqual(created.id, secondProfile.id);
  assert.notEqual(created.id, 'Research Group');
  assert.equal(created.createdAt > 0, true);
  assert.equal(profiles.profileDataPath(created.id), path.join(directory, 'profile-data', created.id));
  assert.equal(profiles.profileDataPath(created.id).includes('Research Group'), false);

  const reopened = new AetherProfiles(directory);
  assert.equal(reopened.profileDataPath(created.id), profiles.profileDataPath(created.id));
  assert.equal(reopened.snapshot().profiles[1].id, created.id);
});

test('duplicate, malformed, and overlong profile names are rejected', (context) => {
  const profiles = new AetherProfiles(createDirectory(context));
  profiles.createProfile('Work');

  for (const name of [' work ', '', '   ', '../escape', 'name/path', 'name\\path', 'name:bad', 'x'.repeat(41), null, 12]) {
    assert.throws(() => profiles.createProfile(name), /profile name|profile with this name/i, String(name));
  }
});

test('profile count is bounded', (context) => {
  const profiles = new AetherProfiles(createDirectory(context));
  for (let index = 1; index < MAX_PROFILES; index += 1) {
    profiles.createProfile(`Profile ${index}`);
  }
  assert.equal(profiles.snapshot().profiles.length, MAX_PROFILES);
  assert.throws(() => profiles.createProfile('One Too Many'), /at most/);
});

test('duplicate generated IDs and invalid metadata timestamps are rejected before persistence', (context) => {
  const directory = createDirectory(context);
  const duplicateId = '123e4567-e89b-12d3-a456-426614174000';
  const profiles = new AetherProfiles(directory, {
    createId: () => duplicateId,
    now: () => 100,
  });
  profiles.createProfile('First');
  const existingContent = fs.readFileSync(profiles.filePath, 'utf8');

  assert.throws(() => profiles.createProfile('Second'), /unique profile identifier/);
  assert.equal(fs.readFileSync(profiles.filePath, 'utf8'), existingContent);

  const invalidClock = new AetherProfiles(path.join(directory, 'invalid-clock'));
  invalidClock.now = () => Number.NaN;
  assert.throws(() => invalidClock.createProfile('Invalid timestamp'), /failed validation/);
  assert.equal(invalidClock.snapshot().profiles.length, 1);
  assert.equal(
    JSON.parse(fs.readFileSync(invalidClock.filePath, 'utf8')).profiles.length,
    1,
  );
});

test('active-profile IDs must reference a validated profile entry', (context) => {
  const directory = createDirectory(context);
  const profiles = new AetherProfiles(directory);
  const metadata = JSON.parse(fs.readFileSync(profiles.filePath, 'utf8'));
  metadata.activeProfileId = '123e4567-e89b-12d3-a456-426614174000';
  fs.writeFileSync(profiles.filePath, JSON.stringify(metadata));

  assert.throws(() => new AetherProfiles(directory), /invalid or unsupported/);
});

test('profile stores isolate bookmarks, history, sessions, zoom, preferences, closed tabs, and download metadata', (context) => {
  const directory = createDirectory(context);
  const profiles = new AetherProfiles(directory);
  const profileId = profiles.createProfile('Private workspace').profiles.at(-1).id;
  const defaultStore = new AetherStore(profiles.profileDataPath('default'));
  const otherStore = new AetherStore(profiles.profileDataPath(profileId));

  defaultStore.addBookmark({ title: 'Default saved', url: 'https://default.example/' });
  defaultStore.addHistory({ title: 'Default visited', url: 'https://default.example/history' });
  defaultStore.saveSession({
    tabs: [{ url: 'https://default.example/tab', pinned: false }],
    activeIndex: 0,
    zoomFactor: 1.1,
    zoomFactors: [1.2],
  });
  defaultStore.updatePreferences({ defaultZoom: 1.3 });
  defaultStore.saveClosedTabs([{
    url: 'https://default.example/closed',
    restoreUrl: null,
    zoomFactor: 1.4,
  }]);
  defaultStore.updateDownload({
    id: '123e4567-e89b-12d3-a456-426614174000',
    fileName: 'default.pdf',
    receivedBytes: 12,
    totalBytes: 12,
    state: 'completed',
    error: null,
    updatedAt: 123,
  });

  assert.deepEqual(otherStore.snapshot(), { bookmarks: [], history: [] });
  assert.deepEqual(otherStore.sessionSnapshot().tabs, []);
  assert.equal(otherStore.preferencesSnapshot().defaultZoom, 1);
  assert.deepEqual(otherStore.closedTabsSnapshot(), []);
  assert.deepEqual(otherStore.downloadsSnapshot(), []);

  const reopenedDefault = new AetherStore(profiles.profileDataPath('default'));
  assert.equal(reopenedDefault.snapshot().bookmarks[0].title, 'Default saved');
  assert.equal(reopenedDefault.snapshot().history[0].title, 'Default visited');
  assert.equal(reopenedDefault.sessionSnapshot().tabs[0].url, 'https://default.example/tab');
  assert.equal(reopenedDefault.preferencesSnapshot().defaultZoom, 1.3);
  assert.equal(reopenedDefault.closedTabsSnapshot()[0].url, 'https://default.example/closed');
  assert.equal(reopenedDefault.downloadsSnapshot()[0].fileName, 'default.pdf');
});

test('a newly created profile with no directory starts empty without reading the Default store', (context) => {
  const directory = createDirectory(context);
  const profiles = new AetherProfiles(directory);
  const defaultStore = new AetherStore(profiles.profileDataPath('default'));
  defaultStore.addBookmark({ title: 'Default only', url: 'https://default.example/' });
  const profileId = profiles.createProfile('Unused profile').profiles.at(-1).id;
  const profilePath = profiles.profileDataPath(profileId);

  assert.equal(fs.existsSync(profilePath), false);
  const newStore = new AetherStore(profilePath);
  assert.deepEqual(newStore.snapshot(), { bookmarks: [], history: [] });
  assert.equal(fs.existsSync(path.join(directory, 'aether-state.json')), true);
  assert.equal(fs.existsSync(profilePath), false);
});

test('profile selection is staged for restart and only becomes active in a new manager', (context) => {
  const directory = createDirectory(context);
  const profiles = new AetherProfiles(directory);
  const targetId = profiles.createProfile('Next profile').profiles.at(-1).id;

  const staged = profiles.selectProfile(targetId);
  assert.equal(staged.activeProfileId, 'default');
  assert.equal(staged.selectedProfileId, targetId);
  assert.equal(staged.restartRequired, true);
  assert.equal(profiles.startupProfileId, 'default');

  const restarted = new AetherProfiles(directory);
  assert.equal(restarted.startupProfileId, targetId);
  assert.equal(restarted.snapshot().activeProfileId, targetId);
  assert.equal(restarted.snapshot().selectedProfileId, targetId);
  assert.equal(restarted.snapshot().restartRequired, false);

  const cancelled = profiles.selectProfile('default');
  assert.equal(cancelled.activeProfileId, 'default');
  assert.equal(cancelled.selectedProfileId, 'default');
  assert.equal(cancelled.restartRequired, false);
});

test('malformed and outdated profile metadata is rejected without replacing the file', (context) => {
  const directory = createDirectory(context);
  const profiles = new AetherProfiles(directory);
  const invalidName = {
    version: 1,
    profiles: [
      { id: 'default', name: 'Default', createdAt: 123 },
      {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: null,
        createdAt: 456,
      },
    ],
    activeProfileId: 'default',
  };
  for (const content of [
    '{"version":',
    JSON.stringify({ version: 0, profiles: [], activeProfileId: 'default' }),
    JSON.stringify({ version: 1, profiles: [], activeProfileId: 'default' }),
    JSON.stringify(invalidName),
    JSON.stringify({
      version: 1,
      profiles: [
        { id: 'default', name: 'Default', createdAt: 123 },
        { id: '123e4567-e89b-12d3-a456-426614174000', name: 'First', createdAt: 456 },
        { id: '123e4567-e89b-12d3-a456-426614174000', name: 'Second', createdAt: 789 },
      ],
      activeProfileId: 'default',
    }),
    JSON.stringify({
      version: 1,
      profiles: [
        { id: 'default', name: 'Default', createdAt: 123 },
        { id: '123e4567-e89b-12d3-a456-426614174000', name: 'default', createdAt: 456 },
      ],
      activeProfileId: 'default',
    }),
  ]) {
    fs.writeFileSync(profiles.filePath, content);
    assert.throws(() => new AetherProfiles(directory), /profile metadata is invalid/);
    assert.equal(fs.readFileSync(profiles.filePath, 'utf8'), content);
  }
});

test('interrupted profile registry writes preserve prior data and remove only their temporary file', (context) => {
  const directory = createDirectory(context);
  const profiles = new AetherProfiles(directory);
  const previousFile = fs.readFileSync(profiles.filePath, 'utf8');
  const originalWriteFileSync = fs.writeFileSync;

  fs.writeFileSync = function writePartialThenFail(file, ...args) {
    if (typeof file === 'number') {
      originalWriteFileSync.call(fs, file, '{"partial":');
      throw new Error('simulated interrupted write');
    }
    return originalWriteFileSync.call(fs, file, ...args);
  };
  try {
    assert.throws(() => profiles.createProfile('Must not persist'), /could not be saved/);
  } finally {
    fs.writeFileSync = originalWriteFileSync;
  }

  assert.equal(fs.readFileSync(profiles.filePath, 'utf8'), previousFile);
  assert.equal(profiles.snapshot().profiles.length, 1);
  assert.deepEqual(
    fs.readdirSync(directory).filter((entry) => entry.endsWith('.tmp')),
    [],
  );
});
