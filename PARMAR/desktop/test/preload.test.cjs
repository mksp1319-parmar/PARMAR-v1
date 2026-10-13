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

  await api.navigate('x'.repeat(2049));
  await api.closeTab('../../unexpected');
  await api.zoom(10);
  assert.equal(calls.length, 0);

  await api.navigate('https://example.com');
  assert.deepEqual(calls[0], {
    channel: 'aether:navigate',
    args: ['https://example.com'],
  });
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
