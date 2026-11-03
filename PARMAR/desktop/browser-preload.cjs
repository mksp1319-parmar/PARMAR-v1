'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const TAB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROFILE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ADDRESS_LENGTH = 2048;

function validTabId(id) {
  return typeof id === 'string' && TAB_ID_PATTERN.test(id);
}

function validProfileId(id) {
  return id === 'default' || (typeof id === 'string' && PROFILE_ID_PATTERN.test(id));
}

function validHttpsUrl(url) {
  if (typeof url !== 'string' || url.length > MAX_ADDRESS_LENGTH) return false;
  try {
    const target = new URL(url);
    return target.protocol === 'https:' && !target.username && !target.password;
  } catch {
    return false;
  }
}

function validBookmark(url, title, updatedUrl = url) {
  return validHttpsUrl(url)
    && validHttpsUrl(updatedUrl)
    && typeof title === 'string'
    && Boolean(title.trim())
    && title.length <= 300;
}

function validPreference(name, value) {
  if (name === 'homepage') return value === 'aether-start';
  if (name === 'startupBehavior') {
    return value === 'restore-session' || value === 'start-page';
  }
  if (name === 'defaultZoom') {
    return Number.isFinite(value) && value >= 0.5 && value <= 2;
  }
  if (name === 'appearance') return value === 'dark';
  return false;
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
  reopenClosedTab: () => invoke('aether:reopen-closed-tab'),
  home: (id) => validTabId(id)
    ? invoke('aether:home', id)
    : Promise.resolve({ ok: false, error: 'Invalid tab.' }),
  cancelDownload: (id) => validTabId(id)
    ? invoke('aether:cancel-download', id)
    : Promise.resolve({ ok: false, error: 'Invalid download.' }),
  activateTab: (id) => validTabId(id) ? invoke('aether:activate-tab', id) : Promise.resolve({ ok: false, error: 'Invalid tab.' }),
  closeTab: (id) => validTabId(id) ? invoke('aether:close-tab', id) : Promise.resolve({ ok: false, error: 'Invalid tab.' }),
  showTabManagementMenu: (id) => validTabId(id)
    ? invoke('aether:tab-management-menu', id)
    : Promise.resolve({ ok: false, error: 'Invalid tab.' }),
  reorderTabs: (ids) => Array.isArray(ids)
    && ids.length <= 16
    && ids.every(validTabId)
    && new Set(ids).size === ids.length
    ? invoke('aether:reorder-tabs', ids)
    : Promise.resolve({ ok: false, error: 'Invalid tab order.' }),
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
  addBookmark: (id) => validTabId(id)
    ? invoke('aether:add-bookmark', id)
    : Promise.resolve({ ok: false, error: 'Invalid tab.' }),
  updateBookmark: (url, title, updatedUrl = url) => validBookmark(url, title, updatedUrl)
    ? invoke('aether:update-bookmark', url, title, updatedUrl)
    : Promise.resolve({ ok: false, error: 'Invalid bookmark.' }),
  removeBookmark: (url) => validHttpsUrl(url)
    ? invoke('aether:remove-bookmark', url)
    : Promise.resolve({ ok: false, error: 'Invalid bookmark.' }),
  removeHistory: (url) => validHttpsUrl(url)
    ? invoke('aether:remove-history', url)
    : Promise.resolve({ ok: false, error: 'Invalid history entry.' }),
  clearHistory: () => invoke('aether:clear-history'),
  updatePreference: (name, value) => validPreference(name, value)
    ? invoke('aether:update-preference', name, value)
    : Promise.resolve({ ok: false, error: 'Invalid preference.' }),
  resetPreferences: () => invoke('aether:reset-preferences'),
  clearDownloadHistory: () => invoke('aether:clear-download-history'),
  createProfile: (name) => typeof name === 'string' && name.length <= 80
    ? invoke('aether:create-profile', name)
    : Promise.resolve({ ok: false, error: 'Invalid profile name.' }),
  selectProfile: (id) => validProfileId(id)
    ? invoke('aether:select-profile', id)
    : Promise.resolve({ ok: false, error: 'Invalid profile.' }),
  zoom: (factor, id) => Number.isFinite(factor) && factor >= 0.5 && factor <= 2
    && validTabId(id)
    ? invoke('aether:zoom', factor, id)
    : Promise.resolve({ ok: false, error: 'Zoom or active tab is invalid.' }),
  onState: (callback) => subscribe('aether:state', callback),
  onNavigationError: (callback) => subscribe('aether:navigation-error', callback),
  onFocusAddress: (callback) => subscribe('aether:focus-address', callback),
}));
