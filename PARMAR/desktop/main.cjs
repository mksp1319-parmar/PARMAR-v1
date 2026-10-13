'use strict';

const { app, BrowserWindow, WebContentsView, ipcMain, Menu, session } = require('electron');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { AetherStore } = require('./store.cjs');
const {
  REMOTE_BROWSING_ENABLED,
  isTrustedControlUrl,
  navigationPolicy,
  resolveAddressInput,
  validatedControlUrl,
} = require('./security.cjs');

const CONTROL_URL = process.env.PARMAR_DESKTOP_BACKEND_URL || 'http://127.0.0.1:8080';
const CONTROL_PRELOAD = path.join(__dirname, 'control-preload.cjs');
const BROWSER_PRELOAD = path.join(__dirname, 'browser-preload.cjs');
const BROWSER_HTML = path.join(__dirname, 'browser.html');
const NEW_TAB_HTML = path.join(__dirname, 'newtab.html');
const CONTROL_UNAVAILABLE_HTML = path.join(__dirname, 'control-unavailable.html');
const MAX_TABS = 16;
const DEFAULT_VIEW_TOP = 184;
const tabs = new Map();
const hasSingleInstanceLock = app.requestSingleInstanceLock();
let controlWindow = null;
let browserWindow = null;
let activeTabId = null;
let browserSession = null;
let browserSessionPolicyInstalled = false;
let aetherStore = null;

function errorMessage(error) {
  return error instanceof Error ? error.message : 'The AETHER operation failed.';
}

function controlPageUrl() {
  const origin = validatedControlUrl(CONTROL_URL);
  return new URL('/', origin).href;
}

function controlPageIsTrusted(url) {
  return isTrustedControlUrl(url, CONTROL_URL);
}

function isBrowserShellSender(event) {
  return Boolean(browserWindow && !browserWindow.isDestroyed()
    && event.sender === browserWindow.webContents
    && event.senderFrame?.isMainFrame
    && event.senderFrame.url === pathToFileURL(BROWSER_HTML).href);
}

function isControlShellSender(event) {
  return Boolean(controlWindow && event.sender === controlWindow.webContents
    && event.senderFrame?.isMainFrame
    && (
      controlPageIsTrusted(event.senderFrame.url)
      || event.senderFrame.url === pathToFileURL(CONTROL_UNAVAILABLE_HTML).href
    ));
}

function statusPayload() {
  return {
    shell: 'available',
    remoteBrowsing: REMOTE_BROWSING_ENABLED,
    state: REMOTE_BROWSING_ENABLED ? 'starting' : 'restricted',
    reason: REMOTE_BROWSING_ENABLED
      ? null
      : 'Remote browsing is disabled because this installation has no verified operating-system network boundary.',
  };
}

function publicTab(tab) {
  return {
    id: tab.id,
    title: tab.title,
    url: tab.url,
    zoomFactor: tab.view.webContents.getZoomFactor(),
    active: tab.id === activeTabId,
    canGoBack: tab.view.webContents.canGoBack(),
    canGoForward: tab.view.webContents.canGoForward(),
    isLoading: tab.view.webContents.isLoading(),
  };
}

function sendBrowserState() {
  if (!browserWindow || browserWindow.isDestroyed()) return;
  browserWindow.webContents.send('aether:state', {
    ...statusPayload(),
    activeTabId,
    tabs: [...tabs.values()].map(publicTab),
    stored: aetherStore ? aetherStore.snapshot() : { bookmarks: [], history: [] },
  });
}

function setActiveTab(tabId) {
  const selected = tabs.get(tabId);
  if (!selected || !browserWindow || browserWindow.isDestroyed()) return false;
  if (activeTabId) {
    const previous = tabs.get(activeTabId);
    if (previous) browserWindow.contentView.removeChildView(previous.view);
  }
  activeTabId = tabId;
  browserWindow.contentView.addChildView(selected.view);
  selected.view.webContents.focus();
  updateActiveTabBounds();
  sendBrowserState();
  return true;
}

function updateActiveTabBounds(bounds) {
  if (!browserWindow || browserWindow.isDestroyed() || !activeTabId) return;
  const tab = tabs.get(activeTabId);
  if (!tab) return;
  const contentSize = browserWindow.getContentSize();
  const candidate = bounds || tab.lastBounds || {
    x: 0,
    y: DEFAULT_VIEW_TOP,
    width: contentSize[0],
    height: Math.max(0, contentSize[1] - DEFAULT_VIEW_TOP),
  };
  const values = [candidate.x, candidate.y, candidate.width, candidate.height];
  if (values.some((value) => !Number.isFinite(value))) return;
  const x = Math.max(0, Math.min(Math.round(candidate.x), contentSize[0]));
  const y = Math.max(0, Math.min(Math.round(candidate.y), contentSize[1]));
  const width = Math.max(0, Math.min(Math.round(candidate.width), contentSize[0] - x));
  const height = Math.max(0, Math.min(Math.round(candidate.height), contentSize[1] - y));
  tab.lastBounds = { x, y, width, height };
  tab.view.setBounds(tab.lastBounds);
}

function notifyNavigationError(message) {
  if (browserWindow && !browserWindow.isDestroyed()) {
    browserWindow.webContents.send('aether:navigation-error', message);
  }
}

function openAllowedExternal(url) {
  if (!REMOTE_BROWSING_ENABLED) {
    notifyNavigationError(statusPayload().reason);
    return false;
  }
  const policy = navigationPolicy(url);
  if (!policy.allowed) {
    notifyNavigationError(policy.reason);
    return false;
  }
  return true;
}

function createTab() {
  if (!browserWindow || browserWindow.isDestroyed()) throw new Error('AETHER browser window is unavailable.');
  if (tabs.size >= MAX_TABS) throw new Error(`AETHER supports at most ${MAX_TABS} tabs.`);

  const id = randomUUID();
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      session: browserSession,
    },
  });
  const tab = { id, view, title: 'New Tab', url: '', lastBounds: null };
  tabs.set(id, tab);

  const contents = view.webContents;
  contents.on('before-input-event', (event, input) => {
    handleBrowserKeyInput(event, input, tab);
  });
  contents.setWindowOpenHandler(({ url }) => {
    openAllowedExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (url === pathToFileURL(NEW_TAB_HTML).href) return;
    if (!openAllowedExternal(url)) event.preventDefault();
  });
  contents.on('will-redirect', (event, url) => {
    if (!openAllowedExternal(url)) event.preventDefault();
  });
  contents.on('page-title-updated', (_event, title) => {
    tab.title = String(title).slice(0, 300) || 'New Tab';
    sendBrowserState();
  });
  contents.on('did-navigate', (_event, url) => {
    tab.url = url === pathToFileURL(NEW_TAB_HTML).href ? '' : url;
    const policy = navigationPolicy(url);
    if (policy.allowed && aetherStore) {
      try {
        aetherStore.addHistory({ title: tab.title, url, visitedAt: Date.now() });
      } catch (error) {
        notifyNavigationError(errorMessage(error));
      }
    }
    sendBrowserState();
  });
  contents.on('did-fail-load', (_event, errorCode, description, validatedURL, isMainFrame) => {
    if (isMainFrame && errorCode !== -3) notifyNavigationError(`Navigation failed: ${description}`);
  });
  contents.on('render-process-gone', (_event, details) => {
    notifyNavigationError(`Browser renderer stopped (${details.reason}). Close this tab and try again.`);
  });

  contents.loadFile(NEW_TAB_HTML).catch((error) => notifyNavigationError(errorMessage(error)));
  setActiveTab(id);
  return id;
}

function closeTab(tabId) {
  if (!tabs.has(tabId)) return false;
  const tab = tabs.get(tabId);
  const wasActive = activeTabId === tabId;
  if (wasActive && browserWindow && !browserWindow.isDestroyed()) {
    browserWindow.contentView.removeChildView(tab.view);
  }
  tabs.delete(tabId);
  tab.view.webContents.close();
  if (tabs.size === 0) {
    createTab();
  } else if (wasActive) {
    setActiveTab([...tabs.keys()].at(-1));
  } else {
    sendBrowserState();
  }
  return true;
}

function activeTab() {
  const tab = tabs.get(activeTabId);
  if (!tab) throw new Error('No AETHER tab is active.');
  return tab;
}

function handleBrowserKeyInput(event, input, tab) {
  if (input.type !== 'keyDown' || tab.id !== activeTabId) return;
  const command = input.control || input.meta;
  const key = input.key.toLowerCase();
  const contents = tab.view.webContents;

  if (command && key === 'tab') {
    event.preventDefault();
    const ids = [...tabs.keys()];
    const current = Math.max(0, ids.indexOf(tab.id));
    const direction = input.shift ? -1 : 1;
    setActiveTab(ids[(current + direction + ids.length) % ids.length]);
  } else if (command && key === 'l') {
    event.preventDefault();
    browserWindow.webContents.send('aether:focus-address');
  } else if (command && key === 't') {
    event.preventDefault();
    createTab();
  } else if (command && key === 'w') {
    event.preventDefault();
    closeTab(tab.id);
  } else if (command && key === 'r') {
    event.preventDefault();
    contents.reload();
  } else if (command && (key === '+' || key === '=')) {
    event.preventDefault();
    contents.setZoomFactor(Math.min(2, contents.getZoomFactor() + 0.1));
  } else if (command && key === '-') {
    event.preventDefault();
    contents.setZoomFactor(Math.max(0.5, contents.getZoomFactor() - 0.1));
  } else if (command && key === '0') {
    event.preventDefault();
    contents.setZoomFactor(1);
  } else if (input.alt && input.key === 'ArrowLeft') {
    event.preventDefault();
    if (contents.canGoBack()) contents.goBack();
  } else if (input.alt && input.key === 'ArrowRight') {
    event.preventDefault();
    if (contents.canGoForward()) contents.goForward();
  } else if (input.key === 'Escape') {
    event.preventDefault();
    if (contents.isLoading()) contents.stop();
  }
}

function registerHandler(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isBrowserShellSender(event)) throw new Error('AETHER request came from an untrusted renderer.');
    try {
      return await handler(...args);
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  });
}

function registerBrowserHandlers() {
  registerHandler('aether:status', async () => statusPayload());
  registerHandler('aether:create-tab', async () => {
    createTab();
    return { ok: true };
  });
  registerHandler('aether:activate-tab', async (id) => ({
    ok: setActiveTab(typeof id === 'string' ? id : ''),
  }));
  registerHandler('aether:close-tab', async (id) => ({
    ok: closeTab(typeof id === 'string' ? id : ''),
  }));
  registerHandler('aether:layout', async (bounds) => {
    if (!bounds || typeof bounds !== 'object') throw new TypeError('AETHER viewport bounds are invalid.');
    updateActiveTabBounds(bounds);
    return { ok: true };
  });
  registerHandler('aether:navigate', async (value) => {
    const result = resolveAddressInput(value);
    if (!result.ok) return result;
    const policy = navigationPolicy(result.url);
    if (!policy.allowed) return { ok: false, error: policy.reason };
    await activeTab().view.webContents.loadURL(result.url);
    return { ok: true };
  });
  for (const [channel, action] of [
    ['aether:back', (contents) => contents.goBack()],
    ['aether:forward', (contents) => contents.goForward()],
    ['aether:reload', (contents) => contents.reload()],
    ['aether:stop', (contents) => contents.stop()],
  ]) {
    registerHandler(channel, async () => {
      action(activeTab().view.webContents);
      return { ok: true };
    });
  }
  registerHandler('aether:bookmarks', async () => ({
    ok: true,
    data: aetherStore.snapshot().bookmarks,
  }));
  registerHandler('aether:add-bookmark', async (record) => ({
    ok: true,
    data: aetherStore.addBookmark(record).bookmarks,
  }));
  registerHandler('aether:remove-bookmark', async (url) => ({
    ok: true,
    data: aetherStore.removeBookmark(url).bookmarks,
  }));
  registerHandler('aether:history', async () => ({
    ok: true,
    data: aetherStore.snapshot().history,
  }));
  registerHandler('aether:clear-history', async () => ({
    ok: true,
    data: aetherStore.clearHistory().history,
  }));
  registerHandler('aether:zoom', async (factor) => {
    if (typeof factor !== 'number' || !Number.isFinite(factor) || factor < 0.5 || factor > 2) {
      throw new TypeError('Zoom must be between 50% and 200%.');
    }
    activeTab().view.webContents.setZoomFactor(factor);
    sendBrowserState();
    return { ok: true, factor };
  });
}

function installBrowserSessionPolicy() {
  if (browserSessionPolicyInstalled) return;
  browserSession = session.fromPartition('persist:parmar-aether-browser-v1');
  browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  browserSession.setPermissionCheckHandler(() => false);
  browserSession.on('will-download', (event) => {
    event.preventDefault();
    notifyNavigationError('Downloads are disabled while remote browsing is restricted.');
  });
  browserSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (_details, callback) => callback({ cancel: true }),
  );
  browserSessionPolicyInstalled = true;
}

async function createBrowserWindow() {
  if (browserWindow && !browserWindow.isDestroyed()) {
    browserWindow.focus();
    return;
  }
  installBrowserSessionPolicy();
  aetherStore = new AetherStore(app.getPath('userData'));
  browserWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 840,
    minHeight: 600,
    title: 'AETHER — PARMAR',
    backgroundColor: '#101014',
    show: false,
    webPreferences: {
      preload: BROWSER_PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  browserWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  browserWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`AETHER browser chrome renderer stopped (${details.reason}).`);
    if (browserWindow && !browserWindow.isDestroyed()) browserWindow.close();
  });
  browserWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== pathToFileURL(BROWSER_HTML).href) event.preventDefault();
  });
  browserWindow.on('resize', () => updateActiveTabBounds());
  browserWindow.on('closed', () => {
    for (const tab of tabs.values()) {
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    }
    tabs.clear();
    activeTabId = null;
    browserWindow = null;
    aetherStore = null;
  });
  try {
    await browserWindow.loadFile(BROWSER_HTML);
    browserWindow.show();
    createTab();
  } catch (error) {
    if (browserWindow && !browserWindow.isDestroyed()) browserWindow.close();
    throw error;
  }
}

function registerControlHandlers() {
  ipcMain.handle('parmar-aether:status', (event) => {
    if (!isControlShellSender(event)) {
      return { shell: 'unavailable', remoteBrowsing: false };
    }
    return statusPayload();
  });
  ipcMain.handle('parmar-aether:open', async (event) => {
    if (!isControlShellSender(event)) {
      return { ok: false, error: 'AETHER can only be opened from PARMAR.' };
    }
    try {
      await createBrowserWindow();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  });
}

async function createControlWindow() {
  const trustedControlUrl = controlPageUrl();
  controlWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 640,
    title: 'PARMAR',
    backgroundColor: '#101014',
    webPreferences: {
      preload: CONTROL_PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  controlWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  controlWindow.webContents.on('will-navigate', (event, url) => {
    if (!controlPageIsTrusted(url)) event.preventDefault();
  });
  controlWindow.webContents.on('will-redirect', (event, url) => {
    if (!controlPageIsTrusted(url)) event.preventDefault();
  });
  controlWindow.on('closed', () => {
    controlWindow = null;
  });
  try {
    await controlWindow.loadURL(trustedControlUrl);
  } catch {
    await controlWindow.loadFile(CONTROL_UNAVAILABLE_HTML);
  }
}

function installBrowserMenu() {
  const template = [{
    label: 'AETHER',
    submenu: [
      {
        label: 'New Tab',
        click: () => {
          if (browserWindow && !browserWindow.isDestroyed()) createTab();
          else createBrowserWindow().catch((error) => console.error(errorMessage(error)));
        },
      },
      { label: 'Close Tab', click: () => activeTabId && closeTab(activeTabId) },
      { type: 'separator' },
      { label: 'Quit PARMAR', role: 'quit' },
    ],
  }];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!controlWindow || controlWindow.isDestroyed()) return;
    if (controlWindow.isMinimized()) controlWindow.restore();
    controlWindow.focus();
  });

  app.whenReady().then(async () => {
    registerBrowserHandlers();
    registerControlHandlers();
    installBrowserMenu();
    await createControlWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createControlWindow();
    });
  }).catch((error) => {
    console.error(`PARMAR AETHER could not start: ${errorMessage(error)}`);
    app.quit();
  });

  app.on('window-all-closed', () => app.quit());
}
