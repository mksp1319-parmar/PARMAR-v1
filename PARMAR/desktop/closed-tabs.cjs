'use strict';

const MAX_CLOSED_TABS = 10;

function safeClosedTab(tab) {
  if (!tab || typeof tab !== 'object' || Array.isArray(tab)) return null;
  const keys = Object.keys(tab).sort();
  if (
    keys.length !== 3
    || keys[0] !== 'restoreUrl'
    || keys[1] !== 'url'
    || keys[2] !== 'zoomFactor'
  ) return null;

  const safeUrl = (value) => {
    if (value === null) return null;
    if (typeof value !== 'string' || value.length > 2048) return undefined;
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password) return undefined;
      return url.href;
    } catch {
      return undefined;
    }
  };
  const url = safeUrl(tab.url);
  const restoreUrl = safeUrl(tab.restoreUrl);
  if (
    url === undefined
    || restoreUrl === undefined
    || typeof tab.zoomFactor !== 'number'
    || !Number.isFinite(tab.zoomFactor)
    || tab.zoomFactor < 0.5
    || tab.zoomFactor > 2
  ) return null;

  return { url, restoreUrl, zoomFactor: tab.zoomFactor };
}

class ClosedTabHistory {
  constructor(entries = []) {
    this.entries = [];
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      const safe = safeClosedTab(entry);
      if (safe) this.entries.push(safe);
      if (this.entries.length === MAX_CLOSED_TABS) break;
    }
  }

  get length() {
    return this.entries.length;
  }

  push(tab) {
    const safe = safeClosedTab(tab);
    if (!safe) return false;
    this.entries.unshift(safe);
    this.entries.length = Math.min(this.entries.length, MAX_CLOSED_TABS);
    return true;
  }

  take() {
    while (this.entries.length) {
      const safe = safeClosedTab(this.entries.shift());
      if (safe) return safe;
    }
    return null;
  }
}

module.exports = { ClosedTabHistory, MAX_CLOSED_TABS, safeClosedTab };
