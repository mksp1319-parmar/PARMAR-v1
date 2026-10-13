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
  constructor() {
    super();
    this.sent = [];
    this.calls = [];
    this.destroyed = false;
    this.windowOpenHandler = null;
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
    return true;
  }

  canGoForward() {
    return true;
  }

  isLoading() {
    return false;
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
} = {}) {
  MockBrowserWindow.windows = [];
  MockBrowserWindow.failControlLoad = backendUnavailable;
  MockBrowserWindow.failBrowserLoad = browserLoadFailure;
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'parmar-aether-main-'));
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
    process,
    require: (name) => {
      if (name === 'electron') return electron;
      if (name.startsWith('.')) return require(path.resolve(path.dirname(mainPath), name));
      return require(name);
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
    senderFrame: { isMainFrame: true, url: 'http://127.0.0.1:8080/' },
  };
  const rejectedRedirect = { prevented: false, preventDefault() { this.prevented = true; } };
  controlWindow.webContents.emit('will-redirect', rejectedRedirect, 'https://untrusted.example/');
  assert.equal(rejectedRedirect.prevented, true);
  const sameOriginRedirect = { prevented: false, preventDefault() { this.prevented = true; } };
  controlWindow.webContents.emit('will-redirect', sameOriginRedirect, 'http://127.0.0.1:8080/settings');
  assert.equal(sameOriginRedirect.prevented, false);

  const untrustedFrameStatus = await handlers.get('parmar-aether:status')({
    ...controlEvent,
    senderFrame: { isMainFrame: false, url: 'http://127.0.0.1:8080/' },
  });
  assert.equal(untrustedFrameStatus.shell, 'unavailable');
  const opened = await handlers.get('parmar-aether:open')(controlEvent);
  assert.equal(opened.ok, true);
  const browserWindow = MockBrowserWindow.windows[1];
  assert.equal(
    browserWindow.webContents.windowOpenHandler({ url: 'mailto:user@example.com' }).action,
    'deny',
  );
  const browserEvent = {
    sender: browserWindow.webContents,
    senderFrame: {
      isMainFrame: true,
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

  const getState = () => browserWindow.webContents.sent
    .filter((entry) => entry.channel === 'aether:state')
    .at(-1).payload;
  const originalTabId = getState().activeTabId;
  const initialView = [...browserWindow.contentView.children][0];
  assert.equal(initialView.bounds.y, 184);
  assert.equal(initialView.options.webPreferences.contextIsolation, true);
  assert.equal(initialView.options.webPreferences.nodeIntegration, false);
  assert.equal(initialView.options.webPreferences.sandbox, true);
  assert.equal(initialView.options.webPreferences.webSecurity, true);
  assert.equal(initialView.options.webPreferences.preload, undefined);
  await assert.rejects(handlers.get('aether:create-tab')({
    sender: initialView.webContents,
    senderFrame: { isMainFrame: true, url: 'https://untrusted.example/' },
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

  await handlers.get('aether:create-tab')(browserEvent);
  const secondTabId = getState().activeTabId;
  assert.notEqual(secondTabId, originalTabId);
  assert.equal(browserWindow.contentView.children.size, 1);
  const blockedNavigation = await handlers.get('aether:navigate')(browserEvent, 'https://example.com');
  assert.equal(blockedNavigation.ok, false);
  assert.match(blockedNavigation.error, /no verified operating-system network boundary/);
  assert.equal([...browserWindow.contentView.children][0].webContents.calls.length, 0);

  const secondView = [...browserWindow.contentView.children][0];
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
  [...browserWindow.contentView.children][0].webContents.emit('before-input-event', {
    preventDefault() {},
  }, { type: 'keyDown', key: '+', control: true });
  const closeInactive = await handlers.get('aether:close-tab')(browserEvent, originalTabId);
  assert.deepEqual({ ok: closeInactive.ok }, { ok: true });
  assert.deepEqual(Array.from(getState().tabs, (tab) => tab.id), [secondTabId]);
  assert.equal(browserWindow.contentView.children.size, 1);

  for (const channel of ['aether:back', 'aether:forward', 'aether:reload', 'aether:stop']) {
    const result = await handlers.get(channel)(browserEvent);
    assert.equal(result.ok, true);
  }
  const activeView = [...browserWindow.contentView.children][0];
  assert.deepEqual(activeView.webContents.calls, [
    ['zoom', 1.1], ['back'], ['forward'], ['reload'], ['stop'],
  ]);

  const closeActive = await handlers.get('aether:close-tab')(browserEvent, secondTabId);
  assert.equal(closeActive.ok, true);
  assert.equal(getState().tabs.length, 1);
  assert.notEqual(getState().activeTabId, secondTabId);
  assert.equal(browserWindow.contentView.children.size, 1);

  browserWindow.close();
  const reopened = await handlers.get('parmar-aether:open')(controlEvent);
  assert.equal(reopened.ok, true);
  assert.equal(browserSession.listenerCount('will-download'), 1);
  assert.equal(browserSession.requestPolicyRegistrations, 1);
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
    senderFrame: { isMainFrame: true, url: 'http://127.0.0.1:8080/' },
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
    senderFrame: { isMainFrame: true, url: 'http://127.0.0.1:8080/' },
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
    senderFrame: { isMainFrame: true, url: fallbackUrl },
  };
  const status = await handlers.get('parmar-aether:status')(fallbackEvent);
  assert.equal(status.shell, 'available');
  assert.equal(status.remoteBrowsing, false);

  const untrustedFileStatus = await handlers.get('parmar-aether:status')({
    ...fallbackEvent,
    senderFrame: { isMainFrame: true, url: 'file:///tmp/untrusted.html' },
  });
  assert.equal(untrustedFileStatus.shell, 'unavailable');

  const opened = await handlers.get('parmar-aether:open')(fallbackEvent);
  assert.equal(opened.ok, true);
  const browserWindow = MockBrowserWindow.windows[1];
  await assert.rejects(handlers.get('aether:create-tab')({
    sender: browserWindow.webContents,
    senderFrame: { isMainFrame: true, url: 'file:///tmp/untrusted.html' },
  }), /untrusted renderer/);
});
