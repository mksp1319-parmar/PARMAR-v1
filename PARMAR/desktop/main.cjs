'use strict';

const { app, BrowserWindow, WebContentsView, ipcMain, Menu, session } = require('electron');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { AetherStore } = require('./store.cjs');
const { createBrowserChildSupervisor } = require('./browser-child-supervisor.cjs');
const { startBrowserChildBroker } = require('./browser-child-broker.cjs');
const { verifyCurrentIsolation } = require('./isolation-probe.cjs');
const {
  MAX_ADDRESS_LENGTH,
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
const BRAND_EMBLEM_PATH = path.resolve(__dirname, '../interface/static/assets/parmar-emblem.png');
const MAX_TABS = 16;
const DEFAULT_VIEW_TOP = 184;
const APP_USER_DATA = app.getPath('userData');
const IS_BROWSER_CHILD = process.platform === 'linux'
  && process.argv.includes('--aether-browser-child');
if (IS_BROWSER_CHILD) {
  app.setName('PARMAR AETHER Browser');
  app.setPath('userData', path.join(APP_USER_DATA, 'aether-browser-profile'));
}
const tabs = new Map();
let controlWindow = null;
let browserWindow = null;
let browserWindowReady = null;
let activeTabId = null;
let browserSession = null;
let browserSessionPolicyInstalled = false;
let aetherStore = null;
let browserChildBroker = null;
const browserChildSupervisor = process.platform === 'linux' && !IS_BROWSER_CHILD
  ? createBrowserChildSupervisor({
    executablePath: process.execPath,
    appPath: app.getAppPath(),
  })
  : null;
const hasSingleInstanceLock = app.requestSingleInstanceLock();

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
    && event.senderFrame?.parent === null
    && event.senderFrame.url === pathToFileURL(BROWSER_HTML).href);
}

function isControlShellSender(event) {
  return Boolean(controlWindow && event.sender === controlWindow.webContents
    && event.senderFrame?.parent === null
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

function browserStatusPayload() {
  const brandEmblemPath = app.isPackaged
    ? path.join(process.resourcesPath, 'aether', 'parmar-emblem.png')
    : BRAND_EMBLEM_PATH;
  return {
    ...statusPayload(),
    brandEmblemUrl: pathToFileURL(brandEmblemPath).href,
  };
}

function publicTab(tab) {
  return {
    id: tab.id,
    title: tab.title,
    url: tab.url,
    restoreUrl: tab.restoreUrl,
    error: tab.error,
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
    ...browserStatusPayload(),
    activeTabId,
    tabs: [...tabs.values()].map(publicTab),
    stored: aetherStore ? aetherStore.snapshot() : { bookmarks: [], history: [] },
  });
}

function persistTabSession() {
  if (!aetherStore) return;
  const tabIds = [...tabs.keys()];
  try {
    aetherStore.saveSession({
      tabs: tabIds.map((id) => {
        const tab = tabs.get(id);
        return tab?.url || tab?.restoreUrl || null;
      }),
      activeIndex: Math.max(0, tabIds.indexOf(activeTabId)),
    });
  } catch (error) {
    notifyNavigationError(errorMessage(error));
  }
}

function setActiveTab(tabId, { persist = true } = {}) {
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
  if (persist) persistTabSession();
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

function setTabError(tab, message) {
  if (tabs.get(tab.id) !== tab) return;
  tab.error = message;
  sendBrowserState();
}

function safeTabUrl(value) {
  if (typeof value !== 'string') return null;
  if (value === pathToFileURL(NEW_TAB_HTML).href) return '';
  if (value.length > MAX_ADDRESS_LENGTH) return null;
  try {
    const target = new URL(value);
    if (target.protocol !== 'https:' || target.username || target.password) return null;
    return target.href;
  } catch {
    return null;
  }
}

function openAllowedExternal(url, tab) {
  if (!REMOTE_BROWSING_ENABLED) {
    setTabError(tab, statusPayload().reason);
    return false;
  }
  const policy = navigationPolicy(url);
  if (!policy.allowed) {
    setTabError(tab, policy.reason);
    return false;
  }
  return true;
}

function createTab({ restoreUrl = null, persist = true } = {}) {
  if (!browserWindow || browserWindow.isDestroyed()) throw new Error('AETHER browser window is unavailable.');
  if (tabs.size >= MAX_TABS) throw new Error(`AETHER supports at most ${MAX_TABS} tabs.`);

  const safeRestoreUrl = restoreUrl === null ? null : safeTabUrl(restoreUrl);
  if (restoreUrl !== null && !safeRestoreUrl) {
    throw new TypeError('The restored AETHER tab address is invalid.');
  }
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
  const tab = {
    id,
    view,
    title: 'New Tab',
    url: '',
    restoreUrl: safeRestoreUrl,
    error: null,
    lastBounds: null,
  };
  tabs.set(id, tab);

  const contents = view.webContents;
  contents.on('before-input-event', (event, input) => {
    handleBrowserKeyInput(event, input, tab);
  });
  contents.setWindowOpenHandler(({ url }) => {
    openAllowedExternal(url, tab);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (url === pathToFileURL(NEW_TAB_HTML).href) return;
    if (!openAllowedExternal(url, tab)) event.preventDefault();
  });
  contents.on('will-redirect', (event, url) => {
    if (!openAllowedExternal(url, tab)) event.preventDefault();
  });
  contents.on('page-title-updated', (_event, title) => {
    if (tabs.get(tab.id) !== tab) return;
    tab.title = String(title).slice(0, 300) || 'New Tab';
    if (tab.url && navigationPolicy(tab.url).allowed && aetherStore) {
      try {
        aetherStore.updateHistoryTitle(tab.url, tab.title);
      } catch (error) {
        setTabError(tab, errorMessage(error));
        return;
      }
    }
    sendBrowserState();
  });
  contents.on('did-redirect-navigation', (_event, url, _isInPlace, isMainFrame) => {
    if (!isMainFrame || tabs.get(tab.id) !== tab) return;
    const safeUrl = safeTabUrl(url);
    if (safeUrl === null) return;
    tab.url = safeUrl;
    if (safeUrl) tab.restoreUrl = null;
    sendBrowserState();
    persistTabSession();
  });
  contents.on('did-start-loading', () => {
    if (tabs.get(tab.id) !== tab) return;
    tab.error = null;
    sendBrowserState();
  });
  contents.on('did-stop-loading', () => {
    if (tabs.get(tab.id) === tab) sendBrowserState();
  });
  contents.on('did-navigate', (_event, url) => {
    if (tabs.get(tab.id) !== tab) return;
    const safeUrl = safeTabUrl(url);
    if (safeUrl === null) return;
    tab.url = safeUrl;
    if (safeUrl) tab.restoreUrl = null;
    if (!tab.url) {
      tab.title = 'New Tab';
    } else {
      try {
        tab.title = new URL(url).hostname || url;
      } catch {
        tab.title = url;
      }
    }
    tab.error = null;
    const policy = navigationPolicy(safeUrl);
    if (policy.allowed && aetherStore) {
      try {
        aetherStore.addHistory({ title: tab.title, url: safeUrl, visitedAt: Date.now() });
      } catch (error) {
        setTabError(tab, errorMessage(error));
      }
    }
    sendBrowserState();
    persistTabSession();
  });
  contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (!isMainFrame || tabs.get(tab.id) !== tab) return;
    const safeUrl = safeTabUrl(url);
    if (safeUrl === null) return;
    tab.url = safeUrl;
    tab.restoreUrl = null;
    tab.error = null;
    if (navigationPolicy(safeUrl).allowed && aetherStore) {
      try {
        aetherStore.addHistory({ title: tab.title, url: safeUrl, visitedAt: Date.now() });
      } catch (error) {
        setTabError(tab, errorMessage(error));
        return;
      }
    }
    sendBrowserState();
    persistTabSession();
  });
  contents.on('did-fail-load', (_event, errorCode, description, validatedURL, isMainFrame) => {
    if (isMainFrame && errorCode !== -3 && tabs.get(tab.id) === tab) {
      setTabError(tab, `Navigation failed: ${description}`);
    }
  });
  contents.on('render-process-gone', (_event, details) => {
    setTabError(tab, `Browser renderer stopped (${details.reason}). Close this tab and try again.`);
  });

  contents.loadFile(NEW_TAB_HTML).catch((error) => setTabError(tab, errorMessage(error)));
  setActiveTab(id, { persist });
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
    persistTabSession();
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

async function startBrowserChildRuntime() {
  verifyCurrentIsolation();
  browserChildBroker = startBrowserChildBroker({
    onStop: () => app.quit(),
    onFocus: () => {
      if (browserWindow && !browserWindow.isDestroyed()) browserWindow.focus();
    },
    onNewTab: () => {
      if (browserWindow && !browserWindow.isDestroyed()) createTab();
    },
    onCloseTab: () => {
      if (activeTabId) closeTab(activeTabId);
    },
    onFailure: (error) => {
      console.error(`AETHER browser parent connection failed: ${errorMessage(error)}`);
      try {
        process.kill(-process.pid, 'SIGKILL');
      } catch (killError) {
        if (killError.code !== 'ESRCH') {
          console.error(`AETHER browser descendant cleanup failed: ${errorMessage(killError)}`);
        }
        app.exit(1);
      }
    },
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
  registerHandler('aether:navigate', async (value, id) => {
    const result = resolveAddressInput(value);
    if (!result.ok) return { ok: false, error: result.reason };
    const tab = tabs.get(id);
    if (!tab || id !== activeTabId) {
      return { ok: false, error: 'The active tab changed. Try again.' };
    }

    const policy = navigationPolicy(result.url);
    if (!policy.allowed) return { ok: false, error: policy.reason };
    try {
      await tab.view.webContents.loadURL(result.url);
    } catch (error) {
      const message = errorMessage(error);
      setTabError(tab, message);
      return { ok: false, error: message };
    }
    return { ok: true };
  });
  for (const [channel, direction] of [
    ['aether:back', 'back'],
    ['aether:forward', 'forward'],
  ]) {
    registerHandler(channel, async (id) => {
      const tab = tabs.get(id);
      if (!tab || id !== activeTabId) {
        return { ok: false, error: 'The active tab changed. Try again.' };
      }
      const contents = tab.view.webContents;
      const canTraverse = direction === 'back' ? contents.canGoBack() : contents.canGoForward();
      if (!canTraverse) {
        return {
          ok: false,
          error: direction === 'back'
            ? 'There is no previous page in this tab.'
            : 'There is no next page in this tab.',
        };
      }
      if (direction === 'back') contents.goBack();
      else contents.goForward();
      return { ok: true };
    });
  }
  for (const [channel, action] of [
    ['aether:reload', (contents) => contents.reload()],
    ['aether:stop', (contents) => contents.stop()],
  ]) {
    registerHandler(channel, async (id) => {
      const tab = tabs.get(id);
      if (!tab || id !== activeTabId) {
        return { ok: false, error: 'The active tab changed. Try again.' };
      }
      if (channel === 'aether:stop' && !tab.view.webContents.isLoading()) {
        return { ok: false, error: 'This tab is not loading.' };
      }
      action(tab.view.webContents);
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
  registerHandler('aether:remove-history', async (url) => ({
    ok: true,
    data: aetherStore.removeHistory(url).history,
  }));
  registerHandler('aether:zoom', async (factor, id) => {
    if (typeof factor !== 'number' || !Number.isFinite(factor) || factor < 0.5 || factor > 2) {
      throw new TypeError('Zoom must be between 50% and 200%.');
    }
    const tab = tabs.get(id);
    if (!tab || id !== activeTabId) {
      return { ok: false, error: 'The active tab changed. Try again.' };
    }
    tab.view.webContents.setZoomFactor(factor);
    sendBrowserState();
    return { ok: true, factor };
  });
}

function installBrowserSessionPolicy() {
  if (browserSessionPolicyInstalled) return;
  browserSession = session.fromPartition('persist:parmar-aether-browser-v1');
  browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  browserSession.setPermissionCheckHandler(() => false);
  browserSession.on('will-download', (event, _item, webContents) => {
    event.preventDefault();
    const message = 'Downloads are disabled while remote browsing is restricted.';
    const tab = [...tabs.values()].find((entry) => entry.view.webContents === webContents);
    if (tab) setTabError(tab, message);
    else notifyNavigationError(message);
  });
  browserSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (_details, callback) => callback({ cancel: true }),
  );
  browserSessionPolicyInstalled = true;
}

async function createBrowserWindow({ newTab = false } = {}) {
  if (browserChildSupervisor) {
    if (browserChildSupervisor.state === 'ready') {
      if (newTab) browserChildSupervisor.newTab();
      else browserChildSupervisor.focus();
      return;
    }
    await browserChildSupervisor.start();
    if (newTab) browserChildSupervisor.newTab();
    return;
  }
  if (browserWindow && !browserWindow.isDestroyed()) {
    if (newTab) {
      createTab();
      return;
    }
    browserWindow.focus();
    if (browserWindowReady) await browserWindowReady;
    return;
  }
  installBrowserSessionPolicy();
  aetherStore = new AetherStore(app.getPath('userData'));
  const savedSession = aetherStore.sessionSnapshot();
  const createdWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 360,
    minHeight: 480,
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
  browserWindow = createdWindow;
  createdWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  createdWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`AETHER browser chrome renderer stopped (${details.reason}).`);
    if (!createdWindow.isDestroyed()) createdWindow.close();
  });
  createdWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== pathToFileURL(BROWSER_HTML).href) event.preventDefault();
  });
  createdWindow.on('resize', () => updateActiveTabBounds());
  createdWindow.on('closed', () => {
    for (const tab of tabs.values()) {
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    }
    tabs.clear();
    activeTabId = null;
    if (browserWindow === createdWindow) {
      browserWindow = null;
      browserWindowReady = null;
      aetherStore = null;
    }
  });
  const ready = (async () => {
    try {
      await createdWindow.loadFile(BROWSER_HTML);
      if (createdWindow.isDestroyed()) {
        throw new Error('AETHER browser window closed during startup.');
      }
      createdWindow.show();
      if (savedSession.tabs.length) {
        const restoredIds = savedSession.tabs.map((restoreUrl) => (
          createTab({ restoreUrl, persist: false })
        ));
        setActiveTab(restoredIds[savedSession.activeIndex] || restoredIds[0], { persist: false });
        persistTabSession();
      } else {
        createTab();
      }
    } catch (error) {
      if (!createdWindow.isDestroyed()) createdWindow.close();
      throw error;
    }
  })();
  browserWindowReady = ready;
  try {
    await ready;
  } finally {
    if (browserWindowReady === ready) browserWindowReady = null;
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
      console.error(
        `Rejected AETHER open request from an untrusted control frame: ${event.senderFrame?.url || 'unknown URL'}.`,
      );
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
          createBrowserWindow({ newTab: true }).catch((error) => {
            console.error(`AETHER browser launch failed: ${errorMessage(error)}`);
          });
        },
      },
      {
        label: 'Close Tab',
        click: () => {
          if (browserChildSupervisor) {
            if (browserChildSupervisor.state === 'ready') browserChildSupervisor.closeTab();
          } else if (activeTabId) {
            closeTab(activeTabId);
          }
        },
      },
      { type: 'separator' },
      { label: 'Quit PARMAR', role: 'quit' },
    ],
  }];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.whenReady().then(async () => {
    installBrowserMenu();
    if (IS_BROWSER_CHILD) {
      await startBrowserChildRuntime();
      registerBrowserHandlers();
      await createBrowserWindow();
      browserChildBroker.sendStatus();
      app.on('before-quit', () => browserChildBroker?.close());
    } else {
      if (!browserChildSupervisor) registerBrowserHandlers();
      registerControlHandlers();
      await createControlWindow();
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createControlWindow();
      });
    }
  }).catch((error) => {
    console.error(`PARMAR AETHER could not start: ${errorMessage(error)}`);
    if (IS_BROWSER_CHILD) app.exit(1);
    else app.quit();
  });

  if (!IS_BROWSER_CHILD && browserChildSupervisor) {
    let shutdownStarted = false;
    app.on('before-quit', (event) => {
      if (shutdownStarted) return;
      event.preventDefault();
      shutdownStarted = true;
      browserChildSupervisor.stop().then((result) => {
        if (result?.cleanupError) {
          console.error(`AETHER browser cleanup failed: ${result.cleanupError}`);
          app.exit(1);
          return;
        }
        app.quit();
      }).catch((error) => {
        console.error(`AETHER browser shutdown failed: ${errorMessage(error)}`);
        app.exit(1);
      });
    });
    process.on('SIGTERM', () => app.quit());
    process.on('SIGINT', () => app.quit());
    browserChildSupervisor.on('stderr', (message) => {
      console.error(`AETHER browser child: ${message.trim()}`);
    });
    browserChildSupervisor.on('protocol-error', (error) => {
      console.error(`AETHER browser child IPC failed: ${errorMessage(error)}`);
    });
    browserChildSupervisor.on('exit', ({ code, signal, cleanupError }) => {
      if (cleanupError) {
        console.error(`AETHER browser descendant cleanup failed: ${cleanupError}`);
      }
      if (code !== 0 && code !== null) {
        console.error(`AETHER browser child exited with status ${code}${signal ? ` (${signal})` : ''}.`);
      }
    });
    browserChildSupervisor.on('cleanup-error', (error) => {
      console.error(`AETHER browser descendant cleanup failed: ${errorMessage(error)}`);
    });
    browserChildSupervisor.on('recovery-error', (error) => {
      console.error(`AETHER browser recovery failed: ${errorMessage(error)}`);
    });
  }

  if (!IS_BROWSER_CHILD) {
    app.on('second-instance', () => {
      if (!controlWindow || controlWindow.isDestroyed()) return;
      if (controlWindow.isMinimized()) controlWindow.restore();
      controlWindow.focus();
    });
  }
  app.on('window-all-closed', () => app.quit());
}
