'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

function loadPreload(filename) {
  const exposed = {};
  const calls = [];
  const listeners = new Map();
  const electron = {
    contextBridge: {
      exposeInMainWorld(name, api) {
        exposed[name] = api;
      },
    },
    ipcRenderer: {
      invoke(channel, ...args) {
        calls.push({ channel, args });
        return Promise.resolve({ ok: true });
      },
      on(channel, listener) {
        listeners.set(channel, listener);
      },
      removeListener(channel) {
        listeners.delete(channel);
      },
    },
  };
  const source = fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
  vm.runInNewContext(source, {
    require: (name) => {
      assert.equal(name, 'electron');
      return electron;
    },
    Object,
    Promise,
    TypeError,
  });
  return { api: exposed.aetherDesktop, calls, listeners };
}

test('browser preload exposes only the fixed, validated AETHER interface', async () => {
  const { api, calls } = loadPreload('browser-preload.cjs');
  assert.deepEqual(Object.keys(api).sort(), [
    'activateTab', 'addBookmark', 'back', 'clearHistory', 'closeTab',
    'createTab', 'forward', 'getBookmarks', 'getHistory', 'getStatus',
    'layout', 'navigate', 'onNavigationError', 'onState', 'reload',
    'onFocusAddress', 'removeBookmark', 'stop', 'zoom',
  ].sort());

  await api.navigate('x'.repeat(2049), '123e4567-e89b-12d3-a456-426614174000');
  await api.navigate('https://example.com');
  await api.closeTab('../../unexpected');
  await api.zoom(10);
  assert.equal(calls.length, 0);

  const tabId = '123e4567-e89b-12d3-a456-426614174000';
  await api.navigate('https://example.com', tabId);
  await api.reload('../../stale');
  await api.stop(undefined);
  await api.zoom(1, '../../stale');
  assert.deepEqual(calls[0], {
    channel: 'aether:navigate',
    args: ['https://example.com', tabId],
  });
  assert.equal(calls.length, 1);

  await api.reload(tabId);
  await api.stop(tabId);
  await api.zoom(1.2, tabId);
  assert.deepEqual(calls.slice(1), [
    { channel: 'aether:reload', args: [tabId] },
    { channel: 'aether:stop', args: [tabId] },
    { channel: 'aether:zoom', args: [1.2, tabId] },
  ]);
});

test('preload event subscriptions can be removed and have no generic IPC method', () => {
  const { api, calls, listeners } = loadPreload('browser-preload.cjs');
  let received;
  const unsubscribe = api.onState((state) => { received = state; });
  listeners.get('aether:state')({}, { state: 'restricted' });
  assert.deepEqual(received, { state: 'restricted' });
  unsubscribe();
  assert.equal(listeners.has('aether:state'), false);
  assert.equal(Object.hasOwn(api, 'send'), false);
  assert.equal(calls.length, 0);
});

test('history traversal IPC requires a valid tab ID and forwards it for main-process freshness checks', async () => {
  const { api, calls } = loadPreload('browser-preload.cjs');
  const tabId = '123e4567-e89b-12d3-a456-426614174000';

  await api.back('../../closed-tab');
  await api.forward(null);
  assert.equal(calls.length, 0);

  await api.back(tabId);
  await api.forward(tabId);
  assert.deepEqual(calls, [
    { channel: 'aether:back', args: [tabId] },
    { channel: 'aether:forward', args: [tabId] },
  ]);
});
