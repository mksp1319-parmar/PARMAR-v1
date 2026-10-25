'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const STORE_VERSION = 1;
const MAX_BOOKMARKS = 500;
const MAX_HISTORY = 1000;
const MAX_TITLE_LENGTH = 300;
const MAX_SESSION_TABS = 16;

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
  if (keys.length !== 2 || keys[0] !== 'activeIndex' || keys[1] !== 'tabs') return null;
  if (!Array.isArray(session.tabs) || session.tabs.length > MAX_SESSION_TABS) return null;
  if (!Number.isSafeInteger(session.activeIndex)) return null;
  if (session.tabs.length === 0) {
    if (session.activeIndex !== 0) return null;
  } else if (session.activeIndex < 0 || session.activeIndex >= session.tabs.length) {
    return null;
  }

  const tabs = session.tabs.map((url) => {
    if (url === null) return null;
    if (typeof url !== 'string') return undefined;
    const record = safeWebRecord({ url });
    return record ? record.url : undefined;
  });
  if (tabs.some((url) => url === undefined)) return null;
  return { tabs, activeIndex: session.activeIndex };
}

class AetherStore {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, 'aether-state.json');
    this.data = {
      version: STORE_VERSION,
      bookmarks: [],
      history: [],
      session: { tabs: [], activeIndex: 0 },
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
    if (!Array.isArray(parsed.bookmarks) || !Array.isArray(parsed.history)) {
      throw new Error('AETHER browser data has an invalid record list.');
    }
    const session = parsed.session === undefined
      ? { tabs: [], activeIndex: 0 }
      : safeSession(parsed.session);
    if (!session) throw new Error('AETHER browser session state is invalid.');
    if (parsed.bookmarks.length > MAX_BOOKMARKS || parsed.history.length > MAX_HISTORY) {
      throw new Error('AETHER browser data exceeds the supported record limits.');
    }

    const validateRecords = (records, name) => records.map((record, index) => {
      const safeRecord = safeWebRecord(record);
      if (!safeRecord) {
        throw new Error(`AETHER ${name} record ${index + 1} is invalid.`);
      }
      return safeRecord;
    });

    this.data = {
      version: STORE_VERSION,
      bookmarks: validateRecords(parsed.bookmarks, 'bookmark'),
      history: validateRecords(parsed.history, 'history'),
      session,
    };
  }

  snapshot() {
    return {
      bookmarks: this.data.bookmarks.map((record) => ({ ...record })),
      history: this.data.history.map((record) => ({ ...record })),
    };
  }

  sessionSnapshot() {
    return { tabs: [...this.data.session.tabs], activeIndex: this.data.session.activeIndex };
  }

  saveSession(session) {
    const safe = safeSession(session);
    if (!safe) throw new TypeError('AETHER tab session is invalid.');
    if (
      safe.activeIndex === this.data.session.activeIndex
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

  updateBookmark(url, title) {
    if (
      typeof title !== 'string'
      || !title.trim()
      || title.trim().length > MAX_TITLE_LENGTH
    ) {
      throw new TypeError(`A bookmark title must contain 1 to ${MAX_TITLE_LENGTH} characters.`);
    }
    const safeRecord = safeWebRecord({ url, title });
    if (!safeRecord) throw new TypeError('Only valid HTTPS bookmarks can be updated.');
    const existing = this.data.bookmarks.find((item) => item.url === safeRecord.url);
    if (!existing) throw new Error('The bookmark no longer exists.');
    const bookmarks = this.data.bookmarks.map((item) => (
      item.url === safeRecord.url
        ? { ...item, title: safeRecord.title }
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
  MAX_SESSION_TABS,
  safeSession,
  safeWebRecord,
};
