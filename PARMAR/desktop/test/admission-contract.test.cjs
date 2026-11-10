'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AdmissionContract,
  CONTRACT_VERSION,
} = require('../admission-contract.cjs');

const GENERATION_ID = '123e4567-e89b-42d3-a456-426614174000';
const OBSERVER_EVIDENCE_ID = 'observer-evidence-1';
const EVIDENCE_ID = 'durable-evidence-1';
const ACKNOWLEDGEMENT_ID = 'cleanup-ack-1';
const HASH = 'a'.repeat(64);
const OBSERVER = 'aether-observer';
const TEST_SERVICE_INSTANCE_ID = '0123456789abcdef0123456789abcdef';

class TestOnlyMemoryStore {
  #document;

  constructor(serviceInstanceId) {
    this.#document = {
      schemaVersion: 1,
      serviceInstanceId,
      serviceInstanceIds: [serviceInstanceId],
      sequence: 0,
      generations: [],
      requests: [],
    };
    this.sequence = 0;
  }

  async open() {
    return structuredClone(this.#document);
  }

  async activateServiceInstance() {}

  async commit({ generations, requests }) {
    this.#document = {
      ...this.#document,
      sequence: this.sequence + 1,
      generations: structuredClone(generations),
      requests: structuredClone(requests),
    };
    this.sequence += 1;
  }
}

function request(operation, requestId, generationId) {
  return {
    version: CONTRACT_VERSION,
    operation,
    requestId,
    ...(generationId ? { generationId } : {}),
  };
}

function makeContract(overrides = {}) {
  const calls = [];
  const { evidenceStore: evidenceStoreOverrides, ...componentOverrides } = overrides;
  const evidenceStore = {
    persistEvidence: async (evidence) => {
      calls.push(['persistEvidence', evidence.generationId]);
      return {
        evidenceHash: HASH,
        evidenceId: EVIDENCE_ID,
        generationId: evidence.generationId,
        observerEvidenceHash: evidence.observerEvidenceHash,
        observerEvidenceId: evidence.observerEvidenceId,
        persisted: true,
      };
    },
    persistAcknowledgement: async ({ generationId, evidenceId, evidenceHash }) => {
      calls.push(['persistAcknowledgement', generationId]);
      return {
        acknowledgementId: ACKNOWLEDGEMENT_ID,
        evidenceHash,
        evidenceId,
        generationId,
        persisted: true,
      };
    },
    retrieveEvidence: async ({ generationId }) => ({
      generationId,
      persisted: true,
      evidenceId: EVIDENCE_ID,
      evidenceHash: HASH,
    }),
    ...evidenceStoreOverrides,
  };
  const contract = new AdmissionContract({
    authorizeCaller: async (caller, operation) => {
      calls.push(['authorize', caller?.role, operation]);
      return caller?.authenticated === true;
    },
    createGenerationId: () => GENERATION_ID,
    now: () => '2026-11-09T00:00:00.000Z',
    admissionAuthority: {
      closeAdmission: async ({ generationId }) => {
        calls.push(['closeAdmission', generationId]);
        return { generationId, closed: true };
      },
    },
    browserLauncher: {
      startApprovedBrowser: async ({ generationId }) => {
        calls.push(['startApprovedBrowser', generationId]);
        return { generationId, started: true, placementBeforeExec: true };
      },
    },
    terminationAuthority: {
      requestTermination: async ({ generationId }) => {
        calls.push(['requestTermination', generationId]);
        return { generationId, requested: true };
      },
    },
    observer: {
      observeCleanup: async ({ generationId }) => {
        calls.push(['observeCleanup', generationId]);
        return {
          admissionClosed: true,
          cleanupIndependentlyVerified: true,
          evidenceHash: HASH,
          evidenceId: OBSERVER_EVIDENCE_ID,
          generationId,
          managerTerminal: true,
          managerTerminalAt: '2026-11-09T00:00:00.000Z',
          observerId: OBSERVER,
          processesObservedAbsent: true,
          processesObservedAbsentAt: '2026-11-09T00:00:00.000Z',
        };
      },
    },
    verifyObserverEvidence: async (evidence) => evidence.observerId === OBSERVER,
    evidenceStore,
    verifyStoredEvidence: async (evidence) => evidence.evidenceId === EVIDENCE_ID,
    durableStore: new TestOnlyMemoryStore(TEST_SERVICE_INSTANCE_ID),
    serviceInstanceId: TEST_SERVICE_INSTANCE_ID,
    ...componentOverrides,
  });
  const admission = { authenticated: true, role: 'admission' };
  const lifecycle = { authenticated: true, role: 'lifecycle' };
  const observer = { authenticated: true, role: 'observer' };
  return { calls, contract, admission, lifecycle, observer };
}

test('service-facing contracts reject missing or incomplete durable stores', () => {
  const options = {
    authorizeCaller: () => true,
    serviceInstanceId: TEST_SERVICE_INSTANCE_ID,
  };
  assert.throws(() => new AdmissionContract(options), {
    code: 'DURABILITY_UNAVAILABLE',
  });
  assert.throws(() => new AdmissionContract({
    ...options,
    durableStore: { open: async () => ({}) },
  }), { code: 'DURABILITY_UNAVAILABLE' });
});

test('service-facing contracts reject invalid durable state during initialization', async () => {
  const contract = new AdmissionContract({
    authorizeCaller: () => true,
    serviceInstanceId: TEST_SERVICE_INSTANCE_ID,
    durableStore: {
      sequence: 0,
      open: async () => ({}),
      activateServiceInstance: async () => {},
      commit: async () => {},
    },
  });
  await assert.rejects(contract.initialize(), { code: 'DURABILITY_UNAVAILABLE' });
});

async function createRunningGeneration(harness, suffix = 'one') {
  const created = await harness.contract.dispatch(
    request('createGeneration', `create-${suffix}`),
    harness.admission,
  );
  const started = await harness.contract.dispatch(
    request('startGeneration', `start-${suffix}`, created.generationId),
    harness.admission,
  );
  return { created, started };
}

async function terminateGeneration(harness, generationId, suffix = 'one') {
  return harness.contract.dispatch(
    request('requestTermination', `terminate-${suffix}`, generationId),
    harness.lifecycle,
  );
}

test('contract uses a fixed versioned request shape and rejects extra or malformed fields', async () => {
  const harness = makeContract();
  const invalid = [
    { ...request('createGeneration', 'bad-1'), version: 2 },
    { ...request('createGeneration', 'bad-2'), executablePath: '/tmp/browser' },
    { ...request('startGeneration', 'bad-3', GENERATION_ID), uid: 1000 },
    { ...request('startGeneration', 'bad-4', 'stale-id') },
    { ...request('createGeneration', 'bad/space') },
    null,
    [],
  ];
  for (const value of invalid) {
    await assert.rejects(harness.contract.dispatch(value, harness.lifecycle), {
      code: 'INVALID_REQUEST',
    });
  }
});

test('contract denies unauthenticated callers and operation roles', async () => {
  const harness = makeContract();
  await assert.rejects(
    harness.contract.dispatch(request('createGeneration', 'unauth'), { role: 'lifecycle' }),
    { code: 'UNAUTHORIZED' },
  );
  await assert.rejects(
    harness.contract.dispatch(request('createGeneration', 'lifecycle-cannot-admit'), harness.lifecycle),
    { code: 'UNAUTHORIZED' },
  );
  await assert.rejects(
    harness.contract.dispatch(
      request('startGeneration', 'lifecycle-cannot-start', GENERATION_ID),
      harness.lifecycle,
    ),
    { code: 'UNAUTHORIZED' },
  );
  await assert.rejects(
    harness.contract.dispatch(request('createGeneration', 'wrong-role'), {
      authenticated: true,
      role: 'observer',
    }),
    { code: 'UNAUTHORIZED' },
  );
});

test('generation creation is idempotent and request ID reuse with different data is rejected', async () => {
  const harness = makeContract();
  const createRequest = request('createGeneration', 'create-idempotent');
  const first = await harness.contract.dispatch(createRequest, harness.admission);
  const retry = await harness.contract.dispatch(createRequest, harness.admission);
  assert.deepEqual(retry, first);
  assert.equal(first.state, 'CREATED');
  assert.equal(harness.calls.filter(([name]) => name === 'authorize').length, 2);

  await assert.rejects(
    harness.contract.dispatch(
      request('queryGeneration', 'create-idempotent', first.generationId),
      harness.admission,
    ),
    { code: 'REPLAY' },
  );
});

test('concurrent creates have a single unresolved generation and concurrent duplicates share one result', async () => {
  let nextId = 0;
  const harness = makeContract({
    createGenerationId: () => `123e4567-e89b-42d3-a456-42661417400${nextId++}`,
  });
  const duplicateRequest = request('createGeneration', 'concurrent-same-create');
  const [first, duplicate] = await Promise.all([
    harness.contract.dispatch(duplicateRequest, harness.admission),
    harness.contract.dispatch(duplicateRequest, harness.admission),
  ]);
  assert.deepEqual(duplicate, first);

  const outcomes = await Promise.allSettled([
    harness.contract.dispatch(request('createGeneration', 'concurrent-create-a'), harness.admission),
    harness.contract.dispatch(request('createGeneration', 'concurrent-create-b'), harness.admission),
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 0);
  assert.deepEqual(
    outcomes.map((outcome) => outcome.reason?.code).sort(),
    ['ADMISSION_BLOCKED', 'ADMISSION_BLOCKED'],
  );
});

test('generation-scoped start closes admission before the fixed approved launch', async () => {
  const harness = makeContract();
  const created = await harness.contract.dispatch(
    request('createGeneration', 'create-start-once'),
    harness.admission,
  );
  const startRequest = request('startGeneration', 'start-once', created.generationId);
  const started = await harness.contract.dispatch(startRequest, harness.admission);
  const duplicate = await harness.contract.dispatch(startRequest, harness.admission);
  assert.equal(started.state, 'RUNNING');
  assert.deepEqual(duplicate, started);
  assert.deepEqual(
    harness.calls.filter(([name]) => ['closeAdmission', 'startApprovedBrowser'].includes(name))
      .map(([name]) => name),
    ['closeAdmission', 'startApprovedBrowser'],
  );
  assert.equal(harness.calls.some(([, generationId, ...args]) => (
    generationId === '/tmp/browser' || args.includes('/tmp/browser')
  )), false);
  assert.equal(created.generationId, GENERATION_ID);
});

test('concurrent start and termination are serialized by the generation queue', async () => {
  const harness = makeContract();
  const created = await harness.contract.dispatch(
    request('createGeneration', 'create-concurrent-lifecycle'),
    harness.admission,
  );
  const start = request('startGeneration', 'start-concurrent-lifecycle', created.generationId);
  const terminate = request('requestTermination', 'terminate-concurrent-lifecycle', created.generationId);
  const [started, terminated] = await Promise.all([
    harness.contract.dispatch(start, harness.admission),
    harness.contract.dispatch(terminate, harness.lifecycle),
  ]);
  assert.equal(started.state, 'RUNNING');
  assert.equal(terminated.state, 'TERMINATING');
  assert.deepEqual(
    terminated.transitions.map(({ state }) => state),
    ['CREATED', 'ADMISSION_CLOSED', 'STARTING', 'RUNNING', 'ADMISSION_CLOSED', 'TERMINATING'],
  );
  assert.equal(harness.calls.filter(([name]) => name === 'requestTermination').length, 1);
});

test('invalid lifecycle transitions and stale generation IDs fail closed', async () => {
  const harness = makeContract();
  const created = await harness.contract.dispatch(
    request('createGeneration', 'create-invalid-transition'),
    harness.admission,
  );

  await assert.rejects(
    terminateGeneration(harness, created.generationId, 'before-start'),
    { code: 'INVALID_TRANSITION' },
  );
  await assert.rejects(
    harness.contract.dispatch(
      request('queryGeneration', 'query-stale', '123e4567-e89b-42d3-a456-426614174001'),
      harness.lifecycle,
    ),
    { code: 'STALE_GENERATION' },
  );
  assert.equal(
    (await harness.contract.dispatch(
      request('queryGeneration', 'query-created', created.generationId),
      harness.lifecycle,
    )).state,
    'CREATED',
  );
});

test('repeated termination does not issue another termination request', async () => {
  const harness = makeContract();
  const { created, started } = await createRunningGeneration(harness, 'duplicate-stop');
  assert.equal(started.state, 'RUNNING');

  const first = await terminateGeneration(harness, created.generationId, 'stop-a');
  const second = await terminateGeneration(harness, created.generationId, 'stop-b');
  assert.equal(first.state, 'TERMINATING');
  assert.deepEqual(second, first);
  assert.equal(harness.calls.filter(([name]) => name === 'requestTermination').length, 1);
});

test('cleanup reaches CLEANUP_VERIFIED only after observer verification and durable evidence plus ACK', async () => {
  const harness = makeContract();
  const { created } = await createRunningGeneration(harness, 'verified');
  await terminateGeneration(harness, created.generationId, 'verified');

  const verified = await harness.contract.dispatch(
    request('verifyCleanup', 'verify-cleanup', created.generationId),
    harness.observer,
  );
  assert.equal(verified.state, 'CLEANUP_VERIFIED');
  assert.equal(verified.evidence.processesObservedAbsentAt, '2026-11-09T00:00:00.000Z');
  assert.equal(verified.evidence.durableEvidence.persisted, true);
  assert.equal(verified.evidence.durableAcknowledgement.persisted, true);

  const retrieved = await harness.contract.dispatch(
    request('retrieveEvidence', 'retrieve-cleanup-evidence', created.generationId),
    harness.lifecycle,
  );
  assert.equal(retrieved.evidenceId, EVIDENCE_ID);
});

test('observer identity or generation mismatch quarantines cleanup without acknowledgement', async () => {
  for (const observation of [
    { generationId: '123e4567-e89b-42d3-a456-426614174001' },
    { generationId: GENERATION_ID },
  ]) {
    const harness = makeContract({
      observer: { observeCleanup: async () => observation },
    });
    const { created } = await createRunningGeneration(harness, `bad-observer-${Math.random()}`);
    await terminateGeneration(harness, created.generationId, `bad-observer-${Math.random()}`);
    await assert.rejects(
      harness.contract.dispatch(
        request('verifyCleanup', `verify-bad-${Math.random()}`, created.generationId),
        harness.observer,
      ),
    );
    const state = await harness.contract.dispatch(
      request('queryGeneration', `query-bad-${Math.random()}`, created.generationId),
      harness.lifecycle,
    );
    assert.equal(state.state, 'QUARANTINED');
    assert.equal(state.evidence, null);
    assert.equal(harness.calls.some(([name]) => name === 'persistAcknowledgement'), false);
  }
});

test('missing native adapters and failed durable acknowledgement never report verified cleanup', async () => {
  const noAdapters = makeContract({
    admissionAuthority: undefined,
    browserLauncher: undefined,
  });
  const created = await noAdapters.contract.dispatch(
    request('createGeneration', 'create-no-adapters'),
    noAdapters.admission,
  );
  await assert.rejects(
    noAdapters.contract.dispatch(
      request('startGeneration', 'start-no-adapters', created.generationId),
      noAdapters.admission,
    ),
    { code: 'COMPONENT_UNAVAILABLE' },
  );
  assert.equal(
    (await noAdapters.contract.dispatch(
      request('queryGeneration', 'query-no-adapters', created.generationId),
      noAdapters.lifecycle,
    )).state,
    'FAILED',
  );

  const noAck = makeContract({
    evidenceStore: {
      persistEvidence: async (evidence) => ({
        generationId: evidence.generationId,
        persisted: true,
        evidenceId: EVIDENCE_ID,
        evidenceHash: HASH,
        observerEvidenceId: evidence.observerEvidenceId,
        observerEvidenceHash: evidence.observerEvidenceHash,
      }),
      persistAcknowledgement: async () => ({ persisted: false }),
    },
  });
  const { created: noAckGeneration } = await createRunningGeneration(noAck, 'no-ack');
  await terminateGeneration(noAck, noAckGeneration.generationId, 'no-ack');
  await assert.rejects(noAck.contract.dispatch(
    request('verifyCleanup', 'verify-no-ack', noAckGeneration.generationId),
    noAck.observer,
  ), { code: 'ACK_UNCONFIRMED' });
  assert.equal(
    (await noAck.contract.dispatch(
      request('queryGeneration', 'query-no-ack', noAckGeneration.generationId),
      noAck.lifecycle,
    )).state,
    'QUARANTINED',
  );
});

test('ambiguous browser launch result quarantines instead of claiming RUNNING', async () => {
  const harness = makeContract({
    browserLauncher: {
      startApprovedBrowser: async () => {
        throw new Error('unknown launch result');
      },
    },
  });

  test('unavailable cleanup confirmation quarantines and blocks later admission', async () => {
    const harness = makeContract({
      terminationAuthority: {
        requestTermination: async () => {
          throw new Error('termination result lost');
        },
      },
    });
    const { created } = await createRunningGeneration(harness, 'terminate-ambiguous');
    await assert.rejects(terminateGeneration(harness, created.generationId, 'terminate-ambiguous'), {
      code: 'COMPONENT_FAILURE',
    });
    const state = await harness.contract.dispatch(
      request('queryGeneration', 'query-terminate-ambiguous', created.generationId),
      harness.admission,
    );
    assert.equal(state.state, 'QUARANTINED');
    await assert.rejects(
      harness.contract.dispatch(
        request('createGeneration', 'create-after-ambiguous-termination'),
        harness.admission,
      ),
      { code: 'ADMISSION_BLOCKED' },
    );
  });
  const created = await harness.contract.dispatch(
    request('createGeneration', 'create-ambiguous'),
    harness.admission,
  );
  await assert.rejects(
    harness.contract.dispatch(
      request('startGeneration', 'start-ambiguous', created.generationId),
      harness.admission,
    ),
    { code: 'COMPONENT_FAILURE' },
  );
  const state = await harness.contract.dispatch(
    request('queryGeneration', 'query-ambiguous', created.generationId),
    harness.lifecycle,
  );
  assert.equal(state.state, 'QUARANTINED');
  assert.equal(state.admissionClosed, true);
  await assert.rejects(
    harness.contract.dispatch(
      request('createGeneration', 'create-after-quarantine'),
      harness.admission,
    ),
    { code: 'ADMISSION_BLOCKED' },
  );
});

test('observer evidence that fails authentication is quarantined before persistence', async () => {
  const harness = makeContract({ verifyObserverEvidence: async () => false });
  const { created } = await createRunningGeneration(harness, 'observer-auth-fails');
  await terminateGeneration(harness, created.generationId, 'observer-auth-fails');

  await assert.rejects(
    harness.contract.dispatch(
      request('verifyCleanup', 'verify-observer-auth-fails', created.generationId),
      harness.observer,
    ),
    { code: 'OBSERVER_UNTRUSTED' },
  );
  const state = await harness.contract.dispatch(
    request('queryGeneration', 'query-observer-auth-fails', created.generationId),
    harness.lifecycle,
  );
  assert.equal(state.state, 'QUARANTINED');
  assert.equal(harness.calls.some(([name]) => name === 'persistEvidence'), false);
});

test('retrieved evidence must be generation-bound and authenticated', async () => {
  const harness = makeContract({
    evidenceStore: {
      retrieveEvidence: async () => ({
        generationId: '123e4567-e89b-42d3-a456-426614174001',
        persisted: true,
        evidenceId: EVIDENCE_ID,
        evidenceHash: HASH,
      }),
    },
  });
  const created = await harness.contract.dispatch(
    request('createGeneration', 'create-bad-retrieval'),
    harness.admission,
  );
  await harness.contract.dispatch(
    request('startGeneration', 'start-bad-retrieval', created.generationId),
    harness.admission,
  );
  await terminateGeneration(harness, created.generationId, 'bad-retrieval');
  await harness.contract.dispatch(
    request('verifyCleanup', 'verify-bad-retrieval', created.generationId),
    harness.observer,
  );
  await assert.rejects(
    harness.contract.dispatch(
      request('retrieveEvidence', 'retrieve-before-cleanup', created.generationId),
      harness.lifecycle,
    ),
    { code: 'EVIDENCE_INVALID' },
  );
});
