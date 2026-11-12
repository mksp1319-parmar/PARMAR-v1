'use strict';

const path = require('node:path');

const DOWNLOAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_DOWNLOAD_FILENAME_LENGTH = 180;
const MAX_DOWNLOAD_ERROR_LENGTH = 300;
const BIDI_FORMAT_CONTROL_PATTERN = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
const DOWNLOAD_STATES = new Set([
  'awaiting-approval',
  'downloading',
  'completed',
  'cancelled',
  'interrupted',
  'failed',
]);

function sanitizeDownloadFilename(value) {
  if (typeof value !== 'string') return 'download';
  const leafName = value.split(/[\\/]/).at(-1)
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_')
    .replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .slice(0, MAX_DOWNLOAD_FILENAME_LENGTH);
  if (!leafName || leafName === '.' || leafName === '..') return 'download';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(leafName)) {
    return `_${leafName}`;
  }
  return leafName;
}

function safeDownloadRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  if (Object.keys(record).some((key) => ![
    'id',
    'fileName',
    'receivedBytes',
    'totalBytes',
    'state',
    'error',
    'updatedAt',
  ].includes(key))) return null;
  if (typeof record.id !== 'string' || !DOWNLOAD_ID_PATTERN.test(record.id)) return null;
  if (
    typeof record.fileName !== 'string'
    || !record.fileName
    || record.fileName.length > MAX_DOWNLOAD_FILENAME_LENGTH
    || /[\\/\u0000-\u001f\u007f]/.test(record.fileName)
    || BIDI_FORMAT_CONTROL_PATTERN.test(record.fileName)
    || record.fileName === '.'
    || record.fileName === '..'
  ) return null;
  if (!DOWNLOAD_STATES.has(record.state)) return null;
  if (
    !Number.isSafeInteger(record.receivedBytes)
    || record.receivedBytes < 0
    || !Number.isSafeInteger(record.totalBytes)
    || record.totalBytes < 0
    || !Number.isFinite(record.updatedAt)
    || record.updatedAt < 0
  ) return null;
  if (record.error !== null && (
    typeof record.error !== 'string' || record.error.length > MAX_DOWNLOAD_ERROR_LENGTH
    || /(?:^|\s)(?:\/[^\s]+|[a-z]:\\[^\s]+)/i.test(record.error)
  )) return null;
  return {
    id: record.id,
    fileName: record.fileName,
    receivedBytes: record.receivedBytes,
    totalBytes: record.totalBytes,
    state: record.state,
    error: record.error,
    updatedAt: record.updatedAt,
  };
}

function safeDownloadDestination(value) {
  if (
    typeof value !== 'string'
    || !value
    || value.length > 4096
    || /[\u0000-\u001f\u007f]/.test(value)
    || !path.isAbsolute(value)
  ) return null;
  const resolved = path.resolve(value);
  if (resolved !== path.normalize(value)) return null;
  if (value.split(path.sep).includes('..')) return null;
  const fileName = path.basename(resolved);
  if (!fileName || fileName === '.' || fileName === '..') return null;
  return resolved;
}

module.exports = {
  MAX_DOWNLOAD_ERROR_LENGTH,
  MAX_DOWNLOAD_FILENAME_LENGTH,
  safeDownloadDestination,
  safeDownloadRecord,
  sanitizeDownloadFilename,
};
