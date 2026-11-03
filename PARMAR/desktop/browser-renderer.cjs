'use strict';

const api = window.aetherDesktop;
const elements = {
  tabs: document.querySelector('#tabs'),
  address: document.querySelector('#address'),
  brandEmblem: document.querySelector('#brand-emblem'),
  form: document.querySelector('#address-form'),
  securityState: document.querySelector('#security-state'),
  tabState: document.querySelector('#tab-state'),
  viewport: document.querySelector('#viewport'),
  panel: document.querySelector('#side-panel'),
  panelTitle: document.querySelector('#panel-title'),
  panelContent: document.querySelector('#panel-content'),
};
let state = {
  tabs: [],
  closedTabCount: 0,
  stored: { bookmarks: [], history: [] },
  downloads: [],
  remoteBrowsing: false,
};
let activePanel = null;
let editingBookmarkUrl = null;
let historyQuery = '';
let historyRange = 'all';
let bookmarkQuery = '';
let stateRevision = 0;
let layoutRevision = 0;
let draggedTabId = null;

function setMessage(message, isError = false) {
  elements.tabState.textContent = message;
  elements.tabState.style.color = isError ? '#e49b83' : '';
}

function formatVisitTime(value) {
  if (!Number.isFinite(value)) return 'Unknown visit time';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown visit time' : date.toLocaleString();
}

function activeTab() {
  return state.tabs.find((tab) => tab.active) || null;
}

function moveTab(direction) {
  if (!state.tabs.length) return;
  const current = Math.max(0, state.tabs.findIndex((tab) => tab.active));
  const next = (current + direction + state.tabs.length) % state.tabs.length;
  activateTabById(state.tabs[next].id);
}

async function createNewTab() {
  try {
    const result = await api.createTab();
    if (!result?.ok) setMessage(result?.error || 'A new tab could not be created.', true);
  } catch (error) {
    setMessage(error?.message || 'A new tab could not be created.', true);
  }
}

async function activateTabById(id) {
  try {
    const result = await api.activateTab(id);
    if (!result?.ok) setMessage(result?.error || 'The tab could not be activated.', true);
  } catch (error) {
    setMessage(error?.message || 'The tab could not be activated.', true);
  }
}

async function closeTabById(id) {
  try {
    const result = await api.closeTab(id);
    if (!result?.ok) setMessage(result?.error || 'The tab could not be closed.', true);
  } catch (error) {
    setMessage(error?.message || 'The tab could not be closed.', true);
  }
}

async function showTabManagementMenu(id) {
  try {
    const result = await api.showTabManagementMenu(id);
    if (!result?.ok) setMessage(result?.error || 'Tab actions could not be opened.', true);
  } catch (error) {
    setMessage(error?.message || 'Tab actions could not be opened.', true);
  }
}

async function reorderTabIds(ids) {
  try {
    const result = await api.reorderTabs(ids);
    if (!result?.ok) setMessage(result?.error || 'Tabs could not be reordered.', true);
  } catch (error) {
    setMessage(error?.message || 'Tabs could not be reordered.', true);
  }
}

function scrollTabs(direction) {
  const amount = Math.max(140, elements.tabs.clientWidth * 0.75) * direction;
  elements.tabs.scrollBy({ left: amount, behavior: 'smooth' });
}

async function reopenClosedTab() {
  if (!state.closedTabCount) return;
  try {
    const result = await api.reopenClosedTab();
    if (!result?.ok) {
      setMessage(result?.error || 'A recently closed tab could not be reopened.', true);
    }
  } catch (error) {
    setMessage(error?.message || 'A recently closed tab could not be reopened.', true);
  }
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function createIcon(name) {
  const paths = {
    close: 'M5 5l10 10M15 5 5 15',
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', paths[name]);
  svg.append(path);
  return svg;
}

function updateAddress(tab, force = false) {
  if (force || document.activeElement !== elements.address) {
    elements.address.value = tab?.url || tab?.restoreUrl || '';
  }
}

async function goHome() {
  const tab = activeTab();
  if (!tab) return;
  try {
    const result = await api.home(tab.id);
    if (activeTab()?.id !== tab.id) return;
    if (result.ok) {
      updateAddress(activeTab(), true);
      return;
    }
    setMessage(result.error || 'The AETHER start page could not be opened.', true);
  } catch (error) {
    if (activeTab()?.id === tab.id) {
      setMessage(error?.message || 'The AETHER start page could not be opened.', true);
    }
  }
}

function renderTabs(forceAddressUpdate = false) {
  elements.tabs.replaceChildren();
  for (const tab of state.tabs) {
    const classes = ['tab'];
    if (tab.active) classes.push('tab-active');
    if (tab.pinned) classes.push('tab-pinned');
    const item = element('div', classes.join(' '));
    item.dataset.tabId = tab.id;
    item.draggable = true;
    item.setAttribute('role', 'presentation');
    item.addEventListener('dragstart', (event) => {
      draggedTabId = tab.id;
      event.dataTransfer?.setData('text/plain', tab.id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', () => {
      draggedTabId = null;
    });
    item.addEventListener('dragover', (event) => {
      if (draggedTabId && draggedTabId !== tab.id) event.preventDefault();
    });
    item.addEventListener('drop', (event) => {
      event.preventDefault();
      const sourceId = draggedTabId || event.dataTransfer?.getData('text/plain');
      draggedTabId = null;
      const sourceIndex = state.tabs.findIndex((entry) => entry.id === sourceId);
      const targetIndex = state.tabs.findIndex((entry) => entry.id === tab.id);
      if (
        sourceIndex < 0
        || targetIndex < 0
        || sourceIndex === targetIndex
        || state.tabs[sourceIndex].pinned !== tab.pinned
      ) return;
      const next = [...state.tabs];
      const [moved] = next.splice(sourceIndex, 1);
      const adjustedTarget = next.findIndex((entry) => entry.id === tab.id);
      const insertAfter = event.clientX >= item.getBoundingClientRect().left
        + item.getBoundingClientRect().width / 2;
      next.splice(adjustedTarget + (insertAfter ? 1 : 0), 0, moved);
      reorderTabIds(next.map(({ id }) => id));
    });
    const button = element('button', 'tab-select');
    button.type = 'button';
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(tab.active));
    button.setAttribute('aria-controls', 'viewport');
    button.setAttribute('aria-label', `${tab.title}${tab.active ? ', active tab' : ''}`);
    const title = element('span', 'tab-title', tab.title || 'New Tab');
    if (tab.pinned) {
      const pin = element('span', 'tab-pin', 'PIN');
      pin.setAttribute('aria-label', 'Pinned tab');
      button.append(pin);
    }
    const close = element('button', 'tab-close');
    const menuButton = element('button', 'tab-menu');
    menuButton.type = 'button';
    menuButton.setAttribute('aria-label', `Tab actions for ${tab.title || 'New Tab'}`);
    menuButton.title = 'Tab actions';
    menuButton.textContent = '···';
    menuButton.addEventListener('click', (event) => {
      event.stopPropagation();
      showTabManagementMenu(tab.id);
    });
    close.type = 'button';
    close.disabled = Boolean(tab.pinned);
    close.title = tab.pinned ? 'Unpin this tab before closing it' : 'Close tab';
    close.setAttribute('aria-label', tab.pinned
      ? `Unpin ${tab.title || 'tab'} before closing`
      : `Close ${tab.title || 'tab'}`);
    button.append(title);
    close.append(createIcon('close'));
    button.addEventListener('click', () => activateTabById(tab.id));
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      closeTabById(tab.id);
    });
    item.append(button, menuButton, close);
    elements.tabs.append(item);
  }
  const tab = activeTab();
  updateAddress(tab, forceAddressUpdate);
  elements.tabState.setAttribute('aria-busy', String(Boolean(tab?.isLoading)));
  document.querySelector('[data-action="back"]').disabled = !tab?.canGoBack;
  document.querySelector('[data-action="forward"]').disabled = !tab?.canGoForward;
  document.querySelector('[data-action="stop"]').disabled = !tab?.isLoading;
  document.querySelector('[data-action="reload"]').disabled = !tab || Boolean(tab.isLoading);
  document.querySelector('[data-action="bookmark"]').disabled = !tab?.url && !tab?.restoreUrl;
  document.querySelector('[data-action="reopen-closed-tab"]').disabled = !state.closedTabCount;
  updateTabScrollControls();
  elements.tabState.textContent = tab
    ? (tab.error || (tab.isLoading
      ? 'Loading…'
      : (tab.url || (tab.restoreUrl
        ? 'Session page paused · submit its address to retry'
        : 'New tab · remote browsing restricted'))))
    : 'No browser tab selected';
  elements.tabState.style.color = tab?.error ? '#e49b83' : '';
}

function updateTabScrollControls() {
  const left = document.querySelector('[data-action="tabs-scroll-left"]');
  const right = document.querySelector('[data-action="tabs-scroll-right"]');
  left.disabled = elements.tabs.scrollLeft <= 0;
  right.disabled = elements.tabs.scrollLeft + elements.tabs.clientWidth >= elements.tabs.scrollWidth;
}

function renderStatus() {
  if (state.brandEmblemUrl) elements.brandEmblem.src = state.brandEmblemUrl;
  const text = state.remoteBrowsing
    ? 'Network boundary verified'
    : 'Restricted · remote browsing unavailable';
  elements.securityState.replaceChildren(
    element('span', 'status-dot'),
    element('span', 'security-state-label', text),
  );
  elements.securityState.title = state.reason || 'The browser shell is running with remote access disabled.';
}

function renderRecords(records, {
  removable = false,
  recordType = 'bookmark',
  emptyMessage = 'No saved browser records yet.',
  toolbar = [],
  noResultsMessage = 'No matching records.',
  hasSourceRecords = true,
} = {}) {
  elements.panelContent.replaceChildren();
  elements.panelContent.append(...toolbar);
  if (!records.length) {
    elements.panelContent.append(element(
      'p',
      'panel-empty',
      toolbar.length && hasSourceRecords
        ? noResultsMessage
        : emptyMessage,
    ));
    return;
  }
  const list = element('div', 'panel-list');
  let editorInput = null;
  for (const record of records) {
    const card = element('div', 'panel-record');
    card.append(element('strong', '', record.title), element('span', '', record.url));
    if (recordType === 'history') {
      const time = element('time', 'record-time', formatVisitTime(record.visitedAt));
      if (Number.isFinite(record.visitedAt)) {
        const date = new Date(record.visitedAt);
        if (!Number.isNaN(date.getTime())) {
          time.setAttribute('datetime', date.toISOString());
        }
      }
      card.append(time);
    }
    if (recordType === 'bookmark' && editingBookmarkUrl === record.url) {
      const editor = element('form', 'bookmark-editor');
      const titleInput = element('input', 'bookmark-title-input');
      titleInput.type = 'text';
      titleInput.value = record.title;
      titleInput.maxLength = 300;
      titleInput.required = true;
      titleInput.setAttribute('aria-label', 'Bookmark title');
      const urlInput = element('input', 'bookmark-url-input');
      urlInput.type = 'url';
      urlInput.value = record.url;
      urlInput.maxLength = 2048;
      urlInput.required = true;
      urlInput.setAttribute('aria-label', 'Bookmark HTTPS URL');
      const save = element('button', 'panel-action', 'Save bookmark');
      save.type = 'submit';
      const cancel = element('button', 'panel-action', 'Cancel');
      cancel.type = 'button';
      cancel.addEventListener('click', () => {
        editingBookmarkUrl = null;
        if (activePanel === 'bookmarks') renderBookmarksPanel();
      });
      editor.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
          const result = await api.updateBookmark(
            record.url,
            titleInput.value,
            urlInput.value,
          );
          if (activePanel !== 'bookmarks') return;
          if (!result?.ok) {
            setMessage(result?.error || 'The bookmark could not be saved.', true);
            return;
          }
          state.stored.bookmarks = result.data;
          editingBookmarkUrl = null;
          renderBookmarksPanel();
          setMessage('Bookmark updated.');
        } catch (error) {
          if (activePanel === 'bookmarks') {
            setMessage(error?.message || 'The bookmark could not be saved.', true);
          }
        }
      });
      editor.append(titleInput, urlInput, save, cancel);
      card.append(editor);
      editorInput = titleInput;
    } else {
      const open = element('button', 'panel-action', 'Open page');
      open.type = 'button';
      open.addEventListener('click', async () => {
        const tab = activeTab();
        if (!tab) {
          setMessage('No browser tab is selected.', true);
          return;
        }
        try {
          const result = await api.navigate(record.url, tab.id);
          if (activeTab()?.id !== tab.id) return;
          if (!result.ok) {
            setMessage(result.error, true);
            return;
          }
          setMessage('Navigation started');
        } catch (error) {
          if (activeTab()?.id === tab.id) {
            setMessage(error?.message || 'The saved address could not be opened.', true);
          }
        }
      });
      card.append(open);
      if (recordType === 'bookmark') {
        const edit = element('button', 'panel-action', 'Edit bookmark');
        edit.type = 'button';
        edit.addEventListener('click', () => {
          editingBookmarkUrl = record.url;
          if (activePanel === 'bookmarks') renderBookmarksPanel();
        });
        card.append(edit);
      }
    }
    if (removable) {
      const remove = element('button', 'panel-action', `Remove ${recordType}`);
      remove.type = 'button';
      remove.addEventListener('click', async () => {
        if (
          recordType === 'bookmark'
          && !window.confirm(`Remove bookmark “${record.title}”?`)
        ) return;
        const collection = recordType === 'history' ? 'history' : 'bookmarks';
        const removeRecord = recordType === 'history' ? api.removeHistory : api.removeBookmark;
        try {
          const result = await removeRecord(record.url);
          if (result.ok) {
            state.stored[collection] = result.data;
            if (activePanel === recordType || (recordType === 'bookmark' && activePanel === 'bookmarks')) {
              if (activePanel === 'history') renderHistoryPanel();
              else renderBookmarksPanel();
              setMessage(recordType === 'history' ? 'History entry removed.' : 'Bookmark removed.');
            }
          } else if (activePanel === recordType || activePanel === 'bookmarks') {
            setMessage(result.error, true);
          }
        } catch (error) {
          if (activePanel === recordType || activePanel === 'bookmarks') {
            setMessage(error?.message || `The ${recordType} could not be removed.`, true);
          }
        }
      });
      card.append(remove);
    }
    list.append(card);
  }
  elements.panelContent.append(list);
  editorInput?.focus();
}

function renderHistoryPanel({ restoreSearchFocus = false } = {}) {
  const search = element('input', 'panel-search');
  search.type = 'search';
  search.value = historyQuery;
  search.maxLength = 300;
  search.placeholder = 'Search history by title or URL';
  search.setAttribute('aria-label', 'Search history by title or URL');
  search.addEventListener('input', () => {
    historyQuery = search.value.slice(0, 300);
    renderHistoryPanel({ restoreSearchFocus: true });
  });

  const range = element('select', 'panel-filter');
  range.setAttribute('aria-label', 'Filter history by time');
  for (const [value, label] of [
    ['all', 'Any time'],
    ['day', 'Past 24 hours'],
    ['week', 'Past 7 days'],
    ['month', 'Past 30 days'],
  ]) {
    const option = element('option', '', label);
    option.value = value;
    option.selected = historyRange === value;
    range.append(option);
  }
  range.value = historyRange;
  range.addEventListener('change', () => {
    historyRange = range.value;
    renderHistoryPanel();
  });
  const toolbar = element('div', 'panel-toolbar');
  toolbar.append(search, range);

  const query = historyQuery.trim().toLowerCase();
  const rangeDurations = { day: 86400000, week: 604800000, month: 2592000000 };
  const cutoff = rangeDurations[historyRange] ? Date.now() - rangeDurations[historyRange] : null;
  const records = state.stored.history.filter((record) => {
    const matchesQuery = !query
      || record.title.toLowerCase().includes(query)
      || record.url.toLowerCase().includes(query);
    return matchesQuery && (
      cutoff === null
      || (Number.isFinite(record.visitedAt) && record.visitedAt >= cutoff && record.visitedAt <= Date.now())
    );
  });
  renderRecords(records, {
    removable: true,
    recordType: 'history',
    emptyMessage: 'No history is saved. Restricted browsing does not load remote pages.',
    noResultsMessage: 'No history matches this search or time range.',
    toolbar: [toolbar],
    hasSourceRecords: state.stored.history.length > 0,
  });
  const clear = element('button', 'panel-action', 'Clear browsing history');
  clear.type = 'button';
  clear.disabled = state.stored.history.length === 0;
  clear.setAttribute('aria-label', 'Clear all browsing history');
  clear.addEventListener('click', async () => {
    if (!window.confirm('Clear all browsing history? This cannot be undone.')) return;
    try {
      const result = await api.clearHistory();
      if (result.ok) {
        state.stored.history = result.data;
        if (activePanel === 'history') {
          renderHistoryPanel();
          setMessage('Browsing history cleared.');
        }
      } else if (activePanel === 'history') {
        setMessage(result.error, true);
      }
    } catch (error) {
      if (activePanel === 'history') {
        setMessage(error?.message || 'Browsing history could not be cleared.', true);
      }
    }
  });
  elements.panelContent.prepend(clear);
  if (restoreSearchFocus) {
    const restoredSearch = elements.panelContent.children[1].children[0];
    restoredSearch.focus();
  }
}

function renderBookmarksPanel({ restoreSearchFocus = false } = {}) {
  const search = element('input', 'panel-search');
  search.type = 'search';
  search.value = bookmarkQuery;
  search.maxLength = 300;
  search.placeholder = 'Search bookmarks by title or URL';
  search.setAttribute('aria-label', 'Search bookmarks by title or URL');
  search.addEventListener('input', () => {
    bookmarkQuery = search.value.slice(0, 300);
    renderBookmarksPanel({ restoreSearchFocus: true });
  });
  const query = bookmarkQuery.trim().toLowerCase();
  const records = state.stored.bookmarks.filter((record) => (
    !query
    || record.title.toLowerCase().includes(query)
    || record.url.toLowerCase().includes(query)
  ));
  renderRecords(records, {
    removable: true,
    recordType: 'bookmark',
    emptyMessage: 'No bookmarks saved yet. Save a paused HTTPS address with the bookmark button.',
    noResultsMessage: 'No bookmarks match this search.',
    hasSourceRecords: state.stored.bookmarks.length > 0,
    toolbar: [
      search,
      element('p', 'panel-note', 'Bookmarks stay in one ordered list; folders are not supported.'),
    ],
  });
  if (restoreSearchFocus) elements.panelContent.children[0].focus();
}

function formatBytes(value) {
  if (!Number.isSafeInteger(value) || value < 0) return 'Size unavailable';
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let amount = value;
  let unitIndex = -1;
  do {
    amount /= 1024;
    unitIndex += 1;
  } while (amount >= 1024 && unitIndex < units.length - 1);
  return `${amount.toFixed(amount < 10 ? 1 : 0)} ${units[unitIndex]}`;
}

function renderDownloadsPanel() {
  elements.panelContent.replaceChildren();
  const downloads = Array.isArray(state.downloads) ? state.downloads : [];
  if (!downloads.length) {
    elements.panelContent.append(element('p', 'panel-empty', 'No downloads yet.'));
    return;
  }

  const list = element('div', 'panel-list');
  for (const download of downloads) {
    const card = element('div', 'panel-record download-record');
    card.append(element('strong', '', download.fileName));
    const labels = {
      'awaiting-approval': 'Waiting for save approval',
      downloading: 'Downloading',
      completed: 'Completed · file may have moved or been deleted',
      cancelled: 'Cancelled',
      interrupted: 'Interrupted · not resumed',
      failed: 'Failed',
    };
    card.append(element('span', 'download-state', labels[download.state] || 'Unknown status'));
    if (download.totalBytes > 0) {
      const progress = element('progress', 'download-progress');
      progress.max = download.totalBytes;
      progress.value = Math.min(download.receivedBytes, download.totalBytes);
      progress.setAttribute(
        'aria-label',
        `${download.fileName}: ${Math.floor((progress.value / progress.max) * 100)}%`,
      );
      card.append(progress);
      card.append(element(
        'span',
        'download-size',
        `${formatBytes(download.receivedBytes)} of ${formatBytes(download.totalBytes)} · ${Math.floor((progress.value / progress.max) * 100)}%`,
      ));
    } else {
      card.append(element(
        'span',
        'download-size',
        download.receivedBytes > 0
          ? `${formatBytes(download.receivedBytes)} received · total size unavailable`
          : 'Total size unavailable',
      ));
    }
    if (download.error) card.append(element('span', 'download-error', download.error));
    if (download.state === 'downloading') {
      const cancel = element('button', 'panel-action', 'Cancel download');
      cancel.type = 'button';
      cancel.addEventListener('click', async () => {
        try {
          const result = await api.cancelDownload(download.id);
          if (!result?.ok && activePanel === 'downloads') {
            setMessage(result?.error || 'The download could not be cancelled.', true);
          }
        } catch (error) {
          if (activePanel === 'downloads') {
            setMessage(error?.message || 'The download could not be cancelled.', true);
          }
        }
      });
      card.append(cancel);
    }
    list.append(card);
  }
  elements.panelContent.append(list);
}

function renderSettingsPanel() {
  elements.panelContent.replaceChildren(
    element('p', 'panel-note', 'AETHER never grants website permissions. Remote browsing is disabled, and every site permission request and check is denied.'),
  );
  const preferences = state.preferences || {
    homepage: 'aether-start',
    startupBehavior: 'restore-session',
    defaultZoom: 1,
    appearance: 'dark',
  };
  const settings = element('div', 'settings-list');
  settings.append(
    renderPreferenceSelect(
      'Homepage',
      'homepage',
      [['aether-start', 'AETHER Start Page']],
      preferences.homepage,
      true,
    ),
    renderPreferenceSelect(
      'Startup',
      'startupBehavior',
      [
        ['restore-session', 'Restore previous tabs'],
        ['start-page', 'Open AETHER Start Page'],
      ],
      preferences.startupBehavior,
    ),
    renderPreferenceSelect(
      'Default zoom for new tabs',
      'defaultZoom',
      Array.from({ length: 16 }, (_, index) => {
        const factor = (50 + index * 10) / 100;
        return [String(factor), `${Math.round(factor * 100)}%`];
      }),
      String(preferences.defaultZoom),
    ),
    renderPreferenceSelect(
      'Appearance',
      'appearance',
      [['dark', 'AETHER Dark']],
      preferences.appearance,
      true,
    ),
  );
  settings.append(
    element('p', 'panel-note', 'Only the local AETHER Start Page is approved as a homepage.'),
    element('p', 'panel-note', 'AETHER Dark is the only supported appearance theme.'),
  );
  elements.panelContent.append(settings);
  const zoomLevel = element(
    'p',
    'panel-note',
    `Current zoom: ${Math.round((activeTab()?.zoomFactor || 1) * 100)}%`,
  );
  zoomLevel.setAttribute('aria-live', 'polite');
  elements.panelContent.append(zoomLevel);
  const zoom = element('div', 'panel-list');
  for (const [label, amount] of [['Zoom out', -0.1], ['Reset zoom', 1], ['Zoom in', 0.1]]) {
    const action = element('button', 'panel-action', label);
    action.type = 'button';
    action.addEventListener('click', () => changeZoom(amount));
    zoom.append(action);
  }
  elements.panelContent.append(zoom);

  const dataControls = element('div', 'settings-list');
  dataControls.append(
    settingsAction('Clear browsing history', 'History only; bookmarks, downloads, and tabs are preserved.', async () => {
      if (!window.confirm('Clear all browsing history? Bookmarks, downloads, and tabs will be preserved.')) return;
      try {
        const result = await api.clearHistory();
        if (!result?.ok) {
          setMessage(result?.error || 'Browsing history could not be cleared.', true);
          return;
        }
        state.stored.history = result.data;
        if (activePanel === 'settings') renderSettingsPanel();
        setMessage('Browsing history cleared.');
      } catch (error) {
        setMessage(error?.message || 'Browsing history could not be cleared.', true);
      }
    }),
    settingsAction('Clear inactive download records', 'Removes inactive download metadata only; active downloads and saved files are preserved.', async () => {
      if (!window.confirm('Clear inactive download records? Active downloads and saved files will be preserved.')) return;
      try {
        const result = await api.clearDownloadHistory();
        if (!result?.ok) {
          setMessage(result?.error || 'Download records could not be cleared.', true);
          return;
        }
        state.downloads = result.downloads;
        if (activePanel === 'settings') renderSettingsPanel();
        setMessage('Inactive download records cleared. Saved files were not removed.');
      } catch (error) {
        setMessage(error?.message || 'Download records could not be cleared.', true);
      }
    }),
  );
  const reset = element('button', 'panel-action', 'Reset settings to defaults');
  reset.type = 'button';
  reset.addEventListener('click', async () => {
    if (!window.confirm('Reset AETHER preferences to defaults? History, bookmarks, downloads, and tabs will be preserved.')) return;
    try {
      const result = await api.resetPreferences();
      if (!result?.ok) {
        setMessage(result?.error || 'AETHER preferences could not be reset.', true);
        return;
      }
      state.preferences = result.preferences;
      applyAppearance();
      if (activePanel === 'settings') renderSettingsPanel();
      setMessage('AETHER preferences reset. Existing tab zoom was preserved.');
    } catch (error) {
      setMessage(error?.message || 'AETHER preferences could not be reset.', true);
    }
  });
  dataControls.append(reset);
  elements.panelContent.append(dataControls);
  renderPrivacySection();
  renderProfilesSection();
}

function renderProfilesSection() {
  const section = element('section', 'privacy-section profile-section');
  section.append(element('h3', 'privacy-heading', 'Profiles'));
  const profilesState = state.profiles;
  if (
    !profilesState
    || !Array.isArray(profilesState.profiles)
    || typeof profilesState.activeProfileId !== 'string'
    || typeof profilesState.selectedProfileId !== 'string'
  ) {
    section.append(element(
      'p',
      'panel-note',
      'Profile management is unavailable. Existing browser data has not been changed.',
    ));
    elements.panelContent.append(section);
    return;
  }

  const activeProfile = profilesState.profiles.find(
    (profile) => profile.id === profilesState.activeProfileId,
  );
  const selectedProfile = profilesState.profiles.find(
    (profile) => profile.id === profilesState.selectedProfileId,
  );
  if (!activeProfile || !selectedProfile) {
    section.append(element('p', 'panel-note', 'Profile status is invalid; profile changes are unavailable.'));
    elements.panelContent.append(section);
    return;
  }

  section.append(element(
    'p',
    'panel-note',
    `Active in this session: ${activeProfile.name}.`,
  ));
  if (profilesState.restartRequired) {
    section.append(element(
      'p',
      'panel-note profile-restart-note',
      `Selected for next startup: ${selectedProfile.name}. Restart AETHER to use it; the current session continues to use ${activeProfile.name}.`,
    ));
  }

  const list = element('div', 'profile-list');
  for (const profile of profilesState.profiles) {
    if (
      !profile
      || typeof profile.id !== 'string'
      || typeof profile.name !== 'string'
      || profile.name.length > 40
    ) continue;
    const row = element('div', 'profile-row');
    const identity = element('div', 'profile-identity');
    identity.append(element('strong', '', profile.name));
    if (profile.id === profilesState.activeProfileId) {
      identity.append(element('span', 'profile-state', 'Active now'));
    }
    if (
      profile.id === profilesState.selectedProfileId
      && profilesState.restartRequired
    ) identity.append(element('span', 'profile-state', 'Selected for next startup'));
    const button = element('button', 'panel-action', profile.id === profilesState.selectedProfileId
      ? (profilesState.restartRequired ? 'Selected' : 'In use')
      : 'Use after restart');
    button.type = 'button';
    button.disabled = profile.id === profilesState.selectedProfileId;
    button.addEventListener('click', () => selectProfileForRestart(profile));
    row.append(identity, button);
    list.append(row);
  }
  section.append(list);

  const createForm = element('form', 'profile-create-form');
  const nameInput = element('input', 'panel-filter');
  nameInput.type = 'text';
  nameInput.maxLength = 40;
  nameInput.autocomplete = 'off';
  nameInput.setAttribute('aria-label', 'New profile name');
  nameInput.placeholder = 'New profile name';
  const createButton = element('button', 'panel-action', 'Create profile');
  createButton.type = 'submit';
  createForm.append(nameInput, createButton);
  createForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const result = await api.createProfile(nameInput.value);
      if (!result?.ok) {
        setMessage(result?.error || 'The profile could not be created.', true);
        return;
      }
      state.profiles = result.profiles;
      if (activePanel === 'settings') renderSettingsPanel();
      setMessage('Profile created. Select it and restart AETHER to use its browser data.');
    } catch (error) {
      setMessage(error?.message || 'The profile could not be created.', true);
    }
  });
  section.append(createForm);
  section.append(element(
    'p',
    'panel-note',
    'Profile names may contain letters, numbers, spaces, hyphens, and underscores (1–40 characters).',
  ));
  section.append(element(
    'p',
    'panel-note',
    'Metadata separation implemented: AETHER bookmarks, history, tabs, preferences, closed tabs, and download metadata use the selected profile store.',
  ));
  section.append(element(
    'p',
    'panel-note',
    'Dedicated Chromium partition configured for each profile. The Default profile retains its existing partition; profile selection takes effect after restarting AETHER.',
  ));
  section.append(element(
    'p',
    'panel-note',
    'Runtime storage verification pending. Cookies, cache, localStorage, IndexedDB, and service-worker separation have not been verified with Electron runtime tests.',
  ));
  section.append(element(
    'p',
    'panel-note',
    'Network isolation not verified. Remote browsing remains disabled. Profiles cannot be deleted here.',
  ));
  elements.panelContent.append(section);
}

async function selectProfileForRestart(profile) {
  const activeProfile = state.profiles?.profiles?.find(
    (entry) => entry.id === state.profiles.activeProfileId,
  );
  if (!activeProfile) {
    setMessage('The active profile could not be verified.', true);
    return;
  }
  if (!window.confirm(
    `Select "${profile.name}" for the next AETHER startup? The current session will keep using "${activeProfile.name}" until AETHER is restarted.`,
  )) return;
  try {
    const result = await api.selectProfile(profile.id);
    if (!result?.ok) {
      setMessage(result?.error || 'The profile selection could not be saved.', true);
      return;
    }
    state.profiles = result.profiles;
    if (activePanel === 'settings') renderSettingsPanel();
    setMessage(
      result.profiles.restartRequired
        ? `${profile.name} selected. Restart AETHER to switch profiles.`
        : `${profile.name} remains the active profile; the pending switch was cancelled.`,
    );
  } catch (error) {
    setMessage(error?.message || 'The profile selection could not be saved.', true);
  }
}

function renderPrivacySection() {
  const section = element('section', 'privacy-section');
  section.append(element('h3', 'privacy-heading', 'Privacy & permissions'));

  const privacy = state.privacy;
  if (!privacy || typeof privacy !== 'object') {
    section.append(element(
      'p',
      'panel-note',
      'Permission and local-data status is unavailable. Settings cannot grant site permissions.',
    ));
    elements.panelContent.append(section);
    return;
  }

  section.append(element(
    'p',
    'panel-note',
    typeof privacy.sitePermissionsReason === 'string'
      ? privacy.sitePermissionsReason
      : 'Site permission controls are unavailable. AETHER does not grant site permissions.',
  ));

  const permissions = element('div', 'privacy-list');
  const rows = Array.isArray(privacy.permissions) ? privacy.permissions : [];
  for (const permission of rows) {
    if (
      !permission
      || typeof permission.label !== 'string'
      || permission.label.length > 80
    ) continue;
    const stateLabel = permission.state === 'denied'
      ? 'Denied by policy'
      : 'Unavailable';
    const row = element('div', 'privacy-row');
    row.append(
      element('span', '', permission.label),
      element('strong', '', stateLabel),
    );
    permissions.append(row);
  }
  const otherState = privacy.otherPermissionsState === 'denied'
    ? 'Denied by policy'
    : 'Unavailable';
  const otherRow = element('div', 'privacy-row');
  otherRow.append(
    element('span', '', 'All other and unrecognized permission types'),
    element('strong', '', otherState),
  );
  permissions.append(otherRow);
  section.append(permissions);
  section.append(element(
    'p',
    'panel-note',
    'These labels describe AETHER policy, not whether a site previously requested a permission. Per-site controls are intentionally unsupported while remote browsing is disabled.',
  ));

  section.append(element('h4', 'privacy-subheading', 'Data stored locally'));
  const localData = element('ul', 'privacy-details');
  for (const item of Array.isArray(privacy.localData) ? privacy.localData : []) {
    if (typeof item === 'string') localData.append(element('li', '', item));
  }
  section.append(localData);

  section.append(element('h4', 'privacy-subheading', 'What clear-data actions cover'));
  const clearDataScope = element('ul', 'privacy-details');
  for (const item of Array.isArray(privacy.clearDataScope) ? privacy.clearDataScope : []) {
    if (typeof item === 'string') clearDataScope.append(element('li', '', item));
  }
  section.append(clearDataScope);
  section.append(element(
    'p',
    'panel-note',
    'AETHER does not claim complete privacy, anonymity, or verified network isolation.',
  ));
  elements.panelContent.append(section);
}

function renderPreferenceSelect(labelText, name, choices, value, disabled = false) {
  const label = element('label', 'settings-field');
  const caption = element('span', '', labelText);
  const select = element('select', 'panel-filter');
  select.disabled = disabled;
  for (const [optionValue, text] of choices) {
    const option = element('option', '', text);
    option.value = optionValue;
    select.append(option);
  }
  if (!choices.some(([optionValue]) => optionValue === String(value))) {
    const current = element('option', '', `${Math.round(Number(value) * 100)}% (saved)`);
    current.value = String(value);
    select.append(current);
  }
  select.value = String(value);
  select.setAttribute('aria-label', labelText);
  select.addEventListener('change', () => {
    const next = name === 'defaultZoom' ? Number(select.value) : select.value;
    return updatePreference(name, next);
  });
  label.append(caption, select);
  return label;
}

function settingsAction(label, description, action) {
  const section = element('div', 'settings-action-group');
  const button = element('button', 'panel-action', label);
  button.type = 'button';
  button.addEventListener('click', action);
  section.append(button, element('p', 'panel-note', description));
  return section;
}

async function updatePreference(name, value) {
  try {
    const result = await api.updatePreference(name, value);
    if (!result?.ok) {
      setMessage(result?.error || 'The preference could not be saved.', true);
      return;
    }
    state.preferences = result.preferences;
    applyAppearance();
    if (activePanel === 'settings') renderSettingsPanel();
    setMessage(name === 'defaultZoom'
      ? 'Default zoom updated for new tabs. Existing tab zoom was preserved.'
      : 'AETHER preference saved.');
  } catch (error) {
    setMessage(error?.message || 'The preference could not be saved.', true);
  }
}

function applyAppearance() {
  if (document.documentElement) {
    document.documentElement.dataset.theme = state.preferences?.appearance || 'dark';
  }
}

function openPanel(name) {
  activePanel = name;
  elements.panel.hidden = false;
  elements.panelTitle.textContent = {
    history: 'Browsing history',
    bookmarks: 'Bookmarks',
    downloads: 'Downloads',
    settings: 'Browser settings',
  }[name] || 'Browser panel';
  elements.panelContent.replaceChildren();

  if (name === 'history') {
    renderHistoryPanel();
  } else if (name === 'bookmarks') {
    renderBookmarksPanel();
  } else if (name === 'downloads') {
    renderDownloadsPanel();
  } else if (name === 'settings') {
    renderSettingsPanel();
  }
}

async function changeZoom(delta) {
  const tab = activeTab();
  if (!tab) return;
  const current = tab.zoomFactor || 1;
  const factor = delta === 1 ? 1 : Math.max(0.5, Math.min(2, current + delta));
  try {
    const result = await api.zoom(factor, tab.id);
    if (activeTab()?.id !== tab.id) return;
    if (!result.ok) setMessage(result.error, true);
    else {
      state.tabs = state.tabs.map((entry) => ({ ...entry, zoomFactor: result.factor }));
      if (activePanel === 'settings') renderSettingsPanel();
      setMessage(`Zoom ${Math.round(result.factor * 100)}%`);
    }
  } catch (error) {
    if (activeTab()?.id === tab.id) {
      setMessage(error?.message || 'The zoom level could not be changed.', true);
    }
  }
}

async function submitAddress(event) {
  event.preventDefault();
  const tab = activeTab();
  if (!tab) {
    setMessage('No browser tab is selected.', true);
    return;
  }
  try {
    const result = await api.navigate(elements.address.value, tab.id);
    if (activeTab()?.id !== tab.id) return;
    if (!result.ok) {
      setMessage(result.error, true);
      return;
    }
    setMessage('Navigation started');
  } catch (error) {
    if (activeTab()?.id === tab.id) {
      setMessage(error?.message || 'The address could not be opened.', true);
    }
  }
}

async function traverseHistory(direction) {
  const tab = activeTab();
  if (!tab) return;
  try {
    const result = await api[direction](tab.id);
    if (activeTab()?.id !== tab.id) return;
    if (!result.ok) setMessage(result.error, true);
  } catch (error) {
    if (activeTab()?.id === tab.id) {
      setMessage(error?.message || 'This page could not be opened.', true);
    }
  }
}

async function controlActiveTab(action) {
  const tab = activeTab();
  if (!tab) return;
  try {
    const result = await api[action](tab.id);
    if (activeTab()?.id !== tab.id || result.ok) return;
    setMessage(result.error, true);
  } catch (error) {
    if (activeTab()?.id === tab.id) {
      setMessage(error?.message || 'The tab action could not be completed.', true);
    }
  }
}

document.querySelectorAll('[data-action]').forEach((button) => {
  button.addEventListener('click', async () => {
    const { action } = button.dataset;
    if (action === 'home') {
      await goHome();
    } else if (action === 'new-tab') {
      await createNewTab();
    } else if (action === 'tabs-scroll-left') {
      scrollTabs(-1);
    } else if (action === 'tabs-scroll-right') {
      scrollTabs(1);
    } else if (action === 'reopen-closed-tab') {
      await reopenClosedTab();
    } else if (action === 'focus-address') {
      elements.address.focus();
      elements.address.select();
    } else if (action === 'back') {
      await traverseHistory('back');
    } else if (action === 'forward') {
      await traverseHistory('forward');
    } else if (action === 'reload') {
      await controlActiveTab('reload');
    } else if (action === 'stop') {
      await controlActiveTab('stop');
    } else if (action === 'bookmark') {
      const tab = activeTab();
      const pausedAddress = Boolean(tab?.restoreUrl && !tab.url);
      if (!tab || (!tab.url && !tab.restoreUrl)) {
        setMessage('This tab does not have an HTTPS address to bookmark.', true);
        return;
      }
      try {
        const result = await api.addBookmark(tab.id);
        if (result.ok) {
          state.stored.bookmarks = result.data;
          if (activePanel === 'bookmarks') renderBookmarksPanel();
          if (activeTab()?.id === tab.id) {
            setMessage(pausedAddress ? 'Paused address saved as a bookmark.' : 'Bookmark saved.');
          }
        } else if (activeTab()?.id === tab.id) {
          setMessage(result.error, true);
        }
      } catch (error) {
        if (activeTab()?.id === tab.id) {
          setMessage(error?.message || 'The bookmark could not be saved.', true);
        }
      }
    } else if (['history', 'bookmarks', 'downloads', 'settings'].includes(action)) {
      openPanel(action);
    } else if (action === 'close-panel') {
      activePanel = null;
      elements.panel.hidden = true;
    }
  });
});

elements.form.addEventListener('submit', submitAddress);
elements.tabs.addEventListener('scroll', updateTabScrollControls);

window.addEventListener('keydown', (event) => {
  const command = event.ctrlKey || event.metaKey;
  if (command && event.key === 'Tab') {
    event.preventDefault();
    moveTab(event.shiftKey ? -1 : 1);
  } else if (command && event.key.toLowerCase() === 'l') {
    event.preventDefault();
    elements.address.focus();
    elements.address.select();
  } else if (command && event.shiftKey && event.key.toLowerCase() === 't') {
    event.preventDefault();
    reopenClosedTab();
  } else if (command && event.key.toLowerCase() === 't') {
    event.preventDefault();
    createNewTab();
  } else if (command && event.key.toLowerCase() === 'w') {
    event.preventDefault();
    const tab = activeTab();
    if (tab) closeTabById(tab.id);
  } else if (command && event.key.toLowerCase() === 'r') {
    event.preventDefault();
    controlActiveTab('reload');
  } else if (command && (event.key === '+' || event.key === '=')) {
    event.preventDefault();
    changeZoom(0.1);
  } else if (command && event.key === '-') {
    event.preventDefault();
    changeZoom(-0.1);
  } else if (command && event.key === '0') {
    event.preventDefault();
    changeZoom(1);
  } else if (event.altKey && event.key === 'ArrowLeft') {
    event.preventDefault();
    traverseHistory('back');
  } else if (event.altKey && event.key === 'ArrowRight') {
    event.preventDefault();
    traverseHistory('forward');
  } else if (event.altKey && event.key === 'Home') {
    event.preventDefault();
    goHome();
  } else if (event.key === 'Escape') {
    if (event.target === elements.address) {
      event.preventDefault();
      elements.address.value = activeTab()?.url || activeTab()?.restoreUrl || '';
      event.stopPropagation();
      return;
    }
    if (activeTab()?.isLoading) controlActiveTab('stop');
    if (activePanel) {
      activePanel = null;
      elements.panel.hidden = true;
    }
  }
});

const resizeObserver = new ResizeObserver(async () => {
  const revision = ++layoutRevision;
  const rect = elements.viewport.getBoundingClientRect();
  try {
    const result = await api.layout({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
    if (revision !== layoutRevision) return;
    if (!result?.ok) setMessage(result?.error || 'The browser viewport could not be resized.', true);
  } catch (error) {
    if (revision === layoutRevision) {
      setMessage(error?.message || 'The browser viewport could not be resized.', true);
    }
  }
});
resizeObserver.observe(elements.viewport);

const unsubscribeState = api.onState((next) => {
  const previousActiveTabId = activeTab()?.id || null;
  stateRevision += 1;
  state = next;
  if (!Array.isArray(state.downloads)) state.downloads = [];
  applyAppearance();
  renderStatus();
  renderTabs(previousActiveTabId !== (activeTab()?.id || null));
  if (activePanel === 'history') renderHistoryPanel();
  if (activePanel === 'bookmarks') renderBookmarksPanel();
  if (activePanel === 'downloads') renderDownloadsPanel();
  if (activePanel === 'settings') renderSettingsPanel();
});
const unsubscribeNavigationError = api.onNavigationError((message) => setMessage(message, true));
const unsubscribeFocusAddress = api.onFocusAddress(() => {
  elements.address.focus();
  elements.address.select();
});
const initialStateRevision = stateRevision;
Promise.resolve().then(() => api.getStatus()).then((status) => {
  if (stateRevision !== initialStateRevision) return;
  if (!status || typeof status !== 'object') {
    setMessage('Browser status could not be loaded.', true);
    return;
  }
  state = { ...state, ...status };
  renderStatus();
}).catch((error) => {
  if (stateRevision === initialStateRevision) {
    setMessage(error?.message || 'Browser status could not be loaded.', true);
  }
});

window.addEventListener('beforeunload', () => {
  resizeObserver.disconnect();
  unsubscribeState();
  unsubscribeNavigationError();
  unsubscribeFocusAddress();
});
