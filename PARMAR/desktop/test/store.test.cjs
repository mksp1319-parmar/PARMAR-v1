'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { AetherStore, safeSession, safeWebRecord } = require('../store.cjs');

function createTemporaryStore(context) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'parmar-aether-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return new AetherStore(directory);
}

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
  });

  const reopened = new AetherStore(path.dirname(store.filePath));
  assert.deepEqual(reopened.sessionSnapshot(), {
    tabs: ['https://example.com/path', null],
    activeIndex: 1,
  });
  assert.equal(reopened.snapshot().history.length, 0);
  assert.deepEqual(safeSession({ tabs: ['https://user:secret@example.com/'], activeIndex: 0 }), null);
  assert.deepEqual(safeSession({ tabs: ['file:///etc/passwd'], activeIndex: 0 }), null);
  assert.deepEqual(safeSession({ tabs: ['https://example.com/'], activeIndex: 1 }), null);
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
  assert.deepEqual(new AetherStore(directory).sessionSnapshot(), { tabs: [], activeIndex: 0 });
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
