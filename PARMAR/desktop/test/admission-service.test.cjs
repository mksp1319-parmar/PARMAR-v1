'use strict';

const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const DESKTOP_DIRECTORY = path.resolve(__dirname, '..');
const SERVICE_SOURCE = path.join(DESKTOP_DIRECTORY, 'admission-service.c');
const BACKEND_SCRIPT = path.join(DESKTOP_DIRECTORY, 'admission-service-backend.cjs');
const CONTRACT_SCRIPT = path.join(DESKTOP_DIRECTORY, 'admission-contract.cjs');
const LEDGER_SCRIPT = path.join(DESKTOP_DIRECTORY, 'admission-ledger.cjs');
const TEST_ANCHOR_SCRIPT = path.join(__dirname, 'admission-test-anchor.cjs');
const GENERATION_ID = '123e4567-e89b-42d3-a456-426614174000';
const CURRENT_UID = typeof process.getuid === 'function' ? process.getuid() : null;
const CURRENT_GID = typeof process.getgid === 'function' ? process.getgid() : null;
const REQUEST_TIMEOUT_MS = 3000;

let temporaryRoot;
let serviceBinary;
let serviceNode;
let serviceBackend;
let serviceContract;

function uidForRole(offset) {
  const candidate = CURRENT_UID + 10000 + offset;
  return candidate === CURRENT_UID ? candidate + 100 : candidate;
}

function serviceArgs(directory, overrides = {}) {
  const admissionUid = overrides.admissionUid ?? uidForRole(4);
  const stateDirectory = overrides.stateDirectory ?? path.join(directory, 'state');
  fs.mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
  fs.chmodSync(stateDirectory, 0o700);
  return [
    '--socket', path.join(directory, overrides.socketName ?? 'admission.sock'),
    '--state-dir', stateDirectory,
    '--service-uid', String(overrides.serviceUid ?? CURRENT_UID),
    '--access-gid', String(overrides.accessGid ?? CURRENT_GID),
    '--admission-uid', String(admissionUid),
    '--browser-uid', String(overrides.browserUid ?? uidForRole(1)),
    '--lifecycle-uid', String(overrides.lifecycleUid ?? uidForRole(2)),
    '--observer-uid', String(overrides.observerUid ?? uidForRole(3)),
    '--operator-uid', String(overrides.operatorUid ?? uidForRole(5)),
    '--node', serviceNode,
    '--worker', serviceBackend,
    '--test-anchor-state', path.join(directory, 'test-anchor.json'),
  ];
}

function request(operation, requestId, generationId, serviceInstanceId) {
  return {
    version: 1,
    operation,
    requestId,
    ...(generationId ? { generationId } : {}),
    serviceInstanceId,
  };
}

function connectAndSend(socketPath, data, { disconnectAfterWrite = false } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let response = '';
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('Native admission service response timed out.'));
    }, REQUEST_TIMEOUT_MS);
    socket.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    socket.on('data', (chunk) => {
      response += chunk.toString('utf8');
      if (response.includes('\n')) {
        clearTimeout(timeout);
        socket.end();
        try {
          resolve(JSON.parse(response.slice(0, response.indexOf('\n'))));
        } catch (error) {
          reject(error);
        }
      }
    });
    socket.once('connect', () => {
      socket.write(data, () => {
        if (disconnectAfterWrite) {
          socket.destroy();
          clearTimeout(timeout);
          resolve(null);
        }
      });
    });
  });
}

function sendRequest(socketPath, value, options) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  return connectAndSend(socketPath, `${serialized}\n`, options);
}

async function waitForSocket(service, socketPath) {
  const deadline = Date.now() + REQUEST_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (service.exitCode !== null) {
      throw new Error(`Native admission service exited during startup (${service.exitCode}).`);
    }
    try {
      if (fs.statSync(socketPath).isSocket()) {
        await new Promise((resolve, reject) => {
          const socket = net.createConnection(socketPath);
          socket.once('connect', () => {
            socket.destroy();
            resolve();
          });
          socket.once('error', (error) => {
            socket.destroy();
            reject(error);
          });
        });
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Native admission service did not create its Unix socket.');
}

async function startService(directory, {
  admissionUid = uidForRole(4),
} = {}) {
  const socketPath = path.join(directory, 'admission.sock');
  const service = spawn(serviceBinary, serviceArgs(directory, { admissionUid }), {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  service.stderr.setEncoding('utf8');
  service.stderr.on('data', (chunk) => { stderr += chunk; });
  await waitForSocket(service, socketPath).catch((error) => {
    error.serviceStderr = stderr;
    throw error;
  });
  return { service, socketPath, getStderr: () => stderr };
}

async function stopService(service) {
  if (service.exitCode !== null) return;
  service.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve, reject) => {
      service.once('exit', resolve);
      service.once('error', reject);
    }),
    new Promise((_, reject) => setTimeout(
      () => reject(new Error('Native admission service did not shut down.')),
      REQUEST_TIMEOUT_MS,
    )),
  ]);
}

async function withService(run, options) {
  const directory = fs.mkdtempSync(path.join(temporaryRoot, 'service-'));
  fs.chmodSync(directory, 0o750);
  const service = await startService(directory, options);
  try {
    await run(service);
  } finally {
    await stopService(service.service);
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test.before(() => {
  assert.notEqual(CURRENT_UID, null, 'Native peer credential tests require Linux getuid().');
  assert.notEqual(CURRENT_GID, null, 'Native socket group tests require Linux getgid().');
  temporaryRoot = fs.mkdtempSync(path.join(os.homedir(), '.aether-admission-native-'));
  serviceBinary = path.join(temporaryRoot, 'admission-service');
  serviceNode = path.join(temporaryRoot, 'node');
  serviceBackend = path.join(temporaryRoot, 'admission-service-backend.cjs');
  serviceContract = path.join(temporaryRoot, 'admission-contract.cjs');
  const serviceLedger = path.join(temporaryRoot, 'admission-ledger.cjs');
  const serviceTestAnchor = path.join(temporaryRoot, 'admission-test-anchor.cjs');
  fs.copyFileSync(process.execPath, serviceNode);
  fs.chmodSync(serviceNode, 0o700);
  fs.copyFileSync(BACKEND_SCRIPT, serviceBackend);
  fs.chmodSync(serviceBackend, 0o600);
  fs.copyFileSync(CONTRACT_SCRIPT, serviceContract);
  fs.chmodSync(serviceContract, 0o600);
  fs.copyFileSync(LEDGER_SCRIPT, serviceLedger);
  fs.chmodSync(serviceLedger, 0o600);
  fs.copyFileSync(TEST_ANCHOR_SCRIPT, serviceTestAnchor);
  fs.chmodSync(serviceTestAnchor, 0o600);
  const compilation = spawnSync('cc', [
    '-std=c11',
    '-DAETHER_TESTING',
    '-Wall',
    '-Wextra',
    '-Werror',
    '-O2',
    SERVICE_SOURCE,
    '-o',
    serviceBinary,
  ], { encoding: 'utf8' });
  assert.equal(compilation.status, 0, compilation.stderr || compilation.stdout);
});

test.after(() => {
  if (temporaryRoot) fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

test('native backend refuses startup without a configured external anchor', () => {
  const directory = fs.mkdtempSync(path.join(temporaryRoot, 'missing-anchor-'));
  fs.chmodSync(directory, 0o700);
  const stateDirectory = path.join(directory, 'state');
  fs.mkdirSync(stateDirectory, { mode: 0o700 });
  const result = spawnSync(serviceNode, [
    serviceBackend,
    '--state-dir',
    stateDirectory,
    '--service-instance-id',
    '0123456789abcdef0123456789abcdef',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /ANTI_ROLLBACK_ANCHOR_UNAVAILABLE/);
  assert.deepEqual(fs.readdirSync(stateDirectory), []);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('native service rejects the actual kernel peer UID when it has no configured role', async () => {
  const directory = fs.mkdtempSync(path.join(temporaryRoot, 'unauthorized-'));
  fs.chmodSync(directory, 0o750);
  const unconfiguredUid = CURRENT_UID === 0 ? 1 : CURRENT_UID + 1;
  const service = await startService(directory, { admissionUid: unconfiguredUid });
  try {
    let response;
    try {
      response = await sendRequest(service.socketPath, {
        version: 1,
        operation: 'serviceInfo',
        requestId: 'unauthorized-info',
      });
    } catch (error) {
      assert.ok(['EPIPE', 'ECONNRESET'].includes(error.code));
    }
    if (response) {
      assert.equal(response.ok, false);
      assert.equal(response.error.code, 'UNAUTHORIZED_PEER');
    }
  } finally {
    await stopService(service.service);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('native socket has restrictive ownership and permission mode', async () => {
  await withService(async ({ socketPath }) => {
    const stat = fs.lstatSync(socketPath);
    assert.equal(stat.isSocket(), true);
    assert.equal(stat.uid, CURRENT_UID);
    assert.equal(stat.gid, CURRENT_GID);
    assert.equal(stat.mode & 0o777, 0o660);
  });
});

test('native service rejects missing and conflicting identity mappings', async () => {
  const directory = fs.mkdtempSync(path.join(temporaryRoot, 'identity-config-'));
  fs.chmodSync(directory, 0o750);
  const valid = serviceArgs(directory);
  const missingObserver = valid.slice();
  const observerIndex = missingObserver.indexOf('--observer-uid');
  missingObserver.splice(observerIndex, 2);
  const missingOperator = valid.slice();
  const operatorIndex = missingOperator.indexOf('--operator-uid');
  missingOperator.splice(operatorIndex, 2);
  const cases = [
    missingObserver,
    missingOperator,
    serviceArgs(directory, { browserUid: uidForRole(4) }),
    serviceArgs(directory, { lifecycleUid: uidForRole(3) }),
    serviceArgs(directory, { operatorUid: uidForRole(3) }),
    serviceArgs(directory, { serviceUid: uidForRole(1) }),
    serviceArgs(directory, { accessGid: CURRENT_GID + 1 }),
    serviceArgs(directory, { serviceUid: uidForRole(4) }),
  ];
  try {
    for (const args of cases) {
      const child = spawn(serviceBinary, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      const exitCode = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', resolve);
      });
      assert.equal(exitCode, 2, stderr);
      assert.match(stderr, /configuration is invalid|identity does not match/);
      assert.equal(fs.existsSync(path.join(directory, 'admission.sock')), false);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('native protocol rejects caller role spoofing, unknown versions and operations', {
  skip: 'Requires a test client running under an authorized UID distinct from the service UID.',
}, async () => {
  await withService(async ({ info, socketPath }) => {
    const spoof = await sendRequest(socketPath, {
      ...request('createGeneration', 'role-spoof', undefined, info.serviceInstanceId),
      role: 'observer',
    });
    assert.equal(spoof.error.code, 'INVALID_MESSAGE');

    const wrongVersion = await sendRequest(socketPath, {
      ...request('createGeneration', 'wrong-version', undefined, info.serviceInstanceId),
      version: 2,
    });
    assert.equal(wrongVersion.error.code, 'UNSUPPORTED_VERSION');

    const unknownOperation = await sendRequest(socketPath, {
      ...request('deleteEverything', 'unknown-operation', GENERATION_ID, info.serviceInstanceId),
    });
    assert.equal(unknownOperation.error.code, 'INVALID_MESSAGE');

    const malformed = await sendRequest(socketPath, '{"version":1,"operation":');
    assert.equal(malformed.error.code, 'INVALID_MESSAGE');
  });
});

test('native protocol rejects oversized and incomplete requests without stopping service', {
  skip: 'Requires a test client running under an authorized UID distinct from the service UID.',
}, async () => {
  await withService(async ({ info, socketPath }) => {
    const oversized = await sendRequest(socketPath, 'x'.repeat(4097));
    assert.equal(oversized.error.code, 'INVALID_MESSAGE');

    const partialSocket = net.createConnection(socketPath);
    await new Promise((resolve, reject) => {
      partialSocket.once('connect', resolve);
      partialSocket.once('error', reject);
    });
    partialSocket.write('{"version":1,"operation":"createGeneration"');
    partialSocket.destroy();
    await new Promise((resolve) => setTimeout(resolve, 30));

    const recovered = await sendRequest(socketPath, request(
      'createGeneration',
      'after-disconnect',
      undefined,
      info.serviceInstanceId,
    ));
    assert.equal(recovered.ok, true);
    assert.equal(recovered.result.state, 'CREATED');
  });
});

test('native service and Phase 3B.0 contract enforce duplicate request and stale generation behavior', {
  skip: 'Requires a test client running under an authorized UID distinct from the service UID.',
}, async () => {
  await withService(async ({ info, socketPath }) => {
    const create = request('createGeneration', 'native-create-once', undefined, info.serviceInstanceId);
    const first = await sendRequest(socketPath, create);
    const duplicate = await sendRequest(socketPath, create);
    assert.deepEqual(duplicate, first);
    assert.equal(first.result.state, 'CREATED');

    const replay = await sendRequest(socketPath, {
      ...request('queryGeneration', 'native-create-once', first.result.generationId, info.serviceInstanceId),
    });
    assert.equal(replay.ok, false);
    assert.equal(replay.error.code, 'REPLAY');

    const stale = await sendRequest(socketPath, request(
      'queryGeneration',
      'native-stale-generation',
      GENERATION_ID,
      info.serviceInstanceId,
    ));
    assert.equal(stale.error.code, 'STALE_GENERATION');
  });
});

test('native service cannot start a browser without native admission and launch components', {
  skip: 'Requires a test client running under an authorized UID distinct from the service UID.',
}, async () => {
  await withService(async ({ info, socketPath }) => {
    const created = await sendRequest(socketPath, request(
      'createGeneration',
      'native-create-fail-closed',
      undefined,
      info.serviceInstanceId,
    ));
    const started = await sendRequest(socketPath, request(
      'startGeneration',
      'native-start-fail-closed',
      created.result.generationId,
      info.serviceInstanceId,
    ));
    assert.equal(started.ok, false);
    assert.equal(started.error.code, 'COMPONENT_UNAVAILABLE');

    const state = await sendRequest(socketPath, request(
      'queryGeneration',
      'native-query-failed-start',
      created.result.generationId,
      info.serviceInstanceId,
    ));
    assert.equal(state.result.state, 'FAILED');
  });
});

test('native service shutdown removes only its owned socket', async () => {
  const directory = fs.mkdtempSync(path.join(temporaryRoot, 'shutdown-'));
  fs.chmodSync(directory, 0o750);
  const service = await startService(directory);
  await stopService(service.service);
  assert.equal(fs.existsSync(service.socketPath), false);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('native service lock rejects a second process in the same runtime directory', async () => {
  const directory = fs.mkdtempSync(path.join(temporaryRoot, 'singleton-'));
  fs.chmodSync(directory, 0o750);
  const first = await startService(directory);
  const secondSocket = path.join(directory, 'second.sock');
  const second = spawn(serviceBinary, serviceArgs(directory, { socketName: 'second.sock' }), {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  second.stderr.setEncoding('utf8');
  second.stderr.on('data', (chunk) => { stderr += chunk; });
  const secondExit = await new Promise((resolve, reject) => {
    second.once('error', reject);
    second.once('exit', resolve);
  });
  assert.equal(secondExit, 1, stderr);
  assert.equal(fs.existsSync(secondSocket), false);
  assert.equal(fs.lstatSync(path.join(directory, '.aether-admission.lock')).mode & 0o777, 0o600);
  await stopService(first.service);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('native service reloads its ledger and rotates service identity on restart', async () => {
  const directory = fs.mkdtempSync(path.join(temporaryRoot, 'restart-'));
  fs.chmodSync(directory, 0o750);
  const first = await startService(directory);
  await stopService(first.service);
  const ledgerPath = path.join(directory, 'state', 'lifecycle-ledger.json');
  const firstLedger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  assert.equal(firstLedger.schemaVersion, 1);
  assert.ok(firstLedger.events.some((event) => event.type === 'service-shutdown'));

  const second = await startService(directory);
  try {
    const secondLedger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
    assert.ok(secondLedger.sequence > firstLedger.sequence);
    assert.notEqual(secondLedger.serviceInstanceId, firstLedger.serviceInstanceId);
    assert.equal(secondLedger.serviceInstanceIds.length, 2);
    assert.equal(fs.existsSync(path.join(directory, 'admission.sock')), true);
  } finally {
    await stopService(second.service);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('native service refuses a missing ledger after prior initialization', async () => {
  const directory = fs.mkdtempSync(path.join(temporaryRoot, 'missing-ledger-'));
  fs.chmodSync(directory, 0o750);
  const first = await startService(directory);
  await stopService(first.service);
  fs.unlinkSync(path.join(directory, 'state', 'lifecycle-ledger.json'));
  const second = spawn(serviceBinary, serviceArgs(directory), {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const exitCode = await new Promise((resolve, reject) => {
    second.once('error', reject);
    second.once('exit', resolve);
  });
  assert.equal(exitCode, 1);
  assert.equal(fs.existsSync(path.join(directory, 'admission.sock')), false);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('native service refuses an unsafe socket parent directory', async () => {
  for (const mode of [0o700, 0o777]) {
    const directory = fs.mkdtempSync(path.join(temporaryRoot, `unsafe-parent-${mode}-`));
    fs.chmodSync(directory, mode);
    const socketPath = path.join(directory, 'admission.sock');
    const child = spawn(serviceBinary, serviceArgs(directory), {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    assert.equal(exitCode, 1, stderr);
    assert.match(stderr, /could not start/);
    assert.equal(fs.existsSync(socketPath), false);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('native service rejects symlinked socket parents and preserves existing socket paths', async () => {
  const targetDirectory = fs.mkdtempSync(path.join(temporaryRoot, 'socket-target-'));
  const linkDirectory = path.join(temporaryRoot, 'socket-link');
  fs.chmodSync(targetDirectory, 0o750);
  fs.symlinkSync(targetDirectory, linkDirectory);
  const linked = spawn(serviceBinary, serviceArgs(linkDirectory), {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const linkedExit = await new Promise((resolve, reject) => {
    linked.once('error', reject);
    linked.once('exit', resolve);
  });
  assert.equal(linkedExit, 1);
  assert.equal(fs.existsSync(path.join(targetDirectory, 'admission.sock')), false);
  fs.unlinkSync(linkDirectory);

  const existingSocket = path.join(targetDirectory, 'admission.sock');
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(existingSocket, resolve);
  });
  fs.chmodSync(existingSocket, 0o600);
  const child = spawn(serviceBinary, serviceArgs(targetDirectory), {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  assert.equal(exitCode, 1);
  assert.equal(fs.lstatSync(existingSocket).isSocket(), true);
  assert.equal(fs.lstatSync(existingSocket).mode & 0o777, 0o600);
  await new Promise((resolve, reject) => server.close((error) => (
    error ? reject(error) : resolve()
  )));
  fs.rmSync(targetDirectory, { recursive: true, force: true });
});
