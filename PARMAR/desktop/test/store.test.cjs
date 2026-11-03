'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AetherStore,
  DEFAULT_PREFERENCES,
  safePreferences,
  safeSession,
  safeWebRecord,
} = require('../store.cjs');
const { ClosedTabHistory, MAX_CLOSED_TABS } = require('../closed-tabs.cjs');
const {
  safeDownloadDestination,
  safeDownloadRecord,
  sanitizeDownloadFilename,
} = require('../download-utils.cjs');

function createTemporaryStore(context) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'parmar-aether-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return new AetherStore(directory);
}

test('download metadata and filenames reject unsafe or unexpected values', () => {
  const record = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    fileName: 'report.pdf',
    receivedBytes: 12,
    totalBytes: 100,
    state: 'downloading',
    error: null,
    updatedAt: 123,
  };
  assert.deepEqual(safeDownloadRecord(record), record);
  assert.equal(safeDownloadRecord({ ...record, fileName: '../secret.txt' }), null);
  assert.equal(safeDownloadRecord({ ...record, destination: '/tmp/secret.txt' }), null);
  assert.equal(safeDownloadRecord({ ...record, error: 'Could not write /home/user/private.txt' }), null);
  assert.equal(sanitizeDownloadFilename('../../CON.txt'), '_CON.txt');
  assert.equal(sanitizeDownloadFilename(''), 'download');
  assert.equal(safeDownloadDestination('/tmp/../secret.txt'), null);
  assert.equal(safeDownloadDestination('relative.txt'), null);
  assert.equal(safeDownloadDestination('/tmp/approved.txt'), '/tmp/approved.txt');
});

test('download persistence restores unfinished entries as interrupted without paths or auto-resume', (context) => {
  const store = createTemporaryStore(context);
  const record = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    fileName: 'report.pdf',
    receivedBytes: 12,
    totalBytes: 100,
    state: 'downloading',
    error: null,
    updatedAt: 123,
  };
  store.updateDownload(record);

  const persisted = JSON.parse(fs.readFileSync(store.filePath, 'utf8'));
  assert.equal(Object.hasOwn(persisted.downloads[0], 'destination'), false);
  const reopened = new AetherStore(path.dirname(store.filePath));
  assert.equal(reopened.downloadsSnapshot()[0].state, 'interrupted');
  assert.match(reopened.downloadsSnapshot()[0].error, /not resumed/);
  assert.equal(reopened.downloadsSnapshot()[0].fileName, 'report.pdf');
});

test('invalid persisted download metadata is rejected', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'parmar-aether-download-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'aether-state.json'), JSON.stringify({
    version: 1,
    bookmarks: [],
    history: [],
    downloads: [{
      id: '123e4567-e89b-12d3-a456-426614174000',
      fileName: '../escape',
      receivedBytes: 0,
      totalBytes: 0,
      state: 'completed',
      error: null,
      updatedAt: 123,
    }],
  }));
  assert.throws(() => new AetherStore(directory), /download record 1 is invalid/);
});

test('recently closed tab history validates entries and removes invalid data safely', () => {
  const valid = {
    url: 'https://example.com/page',
    restoreUrl: null,
    zoomFactor: 1.25,
  };
  const history = new ClosedTabHistory([
    { ...valid, url: 'javascript:alert(1)' },
    { ...valid, zoomFactor: 8 },
    valid,
  ]);

  assert.equal(history.length, 1);
  assert.deepEqual(history.take(), {
    url: 'https://example.com/page',
    restoreUrl: null,
    zoomFactor: 1.25,
  });
  assert.equal(history.take(), null);
});

test('recently closed tab history is bounded and returns tabs newest-first', () => {
  const history = new ClosedTabHistory();
  for (let index = 1; index <= MAX_CLOSED_TABS + 2; index += 1) {
    assert.equal(history.push({
      url: `https://page-${index}.example/`,
      restoreUrl: null,
      zoomFactor: 1,
    }), true);
  }

  assert.equal(history.length, MAX_CLOSED_TABS);
  assert.equal(history.take().url, `https://page-${MAX_CLOSED_TABS + 2}.example/`);
  assert.equal(history.length, MAX_CLOSED_TABS - 1);
});

test('AETHER bookmarks and history persist only normalized HTTPS records', (context) => {
  const store = createTemporaryStore(context);
  store.addBookmark({ title: ' Example ', url: 'https://example.com' });
  store.addHistory({ title: 'Example page', url: 'https://example.com/page', visitedAt: 123 });
  const reopened = new AetherStore(path.dirname(store.filePath));

  assert.equal(reopened.snapshot().bookmarks[0].title, 'Example');
  assert.equal(reopened.snapshot().bookmarks[0].url, 'https://example.com/');
  assert.equal(reopened.snapshot().history[0].visitedAt, 123);
  assert.throws(
    () => store.addBookmark({ title: 'unsafe', url: 'http://example.com' }),
    /valid HTTPS pages/,
  );
});

test('AETHER bookmark removal and history clearing are explicit operations', (context) => {
  const store = createTemporaryStore(context);
  store.addBookmark({ title: 'Example', url: 'https://example.com' });
  store.addHistory({ title: 'Example', url: 'https://example.com' });

  assert.equal(store.removeBookmark('https://example.com/').bookmarks.length, 0);
  assert.equal(store.removeHistory('https://example.com/').history.length, 0);
  assert.equal(store.clearHistory().history.length, 0);
});

test('AETHER bookmark URL duplicates are normalized and replaced rather than multiplied', (context) => {
  const store = createTemporaryStore(context);
  store.addBookmark({ title: 'Original title', url: 'https://example.com/page', visitedAt: 123 });

  const bookmarks = store.addBookmark({
    title: 'Updated title',
    url: 'https://EXAMPLE.com:443/page',
    visitedAt: 456,
  }).bookmarks;

  assert.equal(bookmarks.length, 1);
  assert.deepEqual(bookmarks[0], {
    title: 'Updated title',
    url: 'https://example.com/page',
    visitedAt: 456,
  });
});

test('AETHER bookmark titles can be edited and persist without changing URL or position', (context) => {
  const store = createTemporaryStore(context);
  store.addBookmark({ title: 'Original title', url: 'https://example.com/page', visitedAt: 123 });
  store.addBookmark({ title: 'Second bookmark', url: 'https://second.example/', visitedAt: 456 });

  const updated = store.updateBookmark('https://example.com/page', '  Research notes  ').bookmarks;
  assert.deepEqual(updated.map(({ title, url, visitedAt }) => ({ title, url, visitedAt })), [
    { title: 'Second bookmark', url: 'https://second.example/', visitedAt: 456 },
    { title: 'Research notes', url: 'https://example.com/page', visitedAt: 123 },
  ]);
  const reopened = new AetherStore(path.dirname(store.filePath));
  assert.equal(reopened.snapshot().bookmarks[1].title, 'Research notes');
  assert.throws(() => store.updateBookmark('javascript:alert(1)', 'Unsafe'), /valid HTTPS bookmarks/);
  assert.throws(() => store.updateBookmark('https://example.com/page', '  '), /bookmark title/);
  assert.throws(() => store.updateBookmark('https://missing.example/', 'Missing'), /no longer exists/);
});

test('AETHER bookmark edits validate and persist URL changes without changing order', (context) => {
  const store = createTemporaryStore(context);
  store.addBookmark({ title: 'First', url: 'https://first.example/' });
  store.addBookmark({ title: 'Second', url: 'https://second.example/' });
  const oldUrl = 'https://second.example/';
  const newUrl = 'https://updated.example/path';

  const edited = store.updateBookmark(oldUrl, 'Updated title', newUrl).bookmarks;
  assert.deepEqual(edited.map(({ title, url }) => ({ title, url })), [
    { title: 'Updated title', url: newUrl },
    { title: 'First', url: 'https://first.example/' },
  ]);
  const reopened = new AetherStore(path.dirname(store.filePath));
  assert.deepEqual(reopened.snapshot().bookmarks, edited);
  assert.throws(
    () => store.updateBookmark(newUrl, 'Duplicate', 'https://first.example/'),
    /already exists/,
  );
  assert.throws(
    () => store.updateBookmark(newUrl, 'Unsafe', 'file:///etc/passwd'),
    /valid HTTPS bookmarks/,
  );
});

test('AETHER history deletion remains persisted after store restoration', (context) => {
  const store = createTemporaryStore(context);
  store.addHistory({ title: 'Keep', url: 'https://keep.example/' });
  store.addHistory({ title: 'Remove', url: 'https://remove.example/' });
  store.removeHistory('https://remove.example/');

  const reopened = new AetherStore(path.dirname(store.filePath));
  assert.deepEqual(reopened.snapshot().history.map(({ url }) => url), [
    'https://keep.example/',
  ]);
  store.clearHistory();
  assert.deepEqual(new AetherStore(path.dirname(store.filePath)).snapshot().history, []);
});

test('AETHER bookmark deletion remains persisted after store restoration', (context) => {
  const store = createTemporaryStore(context);
  store.addBookmark({ title: 'Keep', url: 'https://keep.example/' });
  store.addBookmark({ title: 'Remove', url: 'https://remove.example/' });
  store.removeBookmark('https://remove.example/');

  const reopened = new AetherStore(path.dirname(store.filePath));
  assert.deepEqual(reopened.snapshot().bookmarks.map(({ url }) => url), [
    'https://keep.example/',
  ]);
});

test('AETHER rejects invalid URLs when removing an individual history entry', (context) => {
  const store = createTemporaryStore(context);
  assert.throws(() => store.removeHistory('javascript:alert(1)'), /valid HTTPS pages/);
});

test('AETHER rejects invalid URLs when removing a bookmark', (context) => {
  const store = createTemporaryStore(context);
  assert.throws(() => store.removeBookmark('javascript:alert(1)'), /valid HTTPS bookmarks/);
});

test('AETHER history titles update without changing visit order or timestamps', (context) => {
  const store = createTemporaryStore(context);
  store.addHistory({ title: 'example.com', url: 'https://example.com/page', visitedAt: 123 });
  store.addHistory({ title: 'Other page', url: 'https://other.example/', visitedAt: 456 });

  const updated = store.updateHistoryTitle(
    'https://example.com/page',
    'Example page title',
  ).history;
  assert.deepEqual(updated.map(({ title, visitedAt }) => ({ title, visitedAt })), [
    { title: 'Other page', visitedAt: 456 },
    { title: 'Example page title', visitedAt: 123 },
  ]);
  assert.throws(
    () => store.updateHistoryTitle('javascript:alert(1)', 'Unsafe'),
    /valid HTTPS pages/,
  );
});

test('AETHER stored-record validation rejects credentials and non-HTTPS schemes', () => {
  assert.equal(safeWebRecord({ url: 'http://example.com' }), null);
  assert.equal(safeWebRecord({ url: 'https://name:secret@example.com' }), null);
  assert.equal(safeWebRecord({ url: 'file:///tmp/document' }), null);
  assert.deepEqual(
    { title: safeWebRecord({ url: 'https://example.com' }).title },
    { title: 'example.com' },
  );
});

test('AETHER refuses corrupted persisted records instead of silently discarding them', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'parmar-aether-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'aether-state.json'), JSON.stringify({
    version: 1,
    bookmarks: [{ title: 'Invalid', url: 'http://example.com' }],
    history: [],
  }));

  assert.throws(() => new AetherStore(directory), /bookmark record 1 is invalid/);
});

test('AETHER rejects malformed persisted JSON without replacing it', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'parmar-aether-json-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const statePath = path.join(directory, 'aether-state.json');
  fs.writeFileSync(statePath, '{"version":');

  assert.throws(() => new AetherStore(directory), /invalid JSON/);
  assert.equal(fs.readFileSync(statePath, 'utf8'), '{"version":');
});

test('AETHER persists bounded session tabs as validated HTTPS URLs without auto-restoring navigation', (context) => {
  const store = createTemporaryStore(context);
  store.saveSession({
    tabs: ['https://example.com/path', null],
    activeIndex: 1,
    zoomFactor: 1.25,
    zoomFactors: [1.25, 1.25],
  });

  const reopened = new AetherStore(path.dirname(store.filePath));
  assert.deepEqual(reopened.sessionSnapshot(), {
    tabs: [
      { url: 'https://example.com/path', pinned: false },
      { url: null, pinned: false },
    ],
    activeIndex: 1,
    zoomFactor: 1.25,
    zoomFactors: [1.25, 1.25],
  });
  assert.equal(reopened.snapshot().history.length, 0);
  assert.deepEqual(safeSession({ tabs: ['https://user:secret@example.com/'], activeIndex: 0 }), null);
  assert.deepEqual(safeSession({ tabs: ['file:///etc/passwd'], activeIndex: 0 }), null);
  assert.deepEqual(safeSession({ tabs: ['https://example.com/'], activeIndex: 1 }), null);
});

test('AETHER session validates and persists pinned tabs and their order', (context) => {
  const store = createTemporaryStore(context);
  store.saveSession({
    tabs: [
      { url: 'https://pinned.example/', pinned: true },
      { url: 'https://second.example/', pinned: false },
      { url: null, pinned: false },
    ],
    activeIndex: 1,
    zoomFactor: 1.4,
    zoomFactors: [1.4, 1.4, 1.4],
  });
  assert.deepEqual(new AetherStore(path.dirname(store.filePath)).sessionSnapshot(), {
    tabs: [
      { url: 'https://pinned.example/', pinned: true },
      { url: 'https://second.example/', pinned: false },
      { url: null, pinned: false },
    ],
    activeIndex: 1,
    zoomFactor: 1.4,
    zoomFactors: [1.4, 1.4, 1.4],
  });
  assert.equal(safeSession({
    tabs: [{ url: 'https://invalid.example/', pinned: 'yes' }],
    activeIndex: 0,
  }), null);
  assert.equal(safeSession({
    tabs: [{ url: 'javascript:alert(1)', pinned: false }],
    activeIndex: 0,
  }), null);
  assert.equal(safeSession({
    tabs: [
      { url: 'https://regular.example/', pinned: false },
      { url: 'https://pinned.example/', pinned: true },
    ],
    activeIndex: 0,
  }), null);
});

test('AETHER stored zoom falls back to default for malformed and out-of-range values', () => {
  for (const zoomFactor of [null, '1.25', {}, NaN, Infinity, -Infinity, 0.49, 2.01]) {
    assert.deepEqual(
      safeSession({ tabs: [null], activeIndex: 0, zoomFactor }),
      {
        tabs: [{ url: null, pinned: false }],
        activeIndex: 0,
        zoomFactor: 1,
        zoomFactors: [1],
      },
    );
  }
  assert.deepEqual(
    safeSession({ tabs: [null], activeIndex: 0, zoomFactor: 0.5 }),
    { tabs: [{ url: null, pinned: false }], activeIndex: 0, zoomFactor: 0.5, zoomFactors: [0.5] },
  );
  assert.deepEqual(
    safeSession({ tabs: [null], activeIndex: 0, zoomFactor: 2 }),
    { tabs: [{ url: null, pinned: false }], activeIndex: 0, zoomFactor: 2, zoomFactors: [2] },
  );
});

test('AETHER preferences default safely, validate values, and persist without replacing browser data', (context) => {
  const store = createTemporaryStore(context);
  store.addBookmark({ title: 'Saved', url: 'https://saved.example/' });
  store.addHistory({ title: 'Visited', url: 'https://visited.example/' });
  store.updateDownload({
    id: '123e4567-e89b-12d3-a456-426614174000',
    fileName: 'archive.zip',
    receivedBytes: 100,
    totalBytes: 100,
    state: 'completed',
    error: null,
    updatedAt: 123,
  });
  store.saveSession({
    tabs: [{ url: 'https://tab.example/', pinned: false }],
    activeIndex: 0,
    zoomFactor: 1.2,
    zoomFactors: [1.5],
  });

  assert.deepEqual(store.preferencesSnapshot(), DEFAULT_PREFERENCES);
  assert.deepEqual(safePreferences(null), DEFAULT_PREFERENCES);
  assert.deepEqual(safePreferences({
    homepage: 'file:///etc/passwd',
    startupBehavior: 'launch-shell',
    defaultZoom: 9,
    appearance: 'light',
  }), DEFAULT_PREFERENCES);
  assert.deepEqual(
    safePreferences(undefined, 1.35),
    { ...DEFAULT_PREFERENCES, defaultZoom: 1.35 },
  );
  assert.throws(() => store.updatePreferences({ homepage: 'https://outside.example/' }), /invalid/);
  assert.throws(() => store.updatePreferences({ startupBehavior: 'execute' }), /invalid/);
  assert.throws(() => store.updatePreferences({ defaultZoom: 2.1 }), /invalid/);
  assert.throws(() => store.updatePreferences({ appearance: 'light' }), /invalid/);
  assert.throws(() => store.updatePreferences({ secret: 'value' }), /unsupported/);

  store.updatePreferences({ startupBehavior: 'start-page' });
  store.updatePreferences({ defaultZoom: 1.4 });
  const reopened = new AetherStore(path.dirname(store.filePath));
  assert.deepEqual(reopened.preferencesSnapshot(), {
    ...DEFAULT_PREFERENCES,
    startupBehavior: 'start-page',
    defaultZoom: 1.4,
  });
  assert.deepEqual(reopened.snapshot().bookmarks, store.snapshot().bookmarks);
  assert.deepEqual(reopened.snapshot().history, store.snapshot().history);
  assert.deepEqual(reopened.downloadsSnapshot(), store.downloadsSnapshot());
  assert.deepEqual(reopened.sessionSnapshot().zoomFactors, [1.5]);
});

test('AETHER safely normalizes malformed and legacy persisted preferences', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'parmar-aether-preferences-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const statePath = path.join(directory, 'aether-state.json');
  fs.writeFileSync(statePath, JSON.stringify({
    version: 1,
    bookmarks: [],
    history: [],
    session: { tabs: [null], activeIndex: 0, zoomFactor: 1.25 },
    preferences: {
      homepage: 'javascript:alert(1)',
      startupBehavior: 'invalid',
      defaultZoom: '1.8',
      appearance: 'neon',
      path: '/private/path',
    },
  }));
  const store = new AetherStore(directory);
  assert.deepEqual(store.preferencesSnapshot(), DEFAULT_PREFERENCES);
  const persisted = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.deepEqual(persisted.preferences, DEFAULT_PREFERENCES);
  assert.equal(Object.hasOwn(persisted.preferences, 'path'), false);

  fs.writeFileSync(statePath, JSON.stringify({
    version: 1,
    bookmarks: [],
    history: [],
    session: { tabs: [null], activeIndex: 0, zoomFactor: 1.25 },
  }));
  assert.deepEqual(new AetherStore(directory).preferencesSnapshot(), {
    ...DEFAULT_PREFERENCES,
    defaultZoom: 1.25,
  });
});

test('clearing download history removes metadata only and preserves active downloads', (context) => {
  const store = createTemporaryStore(context);
  const base = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    fileName: 'report.pdf',
    receivedBytes: 10,
    totalBytes: 100,
    error: null,
    updatedAt: 123,
  };
  store.updateDownload({ ...base, state: 'completed' });
  store.updateDownload({
    ...base,
    id: '123e4567-e89b-12d3-a456-426614174001',
    state: 'downloading',
  });
  assert.deepEqual(
    store.clearDownloadHistory().map(({ state }) => state),
    ['downloading'],
  );
  assert.equal(new AetherStore(path.dirname(store.filePath)).downloadsSnapshot()[0].state, 'interrupted');
});

test('AETHER rejects malformed persisted tab sessions and retains legacy state compatibility', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'parmar-aether-session-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const statePath = path.join(directory, 'aether-state.json');
  fs.writeFileSync(statePath, JSON.stringify({
    version: 1,
    bookmarks: [],
    history: [],
    session: { tabs: ['http://example.com/'], activeIndex: 0 },
  }));
  assert.throws(() => new AetherStore(directory), /session state is invalid/);

  fs.writeFileSync(statePath, JSON.stringify({ version: 1, bookmarks: [], history: [] }));
  assert.deepEqual(new AetherStore(directory).sessionSnapshot(), {
    tabs: [],
    activeIndex: 0,
    zoomFactor: 1,
    zoomFactors: [],
  });

  fs.writeFileSync(statePath, JSON.stringify({
    version: 1,
    bookmarks: [],
    history: [],
    session: { tabs: ['https://example.com/'], activeIndex: 0 },
  }));
  assert.deepEqual(new AetherStore(directory).sessionSnapshot(), {
    tabs: [{ url: 'https://example.com/', pinned: false }],
    activeIndex: 0,
    zoomFactor: 1,
    zoomFactors: [1],
  });

  fs.writeFileSync(statePath, JSON.stringify({
    version: 1,
    bookmarks: [],
    history: [],
    session: { tabs: ['https://example.com/'], activeIndex: 0, zoomFactor: 'not-a-number' },
  }));
  assert.deepEqual(new AetherStore(directory).sessionSnapshot(), {
    tabs: [{ url: 'https://example.com/', pinned: false }],
    activeIndex: 0,
    zoomFactor: 1,
    zoomFactors: [1],
  });
});

test('failed AETHER persistence does not report or expose an uncommitted in-memory mutation', (context) => {
  const store = createTemporaryStore(context);
  store.addBookmark({ title: 'Saved', url: 'https://saved.example/' });
  const previousSnapshot = store.snapshot();
  fs.rmSync(store.filePath);
  fs.mkdirSync(store.filePath);

  assert.throws(
    () => store.addBookmark({ title: 'Not saved', url: 'https://not-saved.example/' }),
    /could not be saved/,
  );
  assert.deepEqual(store.snapshot(), previousSnapshot);
});

test('failed AETHER rename preserves in-memory state, removes its temp file, and allows recovery', (context) => {
  const store = createTemporaryStore(context);
  store.addBookmark({ title: 'Saved', url: 'https://saved.example/' });
  const previousSnapshot = store.snapshot();
  const renameSync = fs.renameSync;
  let temporaryPath;
  fs.renameSync = (source, destination) => {
    temporaryPath = source;
    if (destination === store.filePath) {
      const error = new Error('Controlled rename failure.');
      error.code = 'EIO';
      throw error;
    }
    return renameSync(source, destination);
  };

  try {
    assert.throws(
      () => store.addBookmark({ title: 'Not saved', url: 'https://not-saved.example/' }),
      /could not be saved/,
    );
  } finally {
    fs.renameSync = renameSync;
  }

  assert.deepEqual(store.snapshot(), previousSnapshot);
  assert.equal(fs.existsSync(temporaryPath), false);
  store.addBookmark({ title: 'Recovered', url: 'https://recovered.example/' });
  assert.equal(new AetherStore(path.dirname(store.filePath)).snapshot().bookmarks.length, 2);
});

test('AETHER does not remove an existing file when exclusive temp creation collides', (context) => {
  const store = createTemporaryStore(context);
  const previousSnapshot = store.snapshot();
  const openSync = fs.openSync;
  const writeFileSync = fs.writeFileSync;
  let collisionPath;
  let collisionCreated = false;
  fs.openSync = (filename, flags, ...arguments_) => {
    if (!collisionCreated && typeof filename === 'string' && filename.endsWith('.tmp')) {
      collisionCreated = true;
      collisionPath = filename;
      writeFileSync(filename, 'pre-existing data', { flag: 'wx', mode: 0o600 });
    }
    return openSync(filename, flags, ...arguments_);
  };

  try {
    assert.throws(
      () => store.addBookmark({ title: 'Not saved', url: 'https://not-saved.example/' }),
      /could not be saved/,
    );
  } finally {
    fs.openSync = openSync;
  }

  assert.deepEqual(store.snapshot(), previousSnapshot);
  assert.equal(fs.readFileSync(collisionPath, 'utf8'), 'pre-existing data');
  fs.rmSync(collisionPath);
});

test('failed bookmark-title persistence leaves the prior title intact', (context) => {
  const store = createTemporaryStore(context);
  store.addBookmark({ title: 'Saved', url: 'https://saved.example/' });
  const previousSnapshot = store.snapshot();
  fs.rmSync(store.filePath);
  fs.mkdirSync(store.filePath);

  assert.throws(
    () => store.updateBookmark('https://saved.example/', 'Unsaved title'),
    /could not be saved/,
  );
  assert.deepEqual(store.snapshot(), previousSnapshot);
});
