'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const { navigationPolicy, resolveAddressInput } = require('../security.cjs');

class MockElement {
  constructor(tagName = '') {
    this.tagName = tagName;
    this.children = [];
    this.listeners = new Map();
    this.dataset = {};
    this.style = {};
    this.attributes = {};
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
  }

  select() {
    this.selected = true;
  }

  async click() {
    await this.listeners.get('click')?.({
      preventDefault() {},
      stopPropagation() {},
      target: this,
    });
  }
}

function createRenderer() {
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
    '[data-action="back"]',
    '[data-action="forward"]',
    '[data-action="stop"]',
    '[data-action="reload"]',
    '[data-action="bookmark"]',
  ];
  const elements = new Map(selectors.map((selector) => [selector, new MockElement()]));
  const actions = ['back', 'forward', 'reload', 'stop', 'bookmark', 'history', 'bookmarks', 'downloads', 'settings', 'focus-address', 'close-panel']
    .map((action) => {
      const button = new MockElement('button');
      button.dataset.action = action;
      return button;
    });
  const calls = [];
  const historyCalls = [];
  const controlCalls = [];
  const bookmarkCalls = [];
  let addBookmarkResult = { ok: true, data: [] };
  let updateBookmarkResult = { ok: true, data: [] };
  let removeBookmarkResult = { ok: true, data: [] };
  let removeHistoryResult = { ok: true, data: [] };
  let clearHistoryResult = { ok: true, data: [] };
  const clearHistoryCalls = [];
  const confirmCalls = [];
  let confirmResult = true;
  let stateListener;
  const api = {
    navigate(value, id) {
      calls.push([value, id]);
      const result = resolveAddressInput(value);
      if (!result.ok) return Promise.resolve({ ok: false, error: result.reason });
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
    zoom(factor, id) {
      controlCalls.push(['zoom', factor, id]);
      return Promise.resolve({ ok: true });
    },
    addBookmark(id) {
      bookmarkCalls.push(id);
      return Promise.resolve(addBookmarkResult);
    },
    updateBookmark(url, title) {
      bookmarkCalls.push([url, title]);
      return Promise.resolve(updateBookmarkResult);
    },
    clearHistory() {
      clearHistoryCalls.push(true);
      return Promise.resolve(clearHistoryResult);
    },
    removeBookmark: () => Promise.resolve(removeBookmarkResult),
    removeHistory: () => Promise.resolve(removeHistoryResult),
    onState(callback) {
      stateListener = callback;
    },
    onNavigationError() {},
    onFocusAddress() {},
    getStatus: () => Promise.resolve({ remoteBrowsing: false }),
  };
  const document = {
    activeElement: null,
    createElement: (tagName) => new MockElement(tagName),
    createElementNS: (_namespace, tagName) => new MockElement(tagName),
    querySelector: (selector) => elements.get(selector) || new MockElement(),
    querySelectorAll: () => actions,
  };
  const window = {
    aetherDesktop: api,
    addEventListener() {},
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
      observe() {}
    },
  });
  return {
    actions,
    api,
    calls,
    elements,
    historyCalls,
    controlCalls,
    bookmarkCalls,
    clearHistoryCalls,
    confirmCalls,
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
    setState: (...args) => stateListener(...args),
  };
}

test('search shortcut focuses and selects the existing address field', async () => {
  const renderer = createRenderer();

  await renderer.actions.find((button) => button.dataset.action === 'focus-address').click();

  assert.equal(renderer.elements.get('#address').focused, true);
  assert.equal(renderer.elements.get('#address').selected, true);
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
    const [select, close] = tab.children;
    assert.equal(tab.attributes.role, 'presentation');
    assert.equal(select.tagName, 'button');
    assert.equal(select.attributes.role, 'tab');
    assert.equal(select.attributes['aria-selected'], 'true');
    assert.equal(select.attributes['aria-controls'], 'viewport');
    assert.equal(select.attributes['aria-label'], 'AETHER, active tab');
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
    ['https://example.com/', tabId],
  ]);
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

  const stopAction = renderer.actions.find((button) => button.dataset.action === 'stop');
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
  assert.match(renderer.elements.get('#tab-state').textContent, /Session page paused/);
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
  const cards = renderer.elements.get('#panel-content').children[0].children;
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
    renderer.elements.get('#panel-content').children[0].textContent,
    /Save a paused HTTPS address/,
  );

  await renderer.actions.find((button) => button.dataset.action === 'history').click();
  assert.match(
    renderer.elements.get('#panel-content').children[1].textContent,
    /Restricted browsing does not load remote pages/,
  );
  assert.equal(renderer.elements.get('#panel-content').children[0].disabled, true);
});

test('bookmark titles can be renamed by keyboard-submittable form and failures remain visible', async () => {
  const original = { title: 'Original title', url: 'https://saved.example/path' };
  const renamed = { title: 'Research notes', url: original.url };
  const renderer = createRenderer();
  renderer.setState({
    remoteBrowsing: false,
    tabs: [],
    stored: { history: [], bookmarks: [original] },
  });

  await renderer.actions.find((button) => button.dataset.action === 'bookmarks').click();
  const card = renderer.elements.get('#panel-content').children[0].children[0];
  await card.children.find((child) => child.textContent === 'Rename bookmark').click();
  const editingCard = renderer.elements.get('#panel-content').children[0].children[0];
  const editor = editingCard.children.find((child) => child.className === 'bookmark-editor');
  const [titleInput] = editor.children;
  assert.equal(titleInput.focused, true);
  assert.equal(titleInput.value, original.title);
  titleInput.value = renamed.title;
  renderer.setUpdateBookmarkResult({ ok: true, data: [renamed] });
  await editor.listeners.get('submit')({ preventDefault() {} });

  assert.deepEqual(renderer.bookmarkCalls, [[original.url, renamed.title]]);
  const updatedCard = renderer.elements.get('#panel-content').children[0].children[0];
  assert.equal(updatedCard.children[0].textContent, renamed.title);
  assert.equal(renderer.elements.get('#tab-state').textContent, 'Bookmark title updated.');

  await updatedCard.children.find((child) => child.textContent === 'Rename bookmark').click();
  const failedCard = renderer.elements.get('#panel-content').children[0].children[0];
  const failedEditor = failedCard.children.find((child) => child.className === 'bookmark-editor');
  renderer.setUpdateBookmarkResult({ ok: false, error: 'AETHER browser data could not be saved.' });
  await failedEditor.listeners.get('submit')({ preventDefault() {} });
  assert.equal(renderer.elements.get('#tab-state').textContent, 'AETHER browser data could not be saved.');
  assert.equal(
    renderer.elements.get('#panel-content').children[0].children[0].children
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
  await rejectingRenderer.elements.get('#panel-content').children[0].children[0]
    .children.find((child) => child.textContent === 'Rename bookmark').click();
  const rejectingEditor = rejectingRenderer.elements.get('#panel-content').children[0].children[0]
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

  assert.match(renderer.elements.get('#panel-content').children[1].textContent, /No history is saved/);
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
  assert.match(renderer.elements.get('#panel-content').children[0].textContent, /No bookmarks saved/);
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
