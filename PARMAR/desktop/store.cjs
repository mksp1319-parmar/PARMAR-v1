'use strict';

const fs = require('node:fs');
const path = require('node:path');

const STORE_VERSION = 1;
const MAX_BOOKMARKS = 500;
const MAX_HISTORY = 1000;
const MAX_TITLE_LENGTH = 300;

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

class AetherStore {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, 'aether-state.json');
    this.data = { version: STORE_VERSION, bookmarks: [], history: [] };
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
    };
  }

  snapshot() {
    return {
      bookmarks: this.data.bookmarks.map((record) => ({ ...record })),
      history: this.data.history.map((record) => ({ ...record })),
    };
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

  removeBookmark(url) {
    if (typeof url !== 'string') throw new TypeError('A bookmark URL is required.');
    const bookmarks = this.data.bookmarks.filter((item) => item.url !== url);
    this.save({ ...this.data, bookmarks });
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

  clearHistory() {
    this.save({ ...this.data, history: [] });
    return this.snapshot();
  }

  save(nextData) {
    const parent = path.dirname(this.filePath);
    fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, JSON.stringify(nextData), { mode: 0o600 });
      fs.renameSync(temporaryPath, this.filePath);
    } catch (error) {
      try {
        fs.rmSync(temporaryPath, { force: true });
      } catch {
        // Preserve the original persistence error.
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
  safeWebRecord,
};
