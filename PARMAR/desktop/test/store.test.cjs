'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { AetherStore, safeWebRecord } = require('../store.cjs');

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
  assert.equal(store.clearHistory().history.length, 0);
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
