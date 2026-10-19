'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const asar = require('@electron/asar');

const outputDirectory = path.resolve(__dirname, '..', 'out');
const artifactDirectory = process.env.PARMAR_POC_ARTIFACT
  ? path.resolve(process.env.PARMAR_POC_ARTIFACT)
  : fs.existsSync(outputDirectory)
    ? fs.readdirSync(outputDirectory)
      .map((name) => path.join(outputDirectory, name))
      .find((candidate) => fs.existsSync(path.join(candidate, 'resources')))
    : null;

test('packaged parent and separate AETHER child resources are present', {
  skip: !artifactDirectory,
}, () => {
  const resourcesDirectory = path.join(artifactDirectory, 'resources');
  const executablePath = path.join(artifactDirectory, 'parmar-child-launch');
  const parentArchivePath = path.join(resourcesDirectory, 'app.asar');
  const childDirectory = path.join(resourcesDirectory, 'aether-child');
  const childPackagePath = path.join(childDirectory, 'package.json');
  const childEntryPath = path.join(childDirectory, 'main.cjs');
  const childHtmlPath = path.join(childDirectory, 'index.html');

  assert.ok(fs.statSync(executablePath).isFile(), `missing executable: ${executablePath}`);
  assert.ok(fs.statSync(parentArchivePath).isFile(), `missing parent archive: ${parentArchivePath}`);
  assert.ok(fs.statSync(childPackagePath).isFile(), `missing child metadata: ${childPackagePath}`);
  assert.ok(fs.statSync(childEntryPath).isFile(), `missing child entry: ${childEntryPath}`);
  assert.ok(fs.statSync(childHtmlPath).isFile(), `missing child page: ${childHtmlPath}`);

  const parentArchiveFiles = asar.listPackage(parentArchivePath);
  assert.ok(parentArchiveFiles.includes('/main.cjs'), 'parent entry point is not in app.asar');
  assert.ok(parentArchiveFiles.includes('/package.json'), 'parent metadata is not in app.asar');

  const parentPackage = JSON.parse(
    asar.extractFile(parentArchivePath, 'package.json').toString('utf8'),
  );
  assert.equal(parentPackage.name, 'parmar-child-launch-poc');
  assert.equal(parentPackage.main, 'main.cjs');
  const parentSource = asar.extractFile(parentArchivePath, 'main.cjs').toString('utf8');
  assert.match(parentSource, /spawn\(executablePath, \[childAppPath\]/);
  assert.match(parentSource, /shell: false/);
  assert.doesNotMatch(parentSource, /\bipcMain\b|loadURL\s*\(/);
  assert.ok(parentArchiveFiles.includes('/child-supervisor.cjs'));
  assert.ok(parentArchiveFiles.includes('/fixed-launch-target.cjs'));
  const supervisorSource = asar.extractFile(parentArchivePath, 'child-supervisor.cjs').toString('utf8');
  assert.match(supervisorSource, /MAX_PROTOCOL_LINE_BYTES = 4096/);
  assert.match(supervisorSource, /startup-timeout/);
  assert.match(supervisorSource, /graceful-shutdown-failed/);

  const childPackage = JSON.parse(fs.readFileSync(childPackagePath, 'utf8'));
  assert.equal(childPackage.name, 'aether-child-poc');
  assert.equal(childPackage.main, 'main.cjs');
  assert.equal(childPackage.devDependencies.electron, '44.7.0');

  const childSource = fs.readFileSync(childEntryPath, 'utf8');
  assert.match(childSource, /component:\s*'aether-child-poc'/);
  assert.doesNotMatch(childSource, /https?:\/\/|loadURL\s*\(/);
  const lockfile = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package-lock.json'), 'utf8'));
  assert.equal(lockfile.packages['node_modules/electron'].version, '44.7.0');
  assert.equal(lockfile.packages['node_modules/@electron-forge/cli'].version, '8.0.1');
  assert.equal(lockfile.packages['node_modules/@electron/asar'].version, '4.0.1');

  process.stdout.write(`${JSON.stringify({
    artifactDirectory,
    executablePath,
    parentArchivePath,
    childDirectory,
    childPackagePath,
    childEntryPath,
    childHtmlPath,
    parentArchiveEntryCount: parentArchiveFiles.length,
    runtimeLaunched: false,
  }, null, 2)}\n`);
});
