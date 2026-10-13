'use strict';

const api = window.aetherDesktop;
const elements = {
  tabs: document.querySelector('#tabs'),
  address: document.querySelector('#address'),
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

function setMessage(message, isError = false) {
  elements.tabState.textContent = message;
  elements.tabState.style.color = isError ? '#e49b83' : '';
}

function activeTab() {
  return state.tabs.find((tab) => tab.active) || null;
}

function moveTab(direction) {
  if (!state.tabs.length) return;
  const current = Math.max(0, state.tabs.findIndex((tab) => tab.active));
  const next = (current + direction + state.tabs.length) % state.tabs.length;
  api.activateTab(state.tabs[next].id);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function updateAddress(tab) {
  if (document.activeElement !== elements.address) {
    elements.address.value = tab?.url || '';
  }
}

function renderTabs() {
  elements.tabs.replaceChildren();
  for (const tab of state.tabs) {
    const button = element('div', 'tab');
    button.setAttribute('role', 'tab');
    button.tabIndex = 0;
    button.setAttribute('aria-selected', String(tab.active));
    button.setAttribute('aria-label', `${tab.title}${tab.active ? ', active tab' : ''}`);
    const title = element('span', 'tab-title', tab.title || 'New Tab');
    const close = element('button', 'tab-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', `Close ${tab.title || 'tab'}`);
    button.append(title, close);
    button.addEventListener('click', (event) => {
      if (event.target !== close) api.activateTab(tab.id);
    });
    button.addEventListener('keydown', (event) => {
      if (event.target === button && ['Enter', ' '].includes(event.key)) {
        event.preventDefault();
        api.activateTab(tab.id);
      }
    });
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      api.closeTab(tab.id);
    });
    elements.tabs.append(button);
  }
  const tab = activeTab();
  updateAddress(tab);
  document.querySelector('[data-action="back"]').disabled = !tab?.canGoBack;
  document.querySelector('[data-action="forward"]').disabled = !tab?.canGoForward;
  document.querySelector('[data-action="stop"]').disabled = !tab?.isLoading;
  document.querySelector('[data-action="reload"]').disabled = !tab;
  document.querySelector('[data-action="bookmark"]').disabled = !state.remoteBrowsing || !tab?.url;
  elements.tabState.textContent = tab
    ? (tab.isLoading ? 'Loading local browser content' : (tab.url || 'New tab · remote browsing restricted'))
    : 'No browser tab selected';
}

function renderStatus() {
  const text = state.remoteBrowsing
    ? 'Network boundary verified'
    : 'Restricted · remote browsing unavailable';
  elements.securityState.replaceChildren(
    element('span', 'status-dot'),
    element('span', '', text),
  );
  elements.securityState.title = state.reason || 'The browser shell is running with remote access disabled.';
}

function renderRecords(records, { removable = false } = {}) {
  elements.panelContent.replaceChildren();
  if (!records.length) {
    elements.panelContent.append(element('p', 'panel-empty', 'No saved browser records yet.'));
    return;
  }
  const list = element('div', 'panel-list');
  for (const record of records) {
    const card = element('div', 'panel-record');
    card.append(element('strong', '', record.title), element('span', '', record.url));
    if (removable) {
      const remove = element('button', 'panel-action', 'Remove bookmark');
      remove.type = 'button';
      remove.addEventListener('click', async () => {
        const result = await api.removeBookmark(record.url);
        if (result.ok) {
          state.stored.bookmarks = result.data;
          renderRecords(state.stored.bookmarks, { removable: true });
        } else {
          setMessage(result.error, true);
        }
      });
      card.append(remove);
    }
    list.append(card);
  }
  elements.panelContent.append(list);
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
    const clear = element('button', 'panel-action', 'Clear browsing history');
    clear.type = 'button';
    clear.addEventListener('click', async () => {
      const result = await api.clearHistory();
      if (result.ok) {
        state.stored.history = result.data;
        renderRecords(state.stored.history);
      } else {
        setMessage(result.error, true);
      }
    });
    elements.panelContent.append(clear);
    renderRecords(state.stored.history);
  } else if (name === 'bookmarks') {
    renderRecords(state.stored.bookmarks, { removable: true });
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
  const result = await api.zoom(factor);
  if (!result.ok) setMessage(result.error, true);
  else {
    state.tabs = state.tabs.map((entry) => entry.id === tab.id ? { ...entry, zoomFactor: factor } : entry);
    setMessage(`Zoom ${Math.round(factor * 100)}%`);
  }
}

async function submitAddress(event) {
  event.preventDefault();
  const result = await api.navigate(elements.address.value);
  if (!result.ok) {
    setMessage(result.error, true);
    return;
  }
  setMessage('Navigation started');
}

document.querySelectorAll('[data-action]').forEach((button) => {
  button.addEventListener('click', async () => {
    const { action } = button.dataset;
    if (action === 'new-tab') {
      const result = await api.createTab();
      if (!result?.ok) setMessage(result?.error || 'A new tab could not be created.', true);
    } else if (action === 'back') {
      api.back();
    } else if (action === 'forward') {
      api.forward();
    } else if (action === 'reload') {
      api.reload();
    } else if (action === 'stop') {
      api.stop();
    } else if (action === 'bookmark') {
      const tab = activeTab();
      if (!state.remoteBrowsing || !tab?.url) {
        setMessage('Bookmarking is unavailable until a page has loaded through the verified network boundary.', true);
        return;
      }
      const result = await api.addBookmark({ title: tab.title, url: tab.url });
      if (result.ok) {
        state.stored.bookmarks = result.data;
        setMessage('Bookmark saved.');
      } else {
        setMessage(result.error, true);
      }
    } else if (['history', 'downloads', 'settings'].includes(action)) {
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
    api.createTab();
  } else if (command && event.key.toLowerCase() === 'w') {
    event.preventDefault();
    const tab = activeTab();
    if (tab) api.closeTab(tab.id);
  } else if (command && event.key.toLowerCase() === 'r') {
    event.preventDefault();
    api.reload();
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
    api.back();
  } else if (event.altKey && event.key === 'ArrowRight') {
    api.forward();
  } else if (event.key === 'Escape') {
    api.stop();
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
  if (activePanel === 'history') renderRecords(state.stored.history);
  if (activePanel === 'bookmarks') renderRecords(state.stored.bookmarks, { removable: true });
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
