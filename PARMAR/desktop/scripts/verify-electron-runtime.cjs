'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function readJson(filePath, description) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`${description} is missing: ${filePath}`);
    }
    throw new Error(`Could not read ${description}: ${error.message}`);
  }
}

function verifyElectronRuntime(
  desktopDirectory,
  { runLibrariesCommand = runElectronLibraries, runVersionCommand = runElectronVersion } = {},
) {
  const packageDirectory = path.join(desktopDirectory, 'node_modules', 'electron');
  const packagePath = path.join(packageDirectory, 'package.json');
  if (!fs.existsSync(packagePath)) {
    throw new Error(`Electron npm package is missing: ${packagePath}`);
  }

  const electronPackage = readJson(packagePath, 'Electron npm package metadata');
  const packageManifest = readJson(path.join(desktopDirectory, 'package.json'), 'desktop package manifest');
  const packageLock = readJson(path.join(desktopDirectory, 'package-lock.json'), 'desktop package lockfile');
  const declaredVersion = packageManifest.devDependencies?.electron;
  if (declaredVersion === undefined) {
    throw new Error('Electron dependency is missing from package.json devDependencies.');
  }
  if (typeof declaredVersion !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(declaredVersion)) {
    throw new Error(
      `Electron package.json devDependencies version must be an exact x.y.z version; received ${JSON.stringify(declaredVersion)}.`,
    );
  }
  const electronLockEntry = packageLock.packages?.['node_modules/electron'];
  if (!electronLockEntry || typeof electronLockEntry !== 'object') {
    throw new Error('Electron package-lock.json entry is missing: packages["node_modules/electron"].');
  }
  const pinnedVersion = electronLockEntry.version;
  if (typeof pinnedVersion !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(pinnedVersion)) {
    throw new Error(
      `Electron package-lock.json entry must contain an exact x.y.z version; received ${JSON.stringify(pinnedVersion)}.`,
    );
  }
  if (declaredVersion !== pinnedVersion) {
    throw new Error(
      `Electron package.json declares ${declaredVersion}, but package-lock.json pins ${pinnedVersion}.`,
    );
  }
  if (!pinnedVersion || electronPackage.version !== pinnedVersion) {
    throw new Error(
      `Electron npm package version ${electronPackage.version ?? 'unknown'} does not match lockfile version ${pinnedVersion ?? 'missing'}.`,
    );
  }

  const runtimeDirectory = path.join(packageDirectory, 'dist');
  let runtimeDirectoryStat;
  try {
    runtimeDirectoryStat = fs.statSync(runtimeDirectory);
  } catch {
    throw new Error(`Electron runtime directory is missing: ${runtimeDirectory}`);
  }
  if (!runtimeDirectoryStat.isDirectory()) {
    throw new Error(`Electron runtime directory is invalid: ${runtimeDirectory}`);
  }

  const electronBinary = path.join(runtimeDirectory, 'electron');
  try {
    if (!fs.statSync(electronBinary).isFile()) {
      throw new Error('not an executable file');
    }
    fs.accessSync(electronBinary, fs.constants.X_OK);
  } catch {
    throw new Error(`Electron runtime binary is missing or not executable: ${electronBinary}`);
  }

  const libraryOutput = runLibrariesCommand(electronBinary);
  const missingLibraries = libraryOutput
    .split(/\r?\n/)
    .filter((line) => line.includes('not found'));
  if (missingLibraries.length > 0) {
    throw new Error(`Electron runtime has unresolved shared libraries:\n${missingLibraries.join('\n')}`);
  }

  const reportedVersion = runVersionCommand(electronBinary);
  if (reportedVersion !== `v${pinnedVersion}` && reportedVersion !== pinnedVersion) {
    throw new Error(
      `Electron runtime reports version ${reportedVersion || 'no version'}; lockfile pins ${pinnedVersion}.`,
    );
  }

  return { electronBinary, pinnedVersion, runtimeDirectory };
}

function runElectronLibraries(electronBinary) {
  const result = spawnSync('ldd', [electronBinary], { encoding: 'utf8' });
  if (result.error) {
    throw new Error(`Could not inspect Electron runtime libraries: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `Could not inspect Electron runtime libraries (${result.status ?? result.signal}): ${result.stderr.trim()}`,
    );
  }
  return `${result.stdout}\n${result.stderr}`;
}

function runElectronVersion(electronBinary) {
  const result = spawnSync(electronBinary, ['--version'], {
    encoding: 'utf8',
    timeout: 15_000,
  });
  if (result.error) {
    throw new Error(`Could not run the pinned Electron binary: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `Pinned Electron binary --version failed (${result.status ?? result.signal}): ${result.stderr.trim()}`,
    );
  }
  return result.stdout.trim();
}

if (require.main === module) {
  try {
    const { electronBinary, pinnedVersion, runtimeDirectory } = verifyElectronRuntime(process.cwd());
    console.log(`Verified Electron ${pinnedVersion}: ${electronBinary}`);
    console.log(`Electron runtime directory: ${runtimeDirectory}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { verifyElectronRuntime };
