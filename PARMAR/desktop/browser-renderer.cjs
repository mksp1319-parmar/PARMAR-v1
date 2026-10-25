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
let state = { tabs: [], stored: { bookmarks: [], history: [] }, remoteBrowsing: false };
let activePanel = null;
let editingBookmarkUrl = null;

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

function updateAddress(tab) {
  if (document.activeElement !== elements.address) {
    elements.address.value = tab?.url || tab?.restoreUrl || '';
  }
}

function renderTabs() {
  elements.tabs.replaceChildren();
  for (const tab of state.tabs) {
    const item = element('div', tab.active ? 'tab tab-active' : 'tab');
    item.setAttribute('role', 'presentation');
    const button = element('button', 'tab-select');
    button.type = 'button';
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(tab.active));
    button.setAttribute('aria-controls', 'viewport');
    button.setAttribute('aria-label', `${tab.title}${tab.active ? ', active tab' : ''}`);
    const title = element('span', 'tab-title', tab.title || 'New Tab');
    const close = element('button', 'tab-close');
    close.type = 'button';
    close.setAttribute('aria-label', `Close ${tab.title || 'tab'}`);
    button.append(title);
    close.append(createIcon('close'));
    button.addEventListener('click', () => activateTabById(tab.id));
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      closeTabById(tab.id);
    });
    item.append(button, close);
    elements.tabs.append(item);
  }
  const tab = activeTab();
  updateAddress(tab);
  elements.tabState.setAttribute('aria-busy', String(Boolean(tab?.isLoading)));
  document.querySelector('[data-action="back"]').disabled = !tab?.canGoBack;
  document.querySelector('[data-action="forward"]').disabled = !tab?.canGoForward;
  document.querySelector('[data-action="stop"]').disabled = !tab?.isLoading;
  document.querySelector('[data-action="reload"]').disabled = !tab;
  document.querySelector('[data-action="bookmark"]').disabled = !tab?.url && !tab?.restoreUrl;
  elements.tabState.textContent = tab
    ? (tab.error || (tab.isLoading
      ? 'Loading…'
      : (tab.url || (tab.restoreUrl
        ? 'Session page paused · submit its address to retry'
        : 'New tab · remote browsing restricted'))))
    : 'No browser tab selected';
  elements.tabState.style.color = tab?.error ? '#e49b83' : '';
}

function renderStatus() {
  if (state.brandEmblemUrl) elements.brandEmblem.src = state.brandEmblemUrl;
  const text = state.remoteBrowsing
    ? 'Network boundary verified'
    : 'Restricted · remote browsing unavailable';
  elements.securityState.replaceChildren(
    element('span', 'status-dot'),
    element('span', '', text),
  );
  elements.securityState.title = state.reason || 'The browser shell is running with remote access disabled.';
}

function renderRecords(records, {
  removable = false,
  recordType = 'bookmark',
  emptyMessage = 'No saved browser records yet.',
} = {}) {
  elements.panelContent.replaceChildren();
  if (!records.length) {
    elements.panelContent.append(element('p', 'panel-empty', emptyMessage));
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
      titleInput.setAttribute('aria-label', `Bookmark title for ${record.url}`);
      const save = element('button', 'panel-action', 'Save title');
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
          const result = await api.updateBookmark(record.url, titleInput.value);
          if (activePanel !== 'bookmarks') return;
          if (!result?.ok) {
            setMessage(result?.error || 'The bookmark title could not be saved.', true);
            return;
          }
          state.stored.bookmarks = result.data;
          editingBookmarkUrl = null;
          renderBookmarksPanel();
          setMessage('Bookmark title updated.');
        } catch (error) {
          if (activePanel === 'bookmarks') {
            setMessage(error?.message || 'The bookmark title could not be saved.', true);
          }
        }
      });
      editor.append(titleInput, save, cancel);
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
        const rename = element('button', 'panel-action', 'Rename bookmark');
        rename.type = 'button';
        rename.addEventListener('click', () => {
          editingBookmarkUrl = record.url;
          if (activePanel === 'bookmarks') renderBookmarksPanel();
        });
        card.append(rename);
      }
    }
    if (removable) {
      const remove = element('button', 'panel-action', `Remove ${recordType}`);
      remove.type = 'button';
      remove.addEventListener('click', async () => {
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

function renderHistoryPanel() {
  renderRecords(state.stored.history, {
    removable: true,
    recordType: 'history',
    emptyMessage: 'No history is saved. Restricted browsing does not load remote pages.',
  });
  const clear = element('button', 'panel-action', 'Clear browsing history');
  clear.type = 'button';
  clear.disabled = state.stored.history.length === 0;
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
}

function renderBookmarksPanel() {
  renderRecords(state.stored.bookmarks, {
    removable: true,
    recordType: 'bookmark',
    emptyMessage: 'No bookmarks saved yet. Save a paused HTTPS address with the bookmark button.',
  });
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
    elements.panelContent.append(
      element('p', 'panel-note', 'Downloads are unavailable while remote browsing is restricted. No download has been started.'),
    );
  } else if (name === 'settings') {
    elements.panelContent.append(
      element('p', 'panel-note', 'Remote site permissions are denied by default. Zoom is available for the local new-tab view; microphone, camera, notifications, and location are not granted.'),
    );
    const zoom = element('div', 'panel-list');
    for (const [label, amount] of [['Zoom out', -0.1], ['Reset zoom', 1], ['Zoom in', 0.1]]) {
      const action = element('button', 'panel-action', label);
      action.type = 'button';
      action.addEventListener('click', () => changeZoom(amount));
      zoom.append(action);
    }
    elements.panelContent.append(zoom);
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
      state.tabs = state.tabs.map((entry) => entry.id === tab.id ? { ...entry, zoomFactor: factor } : entry);
      setMessage(`Zoom ${Math.round(factor * 100)}%`);
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
    if (action === 'new-tab') {
      await createNewTab();
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

window.addEventListener('keydown', (event) => {
  const command = event.ctrlKey || event.metaKey;
  if (command && event.key === 'Tab') {
    event.preventDefault();
    moveTab(event.shiftKey ? -1 : 1);
  } else if (command && event.key.toLowerCase() === 'l') {
    event.preventDefault();
    elements.address.focus();
    elements.address.select();
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
  } else if (event.key === 'Escape') {
    controlActiveTab('stop');
    if (activePanel) {
      activePanel = null;
      elements.panel.hidden = true;
    }
  }
});

const resizeObserver = new ResizeObserver(() => {
  const rect = elements.viewport.getBoundingClientRect();
  api.layout({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
});
resizeObserver.observe(elements.viewport);

api.onState((next) => {
  state = next;
  renderStatus();
  renderTabs();
  if (activePanel === 'history') renderHistoryPanel();
  if (activePanel === 'bookmarks') renderBookmarksPanel();
});
api.onNavigationError((message) => setMessage(message, true));
api.onFocusAddress(() => {
  elements.address.focus();
  elements.address.select();
});
api.getStatus().then((status) => {
  state = { ...state, ...status };
  renderStatus();
});
