'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CHILD_DIRECTORY_NAME = 'aether-child';

function resolveFixedLaunchTarget(executablePath, resourcesPath) {
  const childAppPath = path.join(resourcesPath, CHILD_DIRECTORY_NAME);
  const childEntryPoint = path.join(childAppPath, 'main.cjs');
  if (!fs.existsSync(executablePath) || !fs.statSync(executablePath).isFile()) {
    throw new Error('Fixed Electron executable is not a file.');
  }
  if (!fs.existsSync(childEntryPoint) || !fs.statSync(childEntryPoint).isFile()) {
    throw new Error('Fixed child entry point is not a file.');
  }
  return { executablePath, childAppPath, childEntryPoint };
}

module.exports = { resolveFixedLaunchTarget };
