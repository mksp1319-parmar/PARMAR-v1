'use strict';

const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const { SUPPORTED_PERMISSION_TYPES } = require('../permission-policy.cjs');

class MockWebContents extends EventEmitter {
  static instances = [];

  constructor() {
    super();
    this.sent = [];
    this.calls = [];
    this.destroyed = false;
    this.fileLoads = [];
    this.windowOpenHandler = null;
    this.canGoBackValue = true;
    this.canGoForwardValue = true;
    this.zoomFactor = 1;
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
    return this.zoomFactor;
  }

  setZoomFactor(factor) {
    this.zoomFactor = factor;
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

  selectAll() {
    this.calls.push(['select-all']);
  }

  stop() {
    this.calls.push(['stop']);
  }

  loadFile(filePath) {
    this.fileLoads.push(filePath);
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

class MockDownloadItem extends EventEmitter {
  constructor({ fileName = 'report.pdf', totalBytes = 100, receivedBytes = 0 } = {}) {
    super();
    this.fileName = fileName;
    this.totalBytes = totalBytes;
    this.receivedBytes = receivedBytes;
    this.calls = [];
  }

  pause() { this.calls.push(['pause']); }
  cancel() { this.calls.push(['cancel']); }
  getFilename() { return this.fileName; }
  getTotalBytes() { return this.totalBytes; }
  getReceivedBytes() { return this.receivedBytes; }
  setSavePath(value) { this.calls.push(['save-path', value]); }
  resume() { this.calls.push(['resume']); }
}

async function waitForDownloadCondition(predicate, details = () => '') {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`Timed out waiting for the download lifecycle to update. ${details()}`);
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

function createElectronMock(userDataPath, {
  hasSingleInstanceLock = true,
  saveDialogResponses = [],
  partitionFailure = null,
} = {}) {
  const handlers = new Map();
  const popupMenus = [];
  const clipboardWrites = [];
  const saveDialogCalls = [];
  const messageBoxCalls = [];
  let applicationMenu = null;
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

  const sessions = new Map();
  const partitionCalls = [];
  function getSession(partition) {
    if (!sessions.has(partition)) {
      const browserSession = new EventEmitter();
      browserSession.partition = partition;
      browserSession.requestPolicyRegistrations = 0;
      browserSession.permissionRequestRegistrations = 0;
      browserSession.permissionCheckRegistrations = 0;
      browserSession.webRequest = {
        onBeforeRequest(filter, listener) {
          browserSession.requestPolicyRegistrations += 1;
          browserSession.requestPolicy = { filter, listener };
        },
      };
      browserSession.setPermissionRequestHandler = (handler) => {
        browserSession.permissionRequestRegistrations += 1;
        browserSession.permissionRequestHandler = handler;
      };
      browserSession.setPermissionCheckHandler = (handler) => {
        browserSession.permissionCheckRegistrations += 1;
        browserSession.permissionCheckHandler = handler;
      };
      sessions.set(partition, browserSession);
    }
    return sessions.get(partition);
  }
  const browserSession = getSession('persist:parmar-aether-browser-v1');

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
        buildFromTemplate: (template) => Object.assign(template, {
          popup(options) {
            popupMenus.push({ menu: template, options });
          },
        }),
        setApplicationMenu(menu) {
          applicationMenu = menu;
        },
      },
      clipboard: {
        writeText(value) {
          clipboardWrites.push(value);
        },
      },
      dialog: {
        async showSaveDialog(window, options) {
          saveDialogCalls.push({ window, options });
          const response = saveDialogResponses.shift();
          return typeof response === 'function'
            ? response(options)
            : (response || { canceled: true });
        },
        async showMessageBox(window, options) {
          messageBoxCalls.push({ window, options });
          return { response: 0 };
        },
      },
      session: {
        fromPartition(partition) {
          partitionCalls.push(partition);
          if (partition === partitionFailure) throw new Error('mock partition initialization failure');
          return getSession(partition);
        },
      },
    },
    getSession,
    sessions,
    partitionCalls,
    getApplicationMenu: () => applicationMenu,
    popupMenus,
    clipboardWrites,
    saveDialogCalls,
    messageBoxCalls,
  };
}

async function launchMainForTest({
  backendUnavailable = false,
  hasSingleInstanceLock = true,
  browserLoadFailure = false,
  initialSession,
  initialPreferences,
  initialProfileMetadata,
  profileStates = {},
  platform = 'darwin',
  browserSupervisor = null,
  saveDialogResponses = [],
  partitionFailure = null,
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
      ...(initialPreferences ? { preferences: initialPreferences } : {}),
    }));
  }
  if (initialProfileMetadata) {
    fs.writeFileSync(
      path.join(userDataPath, 'aether-profiles.json'),
      JSON.stringify(initialProfileMetadata),
    );
  }
  for (const [profileId, state] of Object.entries(profileStates)) {
    const profileDirectory = profileId === 'default'
      ? userDataPath
      : path.join(userDataPath, 'profile-data', profileId);
    fs.mkdirSync(profileDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(profileDirectory, 'aether-state.json'),
      JSON.stringify(state),
    );
  }
  const {
    electron,
    handlers,
    browserSession,
    getApplicationMenu,
    popupMenus,
    clipboardWrites,
    saveDialogCalls,
    messageBoxCalls,
    sessions,
    partitionCalls,
    getSession,
  } = createElectronMock(userDataPath, {
    hasSingleInstanceLock,
    saveDialogResponses,
    partitionFailure,
  });
  const app = electron.app;
  const mainPath = path.join(__dirname, '..', 'main.cjs');
  const source = fs.readFileSync(mainPath, 'utf8');
  vm.runInNewContext(source, {
    __dirname: path.dirname(mainPath),
    console,
    require: (name) => {
      if (name === 'electron') return electron;
      if (name === './browser-child-supervisor.cjs' && browserSupervisor) {
        return { createBrowserChildSupervisor: () => browserSupervisor };
      }
      if (name.startsWith('.')) return require(path.resolve(path.dirname(mainPath), name));
      return require(name);
    },
    process: {
      platform,
      argv: [],
      execPath: process.execPath,
      env: process.env,
      on() {},
    },
    setImmediate,
    URL,
  });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  return {
    app,
    browserSupervisor,
    getApplicationMenu,
    browserSession,
    sessions,
    partitionCalls,
    getSession,
    userDataPath,
    popupMenus,
    clipboardWrites,
    saveDialogCalls,
    messageBoxCalls,
    cleanup: () => {
      MockBrowserWindow.failBrowserLoad = false;
      MockBrowserWindow.browserLoadGate = null;
      fs.rmSync(userDataPath, { recursive: true, force: true });
    },
    handlers,
  };
}

test('permission requests and checks validate inputs and consistently deny every site permission', async (context) => {
  const { cleanup, handlers, browserSession } = await launchMainForTest();
  context.after(cleanup);
  const controlWindow = MockBrowserWindow.windows[0];
  const controlEvent = {
    sender: controlWindow.webContents,
    senderFrame: { parent: null, url: 'http://127.0.0.1:8080/' },
  };
  assert.equal((await handlers.get('parmar-aether:open')(controlEvent)).ok, true);

  for (const permission of SUPPORTED_PERMISSION_TYPES) {
    let requestResult;
    browserSession.permissionRequestHandler(
      null,
      permission,
      (allowed) => { requestResult = allowed; },
      { securityOrigin: 'https://example.test' },
    );
    const checkResult = browserSession.permissionCheckHandler(
      null,
      permission,
      'https://example.test',
    );
    assert.equal(requestResult, false, `request: ${permission}`);
    assert.equal(checkResult, false, `check: ${permission}`);
  }

  for (const [permission, origin] of [
    ['unknown-permission', 'https://example.test'],
    ['media', 'http://example.test'],
    ['media', 'file:///tmp/page'],
    ['media', 'https://user:secret@example.test'],
  ]) {
    let requestResult;
    browserSession.permissionRequestHandler(
      null,
      permission,
      (allowed) => { requestResult = allowed; },
      { securityOrigin: origin },
    );
    assert.equal(requestResult, false);
    assert.equal(browserSession.permissionCheckHandler(null, permission, origin), false);
  }
  let missingOriginResult;
  browserSession.permissionRequestHandler(
    null,
    'media',
    (allowed) => { missingOriginResult = allowed; },
    {},
  );
  assert.equal(missingOriginResult, false);

  const browserWindow = MockBrowserWindow.windows[1];
  const browserEvent = {
    sender: browserWindow.webContents,
    senderFrame: {
      parent: null,
      url: pathToFileURL(path.join(__dirname, '..', 'browser.html')).href,
    },
  };
  const status = await handlers.get('aether:status')(browserEvent);
  assert.equal(status.remoteBrowsing, false);
  assert.equal(status.privacy.sitePermissionsAvailable, false);
  assert.ok(status.privacy.permissions.every(({ state }) => state === 'denied'));
  assert.equal(handlers.has('aether:set-permission'), false);
  const invalidStatusPayload = await handlers.get('aether:status')(
    browserEvent,
    { permission: 'media', allow: true },
  );
  assert.equal(invalidStatusPayload.ok, false);
  assert.match(invalidStatusPayload.error, /do not accept a payload/);
  await assert.rejects(
    handlers.get('aether:status')({
      ...browserEvent,
      senderFrame: { parent: null, url: 'file:///tmp/untrusted.html' },
    }),
    /untrusted renderer/,
  );
});

test('profile IPC is browser-shell authorized and switches only the next startup selection', async (context) => {
  const {
    cleanup,
    handlers,
    userDataPath,
    partitionCalls,
    browserSession,
  } = await launchMainForTest();
  context.after(cleanup);
  const controlWindow = MockBrowserWindow.windows[0];
  const controlEvent = {
    sender: controlWindow.webContents,
    senderFrame: { parent: null, url: 'http://127.0.0.1:8080/' },
  };
  await handlers.get('parmar-aether:open')(controlEvent);

  const browserWindow = MockBrowserWindow.windows[1];
  const browserEvent = {
    sender: browserWindow.webContents,
    senderFrame: {
      parent: null,
      url: pathToFileURL(path.join(__dirname, '..', 'browser.html')).href,
    },
  };
  const created = await handlers.get('aether:create-profile')(browserEvent, 'Research');
  assert.equal(created.ok, true);
  const profile = created.profiles.profiles.find((entry) => entry.name === 'Research');
  assert.ok(profile);
  assert.equal(created.profiles.activeProfileId, 'default');
  assert.equal((await handlers.get('aether:status')(browserEvent)).profiles.activeProfileId, 'default');

  const invalidName = await handlers.get('aether:create-profile')(browserEvent, '../outside');
  assert.equal(invalidName.ok, false);
  const unknownProfile = await handlers.get('aether:select-profile')(
    browserEvent,
    '323e4567-e89b-12d3-a456-426614174000',
  );
  assert.equal(unknownProfile.ok, false);

  const selected = await handlers.get('aether:select-profile')(browserEvent, profile.id);
  assert.equal(selected.ok, true);
  assert.equal(selected.profiles.activeProfileId, 'default');
  assert.equal(selected.profiles.selectedProfileId, profile.id);
  assert.equal(selected.profiles.restartRequired, true);
  assert.equal((await handlers.get('aether:status')(browserEvent)).profiles.selectedProfileId, profile.id);
  assert.equal(fs.existsSync(path.join(userDataPath, 'aether-state.json')), true);
  assert.equal(fs.existsSync(path.join(userDataPath, 'profile-data', profile.id)), false);
  assert.deepEqual(partitionCalls, ['persist:parmar-aether-browser-v1']);
  assert.equal([...browserWindow.contentView.children][0].options.webPreferences.session, browserSession);

  await assert.rejects(
    handlers.get('aether:select-profile')({
      ...browserEvent,
      senderFrame: { parent: null, url: 'file:///tmp/untrusted.html' },
    }, profile.id),
    /untrusted renderer/,
  );
});

test('browser startup restores only the persisted selected profile metadata', async (context) => {
  const profileId = '123e4567-e89b-12d3-a456-426614174000';
  const profileMetadata = {
    version: 1,
    profiles: [
      { id: 'default', name: 'Default', createdAt: 123 },
      { id: profileId, name: 'Travel', createdAt: 456 },
    ],
    activeProfileId: profileId,
  };
  const profileState = ({ label, url, zoomFactor }) => ({
    version: 1,
    bookmarks: [{ title: `${label} bookmark`, url: `https://${label}.example/bookmark` }],
    history: [{ title: `${label} history`, url: `https://${label}.example/history`, visitedAt: 123 }],
    downloads: [],
    session: {
      tabs: [{ url, pinned: false }],
      activeIndex: 0,
      zoomFactor,
      zoomFactors: [zoomFactor],
    },
    preferences: {
      homepage: 'aether-start',
      startupBehavior: 'restore-session',
      defaultZoom: zoomFactor,
      appearance: 'dark',
    },
  });
  const {
    cleanup,
    handlers,
    userDataPath,
    partitionCalls,
    getSession,
  } = await launchMainForTest({
    initialProfileMetadata: profileMetadata,
    saveDialogResponses: [
      ({ defaultPath }) => ({
        canceled: false,
        filePath: path.join(path.dirname(defaultPath), 'travel-profile-download.pdf'),
      }),
    ],
    profileStates: {
      default: profileState({
        label: 'default',
        url: 'https://default.example/tab',
        zoomFactor: 0.8,
      }),
      [profileId]: profileState({
        label: 'travel',
        url: 'https://travel.example/tab',
        zoomFactor: 1.6,
      }),
    },
  });
  context.after(cleanup);
  const controlWindow = MockBrowserWindow.windows[0];
  const controlEvent = {
    sender: controlWindow.webContents,
    senderFrame: { parent: null, url: 'http://127.0.0.1:8080/' },
  };
  await handlers.get('parmar-aether:open')(controlEvent);

  const browserWindow = MockBrowserWindow.windows[1];
  const browserEvent = {
    sender: browserWindow.webContents,
    senderFrame: {
      parent: null,
      url: pathToFileURL(path.join(__dirname, '..', 'browser.html')).href,
    },
  };
  const state = await handlers.get('aether:status')(browserEvent);
  const browserState = browserWindow.webContents.sent
    .filter(({ channel }) => channel === 'aether:state')
    .at(-1).payload;

  assert.equal(state.profiles.activeProfileId, profileId);
  const profilePartition = `persist:parmar-aether-profile-${profileId}`;
  const profileSession = getSession(profilePartition);
  assert.deepEqual(partitionCalls, [profilePartition]);
  assert.equal(profileSession.permissionRequestRegistrations, 1);
  assert.equal(profileSession.permissionCheckRegistrations, 1);
  assert.equal(profileSession.requestPolicyRegistrations, 1);
  assert.equal(profileSession.listenerCount('will-download'), 1);
  for (const permission of SUPPORTED_PERMISSION_TYPES) {
    let requestAllowed;
    profileSession.permissionRequestHandler(
      null,
      permission,
      (allowed) => { requestAllowed = allowed; },
      { securityOrigin: 'https://example.test' },
    );
    assert.equal(requestAllowed, false);
    assert.equal(profileSession.permissionCheckHandler(
      null,
      permission,
      'https://example.test',
      false,
    ), false);
  }
  for (const url of [
    'http://example.test/',
    'https://example.test/',
    'ws://example.test/',
    'wss://example.test/',
  ]) {
    let blockedRequest;
    profileSession.requestPolicy.listener({ url }, (result) => { blockedRequest = result; });
    assert.equal(blockedRequest.cancel, true);
  }
  const selectedView = [...browserWindow.contentView.children][0];
  assert.equal(selectedView.options.webPreferences.session, profileSession);
  assert.equal(selectedView.webContents.windowOpenHandler({ url: 'https://popup.example/' }).action, 'deny');
  let navigationPrevented = false;
  selectedView.webContents.emit('will-navigate', {
    preventDefault() { navigationPrevented = true; },
  }, 'https://example.test/');
  assert.equal(navigationPrevented, true);
  const profileDownload = new MockDownloadItem({ fileName: 'travel-profile-download.pdf' });
  profileSession.emit('will-download', {}, profileDownload, selectedView.webContents);
  await waitForDownloadCondition(() => profileDownload.calls.some(([action]) => action === 'resume'));
  assert.deepEqual(profileDownload.calls.slice(0, 3), [
    ['pause'],
    ['save-path', path.join(userDataPath, 'travel-profile-download.pdf')],
    ['resume'],
  ]);
  profileDownload.emit('done', {}, 'completed');
  assert.deepEqual(browserState.stored.bookmarks.map(({ title }) => title), ['travel bookmark']);
  assert.deepEqual(browserState.stored.history.map(({ title }) => title), ['travel history']);
  assert.deepEqual(
    Array.from(browserState.tabs, ({ restoreUrl }) => restoreUrl),
    ['https://travel.example/tab'],
  );
  assert.equal(browserState.tabs[0].zoomFactor, 1.6);
  assert.equal(browserState.preferences.defaultZoom, 1.6);
  assert.equal(browserState.closedTabCount, 0);
  assert.equal(fs.existsSync(path.join(userDataPath, 'aether-state.json')), true);
  assert.equal(fs.existsSync(path.join(userDataPath, 'profile-data', profileId, 'aether-state.json')), true);
});

test('restart-selected profiles create distinct sessions and never reuse WebContents', async (context) => {
  const profileId = '123e4567-e89b-12d3-a456-426614174000';
  const profileMetadata = {
    version: 1,
    profiles: [
      { id: 'default', name: 'Default', createdAt: 123 },
      { id: profileId, name: 'Travel', createdAt: 456 },
    ],
    activeProfileId: 'default',
  };
  const stateFor = (url) => ({
    version: 1,
    bookmarks: [],
    history: [],
    downloads: [],
    session: {
      tabs: [{ url, pinned: false }],
      activeIndex: 0,
      zoomFactor: 1,
      zoomFactors: [1],
    },
    preferences: {
      homepage: 'aether-start',
      startupBehavior: 'restore-session',
      defaultZoom: 1,
      appearance: 'dark',
    },
  });
  const first = await launchMainForTest({
    initialProfileMetadata: profileMetadata,
    profileStates: {
      default: stateFor('https://default.example/tab'),
      [profileId]: stateFor('https://travel.example/tab'),
    },
  });
  context.after(first.cleanup);
  const firstControl = MockBrowserWindow.windows[0];
  await first.handlers.get('parmar-aether:open')({
    sender: firstControl.webContents,
    senderFrame: { parent: null, url: 'http://127.0.0.1:8080/' },
  });
  const firstWindow = MockBrowserWindow.windows[1];
  const firstView = [...firstWindow.contentView.children][0];
  const firstWebContents = firstView.webContents;
  assert.equal(firstView.options.webPreferences.session.partition, 'persist:parmar-aether-browser-v1');

  firstWindow.close();
  first.cleanup();
  const second = await launchMainForTest({
    initialProfileMetadata: { ...profileMetadata, activeProfileId: profileId },
    profileStates: {
      default: stateFor('https://default.example/tab'),
      [profileId]: stateFor('https://travel.example/tab'),
    },
  });
  context.after(second.cleanup);
  const secondControl = MockBrowserWindow.windows[0];
  await second.handlers.get('parmar-aether:open')({
    sender: secondControl.webContents,
    senderFrame: { parent: null, url: 'http://127.0.0.1:8080/' },
  });
  const secondWindow = MockBrowserWindow.windows[1];
  const secondView = [...secondWindow.contentView.children][0];
  const secondWebContents = secondView.webContents;
  const secondState = secondWindow.webContents.sent
    .filter(({ channel }) => channel === 'aether:state')
    .at(-1).payload;

  assert.equal(firstWebContents.isDestroyed(), true);
  assert.notEqual(firstWebContents, secondWebContents);
  assert.notEqual(
    firstView.options.webPreferences.session,
    secondView.options.webPreferences.session,
  );
  assert.equal(
    secondView.options.webPreferences.session.partition,
    `persist:parmar-aether-profile-${profileId}`,
  );
  assert.deepEqual(
    Array.from(secondState.tabs, ({ restoreUrl }) => restoreUrl),
    ['https://travel.example/tab'],
  );
});

test('closing tabs and browser windows disposes their WebContents listeners and references', async (context) => {
  const { cleanup, handlers } = await launchMainForTest();
  context.after(cleanup);
  const controlWindow = MockBrowserWindow.windows[0];
  await handlers.get('parmar-aether:open')({
    sender: controlWindow.webContents,
    senderFrame: { parent: null, url: 'http://127.0.0.1:8080/' },
  });
  const browserWindow = MockBrowserWindow.windows[1];
  const browserEvent = {
    sender: browserWindow.webContents,
    senderFrame: {
      parent: null,
      url: pathToFileURL(path.join(__dirname, '..', 'browser.html')).href,
    },
  };
  const firstView = [...browserWindow.contentView.children][0];
  const firstContents = firstView.webContents;
  assert.ok(firstContents.listenerCount('will-navigate') > 0);

  const closeResult = await handlers.get('aether:close-tab')(
    browserEvent,
    browserWindow.webContents.sent
      .filter(({ channel }) => channel === 'aether:state')
      .at(-1).payload.activeTabId,
  );
  assert.equal(closeResult.ok, true);
  assert.equal(firstContents.isDestroyed(), true);
  assert.equal(firstContents.listenerCount('will-navigate'), 0);

  const remainingContents = [...browserWindow.contentView.children][0].webContents;
  assert.ok(remainingContents.listenerCount('will-navigate') > 0);
  browserWindow.close();
  assert.equal(remainingContents.isDestroyed(), true);
  assert.equal(remainingContents.listenerCount('will-navigate'), 0);
});

test('partition initialization failures do not fall back to the default profile', async (context) => {
  const profileId = '123e4567-e89b-12d3-a456-426614174000';
  const { cleanup, handlers, partitionCalls } = await launchMainForTest({
    initialProfileMetadata: {
      version: 1,
      profiles: [
        { id: 'default', name: 'Default', createdAt: 123 },
        { id: profileId, name: 'Travel', createdAt: 456 },
      ],
      activeProfileId: profileId,
    },
    partitionFailure: `persist:parmar-aether-profile-${profileId}`,
  });
  context.after(cleanup);
  const controlWindow = MockBrowserWindow.windows[0];
  const result = await handlers.get('parmar-aether:open')({
    sender: controlWindow.webContents,
    senderFrame: { parent: null, url: 'http://127.0.0.1:8080/' },
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /Chromium session initialization failed/);
  assert.deepEqual(partitionCalls, [`persist:parmar-aether-profile-${profileId}`]);
  assert.equal(MockBrowserWindow.windows.length, 1);
});

test('tab context menus expose applicable actions and preserve paused-link security', async (context) => {
  const { cleanup, handlers, popupMenus, clipboardWrites } = await launchMainForTest();
  context.after(cleanup);
  const controlWindow = MockBrowserWindow.windows[0];
  const controlEvent = {
    sender: controlWindow.webContents,
    senderFrame: { parent: null, url: 'http://127.0.0.1:8080/' },
  };
  await handlers.get('parmar-aether:open')(controlEvent);
  const browserWindow = MockBrowserWindow.windows[1];
  const contents = [...browserWindow.contentView.children][0].webContents;

  contents.canGoBackValue = false;
  contents.canGoForwardValue = false;
  let prevented = false;
  contents.emit('context-menu', {
    preventDefault() { prevented = true; },
  }, {
    x: 40,
    y: 30,
    selectionText: ' selected words ',
    linkURL: 'https://example.com/path',
    mediaType: 'image',
    srcURL: 'https://example.com/image.png',
  });

  assert.equal(prevented, true);
  const firstMenu = popupMenus.at(-1).menu;
  const item = (label) => firstMenu.find((entry) => entry.label === label);
  assert.equal(item('Back').enabled, false);
  assert.equal(item('Forward').enabled, false);
  for (const label of [
    'Reload',
    'Copy selected text',
    'Copy link address',
    'Open link in new tab',
    'Copy image address',
    'Select All',
  ]) {
    assert.ok(item(label), `${label} should be available for this context.`);
  }
  item('Copy selected text').click();
  item('Copy link address').click();
  item('Copy image address').click();
  item('Select All').click();
  assert.deepEqual(clipboardWrites, [
    ' selected words ',
    'https://example.com/path',
    'https://example.com/image.png',
  ]);
  assert.ok(contents.calls.some(([action]) => action === 'select-all'));

  contents.canGoBackValue = true;
  contents.canGoForwardValue = true;
  contents.emit('context-menu', { preventDefault() {} }, { x: 40, y: 30 });
  const navigationMenu = popupMenus.at(-1).menu;
  assert.equal(navigationMenu.find((entry) => entry.label === 'Back').enabled, true);
  assert.equal(navigationMenu.find((entry) => entry.label === 'Forward').enabled, true);
  navigationMenu.find((entry) => entry.label === 'Back').click();
  navigationMenu.find((entry) => entry.label === 'Forward').click();
  navigationMenu.find((entry) => entry.label === 'Reload').click();
  assert.deepEqual(contents.calls.slice(-3), [['back'], ['forward'], ['reload']]);

  item('Open link in new tab').click();
  const state = browserWindow.webContents.sent
    .filter((entry) => entry.channel === 'aether:state')
    .at(-1).payload;
  const openedTab = state.tabs.find((tab) => tab.active);
  assert.equal(openedTab.url, '');
  assert.equal(openedTab.restoreUrl, 'https://example.com/path');
  assert.equal(MockWebContents.instances.some((entry) => (
    entry.calls.some(([action]) => action === 'navigate')
  )), false);
});

test('tab context menus reject invalid link/image URLs and clamp popup positions', async (context) => {
  const { cleanup, handlers, popupMenus } = await launchMainForTest();
  context.after(cleanup);
  const controlWindow = MockBrowserWindow.windows[0];
  const controlEvent = {
    sender: controlWindow.webContents,
    senderFrame: { parent: null, url: 'http://127.0.0.1:8080/' },
  };
  await handlers.get('parmar-aether:open')(controlEvent);
  const browserWindow = MockBrowserWindow.windows[1];
  browserWindow.contentSize = [360, 480];
  const contents = [...browserWindow.contentView.children][0].webContents;

  for (const linkURL of [
    'http://example.com/',
    'javascript:alert(1)',
    'https://user:password@example.com/',
    'file:///etc/passwd',
    `https://example.com/${'x'.repeat(2048)}`,
  ]) {
    contents.emit('context-menu', { preventDefault() {} }, {
      x: 9999,
      y: 9999,
      linkURL,
      mediaType: 'image',
      srcURL: linkURL,
    });
    const labels = Array.from(popupMenus.at(-1).menu, ({ label }) => label).filter(Boolean);
    assert.equal(labels.includes('Copy link address'), false, linkURL);
    assert.equal(labels.includes('Open link in new tab'), false, linkURL);
    assert.equal(labels.includes('Copy image address'), false, linkURL);
    const { x, y, window } = popupMenus.at(-1).options;
    assert.equal(window, browserWindow);
    assert.ok(Number.isFinite(x) && Number.isFinite(y));
    assert.ok(x >= 0 && x + 260 <= browserWindow.contentSize[0]);
    assert.ok(y >= 0 && y <= browserWindow.contentSize[1] - 122);
  }

  contents.emit('context-menu', { preventDefault() {} }, null);
  const fallbackLabels = Array.from(popupMenus.at(-1).menu, ({ label }) => label).filter(Boolean);
  assert.deepEqual(fallbackLabels, ['Back', 'Forward', 'Reload', 'Select All']);
});

test('download requests pause for approval, report progress, finish, and can be cancelled', async (context) => {
  const {
    cleanup,
    handlers,
    userDataPath,
    browserSession,
    saveDialogCalls,
  } = await launchMainForTest({
    saveDialogResponses: [
      ({ defaultPath }) => ({
        canceled: false,
        filePath: path.join(path.dirname(defaultPath), 'report.pdf'),
      }),
      ({ defaultPath }) => ({
        canceled: false,
        filePath: path.join(path.dirname(defaultPath), 'cancel.pdf'),
      }),
      ({ defaultPath }) => ({
        canceled: false,
        filePath: path.join(path.dirname(defaultPath), 'interrupt.pdf'),
      }),
    ],
  });
  context.after(cleanup);
  const controlWindow = MockBrowserWindow.windows[0];
  const controlEvent = {
    sender: controlWindow.webContents,
    senderFrame: { parent: null, url: 'http://127.0.0.1:8080/' },
  };
  await handlers.get('parmar-aether:open')(controlEvent);
  const browserWindow = MockBrowserWindow.windows[1];
  const browserContents = [...browserWindow.contentView.children][0].webContents;
  const browserEvent = {
    sender: browserWindow.webContents,
    senderFrame: { parent: null, url: pathToFileURL(path.join(__dirname, '..', 'browser.html')).href },
  };
  const unownedItem = new MockDownloadItem();
  browserSession.emit('will-download', {}, unownedItem, controlWindow.webContents);
  assert.ok(unownedItem.calls.some(([action]) => action === 'cancel'));
  const latestDownload = () => browserWindow.webContents.sent
    .filter((entry) => entry.channel === 'aether:state')
    .at(-1).payload.downloads[0];

  const item = new MockDownloadItem({ fileName: '../../report.pdf', totalBytes: 100 });
  const requestEvent = {
    prevented: false,
    preventDefault() { this.prevented = true; },
  };
  browserSession.emit('will-download', requestEvent, item, browserContents);
  assert.equal(requestEvent.prevented, false);
  assert.deepEqual(item.calls, [['pause']]);
  await waitForDownloadCondition(
    () => latestDownload()?.state === 'downloading',
    () => JSON.stringify({
      latest: latestDownload(),
      calls: item.calls,
      dialogs: saveDialogCalls.length,
    }),
  );
  assert.deepEqual(Object.keys(latestDownload()).sort(), [
    'error',
    'fileName',
    'id',
    'receivedBytes',
    'state',
    'totalBytes',
    'updatedAt',
  ]);
  assert.equal(latestDownload().fileName, 'report.pdf');
  assert.equal(latestDownload().state, 'downloading');
  assert.deepEqual(item.calls.slice(0, 3), [
    ['pause'],
    ['save-path', path.join(userDataPath, 'report.pdf')],
    ['resume'],
  ]);
  item.receivedBytes = 25;
  item.emit('updated', {}, 'progressing');
  assert.equal(latestDownload().receivedBytes, 25);
  item.receivedBytes = 100;
  item.emit('done', {}, 'completed');
  assert.equal(latestDownload().state, 'completed');
  assert.equal(latestDownload().error, null);

  const cancelItem = new MockDownloadItem({ fileName: 'cancel.pdf' });
  browserSession.emit('will-download', {}, cancelItem, browserContents);
  await waitForDownloadCondition(() => latestDownload()?.state === 'downloading');
  const cancelId = latestDownload().id;
  const cancelled = await handlers.get('aether:cancel-download')(browserEvent, cancelId);
  assert.equal(cancelled.ok, true);
  assert.deepEqual(cancelItem.calls.map(([action]) => action), ['pause', 'save-path', 'resume', 'cancel']);
  assert.equal(latestDownload().state, 'cancelled');
  const invalidCancel = await handlers.get('aether:cancel-download')(browserEvent, '../../invalid');
  assert.equal(invalidCancel.ok, false);

  const interruptedItem = new MockDownloadItem({ fileName: 'interrupt.pdf' });
  browserSession.emit('will-download', {}, interruptedItem, browserContents);
  await waitForDownloadCondition(
    () => latestDownload()?.state === 'downloading',
    () => JSON.stringify({ latest: latestDownload(), calls: interruptedItem.calls }),
  );
  interruptedItem.receivedBytes = 20;
  interruptedItem.emit('updated', {}, 'interrupted');
  assert.equal(latestDownload().state, 'interrupted');
  assert.match(latestDownload().error, /interrupted/);
  await assert.rejects(
    handlers.get('aether:cancel-download')({
      sender: browserContents,
      senderFrame: { parent: null, url: 'https://untrusted.example/' },
    }, cancelId),
    /untrusted renderer/,
  );
});

test('download save cancellation and invalid destinations fail closed', async (context) => {
  const { cleanup, handlers, userDataPath, browserSession } = await launchMainForTest({
    saveDialogResponses: [
      { canceled: true },
      ({ defaultPath }) => ({
        canceled: false,
        filePath: `${path.dirname(defaultPath)}${path.sep}..${path.sep}outside.txt`,
      }),
    ],
  });
  context.after(cleanup);
  const controlWindow = MockBrowserWindow.windows[0];
  await handlers.get('parmar-aether:open')({
    sender: controlWindow.webContents,
    senderFrame: { parent: null, url: 'http://127.0.0.1:8080/' },
  });
  const browserWindow = MockBrowserWindow.windows[1];
  const browserContents = [...browserWindow.contentView.children][0].webContents;
  const latest = () => browserWindow.webContents.sent
    .filter((entry) => entry.channel === 'aether:state')
    .at(-1).payload.downloads[0];
  const cancelledItem = new MockDownloadItem();
  browserSession.emit('will-download', {}, cancelledItem, browserContents);
  await waitForDownloadCondition(() => latest()?.state === 'cancelled');
  assert.equal(latest().state, 'cancelled');
  assert.ok(cancelledItem.calls.some(([action]) => action === 'cancel'));

  const invalidPathItem = new MockDownloadItem({ fileName: '../unsafe.txt' });
  browserSession.emit('will-download', {}, invalidPathItem, browserContents);
  await waitForDownloadCondition(() => latest()?.state === 'failed');
  assert.equal(latest().fileName, 'unsafe.txt');
  assert.equal(latest().state, 'failed');
  assert.match(latest().error, /could not be saved/);
  assert.equal(invalidPathItem.calls.some(([action]) => action === 'save-path'), false);
  assert.ok(invalidPathItem.calls.some(([action]) => action === 'cancel'));
});

test('duplicate download destinations are never overwritten', async (context) => {
  const { cleanup, handlers, userDataPath, browserSession, messageBoxCalls } = await launchMainForTest({
    saveDialogResponses: [
      ({ defaultPath }) => ({
        canceled: false,
        filePath: path.join(path.dirname(defaultPath), 'existing.txt'),
      }),
      ({ defaultPath }) => ({
        canceled: false,
        filePath: path.join(path.dirname(defaultPath), 'new.txt'),
      }),
    ],
  });
  context.after(cleanup);
  const existingPath = path.join(userDataPath, 'existing.txt');
  fs.writeFileSync(existingPath, 'original content');
  const controlWindow = MockBrowserWindow.windows[0];
  await handlers.get('parmar-aether:open')({
    sender: controlWindow.webContents,
    senderFrame: { parent: null, url: 'http://127.0.0.1:8080/' },
  });
  const browserWindow = MockBrowserWindow.windows[1];
  const browserContents = [...browserWindow.contentView.children][0].webContents;
  const item = new MockDownloadItem({ fileName: 'existing.txt' });
  browserSession.emit('will-download', {}, item, browserContents);
  await waitForDownloadCondition(() => messageBoxCalls.length === 1
    && item.calls.some(([action]) => action === 'save-path'));
  assert.equal(fs.readFileSync(existingPath, 'utf8'), 'original content');
  assert.equal(messageBoxCalls.length, 1);
  assert.ok(item.calls.some(([action, destination]) => (
    action === 'save-path' && destination === path.join(userDataPath, 'new.txt')
  )));
});

test('tab management reorders, duplicates, pins, and restores tabs with zoom safely', async (context) => {
  const { cleanup, handlers, popupMenus } = await launchMainForTest({
    initialSession: {
      tabs: [
        { url: 'https://first.example/page', pinned: false },
        { url: 'https://second.example/page', pinned: false },
        { url: 'https://third.example/page', pinned: false },
      ],
      activeIndex: 0,
      zoomFactor: 1.25,
    },
  });
  context.after(cleanup);
  const controlWindow = MockBrowserWindow.windows[0];
  const controlEvent = {
    sender: controlWindow.webContents,
    senderFrame: { parent: null, url: 'http://127.0.0.1:8080/' },
  };
  await handlers.get('parmar-aether:open')(controlEvent);
  const browserWindow = MockBrowserWindow.windows[1];
  const browserEvent = {
    sender: browserWindow.webContents,
    senderFrame: { parent: null, url: pathToFileURL(path.join(__dirname, '..', 'browser.html')).href },
  };
  const getState = () => browserWindow.webContents.sent
    .filter((entry) => entry.channel === 'aether:state')
    .at(-1).payload;
  const [first, second, third] = getState().tabs;
  const firstId = first.id;
  const secondId = second.id;
  const thirdId = third.id;

  assert.equal((await handlers.get('aether:tab-management-menu')(browserEvent, 'invalid')).ok, false);
  const reordered = await handlers.get('aether:reorder-tabs')(
    browserEvent,
    [thirdId, firstId, secondId],
  );
  assert.equal(reordered.ok, true);
  assert.deepEqual(Array.from(getState().tabs, ({ id }) => id), [thirdId, firstId, secondId]);
  assert.equal(getState().activeTabId, firstId);
  assert.equal((await handlers.get('aether:reorder-tabs')(browserEvent, [firstId, firstId, secondId])).ok, false);
  assert.equal((await handlers.get('aether:reorder-tabs')(browserEvent, ['invalid'])).ok, false);

  const menuRequest = await handlers.get('aether:tab-management-menu')(browserEvent, firstId);
  assert.equal(menuRequest.ok, true);
  const menu = popupMenus.at(-1).menu;
  const menuItem = (label) => menu.find((entry) => entry.label === label);
  for (const label of [
    'Duplicate Tab',
    'Pin Tab',
    'Move Tab Left',
    'Move Tab Right',
    'Close Other Tabs',
    'Close Tabs to the Right',
    'Close Tab',
  ]) assert.ok(menuItem(label), `${label} should be available.`);
  assert.equal(menuItem('Move Tab Left').enabled, true);
  assert.equal(menuItem('Move Tab Right').enabled, true);
  menuItem('Pin Tab').click();
  assert.equal(getState().tabs[0].id, firstId);
  assert.equal(getState().tabs[0].pinned, true);

  const pinnedState = getState();
  const savedZoom = pinnedState.tabs[0].zoomFactor;
  const pinnedClose = await handlers.get('aether:close-tab')(browserEvent, firstId);
  assert.equal(pinnedClose.ok, false);
  assert.equal(getState().tabs.some(({ id }) => id === firstId), true);

  menuItem('Duplicate Tab').click();
  const duplicateId = getState().activeTabId;
  const duplicate = getState().tabs.find(({ id }) => id === duplicateId);
  assert.notEqual(duplicateId, firstId);
  assert.equal(duplicate.pinned, false);
  assert.equal(duplicate.url, '');
  assert.equal(duplicate.restoreUrl, first.restoreUrl);
  assert.equal(duplicate.zoomFactor, savedZoom);

  const orderedTabs = Array.from(
    getState().tabs,
    ({ url, restoreUrl, pinned, zoomFactor }) => ({ url, restoreUrl, pinned, zoomFactor }),
  );
  browserWindow.close();
  await handlers.get('parmar-aether:open')(controlEvent);
  const restoredWindow = MockBrowserWindow.windows.at(-1);
  const restoredState = restoredWindow.webContents.sent
    .filter((entry) => entry.channel === 'aether:state')
    .at(-1).payload;
  assert.deepEqual(
    Array.from(
      restoredState.tabs,
      ({ url, restoreUrl, pinned, zoomFactor }) => ({ url, restoreUrl, pinned, zoomFactor }),
    ),
    orderedTabs,
  );
  assert.equal(restoredState.tabs[0].pinned, true);
  assert.equal(restoredState.tabs[0].zoomFactor, savedZoom);
  assert.equal(MockWebContents.instances.some((contents) => (
    contents.calls.some(([action]) => action === 'navigate')
  )), false);
  const restoredBrowserEvent = {
    sender: restoredWindow.webContents,
    senderFrame: browserEvent.senderFrame,
  };
  await handlers.get('aether:tab-management-menu')(
    restoredBrowserEvent,
    restoredState.tabs[0].id,
  );
  const unpinMenu = popupMenus.at(-1).menu.find(({ label }) => label === 'Unpin Tab');
  assert.ok(unpinMenu);
  unpinMenu.click();
  const unpinnedState = restoredWindow.webContents.sent
    .filter((entry) => entry.channel === 'aether:state')
    .at(-1).payload;
  assert.equal(unpinnedState.tabs[0].pinned, false);
  const keyEvent = {
    prevented: false,
    preventDefault() { this.prevented = true; },
  };
  restoredWindow.webContents.emit('before-input-event', keyEvent, {
    type: 'keyDown',
    control: true,
    shift: true,
    key: 'PageUp',
  });
  assert.equal(keyEvent.prevented, true);
  const keyboardReorderedState = restoredWindow.webContents.sent
    .filter((entry) => entry.channel === 'aether:state')
    .at(-1).payload;
  assert.equal(keyboardReorderedState.tabs[2].id, unpinnedState.activeTabId);
});

test('close-other and close-right tab actions retain pinned tabs and honor pinned boundaries', async (context) => {
  const { cleanup, handlers, popupMenus } = await launchMainForTest();
  context.after(cleanup);
  const controlWindow = MockBrowserWindow.windows[0];
  const controlEvent = {
    sender: controlWindow.webContents,
    senderFrame: { parent: null, url: 'http://127.0.0.1:8080/' },
  };
  await handlers.get('parmar-aether:open')(controlEvent);
  const browserWindow = MockBrowserWindow.windows[1];
  const browserEvent = {
    sender: browserWindow.webContents,
    senderFrame: { parent: null, url: pathToFileURL(path.join(__dirname, '..', 'browser.html')).href },
  };
  const getState = () => browserWindow.webContents.sent
    .filter((entry) => entry.channel === 'aether:state')
    .at(-1).payload;
  const pinnedId = getState().activeTabId;
  await handlers.get('aether:tab-management-menu')(browserEvent, pinnedId);
  assert.equal(popupMenus.at(-1).menu.find(({ label }) => label === 'Close Tab').enabled, true);
  popupMenus.at(-1).menu.find(({ label }) => label === 'Pin Tab').click();
  await handlers.get('aether:tab-management-menu')(browserEvent, pinnedId);
  assert.equal(popupMenus.at(-1).menu.find(({ label }) => label === 'Close Tab').enabled, false);
  await handlers.get('aether:create-tab')(browserEvent);
  const targetId = getState().activeTabId;
  await handlers.get('aether:create-tab')(browserEvent);
  const rightId = getState().activeTabId;
  await handlers.get('aether:tab-management-menu')(browserEvent, targetId);
  popupMenus.at(-1).menu.find(({ label }) => label === 'Close Tabs to the Right').click();
  assert.deepEqual(Array.from(getState().tabs, ({ id }) => id), [pinnedId, targetId]);
  assert.equal(getState().tabs[0].pinned, true);

  await handlers.get('aether:create-tab')(browserEvent);
  const otherId = getState().activeTabId;
  await handlers.get('aether:tab-management-menu')(browserEvent, targetId);
  popupMenus.at(-1).menu.find(({ label }) => label === 'Close Other Tabs').click();
  assert.deepEqual(Array.from(getState().tabs, ({ id }) => id), [pinnedId, targetId]);
  assert.equal(getState().tabs.some(({ id }) => id === otherId || id === rightId), false);
});

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
  assert.equal(getState().activeTabId, secondTabId);
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
  browserWindow.webContents.emit('before-input-event', {
    preventDefault() { shortcutPrevented = true; },
  }, { type: 'keyDown', key: 't', control: true });
  assert.equal(shortcutPrevented, true);
  const chromeOpenedTabId = getState().activeTabId;
  assert.notEqual(chromeOpenedTabId, secondTabId);
  assert.equal(browserWindow.contentView.children.size, 1);

  shortcutPrevented = false;
  browserWindow.webContents.emit('before-input-event', {
    preventDefault() { shortcutPrevented = true; },
  }, { type: 'keyDown', key: 'w', control: true });
  assert.equal(shortcutPrevented, true);
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
  assert.equal(
    getState().tabs.find((tab) => tab.id === secondTabId).zoomFactor,
    1.1,
    'Page-level zoom shortcuts must publish the updated zoom to browser chrome.',
  );
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
  assert.equal(browserSession.permissionRequestRegistrations, 1);
  assert.equal(browserSession.permissionCheckRegistrations, 1);
});

test('AETHER Home, address classification, and navigation lifecycle stay scoped to the active tab', async (context) => {
  const { cleanup, handlers } = await launchMainForTest();
  context.after(cleanup);
  const controlWindow = MockBrowserWindow.windows[0];
  const controlEvent = {
    sender: controlWindow.webContents,
    senderFrame: { parent: null, url: 'http://127.0.0.1:8080/' },
  };
  await handlers.get('parmar-aether:open')(controlEvent);
  const browserWindow = MockBrowserWindow.windows[1];
  const browserEvent = {
    sender: browserWindow.webContents,
    senderFrame: { parent: null, url: pathToFileURL(path.join(__dirname, '..', 'browser.html')).href },
  };
  const getState = () => browserWindow.webContents.sent
    .filter(({ channel }) => channel === 'aether:state')
    .at(-1).payload;
  const activeTab = getState().tabs[0];
  const activeView = [...browserWindow.contentView.children][0];
  const startPage = path.join(__dirname, '..', 'newtab.html');

  assert.equal(activeTab.navigationStatus, 'complete');
  assert.equal((await handlers.get('aether:home')(browserEvent, 'invalid')).ok, false);
  assert.equal((await handlers.get('aether:home')(browserEvent, activeTab.id)).ok, true);
  assert.deepEqual(activeView.webContents.fileLoads, [startPage, startPage]);
  activeView.webContents.loading = true;
  activeView.webContents.emit('did-start-loading');
  assert.equal(getState().tabs[0].navigationStatus, 'loading');
  activeView.webContents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://bad.example/', true);
  assert.equal(getState().tabs[0].navigationStatus, 'error');
  assert.match(getState().tabs[0].error, /ERR_NAME_NOT_RESOLVED/);
  activeView.webContents.loading = false;
  activeView.webContents.emit('did-stop-loading');
  assert.equal(getState().tabs[0].navigationStatus, 'error');

  activeView.webContents.emit(
    'did-navigate',
    {},
    pathToFileURL(startPage).href,
  );
  assert.equal(getState().tabs[0].url, '');
  assert.equal(getState().tabs[0].restoreUrl, null);
  assert.equal(getState().tabs[0].title, 'New Tab');
  assert.equal(getState().tabs[0].navigationStatus, 'complete');

  const query = await handlers.get('aether:navigate')(browserEvent, 'PARMAR browser', activeTab.id);
  assert.equal(query.ok, false);
  assert.equal(query.error, 'Search is unavailable while remote browsing is disabled.');
  const malformed = await handlers.get('aether:navigate')(
    browserEvent,
    'https://bad host',
    activeTab.id,
  );
  assert.equal(malformed.ok, false);
  assert.match(malformed.error, /valid HTTPS address or search query/);
  const remote = await handlers.get('aether:navigate')(
    browserEvent,
    'https://example.com/',
    activeTab.id,
  );
  assert.equal(remote.ok, false);
  assert.match(remote.error, /Remote browsing is disabled/);
  assert.deepEqual(activeView.webContents.calls, []);

  let shortcutPrevented = false;
  activeView.webContents.emit('before-input-event', {
    preventDefault() { shortcutPrevented = true; },
  }, { type: 'keyDown', key: 'Home', alt: true });
  assert.equal(shortcutPrevented, true);
  assert.deepEqual(activeView.webContents.fileLoads, [startPage, startPage, startPage]);
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
  assert.equal(state.tabs[0].zoomFactor, 1);
  assert.equal(MockWebContents.instances.some((contents) => (
    contents.calls.some(([action]) => action === 'navigate')
  )), false);
  const browserEvent = {
    sender: browserWindow.webContents,
    senderFrame: {
      parent: null,
      url: pathToFileURL(path.join(__dirname, '..', 'browser.html')).href,
    },
  };
  const bookmarked = await handlers.get('aether:add-bookmark')(browserEvent, state.tabs[0].id);
  assert.equal(bookmarked.ok, true);
  assert.equal(bookmarked.data.length, 1);
  assert.equal(bookmarked.data[0].title, 'paused.example');
  assert.equal(bookmarked.data[0].url, 'https://paused.example/path');
  assert.equal(MockWebContents.instances.some((contents) => (
    contents.calls.some(([action]) => action === 'navigate')
  )), false);
  const staleBookmark = await handlers.get('aether:add-bookmark')(browserEvent, 'closed-tab');
  assert.equal(staleBookmark.ok, false);
  assert.equal(staleBookmark.error, 'The active tab changed. Try again.');
  const renamedBookmark = await handlers.get('aether:update-bookmark')(
    browserEvent,
    'https://paused.example/path',
    'Research notes',
  );
  assert.equal(renamedBookmark.ok, true);
  assert.equal(renamedBookmark.data[0].title, 'Research notes');
  const invalidRename = await handlers.get('aether:update-bookmark')(
    browserEvent,
    'javascript:alert(1)',
    'Unsafe',
  );
  assert.equal(invalidRename.ok, false);
  assert.match(invalidRename.error, /valid HTTPS bookmarks/);
  const invalidTitle = await handlers.get('aether:update-bookmark')(
    browserEvent,
    'https://paused.example/path',
    '  ',
  );
  assert.equal(invalidTitle.ok, false);
  assert.match(invalidTitle.error, /bookmark title/);

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

test('AETHER per-tab zoom persists across restarts without changing other tabs or the new-tab default', async (context) => {
  const { cleanup, handlers, userDataPath } = await launchMainForTest({
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
  let browserWindow = MockBrowserWindow.windows[1];
  const browserEvent = {
    sender: browserWindow.webContents,
    senderFrame: {
      parent: null,
      url: pathToFileURL(path.join(__dirname, '..', 'browser.html')).href,
    },
  };
  const getState = () => browserWindow.webContents.sent
    .filter(({ channel }) => channel === 'aether:state')
    .at(-1).payload;
  let state = getState();
  assert.deepEqual(Array.from(state.tabs, ({ zoomFactor }) => zoomFactor), [1, 1]);
  assert.equal(state.tabs[0].restoreUrl, 'https://paused.example/path');
  assert.equal(state.tabs[0].url, '');

  for (const invalidZoom of [NaN, Infinity, 0.49, 2.01, '1.25']) {
    const invalidResult = await handlers.get('aether:zoom')(
      browserEvent,
      invalidZoom,
      state.activeTabId,
    );
    assert.equal(invalidResult.ok, false, `Invalid zoom ${String(invalidZoom)} should be rejected.`);
    assert.match(invalidResult.error, /Zoom must be between 50% and 200%/);
  }
  assert.deepEqual(Array.from(state.tabs, ({ zoomFactor }) => zoomFactor), [1, 1]);

  const zoomed = await handlers.get('aether:zoom')(browserEvent, 1.25, state.activeTabId);
  assert.equal(zoomed.ok, true);
  assert.equal(zoomed.factor, 1.25);
  state = getState();
  assert.deepEqual(Array.from(state.tabs, ({ zoomFactor }) => zoomFactor), [1.25, 1]);
  assert.equal(state.activeTabId, state.tabs[0].id);

  const newlyCreatedTab = await handlers.get('aether:create-tab')(browserEvent);
  assert.equal(newlyCreatedTab.ok, true);
  state = getState();
  assert.equal(state.tabs.length, 3);
  assert.equal(state.tabs[2].zoomFactor, 1);
  assert.equal(state.activeTabId, state.tabs[2].id);

  const persisted = JSON.parse(fs.readFileSync(path.join(userDataPath, 'aether-state.json'), 'utf8'));
  assert.deepEqual(persisted.session, {
    tabs: [
      { url: 'https://paused.example/path', pinned: false },
      { url: null, pinned: false },
      { url: null, pinned: false },
    ],
    activeIndex: 2,
    zoomFactor: 1,
    zoomFactors: [1.25, 1, 1],
  });

  browserWindow.close();
  assert.equal((await handlers.get('parmar-aether:open')(controlEvent)).ok, true);
  browserWindow = MockBrowserWindow.windows.at(-1);
  state = getState();
  assert.equal(state.tabs.length, 3);
  assert.equal(state.activeTabId, state.tabs[2].id);
  assert.deepEqual(Array.from(state.tabs, ({ zoomFactor }) => zoomFactor), [1.25, 1, 1]);
  assert.equal(state.tabs[0].restoreUrl, 'https://paused.example/path');
  assert.equal(state.tabs[0].url, '');
  assert.equal(MockWebContents.instances.some((contents) => (
    contents.calls.some(([action]) => action === 'navigate')
  )), false);
});

test('AETHER preferences validate, persist, and apply default zoom only to new tabs', async (context) => {
  const { cleanup, handlers, userDataPath } = await launchMainForTest({
    initialSession: {
      tabs: ['https://paused.example/path', null],
      activeIndex: 0,
      zoomFactor: 1.1,
      zoomFactors: [1.2, 1.3],
    },
    initialPreferences: {
      homepage: 'aether-start',
      startupBehavior: 'restore-session',
      defaultZoom: 1.4,
      appearance: 'dark',
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
  const browserEvent = {
    sender: browserWindow.webContents,
    senderFrame: {
      parent: null,
      url: pathToFileURL(path.join(__dirname, '..', 'browser.html')).href,
    },
  };
  const getState = () => browserWindow.webContents.sent
    .filter(({ channel }) => channel === 'aether:state')
    .at(-1).payload;
  assert.deepEqual(Array.from(getState().tabs, ({ zoomFactor }) => zoomFactor), [1.2, 1.3]);

  for (const [key, value] of [
    ['startupBehavior', 'open-remote-page'],
    ['defaultZoom', 2.01],
    ['homepage', 'https://unsafe.example/'],
    ['appearance', 'light'],
  ]) {
    const result = await handlers.get('aether:update-preference')(browserEvent, key, value);
    assert.equal(result.ok, false, `Invalid ${key} should be rejected.`);
  }
  assert.deepEqual(getState().preferences, {
    homepage: 'aether-start',
    startupBehavior: 'restore-session',
    defaultZoom: 1.4,
    appearance: 'dark',
  });

  const updated = await handlers.get('aether:update-preference')(
    browserEvent,
    'startupBehavior',
    'start-page',
  );
  assert.equal(updated.ok, true);
  const zoomUpdate = await handlers.get('aether:update-preference')(
    browserEvent,
    'defaultZoom',
    1.5,
  );
  assert.equal(zoomUpdate.ok, true);
  assert.deepEqual(Array.from(getState().tabs, ({ zoomFactor }) => zoomFactor), [1.2, 1.3]);

  const newTab = await handlers.get('aether:create-tab')(browserEvent);
  assert.equal(newTab.ok, true);
  assert.deepEqual(Array.from(getState().tabs, ({ zoomFactor }) => zoomFactor), [1.2, 1.3, 1.5]);

  const persisted = JSON.parse(fs.readFileSync(path.join(userDataPath, 'aether-state.json'), 'utf8'));
  assert.deepEqual(persisted.preferences, {
    homepage: 'aether-start',
    startupBehavior: 'start-page',
    defaultZoom: 1.5,
    appearance: 'dark',
  });

  const reset = await handlers.get('aether:reset-preferences')(browserEvent);
  assert.equal(reset.ok, true);
  assert.deepEqual(reset.preferences, {
    homepage: 'aether-start',
    startupBehavior: 'restore-session',
    defaultZoom: 1,
    appearance: 'dark',
  });
  assert.deepEqual(Array.from(getState().tabs, ({ zoomFactor }) => zoomFactor), [1.2, 1.3, 1.5]);
  assert.deepEqual(getState().stored.bookmarks, []);
  assert.deepEqual(getState().stored.history, []);
});

test('start-page startup keeps the saved paused session intact and opens only the local page', async (context) => {
  const session = {
    tabs: ['https://paused.example/path', null],
    activeIndex: 0,
    zoomFactor: 1.25,
    zoomFactors: [1.35, 0.9],
  };
  const { cleanup, handlers, userDataPath } = await launchMainForTest({
    initialSession: session,
    initialPreferences: {
      homepage: 'aether-start',
      startupBehavior: 'start-page',
      defaultZoom: 1.1,
      appearance: 'dark',
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
  assert.equal(state.tabs.length, 1);
  assert.equal(state.tabs[0].url, '');
  assert.equal(state.tabs[0].restoreUrl, null);
  assert.equal(state.tabs[0].zoomFactor, 1.1);
  assert.equal(MockWebContents.instances.some((contents) => (
    contents.calls.some(([action]) => action === 'navigate')
  )), false);

  const persisted = JSON.parse(fs.readFileSync(path.join(userDataPath, 'aether-state.json'), 'utf8'));
  assert.deepEqual(persisted.session, {
    tabs: [
      { url: 'https://paused.example/path', pinned: false },
      { url: null, pinned: false },
    ],
    activeIndex: 0,
    zoomFactor: 1.25,
    zoomFactors: [1.35, 0.9],
  });
});

test('invalid saved AETHER zoom falls back to default without changing restored tabs', async (context) => {
  const { cleanup, handlers } = await launchMainForTest({
    initialSession: {
      tabs: ['https://paused.example/path'],
      activeIndex: 0,
      zoomFactor: 8,
    },
  });
  context.after(cleanup);

  const controlWindow = MockBrowserWindow.windows[0];
  const controlEvent = {
    sender: controlWindow.webContents,
    senderFrame: { parent: null, url: 'http://127.0.0.1:8080/' },
  };
  assert.equal((await handlers.get('parmar-aether:open')(controlEvent)).ok, true);
  const state = MockBrowserWindow.windows[1].webContents.sent
    .filter(({ channel }) => channel === 'aether:state')
    .at(-1).payload;
  assert.equal(state.tabs.length, 1);
  assert.equal(state.tabs[0].zoomFactor, 1);
  assert.equal(state.tabs[0].restoreUrl, 'https://paused.example/path');
  assert.equal(state.activeTabId, state.tabs[0].id);
});

test('recently closed tabs reopen in reverse close order with paused URLs and saved zoom', async (context) => {
  const { cleanup, handlers, getApplicationMenu } = await launchMainForTest({
    initialSession: {
      tabs: ['https://first.example/page'],
      activeIndex: 0,
      zoomFactor: 1.25,
    },
  });
  context.after(cleanup);
  const controlWindow = MockBrowserWindow.windows[0];
  const controlEvent = {
    sender: controlWindow.webContents,
    senderFrame: { parent: null, url: 'http://127.0.0.1:8080/' },
  };
  await handlers.get('parmar-aether:open')(controlEvent);

  const browserWindow = MockBrowserWindow.windows[1];
  const browserEvent = {
    sender: browserWindow.webContents,
    senderFrame: {
      parent: null,
      url: pathToFileURL(path.join(__dirname, '..', 'browser.html')).href,
    },
  };
  const getState = () => browserWindow.webContents.sent
    .filter(({ channel }) => channel === 'aether:state')
    .at(-1).payload;
  const [menu] = getApplicationMenu();
  const reopenMenuItem = menu.submenu.find(({ label }) => label === 'Reopen Closed Tab');
  assert.equal(reopenMenuItem.enabled, false);
  assert.equal(reopenMenuItem.accelerator, 'CommandOrControl+Shift+T');
  const emptyHistory = await handlers.get('aether:reopen-closed-tab')(browserEvent);
  assert.equal(emptyHistory.ok, false);
  assert.equal(emptyHistory.error, 'There are no recently closed tabs to reopen.');

  const firstId = getState().activeTabId;
  const firstView = [...browserWindow.contentView.children][0];
  assert.equal(getState().tabs[0].restoreUrl, 'https://first.example/page');
  assert.equal(getState().tabs[0].url, '');
  assert.equal(firstView.webContents.getZoomFactor(), 1.25);
  await handlers.get('aether:create-tab')(browserEvent);
  const secondId = getState().activeTabId;
  const secondView = [...browserWindow.contentView.children][0];
  secondView.webContents.emit('did-navigate', {}, 'https://second.example/page');
  secondView.webContents.setZoomFactor(1.5);

  assert.equal((await handlers.get('aether:close-tab')(browserEvent, secondId)).ok, true);
  assert.equal(getState().activeTabId, firstId);
  assert.equal(reopenMenuItem.enabled, true);
  assert.equal((await handlers.get('aether:close-tab')(browserEvent, firstId)).ok, true);
  assert.equal(getState().closedTabCount, 2);

  await reopenMenuItem.click();
  let reopened = getState().tabs.find((tab) => tab.active);
  assert.equal(reopened.restoreUrl, 'https://first.example/page');
  assert.equal(reopened.url, '');
  assert.equal(reopened.zoomFactor, 1.25);
  assert.equal(getState().closedTabCount, 1);

  const reopenedFirstView = [...browserWindow.contentView.children][0];
  let shortcutPrevented = false;
  reopenedFirstView.webContents.emit('before-input-event', {
    preventDefault() { shortcutPrevented = true; },
  }, { type: 'keyDown', key: 'T', meta: true, shift: true });
  assert.equal(shortcutPrevented, true);
  reopened = getState().tabs.find((tab) => tab.active);
  assert.equal(reopened.restoreUrl, 'https://second.example/page');
  assert.equal(reopened.url, '');
  assert.equal(reopened.zoomFactor, 1.5);
  assert.equal(getState().closedTabCount, 0);
  assert.equal(reopenMenuItem.enabled, false);
  assert.equal(MockWebContents.instances.some((contents) => (
    contents.calls.some(([action]) => action === 'navigate')
  )), false);
});

test('closed-tab history retains only the ten most recently closed tabs', async (context) => {
  const { cleanup, handlers } = await launchMainForTest();
  context.after(cleanup);
  const controlWindow = MockBrowserWindow.windows[0];
  const controlEvent = {
    sender: controlWindow.webContents,
    senderFrame: { parent: null, url: 'http://127.0.0.1:8080/' },
  };
  await handlers.get('parmar-aether:open')(controlEvent);

  const browserWindow = MockBrowserWindow.windows[1];
  const browserEvent = {
    sender: browserWindow.webContents,
    senderFrame: {
      parent: null,
      url: pathToFileURL(path.join(__dirname, '..', 'browser.html')).href,
    },
  };
  const getState = () => browserWindow.webContents.sent
    .filter(({ channel }) => channel === 'aether:state')
    .at(-1).payload;

  for (let index = 1; index <= 12; index += 1) {
    const activeId = getState().activeTabId;
    const activeView = [...browserWindow.contentView.children][0];
    activeView.webContents.emit('did-navigate', {}, `https://page-${index}.example/`);
    assert.equal((await handlers.get('aether:close-tab')(browserEvent, activeId)).ok, true);
  }
  assert.equal(getState().closedTabCount, 10);
  assert.equal((await handlers.get('aether:reopen-closed-tab')(browserEvent)).ok, true);
  assert.equal(getState().tabs.find((tab) => tab.active).restoreUrl, 'https://page-12.example/');
});

test('the reopen menu recreates a closed browser window without navigating remotely', async (context) => {
  const { cleanup, handlers, getApplicationMenu } = await launchMainForTest();
  context.after(cleanup);
  const controlWindow = MockBrowserWindow.windows[0];
  const controlEvent = {
    sender: controlWindow.webContents,
    senderFrame: { parent: null, url: 'http://127.0.0.1:8080/' },
  };
  await handlers.get('parmar-aether:open')(controlEvent);

  let browserWindow = MockBrowserWindow.windows[1];
  const browserEvent = {
    sender: browserWindow.webContents,
    senderFrame: {
      parent: null,
      url: pathToFileURL(path.join(__dirname, '..', 'browser.html')).href,
    },
  };
  const tabId = browserWindow.webContents.sent
    .filter(({ channel }) => channel === 'aether:state')
    .at(-1).payload.activeTabId;
  const activeView = [...browserWindow.contentView.children][0];
  activeView.webContents.emit('did-navigate', {}, 'https://closed.example/page');
  assert.equal((await handlers.get('aether:close-tab')(browserEvent, tabId)).ok, true);
  browserWindow.close();

  const [menu] = getApplicationMenu();
  const reopenMenuItem = menu.submenu.find(({ label }) => label === 'Reopen Closed Tab');
  assert.equal(reopenMenuItem.enabled, true);
  await reopenMenuItem.click();

  browserWindow = MockBrowserWindow.windows[2];
  const state = browserWindow.webContents.sent
    .filter(({ channel }) => channel === 'aether:state')
    .at(-1).payload;
  const reopened = state.tabs.find((tab) => tab.active);
  assert.equal(reopened.restoreUrl, 'https://closed.example/page');
  assert.equal(reopened.url, '');
  assert.equal(MockWebContents.instances.some((contents) => (
    contents.calls.some(([action]) => action === 'navigate')
  )), false);
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

test('tab creation routes enforce the same limit and report expected failures without crashing', async (context) => {
  const { cleanup, handlers, getApplicationMenu } = await launchMainForTest();
  context.after(cleanup);

  const controlWindow = MockBrowserWindow.windows[0];
  const controlEvent = {
    sender: controlWindow.webContents,
    senderFrame: { parent: null, url: 'http://127.0.0.1:8080/' },
  };
  await handlers.get('parmar-aether:open')(controlEvent);
  const browserWindow = MockBrowserWindow.windows[1];
  const browserEvent = {
    sender: browserWindow.webContents,
    senderFrame: {
      parent: null,
      url: pathToFileURL(path.join(__dirname, '..', 'browser.html')).href,
    },
  };
  const getState = () => browserWindow.webContents.sent
    .filter((entry) => entry.channel === 'aether:state')
    .at(-1).payload;

  for (let index = 1; index < 16; index += 1) {
    assert.equal((await handlers.get('aether:create-tab')(browserEvent)).ok, true);
  }
  const activeTabId = getState().activeTabId;
  assert.equal(getState().tabs.length, 16);

  const ipcFailure = await handlers.get('aether:create-tab')(browserEvent);
  assert.equal(ipcFailure.ok, false);
  assert.match(ipcFailure.error, /at most 16 tabs/);
  assert.equal(getState().tabs.length, 16);

  const activeView = [...browserWindow.contentView.children][0];
  let shortcutPrevented = false;
  activeView.webContents.emit('before-input-event', {
    preventDefault() { shortcutPrevented = true; },
  }, { type: 'keyDown', key: 't', control: true });
  assert.equal(shortcutPrevented, true);
  assert.equal(getState().activeTabId, activeTabId);
  assert.equal(getState().tabs.length, 16);
  assert.match(
    browserWindow.webContents.sent.at(-1).payload,
    /at most 16 tabs/,
  );
  assert.equal(browserWindow.webContents.sent.at(-1).channel, 'aether:navigation-error');

  const [applicationMenu] = getApplicationMenu();
  await applicationMenu.submenu[0].click();
  assert.equal(getState().activeTabId, activeTabId);
  assert.equal(getState().tabs.length, 16);
  assert.equal(browserWindow.webContents.sent.at(-1).channel, 'aether:navigation-error');
  assert.match(browserWindow.webContents.sent.at(-1).payload, /at most 16 tabs/);
});

test('new-tab menu startup avoids a duplicate tab and preserves concurrent requests', async (context) => {
  const createSupervisor = () => {
    const supervisor = new EventEmitter();
    supervisor.state = 'stopped';
    supervisor.newTabCalls = 0;
    supervisor.start = async () => {
      supervisor.state = 'ready';
    };
    supervisor.stop = async () => ({});
    supervisor.focus = () => {};
    supervisor.newTab = () => { supervisor.newTabCalls += 1; };
    supervisor.closeTab = () => {};
    return supervisor;
  };

  const firstSupervisor = createSupervisor();
  const firstLaunch = await launchMainForTest({
    platform: 'linux',
    browserSupervisor: firstSupervisor,
  });
  context.after(firstLaunch.cleanup);
  const [firstMenu] = firstLaunch.getApplicationMenu();
  await firstMenu.submenu[0].click();
  await new Promise(setImmediate);
  assert.equal(firstSupervisor.state, 'ready');
  assert.equal(firstSupervisor.newTabCalls, 0);

  const concurrentSupervisor = createSupervisor();
  let resolveStartup;
  const startup = new Promise((resolve) => { resolveStartup = resolve; });
  concurrentSupervisor.start = () => {
    concurrentSupervisor.state = 'starting';
    return startup;
  };
  const concurrentLaunch = await launchMainForTest({
    platform: 'linux',
    browserSupervisor: concurrentSupervisor,
  });
  context.after(concurrentLaunch.cleanup);
  const controlWindow = MockBrowserWindow.windows[0];
  const controlEvent = {
    sender: controlWindow.webContents,
    senderFrame: { parent: null, url: 'http://127.0.0.1:8080/' },
  };
  const opening = concurrentLaunch.handlers.get('parmar-aether:open')(controlEvent);
  assert.equal(concurrentSupervisor.state, 'starting');
  const [concurrentMenu] = concurrentLaunch.getApplicationMenu();
  concurrentMenu.submenu[0].click();
  concurrentSupervisor.state = 'ready';
  resolveStartup();
  assert.equal((await opening).ok, true);
  await new Promise(setImmediate);
  assert.equal(concurrentSupervisor.newTabCalls, 1);
});
