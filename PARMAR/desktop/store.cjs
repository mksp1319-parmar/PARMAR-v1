'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { safeDownloadRecord } = require('./download-utils.cjs');
const { ClosedTabHistory } = require('./closed-tabs.cjs');

const STORE_VERSION = 1;
const MAX_BOOKMARKS = 500;
const MAX_HISTORY = 1000;
const MAX_DOWNLOADS = 100;
const MAX_TITLE_LENGTH = 300;
const MAX_SESSION_TABS = 16;
const DEFAULT_ZOOM_FACTOR = 1;
const MIN_ZOOM_FACTOR = 0.5;
const MAX_ZOOM_FACTOR = 2;
const DEFAULT_PREFERENCES = Object.freeze({
  homepage: 'aether-start',
  startupBehavior: 'restore-session',
  defaultZoom: DEFAULT_ZOOM_FACTOR,
  appearance: 'dark',
});

function isValidZoomFactor(value) {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= MIN_ZOOM_FACTOR
    && value <= MAX_ZOOM_FACTOR;
}

function safePreferences(value, legacyZoomFactor) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      ...DEFAULT_PREFERENCES,
      defaultZoom: isValidZoomFactor(legacyZoomFactor)
        ? legacyZoomFactor
        : DEFAULT_PREFERENCES.defaultZoom,
    };
  }
  return {
    homepage: value.homepage === 'aether-start'
      ? value.homepage
      : DEFAULT_PREFERENCES.homepage,
    startupBehavior: ['restore-session', 'start-page'].includes(value.startupBehavior)
      ? value.startupBehavior
      : DEFAULT_PREFERENCES.startupBehavior,
    defaultZoom: isValidZoomFactor(value.defaultZoom)
      ? value.defaultZoom
      : (isValidZoomFactor(legacyZoomFactor)
        ? legacyZoomFactor
        : DEFAULT_PREFERENCES.defaultZoom),
    appearance: value.appearance === 'dark'
      ? value.appearance
      : DEFAULT_PREFERENCES.appearance,
  };
}

function safeWebRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  if (typeof record.url !== 'string' || record.url.length > 2048) return null;
  let url;
  try {
    url = new URL(record.url);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  const title = typeof record.title === 'string'
    ? record.title.trim().slice(0, MAX_TITLE_LENGTH)
    : '';
  return {
    title: title || url.hostname,
    url: url.href,
    visitedAt: Number.isFinite(record.visitedAt) ? record.visitedAt : Date.now(),
  };
}

function safeSession(session) {
  if (!session || typeof session !== 'object' || Array.isArray(session)) return null;
  const keys = Object.keys(session).sort();
  if (
    !keys.includes('activeIndex')
    || !keys.includes('tabs')
    || keys.some((key) => !['activeIndex', 'tabs', 'zoomFactor', 'zoomFactors'].includes(key))
  ) return null;
  if (!Array.isArray(session.tabs) || session.tabs.length > MAX_SESSION_TABS) return null;
  if (!Number.isSafeInteger(session.activeIndex)) return null;
  if (session.tabs.length === 0) {
    if (session.activeIndex !== 0) return null;
  } else if (session.activeIndex < 0 || session.activeIndex >= session.tabs.length) {
    return null;
  }

  const tabs = session.tabs.map((tab) => {
    if (typeof tab === 'string' || tab === null) {
      const record = tab === null ? null : safeWebRecord({ url: tab });
      if (tab !== null && !record) return undefined;
      return { url: record?.url || null, pinned: false };
    }
    if (!tab || typeof tab !== 'object' || Array.isArray(tab)) return undefined;
    const keys = Object.keys(tab);
    if (
      keys.length !== 2
      || !keys.includes('url')
      || !keys.includes('pinned')
      || typeof tab.pinned !== 'boolean'
    ) return undefined;
    if (tab.url === null) return { url: null, pinned: tab.pinned };
    if (typeof tab.url !== 'string') return undefined;
    const record = safeWebRecord({ url: tab.url });
    if (!record) return undefined;
    return { url: record.url, pinned: tab.pinned };
  });
  if (tabs.some((url) => url === undefined)) return null;
  let sawUnpinnedTab = false;
  for (const tab of tabs) {
    if (!tab.pinned) sawUnpinnedTab = true;
    else if (sawUnpinnedTab) return null;
  }
  const zoomFactor = typeof session.zoomFactor === 'number'
    && isValidZoomFactor(session.zoomFactor)
    ? session.zoomFactor
    : DEFAULT_ZOOM_FACTOR;
  const zoomFactors = session.zoomFactors === undefined
    ? tabs.map(() => zoomFactor)
    : Array.isArray(session.zoomFactors) && session.zoomFactors.length === tabs.length
      ? session.zoomFactors.map((factor) => isValidZoomFactor(factor) ? factor : zoomFactor)
      : null;
  if (!zoomFactors) return null;
  return { tabs, activeIndex: session.activeIndex, zoomFactor, zoomFactors };
}

class AetherStore {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, 'aether-state.json');
    this.data = {
      version: STORE_VERSION,
      bookmarks: [],
      history: [],
      downloads: [],
      closedTabs: [],
      session: { tabs: [], activeIndex: 0, zoomFactor: DEFAULT_ZOOM_FACTOR, zoomFactors: [] },
      preferences: { ...DEFAULT_PREFERENCES },
    };
    this.load();
  }

  load() {
    let content;
    try {
      content = fs.readFileSync(this.filePath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw new Error('AETHER browser data could not be read.', { cause: error });
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      throw new Error('AETHER browser data is invalid JSON.', { cause: error });
    }
    if (!parsed || parsed.version !== STORE_VERSION) {
      throw new Error('AETHER browser data has an unsupported version.');
    }
    if (
      !Array.isArray(parsed.bookmarks)
      || !Array.isArray(parsed.history)
      || (parsed.downloads !== undefined && !Array.isArray(parsed.downloads))
    ) {
      throw new Error('AETHER browser data has an invalid record list.');
    }
    if (parsed.closedTabs !== undefined && !Array.isArray(parsed.closedTabs)) {
      throw new Error('AETHER closed-tab data has an invalid record list.');
    }
    const session = parsed.session === undefined
      ? { tabs: [], activeIndex: 0, zoomFactor: DEFAULT_ZOOM_FACTOR, zoomFactors: [] }
      : safeSession(parsed.session);
    if (!session) throw new Error('AETHER browser session state is invalid.');
    const preferences = safePreferences(
      parsed.preferences,
      parsed.preferences === undefined ? session.zoomFactor : undefined,
    );
    const downloads = parsed.downloads || [];
    if (
      parsed.bookmarks.length > MAX_BOOKMARKS
      || parsed.history.length > MAX_HISTORY
      || downloads.length > MAX_DOWNLOADS
    ) {
      throw new Error('AETHER browser data exceeds the supported record limits.');
    }

    const validateRecords = (records, name) => records.map((record, index) => {
      const safeRecord = safeWebRecord(record);
      if (!safeRecord) {
        throw new Error(`AETHER ${name} record ${index + 1} is invalid.`);
      }
      return safeRecord;
    });

    const safeDownloads = downloads.map((record, index) => {
      const safeRecord = safeDownloadRecord(record);
      if (!safeRecord) throw new Error(`AETHER download record ${index + 1} is invalid.`);
      if (safeRecord.state === 'downloading' || safeRecord.state === 'awaiting-approval') {
        return {
          ...safeRecord,
          state: 'interrupted',
          error: 'AETHER closed before this download finished. It was not resumed.',
        };
      }
      return safeRecord;
    });
    const closedTabs = new ClosedTabHistory(parsed.closedTabs || []).entries;

    this.data = {
      version: STORE_VERSION,
      bookmarks: validateRecords(parsed.bookmarks, 'bookmark'),
      history: validateRecords(parsed.history, 'history'),
      downloads: safeDownloads,
      closedTabs,
      session,
      preferences,
    };
    if (
      JSON.stringify(downloads) !== JSON.stringify(safeDownloads)
      || JSON.stringify(parsed.preferences) !== JSON.stringify(preferences)
      || JSON.stringify(parsed.session) !== JSON.stringify(session)
      || JSON.stringify(parsed.closedTabs || []) !== JSON.stringify(closedTabs)
    ) {
      this.save(this.data);
    }
  }

  snapshot() {
    return {
      bookmarks: this.data.bookmarks.map((record) => ({ ...record })),
      history: this.data.history.map((record) => ({ ...record })),
    };
  }

  sessionSnapshot() {
    return {
      tabs: [...this.data.session.tabs],
      activeIndex: this.data.session.activeIndex,
      zoomFactor: this.data.session.zoomFactor,
      zoomFactors: [...this.data.session.zoomFactors],
    };
  }

  preferencesSnapshot() {
    return { ...this.data.preferences };
  }

  updatePreferences(updates) {
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      throw new TypeError('AETHER preference updates are invalid.');
    }
    const keys = Object.keys(updates);
    if (!keys.length || keys.some((key) => !Object.hasOwn(DEFAULT_PREFERENCES, key))) {
      throw new TypeError('AETHER preference updates contain an unsupported setting.');
    }
    const next = { ...this.data.preferences, ...updates };
    if (
      next.homepage !== 'aether-start'
      || !['restore-session', 'start-page'].includes(next.startupBehavior)
      || !isValidZoomFactor(next.defaultZoom)
      || next.appearance !== 'dark'
    ) {
      throw new TypeError('One or more AETHER preferences are invalid.');
    }
    this.save({ ...this.data, preferences: next });
    return this.preferencesSnapshot();
  }

  resetPreferences() {
    this.save({ ...this.data, preferences: { ...DEFAULT_PREFERENCES } });
    return this.preferencesSnapshot();
  }

  downloadsSnapshot() {
    return this.data.downloads.map((record) => ({ ...record }));
  }

  closedTabsSnapshot() {
    return this.data.closedTabs.map((tab) => ({ ...tab }));
  }

  saveClosedTabs(entries) {
    if (!Array.isArray(entries)) throw new TypeError('AETHER closed-tab data is invalid.');
    const closedTabs = new ClosedTabHistory(entries).entries;
    this.save({ ...this.data, closedTabs });
    return this.closedTabsSnapshot();
  }

  updateDownload(record) {
    const safeRecord = safeDownloadRecord(record);
    if (!safeRecord) throw new TypeError('AETHER download metadata is invalid.');
    const downloads = [
      safeRecord,
      ...this.data.downloads.filter((item) => item.id !== safeRecord.id),
    ].slice(0, MAX_DOWNLOADS);
    this.save({ ...this.data, downloads });
    return this.downloadsSnapshot();
  }

  clearDownloadHistory() {
    const downloads = this.data.downloads.filter(
      (record) => record.state === 'downloading' || record.state === 'awaiting-approval',
    );
    this.save({ ...this.data, downloads });
    return this.downloadsSnapshot();
  }

  saveSession(session) {
    const safe = safeSession(session);
    if (!safe) throw new TypeError('AETHER tab session is invalid.');
    if (
      safe.activeIndex === this.data.session.activeIndex
      && safe.zoomFactor === this.data.session.zoomFactor
      && JSON.stringify(safe.zoomFactors) === JSON.stringify(this.data.session.zoomFactors)
      && JSON.stringify(safe.tabs) === JSON.stringify(this.data.session.tabs)
    ) {
      return this.sessionSnapshot();
    }
    this.save({ ...this.data, session: safe });
    return this.sessionSnapshot();
  }

  addBookmark(record) {
    const safeRecord = safeWebRecord(record);
    if (!safeRecord) throw new TypeError('Only valid HTTPS pages can be bookmarked.');
    const bookmarks = this.data.bookmarks.filter((item) => item.url !== safeRecord.url);
    if (bookmarks.length >= MAX_BOOKMARKS) {
      throw new Error('The AETHER bookmark limit has been reached.');
    }
    bookmarks.unshift(safeRecord);
    this.save({ ...this.data, bookmarks });
    return this.snapshot();
  }

  updateBookmark(url, title, updatedUrl = url) {
    if (
      typeof title !== 'string'
      || !title.trim()
      || title.trim().length > MAX_TITLE_LENGTH
    ) {
      throw new TypeError(`A bookmark title must contain 1 to ${MAX_TITLE_LENGTH} characters.`);
    }
    const safeRecord = safeWebRecord({ url: updatedUrl, title });
    if (!safeRecord) throw new TypeError('Only valid HTTPS bookmarks can be updated.');
    const oldRecord = safeWebRecord({ url });
    if (!oldRecord) throw new TypeError('Only valid HTTPS bookmarks can be updated.');
    const existing = this.data.bookmarks.find((item) => item.url === oldRecord.url);
    if (!existing) throw new Error('The bookmark no longer exists.');
    if (
      safeRecord.url !== oldRecord.url
      && this.data.bookmarks.some((item) => item.url === safeRecord.url)
    ) {
      throw new Error('A bookmark already exists for the updated address.');
    }
    const bookmarks = this.data.bookmarks.map((item) => (
      item.url === oldRecord.url
        ? { ...item, title: safeRecord.title, url: safeRecord.url }
        : item
    ));
    this.save({ ...this.data, bookmarks });
    return this.snapshot();
  }

  removeBookmark(url) {
    const safeRecord = safeWebRecord({ url });
    if (!safeRecord) throw new TypeError('Only valid HTTPS bookmarks can be removed.');
    const bookmarks = this.data.bookmarks.filter((item) => item.url !== safeRecord.url);
    this.save({ ...this.data, bookmarks });
    return this.snapshot();
  }

  removeHistory(url) {
    const safeRecord = safeWebRecord({ url });
    if (!safeRecord) throw new TypeError('Only valid HTTPS pages can be removed from history.');
    const history = this.data.history.filter((item) => item.url !== safeRecord.url);
    this.save({ ...this.data, history });
    return this.snapshot();
  }

  addHistory(record) {
    const safeRecord = safeWebRecord(record);
    if (!safeRecord) throw new TypeError('Only valid HTTPS pages can be added to history.');
    const history = this.data.history.filter((item) => item.url !== safeRecord.url);
    history.unshift(safeRecord);
    this.save({ ...this.data, history: history.slice(0, MAX_HISTORY) });
    return this.snapshot();
  }

  updateHistoryTitle(url, title) {
    const safeRecord = safeWebRecord({ url, title });
    if (!safeRecord) throw new TypeError('Only valid HTTPS pages can be updated in history.');
    const existing = this.data.history.find((item) => item.url === safeRecord.url);
    if (!existing || existing.title === safeRecord.title) return this.snapshot();
    const history = this.data.history.map((item) => (
      item.url === safeRecord.url ? { ...item, title: safeRecord.title } : item
    ));
    this.save({ ...this.data, history });
    return this.snapshot();
  }

  clearHistory() {
    this.save({ ...this.data, history: [] });
    return this.snapshot();
  }

  save(nextData) {
    const parent = path.dirname(this.filePath);
    fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    let temporaryCreated = false;
    let temporaryDescriptor = null;
    try {
      temporaryDescriptor = fs.openSync(temporaryPath, 'wx', 0o600);
      temporaryCreated = true;
      fs.writeFileSync(temporaryDescriptor, JSON.stringify(nextData));
      fs.closeSync(temporaryDescriptor);
      temporaryDescriptor = null;
      fs.renameSync(temporaryPath, this.filePath);
    } catch (error) {
      if (temporaryDescriptor !== null) {
        try {
          fs.closeSync(temporaryDescriptor);
        } catch {
          // Preserve the original persistence error.
        }
      }
      if (temporaryCreated) {
        try {
          fs.rmSync(temporaryPath, { force: true });
        } catch {
          // Preserve the original persistence error.
        }
      }
      throw new Error('AETHER browser data could not be saved.', { cause: error });
    }
    this.data = nextData;
  }
}

module.exports = {
  AetherStore,
  MAX_BOOKMARKS,
  MAX_HISTORY,
  MAX_DOWNLOADS,
  MAX_SESSION_TABS,
  DEFAULT_ZOOM_FACTOR,
  MIN_ZOOM_FACTOR,
  MAX_ZOOM_FACTOR,
  DEFAULT_PREFERENCES,
  safePreferences,
  safeSession,
  safeWebRecord,
};
