'use strict';

const fs = require('node:fs');
const path = require('node:path');

function readState(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function writeState(filePath, value, exclusive = false) {
  const directory = path.dirname(filePath);
  const temporaryPath = `${filePath}.tmp`;
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT
    | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW
    | (exclusive ? fs.constants.O_EXCL : 0);
  const fd = fs.openSync(exclusive ? filePath : temporaryPath, flags, 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(value)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  if (!exclusive) {
    fs.renameSync(temporaryPath, filePath);
    const directoryFd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
    try {
      fs.fsyncSync(directoryFd);
    } finally {
      fs.closeSync(directoryFd);
    }
  }
}

function createTestAnchor(filePath) {
  return {
    read: () => readState(filePath),
    initialize: (pointer) => {
      if (readState(filePath) !== null) return false;
      writeState(filePath, pointer, true);
      return true;
    },
    compareAndSwap: ({ expected, next }) => {
      const current = readState(filePath);
      if (!current || current.sequence !== expected.sequence
        || current.integrity !== expected.integrity) return false;
      writeState(filePath, next);
      return true;
    },
  };
}

module.exports = { createTestAnchor };
