'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { AdmissionContract } = require('../admission-contract.cjs');
const { AdmissionLedger } = require('../admission-ledger.cjs');
const { createTestAnchor } = require('./admission-test-anchor.cjs');

const INSTANCE_ONE = '0123456789abcdef0123456789abcdef';
const INSTANCE_TWO = '1123456789abcdef0123456789abcdef';
const INSTANCE_THREE = '2123456789abcdef0123456789abcdef';
const GENERATION_ID = '123e4567-e89b-42d3-a456-426614174000';

function request(operation, requestId, generationId) {
  return {
    version: 1,
    operation,
    requestId,
    ...(generationId ? { generationId } : {}),
  };
}

function createContract(directory, serviceInstanceId, { withLifecycleAdapters = false } = {}) {
  return new AdmissionContract({
    authorizeCaller: (caller) => caller?.authenticated === true,
    createGenerationId: () => GENERATION_ID,
    durableStore: new AdmissionLedger({
      directory,
      serviceInstanceId,
      antiRollbackAnchor: createTestAnchor(`${directory}.test-anchor`),
    }),
    serviceInstanceId,
    ...(withLifecycleAdapters ? {
      admissionAuthority: {
        closeAdmission: async ({ generationId }) => ({ generationId, closed: true }),
      },
      browserLauncher: {
        startApprovedBrowser: async ({ generationId }) => ({
          generationId,
          started: true,
          placementBeforeExec: true,
        }),
      },
    } : {}),
  });
}

function removeDirectory(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
  fs.rmSync(`${directory}.test-anchor`, { force: true });
}

test('unresolved generations and quarantine survive clean restart without automatic recovery', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-recovery-test-'));
  fs.chmodSync(directory, 0o700);
  try {
    const first = createContract(directory, INSTANCE_ONE, { withLifecycleAdapters: true });
    const created = await first.dispatch(request('createGeneration', 'recovery-create'), {
      authenticated: true,
      role: 'admission',
    });
    const running = await first.dispatch(
      request('startGeneration', 'recovery-start', created.generationId),
      { authenticated: true, role: 'admission' },
    );
    assert.equal(running.state, 'RUNNING');
    await first.shutdown();

    const restarted = createContract(directory, INSTANCE_TWO);
    await restarted.initialize();
    const persisted = JSON.parse(fs.readFileSync(
      path.join(directory, 'lifecycle-ledger.json'),
      'utf8',
    ));
    assert.equal(persisted.serviceInstanceId, INSTANCE_TWO);
    assert.equal(persisted.generations[0].state, 'QUARANTINED');
    assert.equal(persisted.generations[0].uncertainty, true);
    assert.equal(persisted.generations[0].quarantineReason, 'service-restart-outcome-uncertain');

    const queried = await restarted.dispatch(
      request('queryGeneration', 'recovery-query', created.generationId),
      { authenticated: true, role: 'lifecycle' },
    );
    assert.equal(queried.state, 'QUARANTINED');
    await assert.rejects(restarted.dispatch(request('createGeneration', 'recovery-blocked'), {
      authenticated: true,
      role: 'admission',
    }), { code: 'ADMISSION_BLOCKED' });
  } finally {
    removeDirectory(directory);
  }
});

test('operator recovery requires exact generation and live independent observer evidence', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-recovery-boundary-'));
  fs.chmodSync(directory, 0o700);
  try {
    const first = createContract(directory, INSTANCE_ONE, { withLifecycleAdapters: true });
    const created = await first.dispatch(request('createGeneration', 'recovery-boundary-create'), {
      authenticated: true,
      role: 'admission',
    });
    await first.dispatch(
      request('startGeneration', 'recovery-boundary-start', created.generationId),
      { authenticated: true, role: 'admission' },
    );

    const restarted = createContract(directory, INSTANCE_TWO);
    await restarted.initialize();
    await assert.rejects(restarted.dispatch({
      ...request('recoverGeneration', 'operator-recovery-one', created.generationId),
      cleanupVerified: true,
      processId: 123,
    }, { authenticated: true, role: 'operator' }), { code: 'INVALID_REQUEST' });

    const recovery = request('recoverGeneration', 'operator-recovery-one', created.generationId);
    await assert.rejects(restarted.dispatch(recovery, {
      authenticated: true,
      role: 'admission',
    }), { code: 'UNAUTHORIZED' });
    await assert.rejects(restarted.dispatch(recovery, {
      authenticated: true,
      role: 'operator',
    }), { code: 'COMPONENT_UNAVAILABLE' });
    await assert.rejects(restarted.dispatch(recovery, {
      authenticated: true,
      role: 'operator',
    }), { code: 'COMPONENT_UNAVAILABLE' });

    const ledgerAfterAttempt = JSON.parse(fs.readFileSync(
      path.join(directory, 'lifecycle-ledger.json'),
      'utf8',
    ));
    assert.equal(ledgerAfterAttempt.generations[0].state, 'QUARANTINED');
    assert.ok(ledgerAfterAttempt.requests.some((entry) => (
      entry.requestId === recovery.requestId
      && entry.operation === 'recoverGeneration'
      && entry.status === 'pending'
    )));

    const nextRestart = createContract(directory, INSTANCE_THREE);
    await nextRestart.initialize();
    await assert.rejects(nextRestart.dispatch(recovery, {
      authenticated: true,
      role: 'operator',
    }), { code: 'REPLAY_UNCERTAIN' });
    const afterReplay = JSON.parse(fs.readFileSync(
      path.join(directory, 'lifecycle-ledger.json'),
      'utf8',
    ));
    assert.equal(afterReplay.generations[0].state, 'QUARANTINED');
    assert.equal(afterReplay.generations[0].evidence, null);
  } finally {
    removeDirectory(directory);
  }
});

test('durability failure prevents lifecycle side effects and poisons the contract', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-recovery-io-'));
  fs.chmodSync(directory, 0o700);
  try {
    let closeCalls = 0;
    const contract = new AdmissionContract({
      authorizeCaller: (caller) => caller?.authenticated === true,
      createGenerationId: () => GENERATION_ID,
      durableStore: new AdmissionLedger({
        directory,
        serviceInstanceId: INSTANCE_ONE,
        antiRollbackAnchor: createTestAnchor(`${directory}.test-anchor`),
      }),
      serviceInstanceId: INSTANCE_ONE,
      admissionAuthority: {
        closeAdmission: async ({ generationId }) => {
          closeCalls += 1;
          return { generationId, closed: true };
        },
      },
      browserLauncher: {
        startApprovedBrowser: async ({ generationId }) => ({
          generationId,
          started: true,
          placementBeforeExec: true,
        }),
      },
    });
    const created = await contract.dispatch(request('createGeneration', 'io-create'), {
      authenticated: true,
      role: 'admission',
    });

    const original = fs.fsyncSync;
    fs.fsyncSync = () => {
      const error = new Error('simulated storage synchronization failure');
      error.code = 'EIO';
      throw error;
    };
    try {
      await assert.rejects(contract.dispatch(
        request('startGeneration', 'io-start', created.generationId),
        { authenticated: true, role: 'admission' },
      ), { code: 'DURABILITY_FAILURE' });
    } finally {
      fs.fsyncSync = original;
    }

    assert.equal(closeCalls, 0);
    await assert.rejects(contract.dispatch(request('createGeneration', 'io-after-failure'), {
      authenticated: true,
      role: 'admission',
    }), { code: 'DURABILITY_FAILURE' });
  } finally {
    removeDirectory(directory);
  }
});
