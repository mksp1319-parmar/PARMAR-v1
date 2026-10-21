'use strict';

const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

class MockWebContents extends EventEmitter {
  static instances = [];

  constructor() {
    super();
    this.sent = [];
    this.calls = [];
    this.destroyed = false;
    this.windowOpenHandler = null;
    this.canGoBackValue = true;
    this.canGoForwardValue = true;
    MockWebContents.instances.push(this);
  }

  setWindowOpenHandler(handler) {
    this.windowOpenHandler = handler;
  }

  send(channel, payload) {
    this.sent.push({ channel, payload });
  }

  isDestroyed() {
    return this.destroyed;
  }

  focus() {
    this.focused = true;
  }

  canGoBack() {
    return this.canGoBackValue;
  }

  canGoForward() {
    return this.canGoForwardValue;
  }

  isLoading() {
    return this.loading || false;
  }

  getZoomFactor() {
    return 1;
  }

  setZoomFactor(factor) {
    this.calls.push(['zoom', factor]);
  }

  goBack() {
    this.calls.push(['back']);
  }

  goForward() {
    this.calls.push(['forward']);
  }

  reload() {
    this.calls.push(['reload']);
  }

  stop() {
    this.calls.push(['stop']);
  }

  loadFile() {
    return Promise.resolve();
  }

  loadURL(url) {
    this.calls.push(['navigate', url]);
    return Promise.resolve();
  }

  close() {
    this.destroyed = true;
  }
}

class MockWebContentsView {
  constructor(options) {
    this.options = options;
    this.webContents = new MockWebContents();
    this.bounds = null;
  }

  setBounds(bounds) {
    this.bounds = bounds;
  }
}

class MockBrowserWindow extends EventEmitter {
  static windows = [];
  static failControlLoad = false;
  static failBrowserLoad = false;
  static browserLoadGate = null;

  constructor(options) {
    super();
    this.options = options;
    this.destroyed = false;
    this.minimized = false;
    this.focusCount = 0;
    this.restoreCount = 0;
    this.contentSize = [1320, 880];
    this.contentView = {
      children: new Set(),
      addChildView: (view) => this.contentView.children.add(view),
      removeChildView: (view) => {
        if (!this.contentView.children.delete(view)) {
          throw new Error('Cannot detach a view that is not attached.');
        }
      },
    };
    this.webContents = new MockWebContents();
    MockBrowserWindow.windows.push(this);
  }

  isDestroyed() {
    return this.destroyed;
  }

  getContentSize() {
    return this.contentSize;
  }

  loadURL() {
    if (MockBrowserWindow.failControlLoad) {
      return Promise.reject(new Error('Backend unavailable'));
    }
    return Promise.resolve();
  }

  loadFile() {
    if (MockBrowserWindow.failBrowserLoad) {
      return Promise.reject(new Error('Browser chrome failed to load'));
    }
    if (MockBrowserWindow.browserLoadGate) return MockBrowserWindow.browserLoadGate;
    return Promise.resolve();
  }

  show() {}

  focus() {
    this.focusCount += 1;
  }

  isMinimized() {
    return this.minimized;
  }

  restore() {
    this.minimized = false;
    this.restoreCount += 1;
  }

  close() {
    this.destroyed = true;
    this.emit('closed');
  }

  static getAllWindows() {
    return MockBrowserWindow.windows.filter((window) => !window.destroyed);
  }
}

function createElectronMock(userDataPath, { hasSingleInstanceLock = true } = {}) {
  const handlers = new Map();
  const app = new EventEmitter();
  app.quitCount = 0;
  app.singleInstanceLockRequests = 0;
  app.requestSingleInstanceLock = () => {
    app.singleInstanceLockRequests += 1;
    return hasSingleInstanceLock;
  };
  app.whenReady = () => Promise.resolve();
  app.getPath = () => userDataPath;
  app.getAppPath = () => path.resolve(__dirname, '..');
  app.quit = () => { app.quitCount += 1; };

  const browserSession = new EventEmitter();
  browserSession.requestPolicyRegistrations = 0;
  browserSession.webRequest = {
    onBeforeRequest(filter, listener) {
      browserSession.requestPolicyRegistrations += 1;
      browserSession.requestPolicy = { filter, listener };
    },
  };
  browserSession.setPermissionRequestHandler = (handler) => {
    browserSession.permissionRequestHandler = handler;
  };
  browserSession.setPermissionCheckHandler = (handler) => {
    browserSession.permissionCheckHandler = handler;
  };

  return {
    handlers,
    browserSession,
    electron: {
      app,
      BrowserWindow: MockBrowserWindow,
      WebContentsView: MockWebContentsView,
      ipcMain: {
        handle(channel, handler) {
          handlers.set(channel, handler);
        },
      },
      Menu: {
        buildFromTemplate: (template) => template,
        setApplicationMenu() {},
      },
      session: { fromPartition: () => browserSession },
    },
  };
}

async function launchMainForTest({
  backendUnavailable = false,
  hasSingleInstanceLock = true,
  browserLoadFailure = false,
  initialSession,
} = {}) {
  MockBrowserWindow.windows = [];
  MockWebContents.instances = [];
  MockBrowserWindow.failControlLoad = backendUnavailable;
  MockBrowserWindow.failBrowserLoad = browserLoadFailure;
  MockBrowserWindow.browserLoadGate = null;
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'parmar-aether-main-'));
  if (initialSession) {
    fs.writeFileSync(path.join(userDataPath, 'aether-state.json'), JSON.stringify({
      version: 1,
      bookmarks: [],
      history: [],
      session: initialSession,
    }));
  }
  const {
    electron,
    handlers,
    browserSession,
  } = createElectronMock(userDataPath, { hasSingleInstanceLock });
  const app = electron.app;
  const mainPath = path.join(__dirname, '..', 'main.cjs');
  const source = fs.readFileSync(mainPath, 'utf8');
  vm.runInNewContext(source, {
    __dirname: path.dirname(mainPath),
    console,
    require: (name) => {
      if (name === 'electron') return electron;
      if (name.startsWith('.')) return require(path.resolve(path.dirname(mainPath), name));
      return require(name);
    },
    process: {
      platform: 'darwin',
      argv: [],
      execPath: process.execPath,
      env: process.env,
    },
    setImmediate,
    URL,
  });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  return {
    app,
    browserSession,
    cleanup: () => {
      MockBrowserWindow.failBrowserLoad = false;
      MockBrowserWindow.browserLoadGate = null;
      fs.rmSync(userDataPath, { recursive: true, force: true });
    },
    handlers,
  };
}

test('tab lifecycle detaches only the active view and routes navigation controls to the selected tab', async (context) => {
  const { browserSession, cleanup, handlers } = await launchMainForTest();
  context.after(cleanup);

  const controlWindow = MockBrowserWindow.windows[0];
  assert.equal(browserSession.listenerCount('will-download'), 0);
  const controlEvent = {
    sender: controlWindow.webContents,
    senderFrame: { parent: null, url: 'http://127.0.0.1:8080/' },
  };
  const rejectedRedirect = { prevented: false, preventDefault() { this.prevented = true; } };
  controlWindow.webContents.emit('will-redirect', rejectedRedirect, 'https://untrusted.example/');
  assert.equal(rejectedRedirect.prevented, true);
  const sameOriginRedirect = { prevented: false, preventDefault() { this.prevented = true; } };
  controlWindow.webContents.emit('will-redirect', sameOriginRedirect, 'http://127.0.0.1:8080/settings');
  assert.equal(sameOriginRedirect.prevented, false);

  const untrustedFrameStatus = await handlers.get('parmar-aether:status')({
    ...controlEvent,
    senderFrame: { parent: {}, url: 'http://127.0.0.1:8080/' },
  });
  assert.equal(untrustedFrameStatus.shell, 'unavailable');
  const opened = await handlers.get('parmar-aether:open')(controlEvent);
  assert.equal(opened.ok, true);
  const browserWindow = MockBrowserWindow.windows[1];
  assert.equal(browserWindow.options.minWidth, 360);
  assert.equal(browserWindow.options.minHeight, 480);
  assert.equal(
    browserWindow.webContents.windowOpenHandler({ url: 'mailto:user@example.com' }).action,
    'deny',
  );
  const browserEvent = {
    sender: browserWindow.webContents,
    senderFrame: {
      parent: null,
      url: pathToFileURL(path.join(__dirname, '..', 'browser.html')).href,
    },
  };
  assert.equal(browserWindow.options.webPreferences.contextIsolation, true);
  assert.equal(browserWindow.options.webPreferences.nodeIntegration, false);
  assert.equal(browserWindow.options.webPreferences.sandbox, true);
  assert.equal(browserWindow.options.webPreferences.webSecurity, true);
  assert.equal(controlWindow.options.webPreferences.contextIsolation, true);
  assert.equal(controlWindow.options.webPreferences.nodeIntegration, false);
  assert.equal(controlWindow.options.webPreferences.sandbox, true);
  assert.equal(controlWindow.options.webPreferences.webSecurity, true);
  assert.deepEqual(browserSession.permissionCheckHandler('https://example.com', 'media'), false);
  const removedHistory = await handlers.get('aether:remove-history')(
    browserEvent,
    'https://example.com/',
  );
  assert.equal(removedHistory.ok, true);
  assert.deepEqual([...removedHistory.data], []);
  let permissionGranted = true;
  browserSession.permissionRequestHandler({}, 'media', (granted) => { permissionGranted = granted; });
  assert.equal(permissionGranted, false);

  let downloadPrevented = false;
  browserSession.emit('will-download', { preventDefault() { downloadPrevented = true; } });
  assert.equal(downloadPrevented, true);
  let requestDecision;
  browserSession.requestPolicy.listener(
    { url: 'https://example.com/' },
    (decision) => { requestDecision = decision; },
  );
  assert.equal(requestDecision.cancel, true);
  for (const url of [
    'http://127.0.0.1:8080/',
    'https://example.com/',
    'ws://127.0.0.1:8080/socket',
    'wss://example.com/socket',
  ]) {
    browserSession.requestPolicy.listener({ url }, (decision) => { requestDecision = decision; });
    assert.equal(requestDecision.cancel, true, url);
  }

  const getState = () => browserWindow.webContents.sent
    .filter((entry) => entry.channel === 'aether:state')
    .at(-1).payload;
  const originalTabId = getState().activeTabId;
  const initialView = [...browserWindow.contentView.children][0];
  const navigationErrorCount = browserWindow.webContents.sent
    .filter((entry) => entry.channel === 'aether:navigation-error').length;
  initialView.webContents.canGoBackValue = false;
  initialView.webContents.canGoForwardValue = true;
  assert.equal(initialView.bounds.y, 184);
  assert.equal(initialView.options.webPreferences.contextIsolation, true);
  assert.equal(initialView.options.webPreferences.nodeIntegration, false);
  assert.equal(initialView.options.webPreferences.sandbox, true);
  assert.equal(initialView.options.webPreferences.webSecurity, true);
  assert.equal(initialView.options.webPreferences.preload, undefined);
  await assert.rejects(handlers.get('aether:create-tab')({
    sender: initialView.webContents,
    senderFrame: { parent: null, url: 'https://untrusted.example/' },
  }), /untrusted renderer/);
  assert.equal(
    initialView.webContents.windowOpenHandler({ url: 'https://example.com/' }).action,
    'deny',
  );
  const rejectedProtocol = { prevented: false, preventDefault() { this.prevented = true; } };
  initialView.webContents.emit('will-navigate', rejectedProtocol, 'mailto:user@example.com');
  assert.equal(rejectedProtocol.prevented, true);
  const rejectedWebsite = { prevented: false, preventDefault() { this.prevented = true; } };
  initialView.webContents.emit('will-navigate', rejectedWebsite, 'https://example.com/');
  assert.equal(rejectedWebsite.prevented, true);
  const rejectedWebRedirect = { prevented: false, preventDefault() { this.prevented = true; } };
  initialView.webContents.emit('will-redirect', rejectedWebRedirect, 'https://redirect.example/');
  assert.equal(rejectedWebRedirect.prevented, true);
  assert.equal(
    browserWindow.webContents.sent.filter((entry) => entry.channel === 'aether:navigation-error').length,
    navigationErrorCount,
  );
  assert.match(
    getState().tabs.find((tab) => tab.id === originalTabId).error,
    /no verified operating-system network boundary/,
  );

  await handlers.get('aether:create-tab')(browserEvent);
  const secondTabId = getState().activeTabId;
  assert.notEqual(secondTabId, originalTabId);
  assert.equal(browserWindow.contentView.children.size, 1);
  const secondView = [...browserWindow.contentView.children][0];
  let inactiveDownloadPrevented = false;
  browserSession.emit('will-download', {
    preventDefault() { inactiveDownloadPrevented = true; },
  }, {}, initialView.webContents);
  assert.equal(inactiveDownloadPrevented, true);
  assert.equal(getState().activeTabId, secondTabId);
  assert.match(
    getState().tabs.find((tab) => tab.id === originalTabId).error,
    /Downloads are disabled while remote browsing is restricted/,
  );
  assert.equal(getState().tabs.find((tab) => tab.id === secondTabId).error, null);
  secondView.webContents.canGoBackValue = true;
  secondView.webContents.canGoForwardValue = false;
  secondView.webContents.emit('did-stop-loading');
  assert.equal(getState().tabs.find((tab) => tab.id === secondTabId).canGoBack, true);
  assert.equal(getState().tabs.find((tab) => tab.id === secondTabId).canGoForward, false);
  secondView.webContents.loading = true;
  secondView.webContents.emit('did-start-loading');
  secondView.webContents.emit(
    'did-redirect-navigation',
    {},
    'https://redirect.example/path',
    false,
    true,
  );
  let secondTabState = getState().tabs.find((tab) => tab.id === secondTabId);
  assert.equal(secondTabState.url, 'https://redirect.example/path');
  assert.equal(secondTabState.isLoading, true);
  secondView.webContents.emit('did-navigate', {}, 'https://final.example/path');
  secondTabState = getState().tabs.find((tab) => tab.id === secondTabId);
  assert.equal(secondTabState.url, 'https://final.example/path');
  assert.equal(secondTabState.title, 'final.example');
  secondView.webContents.emit('page-title-updated', {}, 'Final page title');
  secondView.webContents.canGoBackValue = true;
  secondView.webContents.canGoForwardValue = true;
  secondView.webContents.emit(
    'did-navigate-in-page',
    {},
    'https://final.example/path#section',
    true,
  );
  secondTabState = getState().tabs.find((tab) => tab.id === secondTabId);
  assert.equal(secondTabState.url, 'https://final.example/path#section');
  assert.equal(secondTabState.title, 'Final page title');
  assert.equal(secondTabState.canGoBack, true);
  assert.equal(secondTabState.canGoForward, true);
  secondView.webContents.emit(
    'did-navigate-in-page',
    {},
    'https://ignored.example/frame',
    false,
  );
  secondView.webContents.emit(
    'did-navigate-in-page',
    {},
    'javascript:alert(1)',
    true,
  );
  assert.equal(
    getState().tabs.find((tab) => tab.id === secondTabId).url,
    'https://final.example/path#section',
  );
  secondView.webContents.emit(
    'did-navigate',
    {},
    `https://example.com/${'x'.repeat(2049)}`,
  );
  assert.equal(
    getState().tabs.find((tab) => tab.id === secondTabId).url,
    'https://final.example/path#section',
  );
  assert.equal(
    getState().stored.history.some((record) => record.url === 'https://final.example/path#section'),
    false,
  );
  initialView.webContents.emit('did-navigate', {}, 'https://inactive.example/page');
  initialView.webContents.emit('page-title-updated', {}, 'Inactive tab title');
  initialView.webContents.emit('did-fail-load', {}, -2, 'ERR_NAME_NOT_RESOLVED', 'https://inactive.example/page', true);
  const stateAfterInactiveNavigation = getState();
  assert.equal(stateAfterInactiveNavigation.activeTabId, secondTabId);
  assert.equal(stateAfterInactiveNavigation.tabs.find((tab) => tab.id === originalTabId).url, 'https://inactive.example/page');
  assert.equal(stateAfterInactiveNavigation.tabs.find((tab) => tab.id === originalTabId).title, 'Inactive tab title');
  assert.equal(stateAfterInactiveNavigation.tabs.find((tab) => tab.id === secondTabId).url, 'https://final.example/path#section');
  assert.equal(stateAfterInactiveNavigation.tabs.find((tab) => tab.id === secondTabId).title, 'Final page title');
  assert.equal(
    stateAfterInactiveNavigation.tabs.find((tab) => tab.id === originalTabId).error,
    'Navigation failed: ERR_NAME_NOT_RESOLVED',
  );
  assert.equal(
    browserWindow.webContents.sent.filter((entry) => entry.channel === 'aether:navigation-error').length,
    navigationErrorCount,
  );
  const staleNavigation = await handlers.get('aether:navigate')(
    browserEvent,
    'https://example.com',
    originalTabId,
  );
  assert.equal(staleNavigation.ok, false);
  assert.equal(staleNavigation.error, 'The active tab changed. Try again.');
  const blockedNavigation = await handlers.get('aether:navigate')(
    browserEvent,
    'https://example.com',
    secondTabId,
  );
  assert.equal(blockedNavigation.ok, false);
  assert.match(blockedNavigation.error, /no verified operating-system network boundary/);
  assert.equal([...browserWindow.contentView.children][0].webContents.calls.length, 0);
  const invalidNavigation = await handlers.get('aether:navigate')(
    browserEvent,
    'javascript:alert(1)',
    secondTabId,
  );
  assert.equal(invalidNavigation.ok, false);
  assert.match(invalidNavigation.error, /Only HTTPS web addresses are permitted/);
  assert.equal([...browserWindow.contentView.children][0].webContents.calls.length, 0);

  secondView.webContents.loading = true;
  secondView.webContents.emit('did-start-loading');
  assert.equal(getState().tabs.find((tab) => tab.id === secondTabId).isLoading, true);
  secondView.webContents.loading = false;
  secondView.webContents.emit('did-stop-loading');
  assert.equal(getState().tabs.find((tab) => tab.id === secondTabId).isLoading, false);
  secondView.webContents.emit('did-fail-load', {}, -2, 'ERR_NAME_NOT_RESOLVED', 'https://example.com/', true);
  assert.equal(
    getState().tabs.find((tab) => tab.id === secondTabId).error,
    'Navigation failed: ERR_NAME_NOT_RESOLVED',
  );
  secondView.webContents.loading = true;
  secondView.webContents.emit('did-start-loading');
  assert.equal(getState().tabs.find((tab) => tab.id === secondTabId).error, null);
  secondView.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.match(
    getState().tabs.find((tab) => tab.id === secondTabId).error,
    /Browser renderer stopped \(crashed\)/,
  );
  const retry = await handlers.get('aether:reload')(browserEvent, secondTabId);
  assert.equal(retry.ok, true);
  secondView.webContents.emit('did-start-loading');
  assert.equal(getState().tabs.find((tab) => tab.id === secondTabId).error, null);
  secondView.webContents.loading = false;
  secondView.webContents.emit('did-stop-loading');
  let shortcutPrevented = false;
  secondView.webContents.emit('before-input-event', {
    preventDefault() { shortcutPrevented = true; },
  }, { type: 'keyDown', key: 't', control: true });
  assert.equal(shortcutPrevented, true);
  const thirdTabId = getState().activeTabId;
  assert.notEqual(thirdTabId, secondTabId);
  const thirdView = [...browserWindow.contentView.children][0];
  thirdView.webContents.emit('before-input-event', {
    preventDefault() {},
  }, { type: 'keyDown', key: 'w', control: true });
  assert.equal(getState().activeTabId, secondTabId);

  shortcutPrevented = false;
  secondView.webContents.emit('before-input-event', {
    preventDefault() { shortcutPrevented = true; },
  }, { type: 'keyDown', key: 'Tab', control: true, shift: true });
  assert.equal(shortcutPrevented, true);
  assert.equal(getState().activeTabId, originalTabId);
  assert.equal(browserWindow.contentView.children.has(initialView), true);

  shortcutPrevented = false;
  initialView.webContents.emit('before-input-event', {
    preventDefault() { shortcutPrevented = true; },
  }, { type: 'keyDown', key: 'l', control: true });
  assert.equal(shortcutPrevented, true);
  assert.equal(browserWindow.webContents.sent.at(-1).channel, 'aether:focus-address');

  await handlers.get('aether:activate-tab')(browserEvent, secondTabId);
  await handlers.get('aether:activate-tab')(browserEvent, originalTabId);
  assert.equal(getState().tabs.find((tab) => tab.id === originalTabId).canGoBack, false);
  assert.equal(getState().tabs.find((tab) => tab.id === originalTabId).canGoForward, true);
  const staleBack = await handlers.get('aether:back')(browserEvent, secondTabId);
  const originalView = [...browserWindow.contentView.children][0];
  assert.equal(staleBack.ok, false);
  assert.equal(staleBack.error, 'The active tab changed. Try again.');
  assert.deepEqual(originalView.webContents.calls, []);

  secondView.webContents.canGoForwardValue = false;
  secondView.webContents.emit('did-stop-loading');
  await handlers.get('aether:activate-tab')(browserEvent, secondTabId);
  assert.equal(getState().tabs.find((tab) => tab.id === secondTabId).canGoBack, true);
  assert.equal(getState().tabs.find((tab) => tab.id === secondTabId).canGoForward, false);
  for (const channel of ['aether:reload', 'aether:stop', 'aether:zoom']) {
    const result = await handlers.get(channel)(
      browserEvent,
      ...(channel === 'aether:zoom' ? [1.2, originalTabId] : [originalTabId]),
    );
    assert.equal(result.ok, false, `${channel} should reject the stale tab ID`);
    assert.equal(result.error, 'The active tab changed. Try again.');
  }
  secondView.webContents.canGoForwardValue = true;
  secondView.webContents.emit('did-stop-loading');
  [...browserWindow.contentView.children][0].webContents.emit('before-input-event', {
    preventDefault() {},
  }, { type: 'keyDown', key: '+', control: true });
  const closeInactive = await handlers.get('aether:close-tab')(browserEvent, originalTabId);
  assert.deepEqual({ ok: closeInactive.ok }, { ok: true });
  assert.deepEqual(Array.from(getState().tabs, (tab) => tab.id), [secondTabId]);
  assert.equal(browserWindow.contentView.children.size, 1);

  for (const channel of ['aether:back', 'aether:forward']) {
    const result = await handlers.get(channel)(browserEvent, secondTabId);
    assert.equal(result.ok, true);
  }
  const activeView = [...browserWindow.contentView.children][0];
  activeView.webContents.loading = true;
  for (const channel of ['aether:reload', 'aether:stop']) {
    const result = await handlers.get(channel)(browserEvent, secondTabId);
    assert.equal(result.ok, true);
  }
  const zoomed = await handlers.get('aether:zoom')(browserEvent, 1.2, secondTabId);
  assert.equal(zoomed.ok, true);
  const closedTabReload = await handlers.get('aether:reload')(browserEvent, originalTabId);
  assert.equal(closedTabReload.ok, false);
  assert.equal(closedTabReload.error, 'The active tab changed. Try again.');
  assert.deepEqual(activeView.webContents.calls, [
    ['reload'], ['zoom', 1.1], ['back'], ['forward'], ['reload'], ['stop'], ['zoom', 1.2],
  ]);
  activeView.webContents.canGoBackValue = false;
  activeView.webContents.canGoForwardValue = false;
  const unavailableBack = await handlers.get('aether:back')(browserEvent, secondTabId);
  const unavailableForward = await handlers.get('aether:forward')(browserEvent, secondTabId);
  assert.equal(unavailableBack.ok, false);
  assert.equal(unavailableBack.error, 'There is no previous page in this tab.');
  assert.equal(unavailableForward.ok, false);
  assert.equal(unavailableForward.error, 'There is no next page in this tab.');
  assert.deepEqual(activeView.webContents.calls, [
    ['reload'], ['zoom', 1.1], ['back'], ['forward'], ['reload'], ['stop'], ['zoom', 1.2],
  ]);

  const closeActive = await handlers.get('aether:close-tab')(browserEvent, secondTabId);
  assert.equal(closeActive.ok, true);
  assert.equal(getState().tabs.length, 1);
  assert.notEqual(getState().activeTabId, secondTabId);
  assert.equal(browserWindow.contentView.children.size, 1);
  const closedTabBack = await handlers.get('aether:back')(browserEvent, secondTabId);
  assert.equal(closedTabBack.ok, false);
  assert.equal(closedTabBack.error, 'The active tab changed. Try again.');
  activeView.webContents.emit('did-navigate', {}, 'https://late.example/after-close');
  activeView.webContents.emit('page-title-updated', {}, 'Late closed-tab event');
  const remainingTab = getState().tabs[0];
  assert.equal(remainingTab.active, true);
  assert.equal(remainingTab.canGoBack, true);
  assert.equal(remainingTab.canGoForward, true);
  assert.equal(getState().tabs.some((tab) => tab.id === secondTabId), false);
  assert.equal(remainingTab.url, '');
  assert.equal(remainingTab.title, 'New Tab');

  browserWindow.close();
  const reopened = await handlers.get('parmar-aether:open')(controlEvent);
  assert.equal(reopened.ok, true);
  assert.equal(browserSession.listenerCount('will-download'), 1);
  assert.equal(browserSession.requestPolicyRegistrations, 1);
});

test('restored session tabs stay on the local new-tab page until the user retries an address', async (context) => {
  const { cleanup, handlers } = await launchMainForTest({
    initialSession: {
      tabs: ['https://paused.example/path', null],
      activeIndex: 0,
    },
  });
  context.after(cleanup);

  const controlWindow = MockBrowserWindow.windows[0];
  const controlEvent = {
    sender: controlWindow.webContents,
    senderFrame: { parent: null, url: 'http://127.0.0.1:8080/' },
  };
  assert.equal((await handlers.get('parmar-aether:open')(controlEvent)).ok, true);

  const browserWindow = MockBrowserWindow.windows[1];
  const state = browserWindow.webContents.sent
    .filter(({ channel }) => channel === 'aether:state')
    .at(-1).payload;
  assert.equal(state.tabs.length, 2);
  assert.equal(state.tabs[0].restoreUrl, 'https://paused.example/path');
  assert.equal(state.tabs[0].url, '');
  assert.equal(state.tabs[0].active, true);
  assert.equal(MockWebContents.instances.some((contents) => (
    contents.calls.some(([action]) => action === 'navigate')
  )), false);

  MockWebContents.instances.at(-1).emit(
    'did-navigate',
    {},
    pathToFileURL(path.join(__dirname, '..', 'newtab.html')).href,
  );
  const afterLocalLoad = browserWindow.webContents.sent
    .filter(({ channel }) => channel === 'aether:state')
    .at(-1).payload;
  assert.equal(afterLocalLoad.tabs[0].restoreUrl, 'https://paused.example/path');
});

test('concurrent AETHER open requests wait for the same browser startup', async (context) => {
  const { cleanup, handlers } = await launchMainForTest();
  context.after(cleanup);

  const controlWindow = MockBrowserWindow.windows[0];
  const controlEvent = {
    sender: controlWindow.webContents,
    senderFrame: { parent: null, url: 'http://127.0.0.1:8080/' },
  };
  let finishBrowserLoad;
  MockBrowserWindow.browserLoadGate = new Promise((resolve) => {
    finishBrowserLoad = resolve;
  });

  const firstOpen = handlers.get('parmar-aether:open')(controlEvent);
  const secondOpen = handlers.get('parmar-aether:open')(controlEvent);
  let secondSettled = false;
  secondOpen.then(() => { secondSettled = true; });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(MockBrowserWindow.windows.length, 2);
  assert.equal(secondSettled, false);

  finishBrowserLoad();
  const results = await Promise.all([firstOpen, secondOpen]);
  assert.equal(results[0].ok, true);
  assert.equal(results[1].ok, true);
  assert.equal(MockBrowserWindow.windows.length, 2);
  const browserWindow = MockBrowserWindow.windows[1];
  const state = browserWindow.webContents.sent
    .filter((entry) => entry.channel === 'aether:state')
    .at(-1).payload;
  assert.equal(state.tabs.length, 1);
  assert.equal(state.remoteBrowsing, false);
});

test('duplicate Electron launches quit without registering handlers or opening windows', async (context) => {
  const { app, cleanup, handlers } = await launchMainForTest({ hasSingleInstanceLock: false });
  context.after(cleanup);

  assert.equal(app.singleInstanceLockRequests, 1);
  assert.equal(app.quitCount, 1);
  assert.equal(MockBrowserWindow.getAllWindows().length, 0);
  assert.equal(handlers.size, 0);
});

test('a second-instance request restores and focuses only the primary control window', async (context) => {
  const { app, cleanup } = await launchMainForTest();
  context.after(cleanup);
  const controlWindow = MockBrowserWindow.windows[0];
  controlWindow.minimized = true;

  app.emit('second-instance');

  assert.equal(MockBrowserWindow.getAllWindows().length, 1);
  assert.equal(controlWindow.restoreCount, 1);
  assert.equal(controlWindow.focusCount, 1);
});

test('browser chrome renderer crash closes the browser window without enabling remote browsing', async (context) => {
  const { cleanup, handlers } = await launchMainForTest();
  context.after(cleanup);

  const controlWindow = MockBrowserWindow.windows[0];
  const controlEvent = {
    sender: controlWindow.webContents,
    senderFrame: { parent: null, url: 'http://127.0.0.1:8080/' },
  };
  assert.equal((await handlers.get('parmar-aether:open')(controlEvent)).ok, true);
  const browserWindow = MockBrowserWindow.windows[1];

  browserWindow.webContents.emit('render-process-gone', {}, { reason: 'crashed' });

  assert.equal(browserWindow.destroyed, true);
  assert.equal(MockBrowserWindow.getAllWindows().length, 1);
  assert.equal((await handlers.get('parmar-aether:status')(controlEvent)).remoteBrowsing, false);
});

test('browser shell startup failure is reported, cleaned up, and can only retry restricted mode', async (context) => {
  const { cleanup, handlers } = await launchMainForTest({ browserLoadFailure: true });
  context.after(cleanup);

  const controlWindow = MockBrowserWindow.windows[0];
  const controlEvent = {
    sender: controlWindow.webContents,
    senderFrame: { parent: null, url: 'http://127.0.0.1:8080/' },
  };
  const failed = await handlers.get('parmar-aether:open')(controlEvent);
  assert.equal(failed.ok, false);
  assert.equal(typeof failed.error, 'string');
  assert.notEqual(failed.error.length, 0);
  assert.equal(MockBrowserWindow.getAllWindows().length, 1);

  MockBrowserWindow.failBrowserLoad = false;
  const retried = await handlers.get('parmar-aether:open')(controlEvent);
  assert.equal(retried.ok, true);
  assert.equal(MockBrowserWindow.getAllWindows().length, 2);
  assert.equal((await handlers.get('parmar-aether:status')(controlEvent)).remoteBrowsing, false);
});

test('closing all application windows quits the primary app', async (context) => {
  const { app, cleanup } = await launchMainForTest();
  context.after(cleanup);

  app.emit('window-all-closed');

  assert.equal(app.quitCount, 1);
});

test('backend-unavailable fallback can open only the restricted shell through its trusted local bridge', async (context) => {
  const { cleanup, handlers } = await launchMainForTest({ backendUnavailable: true });
  context.after(cleanup);

  const controlWindow = MockBrowserWindow.windows[0];
  const fallbackUrl = pathToFileURL(path.join(__dirname, '..', 'control-unavailable.html')).href;
  const fallbackEvent = {
    sender: controlWindow.webContents,
    senderFrame: { parent: null, url: fallbackUrl },
  };
  const status = await handlers.get('parmar-aether:status')(fallbackEvent);
  assert.equal(status.shell, 'available');
  assert.equal(status.remoteBrowsing, false);

  const untrustedFileStatus = await handlers.get('parmar-aether:status')({
    ...fallbackEvent,
    senderFrame: { parent: null, url: 'file:///tmp/untrusted.html' },
  });
  assert.equal(untrustedFileStatus.shell, 'unavailable');

  const opened = await handlers.get('parmar-aether:open')(fallbackEvent);
  assert.equal(opened.ok, true);
  const browserWindow = MockBrowserWindow.windows[1];
  await assert.rejects(handlers.get('aether:create-tab')({
    sender: browserWindow.webContents,
    senderFrame: { parent: null, url: 'file:///tmp/untrusted.html' },
  }), /untrusted renderer/);
});
