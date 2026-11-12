'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  safeDownloadRecord,
  sanitizeDownloadFilename,
} = require('../download-utils.cjs');

const VALID_DOWNLOAD_RECORD = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  fileName: 'report.pdf',
  receivedBytes: 0,
  totalBytes: 0,
  state: 'awaiting-approval',
  error: null,
  updatedAt: 123,
};

test('download filenames remove bidi controls before display or saving', () => {
  assert.equal(sanitizeDownloadFilename('photo\u202egpj.exe'), 'photogpj.exe');
  assert.equal(sanitizeDownloadFilename('report\u2066final\u2069.pdf'), 'reportfinal.pdf');
  assert.equal(sanitizeDownloadFilename('résumé.pdf'), 'résumé.pdf');
});

test('download metadata rejects bidi controls from persisted or untrusted records', () => {
  assert.equal(
    safeDownloadRecord({ ...VALID_DOWNLOAD_RECORD, fileName: 'photo\u202egpj.exe' }),
    null,
  );
  assert.equal(safeDownloadRecord(VALID_DOWNLOAD_RECORD).fileName, 'report.pdf');
});
