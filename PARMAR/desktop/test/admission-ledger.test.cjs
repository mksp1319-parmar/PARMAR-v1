'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { AdmissionLedger, validateLedger } = require('../admission-ledger.cjs');
const { AdmissionContract } = require('../admission-contract.cjs');
const { createTestAnchor } = require('./admission-test-anchor.cjs');

const SERVICE_ID = '0123456789abcdef0123456789abcdef';
const NEXT_SERVICE_ID = '1123456789abcdef0123456789abcdef';
const GENERATION_ID = '123e4567-e89b-42d3-a456-426614174000';

function makeDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-ledger-test-'));
  fs.chmodSync(directory, 0o700);
  return directory;
}

function ledger(directory, serviceInstanceId = SERVICE_ID) {
  return new AdmissionLedger({
    directory,
    serviceInstanceId,
    antiRollbackAnchor: createTestAnchor(`${directory}.test-anchor`),
  });
}

function event(type = 'service-shutdown') {
  return { type, generationId: null, requestId: null };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort()
      .map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function refreshIntegrity(document) {
  const unsigned = { ...document };
  delete unsigned.integrity;
  return {
    ...unsigned,
    integrity: crypto.createHash('sha256')
      .update(JSON.stringify(canonicalize(unsigned)))
      .digest('hex'),
  };
}

async function removeDirectory(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
  fs.rmSync(`${directory}.test-anchor`, { force: true });
}

test('initial ledger creation and valid reload retain versioned state and service identity', async () => {
  const directory = makeDirectory();
  try {
    const first = ledger(directory);
    const initial = await first.open();
    assert.equal(initial.schemaVersion, 1);
    assert.equal(initial.sequence, 0);
    assert.deepEqual(initial.generations, []);
    assert.equal(fs.statSync(path.join(directory, 'lifecycle-ledger.json')).mode & 0o777, 0o600);
    assert.equal(fs.readFileSync(path.join(directory, 'ledger-initialized'), 'utf8'),
      'AETHER_LIFECYCLE_LEDGER_INITIALIZED_V1\n');

    await first.commit({
      generations: initial.generations,
      requests: initial.requests,
      event: event(),
    });
    const reloaded = await ledger(directory, NEXT_SERVICE_ID).open();
    assert.equal(reloaded.schemaVersion, 1);
    assert.equal(reloaded.sequence, 1);
    assert.equal(reloaded.serviceInstanceId, SERVICE_ID);
    assert.equal(validateLedger(reloaded), true);
  } finally {
    await removeDirectory(directory);
  }
});

test('atomic replacement uses a new inode and leaves no temporary record', async () => {
  const directory = makeDirectory();
  try {
    const store = ledger(directory);
    const initial = await store.open();
    const before = fs.statSync(path.join(directory, 'lifecycle-ledger.json'));
    await store.commit({
      generations: initial.generations,
      requests: initial.requests,
      event: event(),
    });
    const after = fs.statSync(path.join(directory, 'lifecycle-ledger.json'));
    assert.notEqual(after.ino, before.ino);
    assert.deepEqual(fs.readdirSync(directory).sort(), [
      'ledger-initialized',
      'lifecycle-ledger.json',
    ]);
  } finally {
    await removeDirectory(directory);
  }
});

test('ledger rejects duplicate generation identities and non-monotonic event sequences', async () => {
  const directory = makeDirectory();
  try {
    const store = ledger(directory);
    const contract = new AdmissionContract({
      authorizeCaller: (caller) => caller?.authenticated === true,
      createGenerationId: () => GENERATION_ID,
      durableStore: store,
      serviceInstanceId: SERVICE_ID,
    });
    const created = await contract.dispatch({
      version: 1,
      operation: 'createGeneration',
      requestId: 'ledger-create',
    }, { authenticated: true, role: 'admission' });
    assert.equal(created.state, 'CREATED');

    const document = store.document;
    await assert.rejects(store.commit({
      generations: [document.generations[0], document.generations[0]],
      requests: document.requests,
      event: event(),
    }), { code: 'INVALID_LEDGER_SNAPSHOT' });

    const nonMonotonic = structuredClone(document);
    nonMonotonic.events[1].sequence = nonMonotonic.events[0].sequence;
    assert.equal(validateLedger(refreshIntegrity(nonMonotonic)), false);
  } finally {
    await removeDirectory(directory);
  }
});

test('corrupt and truncated ledgers are rejected without replacement', async () => {
  const directory = makeDirectory();
  try {
    await ledger(directory).open();
    const ledgerPath = path.join(directory, 'lifecycle-ledger.json');
    const original = fs.readFileSync(ledgerPath);
    fs.writeFileSync(ledgerPath, '{"schemaVersion":1,"sequence":', { mode: 0o600 });
    await assert.rejects(ledger(directory, NEXT_SERVICE_ID).open(), { code: 'CORRUPT_LEDGER' });
    assert.equal(fs.readFileSync(ledgerPath, 'utf8'), '{"schemaVersion":1,"sequence":');
    assert.notDeepEqual(fs.readFileSync(ledgerPath), original);
  } finally {
    await removeDirectory(directory);
  }
});

test('unsupported ledger schema versions are rejected explicitly', async () => {
  const directory = makeDirectory();
  try {
    const initial = await ledger(directory).open();
    fs.writeFileSync(path.join(directory, 'lifecycle-ledger.json'),
      JSON.stringify({ ...initial, schemaVersion: 2 }), { mode: 0o600 });
    await assert.rejects(ledger(directory, NEXT_SERVICE_ID).open(), {
      code: 'UNSUPPORTED_LEDGER_VERSION',
    });
  } finally {
    await removeDirectory(directory);
  }
});

test('symlinked state directories, invalid permissions, and invalid ownership are rejected', async () => {
  const target = makeDirectory();
  const link = path.join(os.tmpdir(), `aether-ledger-link-${crypto.randomUUID()}`);
  try {
    fs.symlinkSync(target, link);
    await assert.rejects(ledger(link).open(), { code: 'UNSAFE_STATE_DIRECTORY' });

    fs.chmodSync(target, 0o750);
    await assert.rejects(ledger(target).open(), { code: 'UNSAFE_STATE_DIRECTORY' });
    fs.chmodSync(target, 0o700);

    const originalLstat = fs.lstatSync;
    fs.lstatSync = function spoofOwner(filePath, ...args) {
      const stat = originalLstat.call(fs, filePath, ...args);
      if (filePath === target) {
        return new Proxy(stat, {
          get(object, property) {
            if (property === 'uid') return object.uid + 1;
            const value = Reflect.get(object, property, object);
            return typeof value === 'function' ? value.bind(object) : value;
          },
        });
      }
      return stat;
    };
    try {
      await assert.rejects(ledger(target).open(), { code: 'UNSAFE_STATE_DIRECTORY' });
    } finally {
      fs.lstatSync = originalLstat;
    }
  } finally {
    fs.unlinkSync(link);
    await removeDirectory(target);
  }
});

test('a missing ledger after initialization fails closed', async () => {
  const directory = makeDirectory();
  try {
    await ledger(directory).open();
    fs.unlinkSync(path.join(directory, 'lifecycle-ledger.json'));
    await assert.rejects(ledger(directory, NEXT_SERVICE_ID).open(), { code: 'MISSING_LEDGER' });
  } finally {
    await removeDirectory(directory);
  }
});

test('a previously used service instance identity cannot be reopened', async () => {
  const directory = makeDirectory();
  try {
    await ledger(directory).open();
    await assert.rejects(ledger(directory).open(), { code: 'STALE_SERVICE_INSTANCE' });
  } finally {
    await removeDirectory(directory);
  }
});

test('restoring an older ledger and initialization marker is rejected by the external anchor', async () => {
  const directory = makeDirectory();
  try {
    const store = ledger(directory);
    const initial = await store.open();
    const oldLedger = fs.readFileSync(path.join(directory, 'lifecycle-ledger.json'));
    const oldMarker = fs.readFileSync(path.join(directory, 'ledger-initialized'));
    await store.commit({
      generations: initial.generations,
      requests: initial.requests,
      event: event(),
    });

    fs.writeFileSync(path.join(directory, 'lifecycle-ledger.json'), oldLedger, { mode: 0o600 });
    fs.writeFileSync(path.join(directory, 'ledger-initialized'), oldMarker, { mode: 0o600 });
    await assert.rejects(ledger(directory, NEXT_SERVICE_ID).open(), {
      code: 'ANTI_ROLLBACK_ANCHOR_MISMATCH',
    });
  } finally {
    await removeDirectory(directory);
  }
});

test('ledger construction rejects an unavailable anti-rollback anchor', () => {
  assert.throws(() => new AdmissionLedger({
    directory: '/tmp/aether-unavailable-anchor',
    serviceInstanceId: SERVICE_ID,
  }), { code: 'ANTI_ROLLBACK_ANCHOR_UNAVAILABLE' });
});

test('interrupted write and disk-full faults leave a rejected incomplete temporary file', async () => {
  for (const [failureCode, method] of [['EIO', 'fsyncSync'], ['ENOSPC', 'writeSync']]) {
    const directory = makeDirectory();
    try {
      const store = ledger(directory);
      const initial = await store.open();
      const original = fs[method];
      fs[method] = function injectedFailure(...args) {
        const error = new Error(`simulated ${failureCode}`);
        error.code = failureCode;
        throw error;
      };
      try {
        await assert.rejects(store.commit({
          generations: initial.generations,
          requests: initial.requests,
          event: event(),
        }), { code: 'LEDGER_IO_FAILURE' });
      } finally {
        fs[method] = original;
      }
      assert.ok(fs.readdirSync(directory).some((name) => name.startsWith('.lifecycle-ledger.tmp.')));
      await assert.rejects(ledger(directory, NEXT_SERVICE_ID).open(), {
        code: 'INCOMPLETE_LEDGER_WRITE',
      });
    } finally {
      await removeDirectory(directory);
    }
  }
});

test('directory synchronization failure leaves an anchor mismatch and fails closed', async () => {
  const directory = makeDirectory();
  try {
    const store = ledger(directory);
    const initial = await store.open();
    const original = fs.fsyncSync;
    let syncCount = 0;
    fs.fsyncSync = function failDirectorySync(fd) {
      syncCount += 1;
      if (syncCount === 2) {
        const error = new Error('simulated directory sync failure');
        error.code = 'EIO';
        throw error;
      }
      return original.call(fs, fd);
    };
    try {
      await assert.rejects(store.commit({
        generations: initial.generations,
        requests: initial.requests,
        event: event(),
      }), { code: 'LEDGER_IO_FAILURE' });
    } finally {
      fs.fsyncSync = original;
    }
    await assert.rejects(ledger(directory, NEXT_SERVICE_ID).open(), {
      code: 'ANTI_ROLLBACK_ANCHOR_MISMATCH',
    });
  } finally {
    await removeDirectory(directory);
  }
});
