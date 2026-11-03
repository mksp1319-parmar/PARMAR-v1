'use strict';

const {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  Menu,
  clipboard,
  dialog,
  session,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { ClosedTabHistory } = require('./closed-tabs.cjs');
const { AetherProfiles } = require('./profiles.cjs');
const { profilePartition } = require('./profile-partitions.cjs');
const {
  safeDownloadDestination,
  safeDownloadRecord,
  sanitizeDownloadFilename,
} = require('./download-utils.cjs');
const {
  AetherStore,
  DEFAULT_ZOOM_FACTOR,
  MIN_ZOOM_FACTOR,
  MAX_ZOOM_FACTOR,
} = require('./store.cjs');
const { createBrowserChildSupervisor } = require('./browser-child-supervisor.cjs');
const { startBrowserChildBroker } = require('./browser-child-broker.cjs');
const { verifyCurrentIsolation } = require('./isolation-probe.cjs');
const {
  permissionDecision,
  privacyStatusPayload,
} = require('./permission-policy.cjs');
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
const DOWNLOAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TAB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTEXT_MENU_WIDTH = 260;
const CONTEXT_MENU_ITEM_HEIGHT = 34;
const CONTEXT_MENU_SEPARATOR_HEIGHT = 10;
const DEFAULT_VIEW_TOP = 184;
const APP_USER_DATA = app.getPath('userData');
const IS_BROWSER_CHILD = process.platform === 'linux'
  && process.argv.includes('--aether-browser-child');
if (IS_BROWSER_CHILD) {
  app.setName('PARMAR AETHER Browser');
  app.setPath('userData', path.join(APP_USER_DATA, 'aether-browser-profile'));
}
const tabs = new Map();
const activeDownloads = new Map();
let closedTabHistory = new ClosedTabHistory();
let controlWindow = null;
let browserWindow = null;
let browserWindowReady = null;
let activeTabId = null;
let browserZoomFactor = DEFAULT_ZOOM_FACTOR;
let browserSession = null;
let browserSessionProfileId = null;
const profileSessions = new Map();
const failedProfileSessions = new Map();
const sessionOwners = new WeakMap();
let reopenClosedTabMenuItem = null;
let aetherStore = null;
let profileManager = null;
let activeProfileId = null;
let browserChildBroker = null;
const browserChildSupervisor = process.platform === 'linux' && !IS_BROWSER_CHILD
  ? createBrowserChildSupervisor({
    executablePath: process.execPath,
    appPath: app.getAppPath(),
  })
  : null;
const hasSingleInstanceLock = app.requestSingleInstanceLock();

function errorMessage(error) {
  return typeof error?.message === 'string' ? error.message : 'The AETHER operation failed.';
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
    privacy: privacyStatusPayload(REMOTE_BROWSING_ENABLED),
  };
}

function browserStatusPayload() {
  const brandEmblemPath = app.isPackaged
    ? path.join(process.resourcesPath, 'aether', 'parmar-emblem.png')
    : BRAND_EMBLEM_PATH;
  return {
    ...statusPayload(),
    brandEmblemUrl: pathToFileURL(brandEmblemPath).href,
    profiles: profileManager ? profileManager.snapshot(activeProfileId) : null,
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
    navigationStatus: tab.error
      ? 'error'
      : (tab.view.webContents.isLoading() ? 'loading' : 'complete'),
    pinned: tab.pinned,
  };
}

function sendBrowserState() {
  if (!browserWindow || browserWindow.isDestroyed()) return;
  if (reopenClosedTabMenuItem) {
    reopenClosedTabMenuItem.enabled = closedTabHistory.length > 0;
  }
  browserWindow.webContents.send('aether:state', {
    ...browserStatusPayload(),
    activeTabId,
    tabs: [...tabs.values()].map(publicTab),
    closedTabCount: closedTabHistory.length,
    stored: aetherStore ? aetherStore.snapshot() : { bookmarks: [], history: [] },
    downloads: aetherStore ? aetherStore.downloadsSnapshot() : [],
    preferences: aetherStore ? aetherStore.preferencesSnapshot() : null,
  });
}

function persistTabSession({ zoomFactor = browserZoomFactor, throwOnError = false } = {}) {
  if (!aetherStore) return;
  const tabIds = [...tabs.keys()];
  try {
    aetherStore.saveSession({
      tabs: tabIds.map((id) => {
        const tab = tabs.get(id);
        return {
          url: tab?.url || tab?.restoreUrl || null,
          pinned: Boolean(tab?.pinned),
        };
      }),
      activeIndex: Math.max(0, tabIds.indexOf(activeTabId)),
      zoomFactor,
      zoomFactors: tabIds.map((id) => tabs.get(id).view.webContents.getZoomFactor()),
    });
  } catch (error) {
    if (throwOnError) throw error;
    notifyNavigationError(errorMessage(error));
  }
}

function persistClosedTabHistory() {
  if (!aetherStore) return;
  try {
    aetherStore.saveClosedTabs(closedTabHistory.entries);
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

function updateDownload(record) {
  const safeRecord = safeDownloadRecord(record);
  if (!safeRecord) {
    notifyNavigationError('AETHER received invalid download metadata.');
    return false;
  }
  try {
    aetherStore.updateDownload(safeRecord);
    sendBrowserState();
    return true;
  } catch {
    notifyNavigationError('Download status could not be saved.');
    return false;
  }
}

function downloadByteCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function suggestedDownloadPath(fileName) {
  const directory = app.getPath('downloads');
  const extension = path.extname(fileName);
  const stem = path.basename(fileName, extension);
  for (let index = 0; index < 1000; index += 1) {
    const suffix = index === 0 ? '' : ` (${index})`;
    const candidate = path.join(directory, `${stem}${suffix}${extension}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return path.join(directory, `download-${randomUUID()}`);
}

async function chooseDownloadDestination(record, item) {
  let defaultPath = suggestedDownloadPath(record.fileName);
  while (true) {
    const result = await dialog.showSaveDialog(browserWindow, {
      title: 'Save download',
      buttonLabel: 'Save',
      defaultPath,
    });
    if (result.canceled || !result.filePath) return null;
    const destination = safeDownloadDestination(result.filePath);
    if (!destination) {
      throw new TypeError('The selected download destination is invalid.');
    }

    let reservation;
    try {
      reservation = await fs.promises.open(destination, 'wx', 0o600);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await dialog.showMessageBox(browserWindow, {
        type: 'warning',
        title: 'File already exists',
        message: 'AETHER will not overwrite an existing file. Choose a different name.',
        buttons: ['Choose another name'],
      });
      defaultPath = suggestedDownloadPath(record.fileName);
      continue;
    }
    try {
      await reservation.close();
      item.setSavePath(destination);
    } catch (error) {
      fs.rmSync(destination, { force: true });
      throw error;
    }
    return destination;
  }
}

function finalizeDownload(entry, state, error = null) {
  if (activeDownloads.get(entry.record.id) !== entry) return;
  activeDownloads.delete(entry.record.id);
  updateDownload({
    ...entry.record,
    receivedBytes: downloadByteCount(entry.item.getReceivedBytes()),
    totalBytes: downloadByteCount(entry.item.getTotalBytes()),
    state,
    error,
    updatedAt: Date.now(),
  });
}

function handleDownloadRequest(_event, item, webContents) {
  const tab = [...tabs.values()].find((entry) => entry.view.webContents === webContents);
  if (
    !tab
    || !item
    || typeof item.pause !== 'function'
    || typeof item.cancel !== 'function'
    || typeof item.getFilename !== 'function'
    || typeof item.getTotalBytes !== 'function'
    || typeof item.getReceivedBytes !== 'function'
    || typeof item.setSavePath !== 'function'
    || typeof item.resume !== 'function'
    || typeof item.on !== 'function'
    || typeof item.once !== 'function'
  ) {
    try {
      item?.cancel?.();
    } catch {
      notifyNavigationError('An invalid download request could not be cancelled.');
    }
    notifyNavigationError('AETHER rejected an invalid or unowned download request.');
    return;
  }

  let record;
  try {
    record = {
      id: randomUUID(),
      fileName: sanitizeDownloadFilename(item.getFilename()),
      receivedBytes: downloadByteCount(item.getReceivedBytes()),
      totalBytes: downloadByteCount(item.getTotalBytes()),
      state: 'awaiting-approval',
      error: null,
      updatedAt: Date.now(),
    };
  } catch {
    try {
      item.cancel();
    } catch {
      notifyNavigationError('Invalid download metadata could not be cancelled.');
    }
    notifyNavigationError('AETHER rejected invalid download metadata.');
    return;
  }
  const entry = { item, record, tabId: tab.id };
  activeDownloads.set(record.id, entry);
  try {
    item.pause();
    updateDownload(record);
  } catch {
    try {
      item.cancel();
    } catch {
      notifyNavigationError('A failed download could not be cancelled.');
    }
    finalizeDownload(entry, 'failed', 'The download could not be started.');
    return;
  }

  item.on('updated', (_downloadEvent, downloadState) => {
    if (activeDownloads.get(record.id) !== entry) return;
    if (downloadState === 'interrupted') {
      finalizeDownload(entry, 'interrupted', 'The download was interrupted.');
      return;
    }
    entry.record = {
      ...entry.record,
      receivedBytes: downloadByteCount(item.getReceivedBytes()),
      totalBytes: downloadByteCount(item.getTotalBytes()),
      updatedAt: Date.now(),
    };
    updateDownload(entry.record);
  });
  item.once('done', (_downloadEvent, downloadState) => {
    if (downloadState === 'completed') finalizeDownload(entry, 'completed');
    else if (downloadState === 'cancelled') finalizeDownload(entry, 'cancelled');
    else finalizeDownload(entry, 'interrupted', 'The download did not complete.');
  });

  (async () => {
    try {
      const destination = await chooseDownloadDestination(record, item);
      if (activeDownloads.get(record.id) !== entry) return;
      if (!destination) {
        item.cancel();
        finalizeDownload(entry, 'cancelled');
        return;
      }
      entry.destination = destination;
      entry.record = { ...entry.record, state: 'downloading', updatedAt: Date.now() };
      updateDownload(entry.record);
      item.resume();
      entry.resumed = true;
    } catch {
      try {
        item.cancel();
      } catch {
        notifyNavigationError('A failed download could not be cancelled.');
      }
      if (entry.destination && !entry.resumed) {
        fs.rmSync(entry.destination, { force: true });
      }
      finalizeDownload(entry, 'failed', 'The download could not be saved. Check the selected location and try again.');
    }
  })();
}

function createTabFromUserAction(options) {
  if (tabs.size >= MAX_TABS) {
    notifyNavigationError(`AETHER supports at most ${MAX_TABS} tabs.`);
    return null;
  }
  return createTab(options);
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

function safeContextUrl(value) {
  const url = safeTabUrl(value);
  return url ? url : null;
}

function showTabContextMenu(tab, event, params) {
  event.preventDefault();
  if (tabs.get(tab.id) !== tab || !browserWindow || browserWindow.isDestroyed()) return;
  if (!params || typeof params !== 'object' || Array.isArray(params)) params = {};

  const contents = tab.view.webContents;
  const selectedText = typeof params.selectionText === 'string'
    ? params.selectionText
    : '';
  const linkUrl = safeContextUrl(params.linkURL);
  const imageUrl = params.mediaType === 'image' ? safeContextUrl(params.srcURL) : null;
  const template = [
    {
      label: 'Back',
      enabled: contents.canGoBack(),
      accelerator: 'Alt+Left',
      click: () => {
        if (tabs.get(tab.id) === tab && contents.canGoBack()) contents.goBack();
      },
    },
    {
      label: 'Forward',
      enabled: contents.canGoForward(),
      accelerator: 'Alt+Right',
      click: () => {
        if (tabs.get(tab.id) === tab && contents.canGoForward()) contents.goForward();
      },
    },
    {
      label: 'Reload',
      accelerator: 'CommandOrControl+R',
      click: () => {
        if (tabs.get(tab.id) === tab) contents.reload();
      },
    },
  ];

  if (selectedText.trim()) {
    template.push(
      { type: 'separator' },
      {
        label: 'Copy selected text',
        accelerator: 'CommandOrControl+C',
        click: () => {
          if (tabs.get(tab.id) === tab) clipboard.writeText(selectedText);
        },
      },
    );
  }
  if (linkUrl) {
    template.push(
      { type: 'separator' },
      {
        label: 'Copy link address',
        click: () => {
          if (tabs.get(tab.id) === tab) clipboard.writeText(linkUrl);
        },
      },
      {
        label: 'Open link in new tab',
        click: () => {
          if (tabs.get(tab.id) === tab) {
            createTabFromUserAction({ restoreUrl: linkUrl });
          }
        },
      },
    );
  }
  if (imageUrl) {
    template.push(
      { type: 'separator' },
      {
        label: 'Copy image address',
        click: () => {
          if (tabs.get(tab.id) === tab) clipboard.writeText(imageUrl);
        },
      },
    );
  }
  template.push(
    { type: 'separator' },
    {
      label: 'Select All',
      accelerator: 'CommandOrControl+A',
      click: () => {
        if (tabs.get(tab.id) === tab) contents.selectAll();
      },
    },
  );

  const menu = Menu.buildFromTemplate(template);
  const contentSize = browserWindow.getContentSize();
  const menuHeight = template.reduce(
    (height, item) => height + (item.type === 'separator'
      ? CONTEXT_MENU_SEPARATOR_HEIGHT
      : CONTEXT_MENU_ITEM_HEIGHT),
    0,
  );
  const bounds = tab.lastBounds || { x: 0, y: 0 };
  const requestedX = Number.isFinite(params.x) ? params.x : 0;
  const requestedY = Number.isFinite(params.y) ? params.y : 0;
  const x = Math.max(0, Math.min(
    Math.round(bounds.x + requestedX),
    Math.max(0, contentSize[0] - CONTEXT_MENU_WIDTH),
  ));
  const y = Math.max(0, Math.min(
    Math.round(bounds.y + requestedY),
    Math.max(0, contentSize[1] - menuHeight),
  ));
  menu.popup({ window: browserWindow, x, y });
}

function changeTabPin(tab, pinned) {
  if (tabs.get(tab.id) !== tab || tab.pinned === pinned) return false;
  tab.pinned = pinned;
  const order = [...tabs.values()];
  const changedIndex = order.indexOf(tab);
  order.splice(changedIndex, 1);
  const pinnedCount = order.filter((entry) => entry.pinned).length;
  order.splice(pinnedCount, 0, tab);
  tabs.clear();
  for (const entry of order) tabs.set(entry.id, entry);
  sendBrowserState();
  persistTabSession();
  return true;
}

function duplicateTab(tab) {
  if (tabs.get(tab.id) !== tab) return false;
  const restoreUrl = tab.url || tab.restoreUrl || null;
  return Boolean(createTabFromUserAction({ restoreUrl }));
}

function closeOtherTabs(tab) {
  if (tabs.get(tab.id) !== tab) return false;
  for (const entry of [...tabs.values()]) {
    if (entry.id !== tab.id && !entry.pinned) closeTab(entry.id);
  }
  return true;
}

function closeTabsToRight(tab) {
  if (tabs.get(tab.id) !== tab) return false;
  const order = [...tabs.values()];
  const index = order.indexOf(tab);
  for (const entry of order.slice(index + 1)) {
    if (!entry.pinned) closeTab(entry.id);
  }
  return true;
}

function moveTabBy(tab, direction) {
  if (tabs.get(tab.id) !== tab || (direction !== -1 && direction !== 1)) return false;
  const order = [...tabs.values()];
  const index = order.indexOf(tab);
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= order.length) return false;
  if (order[targetIndex].pinned !== tab.pinned) return false;
  [order[index], order[targetIndex]] = [order[targetIndex], order[index]];
  tabs.clear();
  for (const entry of order) tabs.set(entry.id, entry);
  sendBrowserState();
  persistTabSession();
  return true;
}

function reorderTabs(ids) {
  if (
    !Array.isArray(ids)
    || ids.length !== tabs.size
    || ids.some((id) => typeof id !== 'string' || !TAB_ID_PATTERN.test(id))
    || new Set(ids).size !== ids.length
  ) return false;
  const nextTabs = ids.map((id) => tabs.get(id));
  if (nextTabs.some((tab) => !tab)) return false;
  let sawUnpinned = false;
  for (const tab of nextTabs) {
    if (!tab.pinned) sawUnpinned = true;
    else if (sawUnpinned) return false;
  }
  tabs.clear();
  for (const tab of nextTabs) tabs.set(tab.id, tab);
  sendBrowserState();
  persistTabSession();
  return true;
}

function showTabManagementMenu(tab) {
  if (tabs.get(tab.id) !== tab || !browserWindow || browserWindow.isDestroyed()) return;
  const order = [...tabs.values()];
  const index = order.indexOf(tab);
  const menu = Menu.buildFromTemplate([
    {
      label: 'Duplicate Tab',
      enabled: tabs.size < MAX_TABS,
      click: () => duplicateTab(tab),
    },
    {
      label: tab.pinned ? 'Unpin Tab' : 'Pin Tab',
      click: () => changeTabPin(tab, !tab.pinned),
    },
    { type: 'separator' },
    {
      label: 'Move Tab Left',
      enabled: index > 0 && order[index - 1].pinned === tab.pinned,
      click: () => moveTabBy(tab, -1),
    },
    {
      label: 'Move Tab Right',
      enabled: index < order.length - 1 && order[index + 1].pinned === tab.pinned,
      click: () => moveTabBy(tab, 1),
    },
    { type: 'separator' },
    {
      label: 'Close Other Tabs',
      enabled: order.some((entry) => entry.id !== tab.id && !entry.pinned),
      click: () => closeOtherTabs(tab),
    },
    {
      label: 'Close Tabs to the Right',
      enabled: order.slice(index + 1).some((entry) => !entry.pinned),
      click: () => closeTabsToRight(tab),
    },
    { type: 'separator' },
    {
      label: 'Close Tab',
      enabled: !tab.pinned,
      click: () => closeTab(tab.id),
    },
  ]);
  menu.popup({ window: browserWindow });
}

function createTab({
  restoreUrl = null,
  persist = true,
  zoomFactor = browserZoomFactor,
  pinned = false,
} = {}) {
  if (!browserWindow || browserWindow.isDestroyed()) throw new Error('AETHER browser window is unavailable.');
  if (tabs.size >= MAX_TABS) throw new Error(`AETHER supports at most ${MAX_TABS} tabs.`);
  if (!activeProfileId || browserSessionProfileId !== activeProfileId || !browserSession) {
    throw new Error('AETHER could not verify the selected profile Chromium session.');
  }

  const safeRestoreUrl = restoreUrl === null ? null : safeTabUrl(restoreUrl);
  if (restoreUrl !== null && !safeRestoreUrl) {
    throw new TypeError('The restored AETHER tab address is invalid.');
  }
  if (
    typeof zoomFactor !== 'number'
    || !Number.isFinite(zoomFactor)
    || zoomFactor < MIN_ZOOM_FACTOR
    || zoomFactor > MAX_ZOOM_FACTOR
  ) {
    throw new TypeError('The restored AETHER tab zoom is invalid.');
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
    pinned: Boolean(pinned),
  };
  tabs.set(id, tab);

  const contents = view.webContents;
  if (contents.getZoomFactor() !== zoomFactor) contents.setZoomFactor(zoomFactor);
  contents.on('context-menu', (event, params = {}) => {
    showTabContextMenu(tab, event, params);
  });
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
  if (tab.pinned) {
    notifyNavigationError('Unpin this tab before closing it.');
    return false;
  }
  closedTabHistory.push({
    url: tab.url || null,
    restoreUrl: tab.restoreUrl,
    zoomFactor: tab.view.webContents.getZoomFactor(),
  });
  persistClosedTabHistory();
  const wasActive = activeTabId === tabId;
  if (wasActive && browserWindow && !browserWindow.isDestroyed()) {
    browserWindow.contentView.removeChildView(tab.view);
  }
  tabs.delete(tabId);
  disposeTabWebContents(tab);
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

function disposeTabWebContents(tab) {
  const contents = tab.view.webContents;
  if (contents.isDestroyed()) return;
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.removeAllListeners();
  contents.close();
}

function reopenClosedTab() {
  const closedTab = closedTabHistory.take();
  if (!closedTab) {
    sendBrowserState();
    return null;
  }
  persistClosedTabHistory();
  try {
    const restoreUrl = closedTab.url || closedTab.restoreUrl;
    const id = createTabFromUserAction({
      restoreUrl,
      zoomFactor: closedTab.zoomFactor,
    });
    if (!id) {
      closedTabHistory.push(closedTab);
      persistClosedTabHistory();
      sendBrowserState();
      return null;
    }
    return id;
  } catch (error) {
    closedTabHistory.push(closedTab);
    persistClosedTabHistory();
    sendBrowserState();
    throw error;
  }
}

function activeTab() {
  const tab = tabs.get(activeTabId);
  if (!tab) throw new Error('No AETHER tab is active.');
  return tab;
}

async function loadTabHome(tab) {
  if (tabs.get(tab.id) !== tab) return false;
  tab.error = null;
  try {
    await tab.view.webContents.loadFile(NEW_TAB_HTML);
    return true;
  } catch (error) {
    setTabError(tab, errorMessage(error));
    return false;
  }
}

function setActiveTabZoomFactor(factor) {
  if (
    typeof factor !== 'number'
    || !Number.isFinite(factor)
    || factor < MIN_ZOOM_FACTOR
    || factor > MAX_ZOOM_FACTOR
  ) {
    throw new TypeError('Zoom must be between 50% and 200%.');
  }
  const tab = tabs.get(activeTabId);
  if (!tab) throw new Error('No AETHER tab is active.');
  const previousFactor = tab.view.webContents.getZoomFactor();
  try {
    tab.view.webContents.setZoomFactor(factor);
    persistTabSession({ throwOnError: true });
  } catch (error) {
    tab.view.webContents.setZoomFactor(previousFactor);
    throw error;
  }
  sendBrowserState();
}

function handleBrowserKeyInput(event, input, tab) {
  if (input.type !== 'keyDown' || tab.id !== activeTabId) return;
  const command = input.control || input.meta;
  const key = input.key.toLowerCase();
  const contents = tab.view.webContents;

  if (command && input.shift && (key === 'pageup' || key === 'pagedown')) {
    event.preventDefault();
    moveTabBy(tab, key === 'pageup' ? -1 : 1);
  } else if (command && key === 'tab') {
    event.preventDefault();
    const ids = [...tabs.keys()];
    const current = Math.max(0, ids.indexOf(tab.id));
    const direction = input.shift ? -1 : 1;
    setActiveTab(ids[(current + direction + ids.length) % ids.length]);
  } else if (command && key === 'l') {
    event.preventDefault();
    browserWindow.webContents.send('aether:focus-address');
  } else if (command && input.shift && key === 't') {
    if (!closedTabHistory.length) return;
    event.preventDefault();
    try {
      reopenClosedTab();
    } catch (error) {
      notifyNavigationError(errorMessage(error));
    }
  } else if (command && key === 't') {
    event.preventDefault();
    createTabFromUserAction();
  } else if (command && key === 'w') {
    event.preventDefault();
    closeTab(tab.id);
  } else if (command && key === 'r') {
    event.preventDefault();
    contents.reload();
  } else if (command && (key === '+' || key === '=')) {
    event.preventDefault();
    try {
      setActiveTabZoomFactor(Math.min(2, contents.getZoomFactor() + 0.1));
    } catch (error) {
      setTabError(tab, errorMessage(error));
    }
  } else if (command && key === '-') {
    event.preventDefault();
    try {
      setActiveTabZoomFactor(Math.max(0.5, contents.getZoomFactor() - 0.1));
    } catch (error) {
      setTabError(tab, errorMessage(error));
    }
  } else if (command && key === '0') {
    event.preventDefault();
    try {
      setActiveTabZoomFactor(1);
    } catch (error) {
      setTabError(tab, errorMessage(error));
    }
  } else if (input.alt && key === 'home') {
    event.preventDefault();
    loadTabHome(tab);
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
      if (browserWindow && !browserWindow.isDestroyed()) createTabFromUserAction();
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
  registerHandler('aether:status', async (...args) => {
    if (args.length) throw new TypeError('AETHER status requests do not accept a payload.');
    return browserStatusPayload();
  });
  registerHandler('aether:create-tab', async () => {
    createTab();
    return { ok: true };
  });
  registerHandler('aether:activate-tab', async (id) => ({
    ok: setActiveTab(typeof id === 'string' ? id : ''),
  }));
  registerHandler('aether:home', async (id) => {
    if (typeof id !== 'string' || !TAB_ID_PATTERN.test(id)) {
      return { ok: false, error: 'The tab identifier is invalid.' };
    }
    const tab = tabs.get(id);
    if (!tab || id !== activeTabId) {
      return { ok: false, error: 'The active tab changed. Try again.' };
    }
    return { ok: await loadTabHome(tab) };
  });
  registerHandler('aether:close-tab', async (id) => ({
    ok: closeTab(typeof id === 'string' ? id : ''),
  }));
  registerHandler('aether:tab-management-menu', async (id) => {
    if (typeof id !== 'string' || !TAB_ID_PATTERN.test(id)) {
      return { ok: false, error: 'The tab identifier is invalid.' };
    }
    const tab = tabs.get(id);
    if (!tab) return { ok: false, error: 'This tab is no longer available.' };
    showTabManagementMenu(tab);
    return { ok: true };
  });
  registerHandler('aether:reorder-tabs', async (ids) => ({
    ok: reorderTabs(ids),
    error: 'The tab order is invalid or crosses the pinned-tab boundary.',
  }));
  registerHandler('aether:reopen-closed-tab', async () => {
    const id = reopenClosedTab();
    return id
      ? { ok: true }
      : { ok: false, error: 'There are no recently closed tabs to reopen.' };
  });
  registerHandler('aether:cancel-download', async (id) => {
    if (typeof id !== 'string' || !DOWNLOAD_ID_PATTERN.test(id)) {
      return { ok: false, error: 'The download identifier is invalid.' };
    }
    const entry = activeDownloads.get(id);
    if (!entry) return { ok: false, error: 'This download is no longer active.' };
    entry.item.cancel();
    finalizeDownload(entry, 'cancelled');
    return { ok: true };
  });
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

    if (result.kind === 'search' && !REMOTE_BROWSING_ENABLED) {
      return { ok: false, error: 'Search is unavailable while remote browsing is disabled.' };
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
  registerHandler('aether:add-bookmark', async (id) => {
    const tab = tabs.get(id);
    if (!tab || id !== activeTabId) {
      return { ok: false, error: 'The active tab changed. Try again.' };
    }
    const url = tab.url || tab.restoreUrl;
    if (!url) return { ok: false, error: 'This tab does not have an HTTPS address to bookmark.' };
    const title = tab.title === 'New Tab' ? new URL(url).hostname : tab.title;
    return {
      ok: true,
      data: aetherStore.addBookmark({ title, url }).bookmarks,
    };
  });
  registerHandler('aether:update-bookmark', async (url, title, updatedUrl) => ({
    ok: true,
    data: aetherStore.updateBookmark(url, title, updatedUrl).bookmarks,
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
    const tab = tabs.get(id);
    if (!tab || id !== activeTabId) {
      return { ok: false, error: 'The active tab changed. Try again.' };
    }
    setActiveTabZoomFactor(factor);
    return { ok: true, factor };
  });
  registerHandler('aether:update-preference', async (key, value) => {
    if (typeof key !== 'string') {
      return { ok: false, error: 'The preference name is invalid.' };
    }
    const preferences = aetherStore.updatePreferences({ [key]: value });
    if (key === 'defaultZoom') browserZoomFactor = preferences.defaultZoom;
    sendBrowserState();
    return { ok: true, preferences };
  });
  registerHandler('aether:reset-preferences', async () => {
    const preferences = aetherStore.resetPreferences();
    browserZoomFactor = preferences.defaultZoom;
    sendBrowserState();
    return { ok: true, preferences };
  });
  registerHandler('aether:clear-download-history', async () => {
    const downloads = aetherStore.clearDownloadHistory();
    sendBrowserState();
    return { ok: true, downloads };
  });
  registerHandler('aether:create-profile', async (name) => {
    if (typeof name !== 'string') {
      return { ok: false, error: 'The profile name is invalid.' };
    }
    const profiles = profileManager.createProfile(name);
    sendBrowserState();
    return { ok: true, profiles };
  });
  registerHandler('aether:select-profile', async (id) => {
    if (typeof id !== 'string') {
      return { ok: false, error: 'The selected profile is invalid.' };
    }
    const profiles = profileManager.selectProfile(id);
    sendBrowserState();
    return { ok: true, profiles };
  });
}

function installBrowserSessionPolicy(profileId) {
  const partition = profilePartition(profileId);
  if (failedProfileSessions.has(profileId)) {
    throw new Error(`AETHER profile session initialization previously failed for ${profileId}.`, {
      cause: failedProfileSessions.get(profileId),
    });
  }
  const existing = profileSessions.get(profileId);
  if (existing) return existing;

  let selectedSession;
  try {
    selectedSession = session.fromPartition(partition);
    if (
      !selectedSession
      || typeof selectedSession.setPermissionRequestHandler !== 'function'
      || typeof selectedSession.setPermissionCheckHandler !== 'function'
      || typeof selectedSession.on !== 'function'
      || typeof selectedSession.webRequest?.onBeforeRequest !== 'function'
    ) {
      throw new TypeError('Electron returned an incomplete AETHER profile session.');
    }
    const owner = sessionOwners.get(selectedSession);
    if (owner && owner !== profileId) {
      throw new Error('Electron returned a Chromium session already assigned to another AETHER profile.');
    }
    sessionOwners.set(selectedSession, profileId);
    selectedSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
      callback(permissionDecision(permission, details?.securityOrigin).allowed);
    });
    selectedSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => (
      permissionDecision(permission, requestingOrigin).allowed
    ));
    selectedSession.on('will-download', (event, item, webContents) => {
      handleDownloadRequest(event, item, webContents);
    });
    selectedSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
      (_details, callback) => callback({ cancel: true }),
    );
    profileSessions.set(profileId, selectedSession);
    return selectedSession;
  } catch (error) {
    failedProfileSessions.set(profileId, error);
    throw new Error(`AETHER Chromium session initialization failed for profile ${profileId}.`, {
      cause: error,
    });
  }
}

async function createBrowserWindow({ newTab = false } = {}) {
  if (browserChildSupervisor) {
    if (browserChildSupervisor.state === 'ready') {
      if (newTab) browserChildSupervisor.newTab();
      else browserChildSupervisor.focus();
      return;
    }
    const alreadyStarting = browserChildSupervisor.state === 'starting';
    await browserChildSupervisor.start();
    if (newTab && alreadyStarting) browserChildSupervisor.newTab();
    return;
  }
  if (browserWindow && !browserWindow.isDestroyed()) {
    if (newTab) {
      createTabFromUserAction();
      return;
    }
    browserWindow.focus();
    if (browserWindowReady) await browserWindowReady;
    return;
  }
  if (!profileManager) profileManager = new AetherProfiles(app.getPath('userData'));
  if (!activeProfileId) {
    activeProfileId = profileManager.startupProfileId;
    browserSession = installBrowserSessionPolicy(activeProfileId);
    browserSessionProfileId = activeProfileId;
  } else if (browserSessionProfileId !== activeProfileId || !browserSession) {
    throw new Error('AETHER active profile and Chromium session do not match.');
  }
  aetherStore = new AetherStore(profileManager.profileDataPath(activeProfileId));
  closedTabHistory = new ClosedTabHistory(aetherStore.closedTabsSnapshot());
  const savedSession = aetherStore.sessionSnapshot();
  const preferences = aetherStore.preferencesSnapshot();
  browserZoomFactor = preferences.defaultZoom;
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
  createdWindow.webContents.on('before-input-event', (event, input) => {
    const tab = tabs.get(activeTabId);
    if (tab) handleBrowserKeyInput(event, input, tab);
  });
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
      disposeTabWebContents(tab);
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
      if (preferences.startupBehavior === 'restore-session' && savedSession.tabs.length) {
        const restoredIds = savedSession.tabs.map(({ url, pinned }, index) => (
          createTab({
            restoreUrl: url,
            pinned,
            zoomFactor: savedSession.zoomFactors[index] ?? savedSession.zoomFactor,
            persist: false,
          })
        ));
        setActiveTab(restoredIds[savedSession.activeIndex] || restoredIds[0], { persist: false });
        persistTabSession();
      } else {
        createTab({ persist: preferences.startupBehavior !== 'start-page' });
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
  reopenClosedTabMenuItem = {
    label: 'Reopen Closed Tab',
    accelerator: 'CommandOrControl+Shift+T',
    enabled: false,
    click: async () => {
      try {
        if (!browserWindow || browserWindow.isDestroyed()) {
          await createBrowserWindow();
        }
        reopenClosedTab();
      } catch (error) {
        if (browserWindow && !browserWindow.isDestroyed()) {
          notifyNavigationError(errorMessage(error));
        } else {
          console.error(`AETHER closed tab reopen failed: ${errorMessage(error)}`);
        }
      }
    },
  };
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
      reopenClosedTabMenuItem,
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
