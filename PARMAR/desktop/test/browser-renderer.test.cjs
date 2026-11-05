'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const { navigationPolicy, resolveAddressInput } = require('../security.cjs');
const { privacyStatusPayload } = require('../permission-policy.cjs');

function collectText(node) {
  return [
    node.textContent || '',
    ...node.children.flatMap(collectText),
  ];
}

class MockElement {
  constructor(tagName = '') {
    this.tagName = tagName;
    this.children = [];
    this.listeners = new Map();
    this.dataset = {};
    this.style = {};
    this.attributes = {};
    this.scrollLeft = 0;
    this.clientWidth = 240;
    this.scrollWidth = 700;
  }

  append(...children) {
    this.children.push(...children);
  }

  prepend(...children) {
    this.children.unshift(...children);
  }

  replaceChildren(...children) {
    this.children = children;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  focus() {
    this.focused = true;
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }

  select() {
    this.selected = true;
  }

  getBoundingClientRect() {
    return { x: 0, y: 0, left: 0, top: 0, width: 800, height: 600 };
  }

  async click() {
    await this.listeners.get('click')?.({
      preventDefault() {},
      stopPropagation() {},
      target: this,
    });
  }

  async dispatch(type, event = {}) {
    await this.listeners.get(type)?.({ target: this, preventDefault() {}, ...event });
  }

  scrollBy({ left }) {
    this.scrollLeft = Math.max(0, Math.min(this.scrollWidth - this.clientWidth, this.scrollLeft + left));
    this.listeners.get('scroll')?.();
  }
}

function createRenderer({ statusRequest = Promise.resolve({ remoteBrowsing: false }) } = {}) {
  const selectors = [
    '#tabs',
    '#address',
    '#brand-emblem',
    '#address-form',
    '#security-state',
    '#tab-state',
    '#viewport',
    '#side-panel',
    '#panel-title',
    '#panel-content',
    '[data-action="tabs-scroll-left"]',
    '[data-action="tabs-scroll-right"]',
    '[data-action="back"]',
    '[data-action="forward"]',
    '[data-action="stop"]',
    '[data-action="reload"]',
    '[data-action="home"]',
    '[data-action="bookmark"]',
    '[data-action="reopen-closed-tab"]',
  ];
  const elements = new Map(selectors.map((selector) => [selector, new MockElement()]));
  const actions = ['new-tab', 'home', 'tabs-scroll-left', 'tabs-scroll-right', 'reopen-closed-tab', 'back', 'forward', 'reload', 'stop', 'bookmark', 'history', 'bookmarks', 'downloads', 'settings', 'focus-address', 'close-panel']
    .map((action) => {
      const button = elements.get(`[data-action="${action}"]`) || new MockElement('button');
      button.dataset.action = action;
      return button;
    });
  const calls = [];
  const historyCalls = [];
  const controlCalls = [];
  const preferenceCalls = [];
  const clearDownloadHistoryCalls = [];
  const profileCalls = [];
  const downloadCalls = [];
  const bookmarkCalls = [];
  let addBookmarkResult = { ok: true, data: [] };
  let updateBookmarkResult = { ok: true, data: [] };
  let removeBookmarkResult = { ok: true, data: [] };
  let removeHistoryResult = { ok: true, data: [] };
  let clearHistoryResult = { ok: true, data: [] };
  let clearDownloadHistoryResult = { ok: true, downloads: [] };
  let createProfileResult = { ok: true, profiles: null };
  let selectProfileResult = { ok: true, profiles: null };
  let preferences = {
    homepage: 'aether-start',
    startupBehavior: 'restore-session',
    defaultZoom: 1,
    appearance: 'dark',
  };
  const clearHistoryCalls = [];
  const confirmCalls = [];
  const tabCalls = [];
  let confirmResult = true;
  let stateListener;
  let navigationErrorListener;
  let focusAddressListener;
  let resizeCallback;
  let beforeUnloadListener;
  let keydownListener;
  let resizeDisconnected = false;
  let layoutResponse = Promise.resolve({ ok: true });
  const api = {
    navigate(value, id) {
      calls.push([value, id]);
      const result = resolveAddressInput(value);
      if (!result.ok) return Promise.resolve({ ok: false, error: result.reason });
      if (result.kind === 'search') {
        return Promise.resolve({
          ok: false,
          error: 'Search is unavailable while remote browsing is disabled.',
        });
      }
      const policy = navigationPolicy(result.url);
      return Promise.resolve(policy.allowed
        ? { ok: true }
        : { ok: false, error: policy.reason });
    },
    back(id) {
      historyCalls.push(['back', id]);
      return Promise.resolve({ ok: false, error: 'There is no previous page in this tab.' });
    },
    forward(id) {
      historyCalls.push(['forward', id]);
      return Promise.resolve({ ok: false, error: 'There is no next page in this tab.' });
    },
    reload(id) {
      controlCalls.push(['reload', id]);
      return Promise.resolve({ ok: true });
    },
    stop(id) {
      controlCalls.push(['stop', id]);
      return Promise.resolve({ ok: false, error: 'This tab is not loading.' });
    },
    home(id) {
      controlCalls.push(['home', id]);
      return Promise.resolve({ ok: true });
    },
    zoom(factor, id) {
      controlCalls.push(['zoom', factor, id]);
      return Promise.resolve({ ok: true, factor });
    },
    layout() {
      return layoutResponse;
    },
    addBookmark(id) {
      bookmarkCalls.push(id);
      return Promise.resolve(addBookmarkResult);
    },
    updateBookmark(url, title, updatedUrl = url) {
      bookmarkCalls.push([url, title, updatedUrl]);
      return Promise.resolve(updateBookmarkResult);
    },
    clearHistory() {
      clearHistoryCalls.push(true);
      return Promise.resolve(clearHistoryResult);
    },
    updatePreference(name, value) {
      preferenceCalls.push([name, value]);
      preferences = { ...preferences, [name]: value };
      return Promise.resolve({ ok: true, preferences: { ...preferences } });
    },
    resetPreferences() {
      preferences = {
        homepage: 'aether-start',
        startupBehavior: 'restore-session',
        defaultZoom: 1,
        appearance: 'dark',
      };
      return Promise.resolve({ ok: true, preferences: { ...preferences } });
    },
    clearDownloadHistory() {
      clearDownloadHistoryCalls.push(true);
      return Promise.resolve(clearDownloadHistoryResult);
    },
    createProfile(name) {
      profileCalls.push(['create', name]);
      return Promise.resolve(createProfileResult);
    },
    selectProfile(id) {
      profileCalls.push(['select', id]);
      return Promise.resolve(selectProfileResult);
    },
    removeBookmark: () => Promise.resolve(removeBookmarkResult),
    removeHistory: () => Promise.resolve(removeHistoryResult),
    onState(callback) {
      stateListener = callback;
      return () => { stateListener = null; };
    },
    onNavigationError(callback) {
      navigationErrorListener = callback;
      return () => { navigationErrorListener = null; };
    },
    onFocusAddress(callback) {
      focusAddressListener = callback;
      return () => { focusAddressListener = null; };
    },
    getStatus: () => statusRequest,
    createTab() {
      tabCalls.push(['create']);
      return Promise.resolve({ ok: true });
    },
    activateTab(id) {
      tabCalls.push(['activate', id]);
      return Promise.resolve({ ok: true });
    },
    closeTab(id) {
      tabCalls.push(['close', id]);
      return Promise.resolve({ ok: true });
    },
    reopenClosedTab() {
      tabCalls.push(['reopen']);
      return Promise.resolve({ ok: true });
    },
    showTabManagementMenu(id) {
      tabCalls.push(['tab-menu', id]);
      return Promise.resolve({ ok: true });
    },
    reorderTabs(ids) {
      tabCalls.push(['reorder', ids]);
      return Promise.resolve({ ok: true });
    },
    cancelDownload(id) {
      downloadCalls.push(id);
      return Promise.resolve({ ok: true });
    },
  };
  const rootElement = { dataset: {} };
  const document = {
    activeElement: null,
    documentElement: rootElement,
    createElement: (tagName) => {
      const element = new MockElement(tagName);
      element.ownerDocument = document;
      return element;
    },
    createElementNS: (_namespace, tagName) => {
      const element = new MockElement(tagName);
      element.ownerDocument = document;
      return element;
    },
    querySelector: (selector) => elements.get(selector) || new MockElement(),
    querySelectorAll: () => actions,
  };
  for (const element of elements.values()) element.ownerDocument = document;
  const window = {
    aetherDesktop: api,
    addEventListener(type, listener) {
      if (type === 'beforeunload') beforeUnloadListener = listener;
      if (type === 'keydown') keydownListener = listener;
    },
    confirm(message) {
      confirmCalls.push(message);
      return confirmResult;
    },
  };
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'browser-renderer.cjs'),
    'utf8',
  );
  vm.runInNewContext(source, {
    window,
    document,
    ResizeObserver: class {
      constructor(callback) {
        resizeCallback = callback;
      }

      observe() {}
      disconnect() {
        resizeDisconnected = true;
      }
    },
  });
  return {
    actions,
    api,
    calls,
    document,
    elements,
    rootElement,
    historyCalls,
    controlCalls,
    preferenceCalls,
    clearDownloadHistoryCalls,
    profileCalls,
    downloadCalls,
    bookmarkCalls,
    clearHistoryCalls,
    confirmCalls,
    tabCalls,
    setConfirmResult(result) {
      confirmResult = result;
    },
    setAddBookmarkResult(result) {
      addBookmarkResult = result;
    },
    setUpdateBookmarkResult(result) {
      updateBookmarkResult = result;
    },
    setRemoveBookmarkResult(result) {
      removeBookmarkResult = result;
    },
    setRemoveHistoryResult(result) {
      removeHistoryResult = result;
    },
    setClearHistoryResult(result) {
      clearHistoryResult = result;
    },
    setClearDownloadHistoryResult(result) {
      clearDownloadHistoryResult = result;
    },
    setCreateProfileResult(result) {
      createProfileResult = result;
    },
    setSelectProfileResult(result) {
      selectProfileResult = result;
    },
    setLayoutResponse(result) {
      layoutResponse = result;
    },
    resize() {
      return resizeCallback?.();
    },
    unload() {
      beforeUnloadListener?.();
    },
    isResizeDisconnected: () => resizeDisconnected,
    isSubscribed: () => Boolean(stateListener || navigationErrorListener || focusAddressListener),
    setState: (...args) => stateListener(...args),
    focusAddress() {
      document.activeElement = elements.get('#address');
    },
    async keydown(event) {
      let prevented = false;
      await keydownListener?.({ preventDefault() { prevented = true; }, ...event });
      return prevented;
    },
  };
}

test('search shortcut focuses and selects the existing address field', async () => {
  const renderer = createRenderer();

  await renderer.actions.find((button) => button.dataset.action === 'focus-address').click();

  assert.equal(renderer.elements.get('#address').focused, true);
  assert.equal(renderer.elements.get('#address').selected, true);
});

test('Home returns to the active tab start page without opening another tab', async () => {
  const renderer = createRenderer();
  renderer.setState({
    remoteBrowsing: false,
    tabs: [{ id: 'home-tab', title: 'Saved page', url: '', restoreUrl: 'https://saved.example/', active: true }],
    stored: { bookmarks: [], history: [] },
  });
  renderer.focusAddress();
  renderer.elements.get('#address').value = 'https://unsaved.example/';
  renderer.api.home = (id) => {
    renderer.controlCalls.push(['home', id]);
    renderer.setState({
      remoteBrowsing: false,
      tabs: [{
        id: 'home-tab',
        title: 'New Tab',
        url: '',
        restoreUrl: null,
        active: true,
        isLoading: false,
      }],
      stored: { bookmarks: [], history: [] },
    });
    return Promise.resolve({ ok: true });
  };

  await renderer.actions.find((button) => button.dataset.action === 'home').click();
  assert.deepEqual(renderer.controlCalls, [['home', 'home-tab']]);
  assert.deepEqual(renderer.tabCalls, []);
  assert.equal(renderer.elements.get('#address').value, '');
});

test('Reopen Closed Tab is disabled when empty and works from the visible action and keyboard shortcut', async () => {
  const renderer = createRenderer();
  const reopenButton = renderer.actions.find(
    (button) => button.dataset.action === 'reopen-closed-tab',
  );
  renderer.setState({
    remoteBrowsing: false,
    closedTabCount: 0,
    tabs: [],
    stored: { bookmarks: [], history: [] },
  });
  assert.equal(reopenButton.disabled, true);
  await reopenButton.click();
  assert.equal(await renderer.keydown({ ctrlKey: true, shiftKey: true, key: 'T' }), true);
  assert.deepEqual(renderer.tabCalls, []);

  renderer.setState({
    remoteBrowsing: false,
    closedTabCount: 1,
    tabs: [],
    stored: { bookmarks: [], history: [] },
  });
  assert.equal(reopenButton.disabled, false);
  await reopenButton.click();
  assert.equal(await renderer.keydown({ metaKey: true, shiftKey: true, key: 't' }), true);
  assert.deepEqual(renderer.tabCalls, [['reopen'], ['reopen']]);
});

test('tab drag reorders within pin groups and tab controls expose accessible management actions', async () => {
  const renderer = createRenderer();
  renderer.setState({
    remoteBrowsing: false,
    closedTabCount: 0,
    tabs: [
      { id: 'pinned', title: 'Pinned', active: false, pinned: true },
      { id: 'one', title: 'One', active: true, pinned: false },
      { id: 'two', title: 'Two', active: false, pinned: false },
    ],
    stored: { bookmarks: [], history: [] },
  });

  const [pinnedTab, firstTab, secondTab] = renderer.elements.get('#tabs').children;
  assert.match(pinnedTab.className, /tab-pinned/);
  assert.equal(pinnedTab.children[0].children.some((child) => child.textContent === 'PIN'), true);
  assert.equal(pinnedTab.children[2].disabled, true);
  assert.equal(pinnedTab.children[1].attributes['aria-label'], 'Tab actions for Pinned');

  await firstTab.dispatch('dragstart', { dataTransfer: { setData() {}, effectAllowed: '' } });
  await secondTab.dispatch('drop', {
    clientX: 700,
    dataTransfer: { getData: () => 'one' },
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(renderer.tabCalls.at(-1))),
    ['reorder', ['pinned', 'two', 'one']],
  );

  await pinnedTab.children[1].click();
  assert.deepEqual(renderer.tabCalls.at(-1), ['tab-menu', 'pinned']);
  await renderer.actions.find((button) => button.dataset.action === 'tabs-scroll-right').click();
  assert.equal(renderer.elements.get('#tabs').scrollLeft > 0, true);
  assert.equal(renderer.actions.find((button) => button.dataset.action === 'tabs-scroll-left').disabled, false);
});

test('tablist arrow keys navigate and wrap in the existing pinned and unpinned order', async () => {
  const renderer = createRenderer();
  const tabs = [
    { id: 'pinned-one', title: 'Pinned one', active: true, pinned: true },
    { id: 'pinned-two', title: 'Pinned two', active: false, pinned: true },
    { id: 'regular-one', title: 'Regular one', active: false, pinned: false },
    { id: 'regular-two', title: 'Regular two', active: false, pinned: false },
  ];
  renderer.setState({
    remoteBrowsing: false,
    tabs,
    stored: { bookmarks: [], history: [] },
  });
  const focusTab = (id) => {
    const wrapper = renderer.elements.get('#tabs').children
      .find((entry) => entry.dataset.tabId === id);
    const button = wrapper.children[0];
    renderer.document.activeElement = button;
    return button;
  };

  await renderer.keydown({ key: 'ArrowLeft', target: focusTab('pinned-one') });
  assert.deepEqual(renderer.tabCalls, [['activate', 'regular-two']]);
  assert.equal(renderer.elements.get('#tabs').children[3].children[0].focused, true);

  await renderer.keydown({ key: 'ArrowRight', target: focusTab('regular-two') });
  assert.deepEqual(renderer.tabCalls.at(-1), ['activate', 'pinned-one']);
  await renderer.keydown({ key: 'ArrowRight', target: focusTab('pinned-one') });
  assert.deepEqual(renderer.tabCalls.at(-1), ['activate', 'pinned-two']);
  await renderer.keydown({ key: 'ArrowLeft', target: focusTab('pinned-two') });
  assert.deepEqual(renderer.tabCalls.at(-1), ['activate', 'pinned-one']);

  assert.deepEqual(tabs.map(({ id }) => id), [
    'pinned-one',
    'pinned-two',
    'regular-one',
    'regular-two',
  ]);
  assert.deepEqual(
    renderer.elements.get('#tabs').children.map((entry) => entry.dataset.tabId),
    tabs.map(({ id }) => id),
  );
  assert.equal(renderer.tabCalls.every(([action]) => action === 'activate'), true);
});

test('tablist Home and End select the first and last tabs without mutating tab management', async () => {
  const renderer = createRenderer();
  renderer.setState({
    remoteBrowsing: false,
    tabs: [
      { id: 'pinned', title: 'Pinned', active: false, pinned: true },
      { id: 'regular-one', title: 'Regular one', active: true, pinned: false },
      { id: 'regular-two', title: 'Regular two', active: false, pinned: false },
    ],
    stored: { bookmarks: [], history: [] },
  });
  const focusedButton = (index) => {
    const button = renderer.elements.get('#tabs').children[index].children[0];
    renderer.document.activeElement = button;
    return button;
  };

  await renderer.keydown({ key: 'Home', target: focusedButton(1) });
  assert.deepEqual(renderer.tabCalls, [['activate', 'pinned']]);
  assert.equal(renderer.elements.get('#tabs').children[0].children[0].focused, true);

  await renderer.keydown({ key: 'End', target: focusedButton(0) });
  assert.deepEqual(renderer.tabCalls.at(-1), ['activate', 'regular-two']);
  assert.equal(renderer.tabCalls.every(([action]) => action === 'activate'), true);
});

test('tab navigation keys do not switch tabs from tab menu or close controls', async () => {
  const renderer = createRenderer();
  renderer.setState({
    remoteBrowsing: false,
    tabs: [
      { id: 'first', title: 'First', active: true, pinned: false },
      { id: 'second', title: 'Second', active: false, pinned: false },
    ],
    stored: { bookmarks: [], history: [] },
  });
  const controls = renderer.elements.get('#tabs').children
    .flatMap((tab) => [tab.children[1], tab.children[2]]);

  for (const control of controls) {
    for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
      assert.equal(
        await renderer.keydown({ key, target: control }),
        false,
        `${key} should not be consumed by ${control.dataset.tabControl} control`,
      );
    }
  }
  assert.deepEqual(renderer.tabCalls, []);
});

test('tablist navigation preserves focus and selected accessibility state after state updates', async () => {
  const renderer = createRenderer();
  const tabs = [
    { id: 'first', title: 'First', active: true, pinned: false },
    { id: 'second', title: 'Second', active: false, pinned: false },
  ];
  renderer.setState({
    remoteBrowsing: false,
    tabs,
    stored: { bookmarks: [], history: [] },
  });
  const firstButton = renderer.elements.get('#tabs').children[0].children[0];
  renderer.document.activeElement = firstButton;

  await renderer.keydown({ key: 'ArrowRight', target: firstButton });
  renderer.setState({
    remoteBrowsing: false,
    tabs: [
      { ...tabs[0], active: false },
      { ...tabs[1], active: true },
    ],
    stored: { bookmarks: [], history: [] },
  });

  const [first, second] = renderer.elements.get('#tabs').children.map(
    (wrapper) => wrapper.children[0],
  );
  assert.equal(first.attributes['aria-selected'], 'false');
  assert.equal(first.tabIndex, -1);
  assert.equal(second.attributes['aria-selected'], 'true');
  assert.equal(second.tabIndex, 0);
  assert.equal(second.focused, true);
});

test('tablist navigation safely handles empty and single-tab states', async () => {
  const renderer = createRenderer();
  renderer.setState({
    remoteBrowsing: false,
    tabs: [],
    stored: { bookmarks: [], history: [] },
  });
  assert.equal(await renderer.keydown({ key: 'ArrowLeft', target: null }), false);
  assert.equal(await renderer.keydown({ key: 'Home', target: null }), false);
  assert.deepEqual(renderer.tabCalls, []);

  renderer.setState({
    remoteBrowsing: false,
    tabs: [{ id: 'only', title: 'Only tab', active: true, pinned: true }],
    stored: { bookmarks: [], history: [] },
  });
  const button = renderer.elements.get('#tabs').children[0].children[0];
  renderer.document.activeElement = button;
  for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
    assert.equal(await renderer.keydown({ key, target: button }), true);
  }
  assert.equal(button.focused, true);
  assert.deepEqual(renderer.tabCalls, []);
});

test('tab focus stays valid when the focused tab is removed or selection changes', () => {
  const renderer = createRenderer();
  renderer.setState({
    remoteBrowsing: false,
    tabs: [
      { id: 'first', title: 'First', active: true, pinned: false },
      { id: 'second', title: 'Second', active: false, pinned: false },
    ],
    stored: { bookmarks: [], history: [] },
  });
  const firstButton = renderer.elements.get('#tabs').children[0].children[0];
  renderer.document.activeElement = firstButton;

  renderer.setState({
    remoteBrowsing: false,
    tabs: [{ id: 'second', title: 'Second', active: true, pinned: false }],
    stored: { bookmarks: [], history: [] },
  });
  let secondTab = renderer.elements.get('#tabs').children[0];
  assert.equal(secondTab.children[0].focused, true);
  assert.equal(renderer.document.activeElement, secondTab.children[0]);

  renderer.document.activeElement = secondTab.children[1];
  renderer.setState({
    remoteBrowsing: false,
    tabs: [{ id: 'second', title: 'Second', active: true, pinned: true }],
    stored: { bookmarks: [], history: [] },
  });
  secondTab = renderer.elements.get('#tabs').children[0];
  assert.equal(secondTab.children[1].focused, true);
  assert.equal(renderer.document.activeElement, secondTab.children[1]);

  renderer.document.activeElement = secondTab.children[0];
  renderer.setState({
    remoteBrowsing: false,
    tabs: [
      { id: 'second', title: 'Second', active: false, pinned: true },
      { id: 'third', title: 'Third', active: true, pinned: false },
    ],
    stored: { bookmarks: [], history: [] },
  });
  assert.equal(renderer.elements.get('#tabs').children[1].children[0].focused, true);
});

test('Downloads panel displays validated progress and exposes cancellation only while active', async () => {
  const renderer = createRenderer();
  renderer.setState({
    remoteBrowsing: false,
    tabs: [],
    stored: { bookmarks: [], history: [] },
    downloads: [{
      id: '123e4567-e89b-12d3-a456-426614174000',
      fileName: 'report.pdf',
      receivedBytes: 50,
      totalBytes: 100,
      state: 'downloading',
      error: null,
    }],
  });
  await renderer.actions.find((button) => button.dataset.action === 'downloads').click();

  const panel = renderer.elements.get('#panel-content');
  const card = panel.children[0].children[0];
  assert.equal(card.children[0].textContent, 'report.pdf');
  assert.equal(card.children.some((child) => child.tagName === 'progress'), true);
  const cancel = card.children.find((child) => child.textContent === 'Cancel download');
  assert.ok(cancel);
  await cancel.click();
  assert.deepEqual(renderer.downloadCalls, ['123e4567-e89b-12d3-a456-426614174000']);

  renderer.setState({
    remoteBrowsing: false,
    tabs: [],
    stored: { bookmarks: [], history: [] },
    downloads: [{
      id: '123e4567-e89b-12d3-a456-426614174000',
      fileName: 'report.pdf',
      receivedBytes: 100,
      totalBytes: 100,
      state: 'completed',
      error: null,
    }],
  });
  const completedCard = panel.children[0].children[0];
  assert.equal(completedCard.children.some((child) => child.textContent === 'Cancel download'), false);
});

test('Ctrl+Tab refreshes a focused address bar without replacing edits on the same tab', async () => {
  const renderer = createRenderer();
  const firstTab = {
    id: 'first-tab',
    title: 'First',
    url: 'https://first.example/',
    active: true,
  };
  renderer.setState({
    remoteBrowsing: false,
    tabs: [firstTab, { id: 'second-tab', title: 'Second', url: 'https://second.example/', active: false }],
    stored: { bookmarks: [], history: [] },
  });
  renderer.focusAddress();
  renderer.elements.get('#address').value = 'https://unfinished.example';

  await renderer.keydown({ ctrlKey: true, key: 'Tab' });
  assert.deepEqual(renderer.tabCalls, [['activate', 'second-tab']]);
  renderer.setState({
    remoteBrowsing: false,
    tabs: [
      { ...firstTab, active: false },
      { id: 'second-tab', title: 'Second', url: 'https://second.example/', active: true },
    ],
    stored: { bookmarks: [], history: [] },
  });
  assert.equal(renderer.elements.get('#address').value, 'https://second.example/');

  renderer.elements.get('#address').value = 'https://still-editing.example';
  renderer.setState({
    remoteBrowsing: false,
    tabs: [
      { ...firstTab, active: false },
      {
        id: 'second-tab',
        title: 'Second updated',
        url: 'https://second.example/updated',
        active: true,
      },
    ],
    stored: { bookmarks: [], history: [] },
  });
  assert.equal(renderer.elements.get('#address').value, 'https://still-editing.example');

});

test('settings zoom buttons and keyboard shortcuts update the active tab', async () => {
  const renderer = createRenderer();
  renderer.setState({
    remoteBrowsing: false,
    tabs: [{
      id: 'zoom-tab',
      title: 'New Tab',
      active: true,
      zoomFactor: 1,
    }],
    stored: { bookmarks: [], history: [] },
  });
  await renderer.actions.find((button) => button.dataset.action === 'settings').click();
  const panelContent = renderer.elements.get('#panel-content');
  const zoomButtons = panelContent.children[3].children;
  assert.equal(panelContent.children[2].textContent, 'Current zoom: 100%');
  await zoomButtons.find((button) => button.textContent === 'Zoom in').click();
  assert.deepEqual(renderer.controlCalls, [['zoom', 1.1, 'zoom-tab']]);
  assert.equal(panelContent.children[2].textContent, 'Current zoom: 110%');

  await renderer.keydown({ ctrlKey: true, key: '-' });
  assert.deepEqual(renderer.controlCalls.at(-1), ['zoom', 1, 'zoom-tab']);
  await renderer.keydown({ ctrlKey: true, key: '0' });
  assert.deepEqual(renderer.controlCalls.at(-1), ['zoom', 1, 'zoom-tab']);
});

test('settings persist supported preferences and preserve current tab zoom', async () => {
  const renderer = createRenderer();
  renderer.setState({
    remoteBrowsing: false,
    preferences: {
      homepage: 'aether-start',
      startupBehavior: 'restore-session',
      defaultZoom: 1,
      appearance: 'dark',
    },
    tabs: [{
      id: 'existing-tab',
      title: 'Existing',
      active: true,
      zoomFactor: 1.35,
    }],
    stored: { bookmarks: [], history: [] },
  });
  await renderer.actions.find((button) => button.dataset.action === 'settings').click();

  const content = renderer.elements.get('#panel-content');
  const fields = content.children[1].children;
  const homepage = fields[0].children[1];
  const startup = fields[1].children[1];
  const defaultZoom = fields[2].children[1];
  const appearance = fields[3].children[1];
  assert.equal(homepage.disabled, true);
  assert.equal(appearance.disabled, true);
  assert.equal(renderer.rootElement.dataset.theme, 'dark');

  startup.value = 'start-page';
  await startup.dispatch('change');
  defaultZoom.value = '1.4';
  await defaultZoom.dispatch('change');

  assert.deepEqual(renderer.preferenceCalls, [
    ['startupBehavior', 'start-page'],
    ['defaultZoom', 1.4],
  ]);
  assert.equal(renderer.elements.get('#tab-state').textContent, 'Default zoom updated for new tabs. Existing tab zoom was preserved.');
  assert.equal(renderer.elements.get('#panel-content').children[1].children[2].children[1].value, '1.4');
  assert.equal(renderer.elements.get('#panel-content').children[2].textContent, 'Current zoom: 135%');
});

test('settings clear-data and reset controls confirm scope and preserve unrelated data', async () => {
  const renderer = createRenderer();
  const historyRecord = { title: 'Visited', url: 'https://visited.example/' };
  const bookmarkRecord = { title: 'Saved', url: 'https://saved.example/' };
  const activeDownload = {
    id: 'active-download',
    fileName: 'active.zip',
    state: 'downloading',
  };
  renderer.setState({
    remoteBrowsing: false,
    preferences: {
      homepage: 'aether-start',
      startupBehavior: 'start-page',
      defaultZoom: 1.4,
      appearance: 'dark',
    },
    tabs: [{ id: 'tab', title: 'Tab', active: true, zoomFactor: 1.25 }],
    stored: { history: [historyRecord], bookmarks: [bookmarkRecord] },
    downloads: [activeDownload],
  });
  renderer.setClearDownloadHistoryResult({ ok: true, downloads: [activeDownload] });
  await renderer.actions.find((button) => button.dataset.action === 'settings').click();
  const getControls = () => renderer.elements.get('#panel-content').children[4];
  const clearHistory = getControls().children[0].children[0];
  const clearDownloads = getControls().children[1].children[0];
  const reset = getControls().children[2];

  renderer.setConfirmResult(false);
  await clearHistory.click();
  await clearDownloads.click();
  await reset.click();
  assert.deepEqual(renderer.clearHistoryCalls, []);
  assert.deepEqual(renderer.clearDownloadHistoryCalls, []);
  assert.deepEqual(renderer.preferenceCalls, []);

  renderer.setConfirmResult(true);
  await clearHistory.click();
  assert.deepEqual(renderer.clearHistoryCalls, [true]);
  assert.equal(renderer.elements.get('#tab-state').textContent, 'Browsing history cleared.');

  await clearDownloads.click();
  assert.deepEqual(renderer.clearDownloadHistoryCalls, [true]);
  assert.equal(renderer.elements.get('#tab-state').textContent, 'Inactive download records cleared. Saved files were not removed.');
  assert.deepEqual(renderer.elements.get('#panel-content').children[4].children[0].children[0].textContent, 'Clear browsing history');

  await renderer.elements.get('#panel-content').children[4].children[2].click();
  assert.equal(renderer.elements.get('#tab-state').textContent, 'AETHER preferences reset. Existing tab zoom was preserved.');
  assert.equal(renderer.elements.get('#panel-content').children[1].children[1].children[1].value, 'restore-session');
  assert.equal(renderer.elements.get('#panel-content').children[2].textContent, 'Current zoom: 125%');
  assert.deepEqual(renderer.elements.get('#panel-content').children[4].children.length, 3);
  assert.equal(renderer.confirmCalls.length, 6);
});

test('settings show the main-process permission policy and accurate local-data clear scope', async () => {
  const renderer = createRenderer();
  renderer.setState({
    remoteBrowsing: false,
    tabs: [],
    privacy: privacyStatusPayload(false),
    preferences: {
      homepage: 'aether-start',
      startupBehavior: 'restore-session',
      defaultZoom: 1,
      appearance: 'dark',
    },
  });
  await renderer.actions.find((button) => button.dataset.action === 'settings').click();

  const privacySection = renderer.elements.get('#panel-content').children[5];
  const text = collectText(privacySection).join('\n');
  for (const label of [
    'Camera',
    'Microphone',
    'Geolocation',
    'Notifications',
    'Clipboard read/write',
    'Screen capture',
    'MIDI / SysEx',
    'All other and unrecognized permission types',
    'Denied by policy',
    'Remote browsing is disabled',
    'Browsing history:',
    'Bookmarks:',
    'Tab/session metadata:',
    'Preferences:',
    'Download metadata:',
    'Neither action deletes downloaded files.',
    'Neither clear action removes bookmarks',
    'does not claim complete privacy, anonymity, or verified network isolation',
  ]) {
    assert.ok(text.includes(label), `privacy settings should include "${label}"`);
  }
  assert.equal(text.includes('Granted'), false);
  assert.equal(text.includes('Not requested'), false);
  assert.equal(privacySection.children.some((child) => child.tagName === 'input'), false);
});

test('settings never present a malformed permission status as granted', async () => {
  const renderer = createRenderer();
  const privacy = privacyStatusPayload(false);
  privacy.permissions[0].state = 'granted';
  privacy.otherPermissionsState = 'granted';
  renderer.setState({ remoteBrowsing: false, tabs: [], privacy });
  await renderer.actions.find((button) => button.dataset.action === 'settings').click();

  const text = collectText(renderer.elements.get('#panel-content').children[5]).join('\n');
  assert.equal(text.includes('Granted'), false);
  assert.ok(text.includes('Unavailable'));
});

test('profile settings create profiles and require confirmation before staging a restart switch', async () => {
  const renderer = createRenderer();
  const defaultId = 'default';
  const workId = '123e4567-e89b-12d3-a456-426614174000';
  const initialProfiles = {
    profiles: [
      { id: defaultId, name: 'Default', createdAt: 123 },
      { id: workId, name: 'Work', createdAt: 456 },
    ],
    activeProfileId: defaultId,
    selectedProfileId: defaultId,
    restartRequired: false,
  };
  renderer.setState({ remoteBrowsing: false, tabs: [], profiles: initialProfiles });
  await renderer.actions.find((button) => button.dataset.action === 'settings').click();

  const content = renderer.elements.get('#panel-content');
  const profileSection = content.children[6];
  const sectionText = () => collectText(content.children[6]).join('\n');
  assert.ok(sectionText().includes('Active in this session: Default.'));
  assert.ok(sectionText().includes('Metadata separation implemented'));
  assert.ok(sectionText().includes('Dedicated Chromium partition configured'));
  assert.ok(sectionText().includes('Runtime storage verification pending'));
  assert.ok(sectionText().includes('Network isolation not verified'));
  assert.ok(sectionText().includes('Profiles cannot be deleted here.'));

  const form = profileSection.children[3];
  const nameInput = form.children[0];
  nameInput.value = 'Personal';
  const createdProfiles = {
    ...initialProfiles,
    profiles: [...initialProfiles.profiles, {
      id: '223e4567-e89b-12d3-a456-426614174000',
      name: 'Personal',
      createdAt: 789,
    }],
  };
  renderer.setCreateProfileResult({ ok: true, profiles: createdProfiles });
  await form.dispatch('submit');
  assert.deepEqual(renderer.profileCalls, [['create', 'Personal']]);
  assert.equal(renderer.elements.get('#tab-state').textContent, 'Profile created. Select it and restart AETHER to use its browser data.');

  const pendingProfiles = {
    ...createdProfiles,
    selectedProfileId: workId,
    restartRequired: true,
  };
  renderer.setSelectProfileResult({ ok: true, profiles: pendingProfiles });
  renderer.setConfirmResult(false);
  const workButton = renderer.elements.get('#panel-content').children[6].children[2].children[1].children[1];
  await workButton.click();
  assert.deepEqual(renderer.profileCalls, [['create', 'Personal']]);

  renderer.setConfirmResult(true);
  await workButton.click();
  assert.deepEqual(renderer.profileCalls, [['create', 'Personal'], ['select', workId]]);
  assert.equal(renderer.confirmCalls.length, 2);
  assert.ok(renderer.confirmCalls.at(-1).includes('until AETHER is restarted'));
  assert.ok(sectionText().includes('Selected for next startup: Work.'));
  assert.ok(sectionText().includes('current session continues to use Default'));
  assert.equal(renderer.elements.get('#tab-state').textContent, 'Work selected. Restart AETHER to switch profiles.');
});

test('history controls surface traversal denials when tab state changes before the action', async () => {
  const renderer = createRenderer();
  renderer.setState({
    remoteBrowsing: false,
    tabs: [{
      id: 'tab',
      title: 'Current page',
      url: 'https://example.com/',
      active: true,
      canGoBack: true,
      canGoForward: true,
      isLoading: false,
    }],
    stored: { history: [], bookmarks: [] },
  });

  test('browser chrome uses the trusted PARMAR emblem URL from application state', () => {
    const renderer = createRenderer();
    const brandEmblemUrl = 'file:///resources/aether/parmar-emblem.png';
    renderer.setState({
      brandEmblemUrl,
      remoteBrowsing: false,
      tabs: [],
      stored: { bookmarks: [], history: [] },
    });
    assert.equal(renderer.elements.get('#brand-emblem').src, brandEmblemUrl);
  });

  test('tab controls are native, labelled buttons with an active selection state', () => {
    const renderer = createRenderer();
    renderer.setState({
      remoteBrowsing: false,
      tabs: [{
        id: '00000000-0000-0000-0000-000000000001',
        active: true,
        title: 'AETHER',
      }],
      stored: { bookmarks: [], history: [] },
    });
    const [tab] = renderer.elements.get('#tabs').children;
    const [select, menu, close] = tab.children;
    assert.equal(tab.attributes.role, 'presentation');
    assert.equal(select.tagName, 'button');
    assert.equal(select.attributes.role, 'tab');
    assert.equal(select.attributes['aria-selected'], 'true');
    assert.equal(select.attributes['aria-controls'], 'viewport');
    assert.equal(select.attributes['aria-label'], 'AETHER, active tab');
    assert.equal(menu.attributes['aria-label'], 'Tab actions for AETHER');
    assert.equal(close.attributes['aria-label'], 'Close AETHER');
  });

  await renderer.actions.find((button) => button.dataset.action === 'back').click();
  await renderer.actions.find((button) => button.dataset.action === 'forward').click();

  assert.deepEqual(renderer.historyCalls, [['back', 'tab'], ['forward', 'tab']]);
  assert.equal(renderer.elements.get('#tab-state').textContent, 'There is no next page in this tab.');
  assert.equal(renderer.elements.get('[data-action="back"]').disabled, false);
  assert.equal(renderer.elements.get('[data-action="forward"]').disabled, false);
});

test('back and forward controls follow the selected tab and traversal sends its current ID', async () => {
  const renderer = createRenderer();
  const firstTab = {
    id: 'first-tab',
    title: 'First page',
    active: true,
    canGoBack: true,
    canGoForward: false,
  };
  const secondTab = {
    id: 'second-tab',
    title: 'Second page',
    active: false,
    canGoBack: false,
    canGoForward: true,
  };
  const setTabs = (tabs) => renderer.setState({
    remoteBrowsing: false,
    tabs,
    stored: { history: [], bookmarks: [] },
  });

  setTabs([firstTab, secondTab]);
  assert.equal(renderer.elements.get('[data-action="back"]').disabled, false);
  assert.equal(renderer.elements.get('[data-action="forward"]').disabled, true);

  setTabs([{ ...firstTab, active: false }, { ...secondTab, active: true }]);
  assert.equal(renderer.elements.get('[data-action="back"]').disabled, true);
  assert.equal(renderer.elements.get('[data-action="forward"]').disabled, false);
  await renderer.actions.find((button) => button.dataset.action === 'forward').click();
  assert.deepEqual(renderer.historyCalls, [['forward', 'second-tab']]);

  setTabs([
    { ...firstTab, active: false, title: 'Updated inactive title', url: 'https://inactive.example/new' },
    {
      ...secondTab,
      active: true,
      title: 'Selected title',
      url: 'https://selected.example/page#section',
    },
  ]);
  assert.equal(renderer.elements.get('#address').value, 'https://selected.example/page#section');
  assert.equal(renderer.elements.get('#tab-state').textContent, 'https://selected.example/page#section');
  assert.equal(renderer.elements.get('[data-action="back"]').disabled, true);
  assert.equal(renderer.elements.get('[data-action="forward"]').disabled, false);

  setTabs([{ ...firstTab, active: true }]);
  assert.equal(renderer.elements.get('[data-action="back"]').disabled, false);
  assert.equal(renderer.elements.get('[data-action="forward"]').disabled, true);
  await renderer.actions.find((button) => button.dataset.action === 'back').click();
  assert.deepEqual(renderer.historyCalls.at(-1), ['back', 'first-tab']);
});

test('address submission reports invalid and denied navigation for the originating tab', async () => {
  const renderer = createRenderer();
  const tabId = '123e4567-e89b-12d3-a456-426614174000';
  renderer.setState({
    remoteBrowsing: false,
    tabs: [{ id: tabId, title: 'New Tab', active: true }],
    stored: { history: [], bookmarks: [] },
  });

  renderer.elements.get('#address').value = 'javascript:alert(1)';
  await renderer.elements.get('#address-form').listeners.get('submit')({
    preventDefault() {},
  });
  assert.match(renderer.elements.get('#tab-state').textContent, /Only HTTPS web addresses are permitted/);

  renderer.elements.get('#address').value = 'PARMAR browser';
  await renderer.elements.get('#address-form').listeners.get('submit')({
    preventDefault() {},
  });
  assert.match(renderer.elements.get('#tab-state').textContent, /Search is unavailable/);

  renderer.elements.get('#address').value = 'https://example.com/';
  await renderer.elements.get('#address-form').listeners.get('submit')({
    preventDefault() {},
  });
  assert.match(renderer.elements.get('#tab-state').textContent, /no verified operating-system network boundary/);
  assert.equal(renderer.elements.get('#tab-state').style.color, '#e49b83');
  renderer.setState({
    remoteBrowsing: false,
    tabs: [{ id: tabId, title: 'New Tab', active: true, error: null, isLoading: false }],
    stored: { history: [], bookmarks: [] },
  });
  assert.equal(renderer.elements.get('#tab-state').style.color, '');
  assert.deepEqual(renderer.calls, [
    ['javascript:alert(1)', tabId],
    ['PARMAR browser', tabId],
    ['https://example.com/', tabId],
  ]);
});

test('Escape restores the active tab address and does not issue Stop while editing', async () => {
  const renderer = createRenderer();
  const tab = {
    id: 'address-tab',
    title: 'Current page',
    url: 'https://current.example/path',
    restoreUrl: null,
    active: true,
    isLoading: true,
  };
  renderer.setState({
    remoteBrowsing: false,
    tabs: [tab],
    stored: { history: [], bookmarks: [] },
  });
  renderer.focusAddress();
  renderer.elements.get('#address').value = 'https://unfinished.example/';
  let stoppedPropagation = false;
  const prevented = await renderer.keydown({
    key: 'Escape',
    target: renderer.elements.get('#address'),
    stopPropagation() { stoppedPropagation = true; },
  });

  assert.equal(prevented, true);
  assert.equal(stoppedPropagation, true);
  assert.equal(renderer.elements.get('#address').value, tab.url);
  assert.deepEqual(renderer.controlCalls, []);
});

test('reload and stop controls use the active tab ID and ignore late results after a tab switch', async () => {
  const renderer = createRenderer();
  let completeReload;
  const firstTab = { id: 'first-tab', title: 'First tab', active: true, isLoading: false };
  renderer.setState({
    remoteBrowsing: false,
    tabs: [firstTab, { id: 'second-tab', title: 'Second tab', active: false }],
    stored: { history: [], bookmarks: [] },
  });
  const reloadPromise = new Promise((resolve) => { completeReload = resolve; });
  renderer.api.reload = (id) => {
    renderer.controlCalls.push(['reload', id]);
    return reloadPromise;
  };

  const reloadAction = renderer.actions.find((button) => button.dataset.action === 'reload');
  const stopAction = renderer.actions.find((button) => button.dataset.action === 'stop');
  assert.equal(reloadAction.disabled, false);
  assert.equal(stopAction.disabled, true);
  const pendingReload = reloadAction.click();
  assert.deepEqual(renderer.controlCalls, [['reload', 'first-tab']]);

  renderer.setState({
    remoteBrowsing: false,
    tabs: [{ ...firstTab, active: false }, { id: 'second-tab', title: 'Second tab', active: true }],
    stored: { history: [], bookmarks: [] },
  });
  completeReload({ ok: false, error: 'stale failure' });
  await pendingReload;
  assert.equal(renderer.elements.get('#tab-state').textContent, 'New tab · remote browsing restricted');
  assert.equal(renderer.elements.get('#tab-state').style.color, '');

  renderer.setState({
    remoteBrowsing: false,
    tabs: [{
      ...firstTab,
      active: false,
    }, {
      id: 'second-tab',
      title: 'Second tab',
      active: true,
      isLoading: true,
    }],
    stored: { history: [], bookmarks: [] },
  });
  assert.equal(reloadAction.disabled, true);
  assert.equal(stopAction.disabled, false);
  await stopAction.click();
  assert.deepEqual(renderer.controlCalls.at(-1), ['stop', 'second-tab']);
  assert.equal(renderer.elements.get('#tab-state').textContent, 'This tab is not loading.');
});

test('restored session addresses are shown as paused and are not navigated automatically', () => {
  const renderer = createRenderer();
  renderer.setState({
    remoteBrowsing: false,
    tabs: [{
      id: 'paused-tab',
      title: 'New Tab',
      url: '',
      restoreUrl: 'https://saved.example/path',
      active: true,
      isLoading: false,
    }],
    stored: { history: [], bookmarks: [] },
  });

  assert.equal(renderer.elements.get('#address').value, 'https://saved.example/path');
  assert.equal(
    renderer.elements.get('#tab-state').textContent,
    'Session URL saved · page content is not stored; remote retry is unavailable',
  );
  assert.deepEqual(renderer.calls, []);
});

test('a paused restored HTTPS address can be bookmarked without enabling navigation', async () => {
  const renderer = createRenderer();
  const tab = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    title: 'New Tab',
    url: '',
    restoreUrl: 'https://saved.example/research',
    active: true,
    isLoading: false,
  };
  const record = { title: 'saved.example', url: tab.restoreUrl };
  renderer.setState({
    remoteBrowsing: false,
    tabs: [tab],
    stored: { history: [], bookmarks: [] },
  });
  assert.equal(renderer.elements.get('[data-action="bookmark"]').disabled, false);
  renderer.setAddBookmarkResult({ ok: true, data: [record] });

  await renderer.actions.find((button) => button.dataset.action === 'bookmark').click();

  assert.deepEqual(renderer.bookmarkCalls, [tab.id]);
  assert.deepEqual(renderer.calls, []);
  assert.equal(renderer.elements.get('#tab-state').textContent, 'Paused address saved as a bookmark.');

  await renderer.actions.find((button) => button.dataset.action === 'bookmarks').click();
  const cards = renderer.elements.get('#panel-content').children
    .find((child) => child.className === 'panel-list').children;
  assert.equal(cards[0].children[0].textContent, record.title);
  assert.equal(cards[0].children[1].textContent, record.url);
});

test('empty bookmark and history panels explain the offline state', async () => {
  const renderer = createRenderer();
  renderer.setState({
    remoteBrowsing: false,
    tabs: [],
    stored: { history: [], bookmarks: [] },
  });

  await renderer.actions.find((button) => button.dataset.action === 'bookmarks').click();
  assert.match(
    renderer.elements.get('#panel-content').children.find((child) => child.className === 'panel-empty').textContent,
    /Save a paused HTTPS address/,
  );

  await renderer.actions.find((button) => button.dataset.action === 'history').click();
  assert.match(
    renderer.elements.get('#panel-content').children.find((child) => child.className === 'panel-empty').textContent,
    /Restricted browsing does not load remote pages/,
  );
  assert.equal(renderer.elements.get('#panel-content').children[0].disabled, true);
});

test('history search matches title or URL and time filters produce accurate empty results', async () => {
  const now = Date.now();
  const renderer = createRenderer();
  renderer.setState({
    remoteBrowsing: false,
    tabs: [],
    stored: {
      history: [
        { title: 'Recent research', url: 'https://recent.example/article', visitedAt: now - 1000 },
        { title: 'Older page', url: 'https://archive.example/query', visitedAt: now - 9 * 86400000 },
      ],
      bookmarks: [],
    },
  });
  await renderer.actions.find((button) => button.dataset.action === 'history').click();

  const content = renderer.elements.get('#panel-content');
  const toolbar = content.children.find((child) => child.className === 'panel-toolbar');
  const [search, range] = toolbar.children;
  search.value = 'Recent research';
  await search.dispatch('input');
  let list = content.children.find((child) => child.className === 'panel-list');
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].children[0].textContent, 'Recent research');

  search.value = 'archive.example';
  await search.dispatch('input');
  list = content.children.find((child) => child.className === 'panel-list');
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].children[0].textContent, 'Older page');

  search.value = 'no-such-page';
  await search.dispatch('input');
  assert.match(content.children.find((child) => child.className === 'panel-empty').textContent, /No history matches/);

  search.value = '';
  await search.dispatch('input');
  const updatedToolbar = content.children.find((child) => child.className === 'panel-toolbar');
  const updatedRange = updatedToolbar.children[1];
  updatedRange.value = 'week';
  await updatedRange.dispatch('change');
  list = content.children.find((child) => child.className === 'panel-list');
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].children[0].textContent, 'Recent research');
});

test('bookmark search filters title and URL while preserving empty and no-match messages', async () => {
  const renderer = createRenderer();
  renderer.setState({
    remoteBrowsing: false,
    tabs: [],
    stored: {
      history: [],
      bookmarks: [
        { title: 'One title', url: 'https://one.example/path' },
        { title: 'Work', url: 'https://research.example/path' },
      ],
    },
  });
  await renderer.actions.find((button) => button.dataset.action === 'bookmarks').click();
  const content = renderer.elements.get('#panel-content');
  const search = content.children.find((child) => child.className === 'panel-search');
  search.value = 'One title';
  await search.dispatch('input');
  let list = content.children.find((child) => child.className === 'panel-list');
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].children[0].textContent, 'One title');

  search.value = 'research.example';
  await search.dispatch('input');
  list = content.children.find((child) => child.className === 'panel-list');
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].children[0].textContent, 'Work');

  search.value = 'missing';
  await search.dispatch('input');
  assert.match(content.children.find((child) => child.className === 'panel-empty').textContent, /No bookmarks match/);
});

test('bookmark title and URL can be edited by keyboard-submittable form and failures remain visible', async () => {
  const original = { title: 'Original title', url: 'https://saved.example/path' };
  const renamed = { title: 'Research notes', url: 'https://renamed.example/new-path' };
  const renderer = createRenderer();
  renderer.setState({
    remoteBrowsing: false,
    tabs: [],
    stored: { history: [], bookmarks: [original] },
  });

  await renderer.actions.find((button) => button.dataset.action === 'bookmarks').click();
  const getFirstCard = () => renderer.elements.get('#panel-content').children
    .find((child) => child.className === 'panel-list').children[0];
  const card = getFirstCard();
  await card.children.find((child) => child.textContent === 'Edit bookmark').click();
  const editingCard = getFirstCard();
  const editor = editingCard.children.find((child) => child.className === 'bookmark-editor');
  const [titleInput, urlInput] = editor.children;
  assert.equal(titleInput.focused, true);
  assert.equal(titleInput.value, original.title);
  titleInput.value = renamed.title;
  urlInput.value = renamed.url;
  renderer.setUpdateBookmarkResult({ ok: true, data: [renamed] });
  await editor.listeners.get('submit')({ preventDefault() {} });

  assert.deepEqual(renderer.bookmarkCalls, [[original.url, renamed.title, renamed.url]]);
  const updatedCard = getFirstCard();
  assert.equal(updatedCard.children[0].textContent, renamed.title);
  assert.equal(updatedCard.children[1].textContent, renamed.url);
  assert.equal(renderer.elements.get('#tab-state').textContent, 'Bookmark updated.');

  await updatedCard.children.find((child) => child.textContent === 'Edit bookmark').click();
  const failedCard = getFirstCard();
  const failedEditor = failedCard.children.find((child) => child.className === 'bookmark-editor');
  renderer.setUpdateBookmarkResult({ ok: false, error: 'AETHER browser data could not be saved.' });
  await failedEditor.listeners.get('submit')({ preventDefault() {} });
  assert.equal(renderer.elements.get('#tab-state').textContent, 'AETHER browser data could not be saved.');
  assert.equal(
    getFirstCard().children
      .some((child) => child.className === 'bookmark-editor'),
    true,
  );

  const rejectingRenderer = createRenderer();
  rejectingRenderer.setState({
    remoteBrowsing: false,
    tabs: [],
    stored: { history: [], bookmarks: [original] },
  });
  await rejectingRenderer.actions.find((button) => button.dataset.action === 'bookmarks').click();
  await rejectingRenderer.elements.get('#panel-content').children
    .find((child) => child.className === 'panel-list').children[0]
    .children.find((child) => child.textContent === 'Edit bookmark').click();
  const rejectingEditor = rejectingRenderer.elements.get('#panel-content').children
    .find((child) => child.className === 'panel-list').children[0]
    .children.find((child) => child.className === 'bookmark-editor');
  rejectingRenderer.api.updateBookmark = () => Promise.reject(new Error('Storage unavailable.'));
  await rejectingEditor.listeners.get('submit')({ preventDefault() {} });
  assert.equal(rejectingRenderer.elements.get('#tab-state').textContent, 'Storage unavailable.');
});

test('history and bookmark open actions use guarded navigation while remote browsing is disabled', async () => {
  for (const [panel, records, expectedUrl] of [
    ['history', [{ title: 'Visited page', url: 'https://history.example/path' }], 'https://history.example/path'],
    ['bookmarks', [{ title: 'Saved page', url: 'https://bookmark.example/path' }], 'https://bookmark.example/path'],
  ]) {
    const renderer = createRenderer();
    renderer.setState({
      remoteBrowsing: false,
      reason: 'Remote browsing remains restricted.',
      tabs: [{
        id: '123e4567-e89b-12d3-a456-426614174000',
        title: 'New Tab',
        active: true,
        canGoBack: false,
        canGoForward: false,
      }],
      stored: {
        history: records,
        bookmarks: records,
      },
    });

    await renderer.actions.find((button) => button.dataset.action === panel).click();

    const panelContent = renderer.elements.get('#panel-content');
    if (panel === 'history') {
      assert.equal(panelContent.children[0].textContent, 'Clear browsing history');
    }
    const recordCard = panelContent.children.find((child) => child.className === 'panel-list')
      .children[0];
    const openButton = recordCard.children.find((child) => child.textContent === 'Open page');
    await openButton.click();

    assert.deepEqual(renderer.calls, [[
      expectedUrl,
      '123e4567-e89b-12d3-a456-426614174000',
    ]]);
    assert.match(renderer.elements.get('#tab-state').textContent, /no verified operating-system network boundary/);
    if (panel === 'history') {
      const clearButton = panelContent.children[0];
      await clearButton.click();
      assert.equal(panelContent.children[0].textContent, 'Clear browsing history');
    }
  }
});

test('history entries can be removed individually without replacing another panel', async () => {
  const record = {
    title: 'Visited page',
    url: 'https://visited.example/path',
    visitedAt: 1700000000000,
  };
  const renderer = createRenderer();
  renderer.setState({
    remoteBrowsing: false,
    tabs: [],
    stored: { history: [record], bookmarks: [] },
  });

  await renderer.actions.find((button) => button.dataset.action === 'history').click();
  const time = renderer.elements.get('#panel-content').children
    .find((child) => child.className === 'panel-list').children[0].children[2];
  assert.equal(time.tagName, 'time');
  assert.equal(time.attributes.datetime, new Date(record.visitedAt).toISOString());
  assert.equal(time.textContent, new Date(record.visitedAt).toLocaleString());
  const historyList = renderer.elements.get('#panel-content').children
    .find((child) => child.className === 'panel-list');
  const removeButton = historyList.children[0].children
    .find((child) => child.textContent === 'Remove history');
  await removeButton.click();

  assert.match(
    renderer.elements.get('#panel-content').children.find((child) => child.className === 'panel-empty').textContent,
    /No history is saved/,
  );
  assert.equal(renderer.elements.get('#tab-state').textContent, 'History entry removed.');
});

test('bookmark deletion updates the visible list only after persistence succeeds', async () => {
  const record = { title: 'Saved page', url: 'https://saved.example/' };
  const renderer = createRenderer();
  renderer.setState({
    remoteBrowsing: false,
    tabs: [],
    stored: { history: [], bookmarks: [record] },
  });
  await renderer.actions.find((button) => button.dataset.action === 'bookmarks').click();
  const remove = renderer.elements.get('#panel-content').children
    .find((child) => child.className === 'panel-list').children[0].children
    .find((child) => child.textContent === 'Remove bookmark');

  renderer.setConfirmResult(false);
  await remove.click();
  assert.equal(renderer.bookmarkCalls.length, 0);
  assert.match(renderer.confirmCalls[0], /Remove bookmark/);

  renderer.setConfirmResult(true);
  renderer.setRemoveBookmarkResult({ ok: false, error: 'AETHER browser data could not be saved.' });
  await remove.click();
  assert.equal(
    renderer.elements.get('#panel-content').children
      .find((child) => child.className === 'panel-list').children.length,
    1,
  );
  assert.equal(renderer.elements.get('#tab-state').textContent, 'AETHER browser data could not be saved.');

  renderer.setRemoveBookmarkResult({ ok: true, data: [] });
  const retryRemove = renderer.elements.get('#panel-content').children
    .find((child) => child.className === 'panel-list').children[0].children
    .find((child) => child.textContent === 'Remove bookmark');
  await retryRemove.click();
  assert.match(
    renderer.elements.get('#panel-content').children.find((child) => child.className === 'panel-empty').textContent,
    /No bookmarks saved/,
  );
  assert.equal(renderer.elements.get('#tab-state').textContent, 'Bookmark removed.');
});

test('clearing history requires confirmation and reports persistence success or failure', async () => {
  const renderer = createRenderer();
  renderer.setState({
    remoteBrowsing: false,
    tabs: [],
    stored: { history: [{ title: 'Visited', url: 'https://visited.example/' }], bookmarks: [] },
  });
  await renderer.actions.find((button) => button.dataset.action === 'history').click();
  const clear = renderer.elements.get('#panel-content').children[0];

  renderer.setConfirmResult(false);
  await clear.click();
  assert.deepEqual(renderer.clearHistoryCalls, []);
  assert.match(renderer.confirmCalls[0], /cannot be undone/);

  renderer.setConfirmResult(true);
  renderer.setClearHistoryResult({ ok: true, data: [] });
  await clear.click();
  assert.deepEqual(renderer.clearHistoryCalls, [true]);
  assert.equal(renderer.elements.get('#tab-state').textContent, 'Browsing history cleared.');

  const failingRenderer = createRenderer();
  failingRenderer.setState({
    remoteBrowsing: false,
    tabs: [],
    stored: { history: [{ title: 'Visited', url: 'https://visited.example/' }], bookmarks: [] },
  });
  await failingRenderer.actions.find((button) => button.dataset.action === 'history').click();
  failingRenderer.setClearHistoryResult({ ok: false, error: 'AETHER browser data could not be saved.' });
  await failingRenderer.elements.get('#panel-content').children[0].click();
  assert.equal(
    failingRenderer.elements.get('#tab-state').textContent,
    'AETHER browser data could not be saved.',
  );
});

test('IPC rejections are surfaced instead of becoming unhandled renderer failures', async () => {
  const renderer = createRenderer();
  const tab = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    title: 'New Tab',
    active: true,
  };
  renderer.setState({
    remoteBrowsing: false,
    tabs: [tab],
    stored: { history: [], bookmarks: [] },
  });
  renderer.api.navigate = () => Promise.reject(new Error('IPC connection closed.'));
  renderer.elements.get('#address').value = 'https://example.com/';
  await renderer.elements.get('#address-form').listeners.get('submit')({ preventDefault() {} });
  assert.equal(renderer.elements.get('#tab-state').textContent, 'IPC connection closed.');
  assert.equal(renderer.elements.get('#tab-state').style.color, '#e49b83');
});

test('initial status IPC failures are visible and stale status responses do not replace newer state', async () => {
  const failedRenderer = createRenderer({
    statusRequest: Promise.reject(new Error('Status IPC unavailable.')),
  });
  await new Promise(setImmediate);
  assert.equal(failedRenderer.elements.get('#tab-state').textContent, 'Status IPC unavailable.');
  assert.equal(failedRenderer.elements.get('#tab-state').style.color, '#e49b83');

  let resolveStatus;
  const statusRequest = new Promise((resolve) => { resolveStatus = resolve; });
  const renderer = createRenderer({ statusRequest });
  renderer.setState({
    remoteBrowsing: false,
    reason: 'Current browser status.',
    tabs: [],
    stored: { bookmarks: [], history: [] },
  });
  resolveStatus({ remoteBrowsing: true, reason: 'Stale browser status.' });
  await new Promise(setImmediate);
  assert.equal(renderer.elements.get('#security-state').title, 'Current browser status.');
  assert.match(renderer.elements.get('#security-state').children[1].textContent, /Restricted/);
});

test('viewport IPC failures are visible and renderer resources are released on unload', async () => {
  const renderer = createRenderer();
  renderer.api.layout = () => Promise.reject(new Error('Viewport IPC unavailable.'));
  await renderer.resize();
  assert.equal(renderer.elements.get('#tab-state').textContent, 'Viewport IPC unavailable.');
  assert.equal(renderer.elements.get('#tab-state').style.color, '#e49b83');
  assert.equal(renderer.isSubscribed(), true);

  renderer.unload();
  assert.equal(renderer.isResizeDisconnected(), true);
  assert.equal(renderer.isSubscribed(), false);
});

test('late history and bookmark responses update storage without replacing another open panel', async () => {
  const record = { title: 'Saved page', url: 'https://saved.example/' };
  const renderer = createRenderer();
  renderer.setState({
    remoteBrowsing: false,
    tabs: [],
    stored: { history: [record], bookmarks: [record] },
  });

  await renderer.actions.find((button) => button.dataset.action === 'history').click();
  const clearHistory = renderer.elements.get('#panel-content').children[0];
  let finishClearHistory;
  renderer.setClearHistoryResult(new Promise((resolve) => { finishClearHistory = resolve; }));
  const pendingClear = clearHistory.listeners.get('click')();
  await renderer.actions.find((button) => button.dataset.action === 'settings').click();
  const settingsPanel = renderer.elements.get('#panel-content').children[0];
  finishClearHistory({ ok: true, data: [] });
  await pendingClear;
  assert.equal(renderer.elements.get('#panel-content').children[0], settingsPanel);

  await renderer.actions.find((button) => button.dataset.action === 'bookmarks').click();
  const bookmarkList = renderer.elements.get('#panel-content').children
    .find((child) => child.className === 'panel-list');
  const remove = bookmarkList.children[0].children
    .find((child) => child.textContent === 'Remove bookmark');
  let finishRemove;
  renderer.setRemoveBookmarkResult(new Promise((resolve) => { finishRemove = resolve; }));
  const pendingRemove = remove.listeners.get('click')();
  await renderer.actions.find((button) => button.dataset.action === 'history').click();
  const historyPanel = renderer.elements.get('#panel-content').children[0];
  finishRemove({ ok: true, data: [] });
  await pendingRemove;
  assert.equal(renderer.elements.get('#panel-content').children[0], historyPanel);
});
