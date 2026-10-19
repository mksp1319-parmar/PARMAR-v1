'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const TAB_ID_PATTERN = /^[0-9a-f-]{36}$/i;
const MAX_ADDRESS_LENGTH = 2048;

function validTabId(id) {
  return typeof id === 'string' && TAB_ID_PATTERN.test(id);
}

function invoke(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args);
}

function subscribe(channel, callback) {
  if (typeof callback !== 'function') throw new TypeError('A listener function is required.');
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('aetherDesktop', Object.freeze({
  getStatus: () => invoke('aether:status'),
  getHistory: () => invoke('aether:history'),
  getBookmarks: () => invoke('aether:bookmarks'),
  createTab: () => invoke('aether:create-tab'),
  activateTab: (id) => validTabId(id) ? invoke('aether:activate-tab', id) : Promise.resolve({ ok: false, error: 'Invalid tab.' }),
  closeTab: (id) => validTabId(id) ? invoke('aether:close-tab', id) : Promise.resolve({ ok: false, error: 'Invalid tab.' }),
  navigate: (value, id) => typeof value === 'string'
    && value.length <= MAX_ADDRESS_LENGTH
    && validTabId(id)
    ? invoke('aether:navigate', value, id)
    : Promise.resolve({ ok: false, error: 'The address or active tab is invalid.' }),
  back: (id) => validTabId(id)
    ? invoke('aether:back', id)
    : Promise.resolve({ ok: false, error: 'The active tab changed. Try again.' }),
  forward: (id) => validTabId(id)
    ? invoke('aether:forward', id)
    : Promise.resolve({ ok: false, error: 'The active tab changed. Try again.' }),
  reload: (id) => validTabId(id)
    ? invoke('aether:reload', id)
    : Promise.resolve({ ok: false, error: 'The active tab changed. Try again.' }),
  stop: (id) => validTabId(id)
    ? invoke('aether:stop', id)
    : Promise.resolve({ ok: false, error: 'The active tab changed. Try again.' }),
  layout: (bounds) => {
    if (
      !bounds
      || typeof bounds !== 'object'
      || ['x', 'y', 'width', 'height'].some((key) => !Number.isFinite(bounds[key]))
    ) return Promise.resolve({ ok: false, error: 'Invalid browser viewport.' });
    return invoke('aether:layout', {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    });
  },
  addBookmark: (record) => {
    if (!record || typeof record !== 'object') {
      return Promise.resolve({ ok: false, error: 'Invalid bookmark.' });
    }
    return invoke('aether:add-bookmark', {
      title: typeof record.title === 'string' ? record.title.slice(0, 300) : '',
      url: typeof record.url === 'string' ? record.url.slice(0, MAX_ADDRESS_LENGTH) : '',
    });
  },
  removeBookmark: (url) => typeof url === 'string' && url.length <= MAX_ADDRESS_LENGTH
    ? invoke('aether:remove-bookmark', url)
    : Promise.resolve({ ok: false, error: 'Invalid bookmark.' }),
  clearHistory: () => invoke('aether:clear-history'),
  zoom: (factor, id) => Number.isFinite(factor) && factor >= 0.5 && factor <= 2
    && validTabId(id)
    ? invoke('aether:zoom', factor, id)
    : Promise.resolve({ ok: false, error: 'Zoom or active tab is invalid.' }),
  onState: (callback) => subscribe('aether:state', callback),
  onNavigationError: (callback) => subscribe('aether:navigation-error', callback),
  onFocusAddress: (callback) => subscribe('aether:focus-address', callback),
}));
