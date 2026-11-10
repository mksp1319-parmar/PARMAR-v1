'use strict';

const { createHash, randomUUID } = require('node:crypto');

const CONTRACT_VERSION = 1;
const GENERATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const OPERATION_NAMES = Object.freeze([
  'createGeneration',
  'startGeneration',
  'queryGeneration',
  'closeAdmission',
  'requestTermination',
  'verifyCleanup',
  'retrieveEvidence',
  'recoverGeneration',
]);
const OPERATIONS = new Set(OPERATION_NAMES);
const FINAL_STATES = new Set(['CLEANUP_VERIFIED', 'FAILED', 'QUARANTINED']);
const TRANSITIONS = {
  CREATED: new Set(['ADMISSION_CLOSED', 'FAILED', 'QUARANTINED']),
  ADMISSION_CLOSED: new Set(['STARTING', 'TERMINATING', 'QUARANTINED']),
  STARTING: new Set(['RUNNING', 'FAILED', 'QUARANTINED']),
  RUNNING: new Set(['ADMISSION_CLOSED', 'QUARANTINED']),
  TERMINATING: new Set(['CLEANUP_VERIFIED', 'QUARANTINED']),
  CLEANUP_VERIFIED: new Set(),
  FAILED: new Set(),
  QUARANTINED: new Set(),
};
const ALLOWED_CALLERS = {
  createGeneration: new Set(['admission']),
  startGeneration: new Set(['admission']),
  queryGeneration: new Set(['admission', 'lifecycle', 'observer']),
  closeAdmission: new Set(['admission']),
  requestTermination: new Set(['lifecycle']),
  verifyCleanup: new Set(['observer']),
  retrieveEvidence: new Set(['lifecycle', 'observer']),
  recoverGeneration: new Set(['operator']),
};

class AdmissionContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AdmissionContractError';
    this.code = code;
  }
}

function isPlainDataObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(Object.getOwnPropertyDescriptors(value))
    .every((descriptor) => Object.hasOwn(descriptor, 'value'));
}

function validateRequest(request) {
  if (!isPlainDataObject(request)) {
    throw new AdmissionContractError('INVALID_REQUEST', 'Admission request must be a plain data object.');
  }

  const baseKeys = ['operation', 'requestId', 'version'];
  const expectedKeys = request.operation === 'createGeneration'
    ? baseKeys
    : [...baseKeys, 'generationId'];
  const keys = Reflect.ownKeys(request);
  const expected = expectedKeys.sort();
  if (
    keys.length !== expected.length
    || keys.some((key) => typeof key !== 'string')
    || keys.sort().some((key, index) => key !== expected[index])
  ) {
    throw new AdmissionContractError('INVALID_REQUEST', 'Admission request fields are not allowed.');
  }
  if (
    request.version !== CONTRACT_VERSION
    || !OPERATIONS.has(request.operation)
    || typeof request.requestId !== 'string'
    || !REQUEST_ID_PATTERN.test(request.requestId)
    || (request.operation !== 'createGeneration'
      && (typeof request.generationId !== 'string'
        || !GENERATION_ID_PATTERN.test(request.generationId)))
  ) {
    throw new AdmissionContractError('INVALID_REQUEST', 'Admission request values are invalid.');
  }

  return Object.freeze({
    version: CONTRACT_VERSION,
    operation: request.operation,
    requestId: request.requestId,
    ...(request.operation === 'createGeneration' ? {} : { generationId: request.generationId }),
  });
}

function validTimestamp(value) {
  return typeof value === 'string'
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function fail(code, message) {
  throw new AdmissionContractError(code, message);
}

class AdmissionContract {
  #authorizeCaller;
  #admissionAuthority;
  #browserLauncher;
  #terminationAuthority;
  #observer;
  #verifyObserverEvidence;
  #evidenceStore;
  #verifyStoredEvidence;
  #now;
  #createGenerationId;
  #durableStore;
  #serviceInstanceId;
  #initializationPromise;
  #storageFailed = false;
  #generations = new Map();
  #requests = new Map();
  #queues = new Map();

  constructor({
    authorizeCaller = () => false,
    admissionAuthority,
    browserLauncher,
    terminationAuthority,
    observer,
    verifyObserverEvidence = () => false,
    evidenceStore,
    verifyStoredEvidence = () => false,
    now = () => new Date().toISOString(),
    createGenerationId = randomUUID,
    durableStore,
    serviceInstanceId,
  } = {}) {
    if (!durableStore || typeof durableStore.open !== 'function'
      || typeof durableStore.commit !== 'function'
      || typeof durableStore.activateServiceInstance !== 'function'
      || !/^[0-9a-f]{32}$/.test(serviceInstanceId || '')) {
      fail(
        'DURABILITY_UNAVAILABLE',
        'A durable lifecycle store and unique service instance identity are required.',
      );
    }
    this.#authorizeCaller = authorizeCaller;
    this.#admissionAuthority = admissionAuthority;
    this.#browserLauncher = browserLauncher;
    this.#terminationAuthority = terminationAuthority;
    this.#observer = observer;
    this.#verifyObserverEvidence = verifyObserverEvidence;
    this.#evidenceStore = evidenceStore;
    this.#verifyStoredEvidence = verifyStoredEvidence;
    this.#now = now;
    this.#createGenerationId = createGenerationId;
    this.#durableStore = durableStore;
    this.#serviceInstanceId = serviceInstanceId;
  }

  async initialize() {
    if (this.#initializationPromise) return this.#initializationPromise;
    this.#initializationPromise = this.#initializeDurableState();
    return this.#initializationPromise;
  }

  async shutdown() {
    await this.initialize();
    await this.#persist('service-shutdown');
  }

  async #initializeDurableState() {
    const document = await this.#durableStore.open();
    if (!isPlainDataObject(document) || document.schemaVersion !== 1
      || !/^[0-9a-f]{32}$/.test(document.serviceInstanceId || '')
      || !Array.isArray(document.serviceInstanceIds)
      || !document.serviceInstanceIds.includes(document.serviceInstanceId)
      || !Number.isSafeInteger(document.sequence) || document.sequence < 0
      || this.#durableStore.sequence !== document.sequence
      || !Array.isArray(document.generations)
      || !Array.isArray(document.requests)) {
      fail('DURABILITY_UNAVAILABLE', 'Durable lifecycle store returned an invalid state document.');
    }
    for (const generation of document.generations) {
      this.#generations.set(generation.generationId, structuredClone(generation));
    }
    for (const request of document.requests) {
      this.#requests.set(request.requestId, structuredClone(request));
    }

    if (document.serviceInstanceId !== this.#serviceInstanceId) {
      for (const generation of this.#generations.values()) {
        if (!FINAL_STATES.has(generation.state)) {
          await this.#quarantine(generation, 'service-restart-outcome-uncertain');
        }
      }
      await this.#durableStore.activateServiceInstance();
    }
  }

  async dispatch(input, caller) {
    await this.initialize();
    if (this.#storageFailed) {
      fail('DURABILITY_FAILURE', 'Durable lifecycle storage failed; admission remains closed.');
    }
    const request = validateRequest(input);
    const authorized = await this.#authorizeCaller(caller, request.operation);
    if (authorized !== true || !ALLOWED_CALLERS[request.operation].has(caller?.role)) {
      fail('UNAUTHORIZED', 'Admission caller is not authorized for this operation.');
    }

    const fingerprint = createHash('sha256').update(JSON.stringify(request)).digest('hex');
    const prior = this.#requests.get(request.requestId);
    if (prior) {
      if (prior.fingerprint !== fingerprint) {
        fail('REPLAY', 'Request ID was reused with different admission data.');
      }
      if (prior.promise) return prior.promise.then((result) => structuredClone(result));
      fail(prior.status === 'pending' ? 'REPLAY_UNCERTAIN' : 'REPLAY',
        'Request was already recorded by an earlier service instance.');
    }

    const queueKey = 'durable-ledger';
    const previous = this.#queues.get(queueKey) || Promise.resolve();
    const requestRecord = {
      requestId: request.requestId,
      fingerprint,
      operation: request.operation,
      generationId: request.generationId || null,
      callerRole: caller.role,
      status: 'pending',
      serviceInstanceId: this.#serviceInstanceId,
      sequence: 0,
    };
    const promise = previous.then(async () => {
      requestRecord.sequence = this.#durableStore.sequence + 1;
      this.#requests.set(request.requestId, { ...requestRecord, promise });
      await this.#persist('request-intent', request);
      const result = await this.#execute(request);
      requestRecord.status = 'completed';
      requestRecord.sequence = this.#durableStore.sequence + 1;
      this.#requests.set(request.requestId, { ...requestRecord, promise });
      await this.#persist('request-completed', request);
      return result;
    });
    this.#queues.set(queueKey, promise.then(() => undefined, () => undefined));
    this.#requests.set(request.requestId, { ...requestRecord, promise });
    return promise.then((result) => structuredClone(result));
  }

  async #persist(type, request = null, generation = null) {
    if (this.#storageFailed) {
      fail('DURABILITY_FAILURE', 'Durable lifecycle storage failed; admission remains closed.');
    }
    const generations = [...this.#generations.values()].map((item) => structuredClone(item));
    const requests = [...this.#requests.values()].map((item) => {
      const { promise, fingerprint, ...record } = item;
      if (fingerprint && !record.fingerprint) record.fingerprint = fingerprint;
      return record;
    });
    try {
      await this.#durableStore.commit({
        generations,
        requests,
        event: {
          type,
          generationId: generation?.generationId || request?.generationId || null,
          requestId: request?.requestId || null,
        },
      });
    } catch {
      this.#storageFailed = true;
      fail('DURABILITY_FAILURE', 'Lifecycle state could not be durably recorded; admission remains closed.');
    }
  }

  async #execute(request) {
    if (request.operation === 'createGeneration') return this.#create();

    const generation = this.#generations.get(request.generationId);
    if (!generation) fail('STALE_GENERATION', 'Generation does not exist in this controller instance.');

    switch (request.operation) {
      case 'startGeneration':
        return this.#start(generation);
      case 'queryGeneration':
        return this.#query(generation);
      case 'closeAdmission':
        return this.#closeAdmission(generation);
      case 'requestTermination':
        return this.#requestTermination(generation);
      case 'verifyCleanup':
        return this.#verifyCleanup(generation);
      case 'recoverGeneration':
        return this.#recover(generation, request);
      case 'retrieveEvidence':
        return this.#retrieveEvidence(generation);
      default:
        fail('INVALID_OPERATION', 'Admission operation is not supported.');
    }
  }

  #timestamp() {
    const value = this.#now();
    if (!validTimestamp(value)) {
      fail('INVALID_CLOCK', 'Admission controller clock returned an invalid timestamp.');
    }
    return value;
  }

  async #transition(generation, state, details = {}) {
    const recoveryTransition = generation.state === 'QUARANTINED'
      && state === 'CLEANUP_VERIFIED'
      && typeof details.recoveryRequestId === 'string';
    if ((!recoveryTransition && FINAL_STATES.has(generation.state))
      || (!recoveryTransition && !TRANSITIONS[generation.state]?.has(state))) {
      fail('INVALID_TRANSITION', `Generation cannot transition from ${generation.state} to ${state}.`);
    }
    const at = this.#timestamp();
    generation.state = state;
    generation.updatedAt = at;
    generation.transitions.push({
      state,
      at,
      sequence: this.#durableStore.sequence + 1,
      ...details,
    });
    await this.#persist('lifecycle-transition', null, generation);
  }

  #snapshot(generation) {
    return {
      generationId: generation.generationId,
      state: generation.state,
      admissionClosed: generation.admissionClosed,
      terminationRequestedAt: generation.terminationRequestedAt,
      evidence: generation.evidence ? structuredClone(generation.evidence) : null,
      transitions: structuredClone(generation.transitions),
    };
  }

  async #create() {
    if ([...this.#generations.values()].some((generation) => (
      !['CLEANUP_VERIFIED', 'FAILED'].includes(generation.state)
    ))) {
      fail('ADMISSION_BLOCKED', 'An active or quarantined generation blocks new admission.');
    }
    const generationId = this.#createGenerationId();
    if (typeof generationId !== 'string' || !GENERATION_ID_PATTERN.test(generationId)
      || this.#generations.has(generationId)) {
      fail('GENERATION_ID_FAILURE', 'Controller could not create a unique generation ID.');
    }
    const createdAt = this.#timestamp();
    const generation = {
      generationId,
      serviceInstanceId: this.#serviceInstanceId,
      state: 'CREATED',
      admissionClosed: false,
      terminationRequestedAt: null,
      evidence: null,
      createdAt,
      updatedAt: createdAt,
      transitions: [{
        state: 'CREATED',
        at: createdAt,
        sequence: this.#durableStore.sequence + 1,
      }],
      quarantineReason: null,
      uncertainty: false,
    };
    this.#generations.set(generationId, generation);
    await this.#persist('generation-created', null, generation);
    return this.#snapshot(generation);
  }

  async #start(generation) {
    if (generation.state !== 'CREATED') {
      fail('INVALID_TRANSITION', `Generation cannot start from ${generation.state}.`);
    }
    if (
      typeof this.#admissionAuthority?.closeAdmission !== 'function'
      || typeof this.#browserLauncher?.startApprovedBrowser !== 'function'
    ) {
      await this.#transition(generation, 'FAILED', { reason: 'native-admission-components-unavailable' });
      fail('COMPONENT_UNAVAILABLE', 'Admission authority and approved browser launcher are required.');
    }

    try {
      // The fixed launcher is the only one-shot initial admission after closure.
      const closure = await this.#admissionAuthority.closeAdmission({
        generationId: generation.generationId,
      });
      if (closure?.generationId !== generation.generationId || closure.closed !== true) {
        fail('ADMISSION_UNCONFIRMED', 'Admission authority did not confirm generation closure.');
      }
      generation.admissionClosed = true;
      await this.#transition(generation, 'ADMISSION_CLOSED');
      // Only this controller-owned launch path may consume the initial start.
      await this.#transition(generation, 'STARTING');

      const started = await this.#browserLauncher.startApprovedBrowser({
        generationId: generation.generationId,
      });
      if (
        started?.generationId !== generation.generationId
        || started.started !== true
        || started.placementBeforeExec !== true
      ) {
        fail('START_UNCONFIRMED', 'Approved browser launch did not confirm generation-bound placement.');
      }
      await this.#transition(generation, 'RUNNING');
      return this.#snapshot(generation);
    } catch (error) {
      if (!FINAL_STATES.has(generation.state)) {
        await this.#quarantine(generation, 'start-outcome-uncertain');
      }
      throw this.#asContractError(error);
    }
  }

  async #closeAdmission(generation) {
    if (generation.state === 'ADMISSION_CLOSED') return this.#snapshot(generation);
    if (generation.state !== 'RUNNING') {
      fail('INVALID_TRANSITION', `Admission cannot be closed from ${generation.state}.`);
    }
    if (typeof this.#admissionAuthority?.closeAdmission !== 'function') {
      await this.#quarantine(generation, 'admission-authority-unavailable');
      fail('COMPONENT_UNAVAILABLE', 'Admission authority is unavailable.');
    }
    try {
      const result = await this.#admissionAuthority.closeAdmission({
        generationId: generation.generationId,
      });
      if (result?.generationId !== generation.generationId || result.closed !== true) {
        fail('ADMISSION_UNCONFIRMED', 'Admission authority did not confirm generation closure.');
      }
      generation.admissionClosed = true;
      await this.#transition(generation, 'ADMISSION_CLOSED');
      return this.#snapshot(generation);
    } catch (error) {
      await this.#quarantine(generation, 'admission-closure-uncertain');
      throw this.#asContractError(error);
    }
  }

  async #requestTermination(generation) {
    if (generation.state === 'TERMINATING' || generation.state === 'CLEANUP_VERIFIED') {
      return this.#snapshot(generation);
    }
    if (generation.state === 'RUNNING') await this.#closeAdmission(generation);
    if (generation.state !== 'ADMISSION_CLOSED') {
      fail('INVALID_TRANSITION', `Generation cannot terminate from ${generation.state}.`);
    }
    if (typeof this.#terminationAuthority?.requestTermination !== 'function') {
      await this.#quarantine(generation, 'termination-authority-unavailable');
      fail('COMPONENT_UNAVAILABLE', 'Termination authority is unavailable.');
    }
    await this.#transition(generation, 'TERMINATING');
    try {
      const result = await this.#terminationAuthority.requestTermination({
        generationId: generation.generationId,
      });
      if (result?.generationId !== generation.generationId || result.requested !== true) {
        fail('TERMINATION_UNCONFIRMED', 'Termination authority did not confirm the request.');
      }
      generation.terminationRequestedAt = this.#timestamp();
      generation.transitions[generation.transitions.length - 1].terminationRequestedAt
        = generation.terminationRequestedAt;
      await this.#persist('lifecycle-transition', null, generation);
      return this.#snapshot(generation);
    } catch (error) {
      await this.#quarantine(generation, 'termination-outcome-uncertain');
      throw this.#asContractError(error);
    }
  }

  async #verifyCleanup(generation, recoveryRequestId = null) {
    if (generation.state === 'CLEANUP_VERIFIED') return this.#snapshot(generation);
    if ((!recoveryRequestId
      && (generation.state !== 'TERMINATING' || !generation.terminationRequestedAt))
      || (recoveryRequestId && generation.state !== 'QUARANTINED')) {
      fail('INVALID_TRANSITION', `Cleanup cannot be verified from ${generation.state}.`);
    }
    if (
      typeof this.#observer?.observeCleanup !== 'function'
      || typeof this.#verifyObserverEvidence !== 'function'
      || typeof this.#evidenceStore?.persistEvidence !== 'function'
      || typeof this.#evidenceStore?.persistAcknowledgement !== 'function'
    ) {
      await this.#quarantine(generation, 'observer-or-evidence-store-unavailable');
      fail('COMPONENT_UNAVAILABLE', 'Independent observer and durable evidence store are required.');
    }

    try {
      const observation = await this.#observer.observeCleanup({
        generationId: generation.generationId,
      });
      this.#validateObservation(generation, observation);
      if (await this.#verifyObserverEvidence(observation) !== true) {
        fail('OBSERVER_UNTRUSTED', 'Observer evidence could not be independently authenticated.');
      }

      const cleanupVerifiedAt = this.#timestamp();
      const evidence = {
        version: CONTRACT_VERSION,
        generationId: generation.generationId,
        terminationRequestedAt: generation.terminationRequestedAt,
        admissionClosedAt: this.#transitionTime(generation, 'ADMISSION_CLOSED'),
        processesObservedAbsentAt: observation.processesObservedAbsentAt,
        managerTerminalAt: observation.managerTerminalAt,
        cleanupIndependentlyVerifiedAt: cleanupVerifiedAt,
        observerId: observation.observerId,
        observerEvidenceId: observation.evidenceId,
        observerEvidenceHash: observation.evidenceHash,
      };
      const durableRecord = await this.#evidenceStore.persistEvidence(evidence);
      this.#validateDurableResult(generation, durableRecord, observation);

      const acknowledgement = await this.#evidenceStore.persistAcknowledgement({
        generationId: generation.generationId,
        evidenceId: durableRecord.evidenceId,
        evidenceHash: durableRecord.evidenceHash,
      });
      if (
        acknowledgement?.generationId !== generation.generationId
        || acknowledgement.persisted !== true
        || typeof acknowledgement.acknowledgementId !== 'string'
        || !REQUEST_ID_PATTERN.test(acknowledgement.acknowledgementId)
        || acknowledgement.evidenceId !== durableRecord.evidenceId
        || acknowledgement.evidenceHash !== durableRecord.evidenceHash
      ) {
        fail('ACK_UNCONFIRMED', 'Durable cleanup acknowledgement was not confirmed.');
      }

      generation.evidence = {
        ...evidence,
        durableEvidence: {
          evidenceId: durableRecord.evidenceId,
          evidenceHash: durableRecord.evidenceHash,
          persisted: true,
        },
        durableAcknowledgement: {
          acknowledgementId: acknowledgement.acknowledgementId,
          persistedAt: this.#timestamp(),
          persisted: true,
        },
      };
      generation.quarantineReason = null;
      generation.uncertainty = false;
      await this.#transition(generation, 'CLEANUP_VERIFIED', recoveryRequestId
        ? { recoveryRequestId }
        : {});
      return this.#snapshot(generation);
    } catch (error) {
      await this.#quarantine(generation, 'cleanup-evidence-incomplete');
      throw this.#asContractError(error);
    }
  }

  async #recover(generation, request) {
    if (generation.state !== 'QUARANTINED') {
      fail('INVALID_TRANSITION', 'Only a quarantined generation can enter operator recovery.');
    }
    if (!generation.transitions.some((transition) => transition.state === 'ADMISSION_CLOSED')) {
      fail('EVIDENCE_INCOMPLETE', 'Recovery requires independently observed admission closure.');
    }
    return this.#verifyCleanup(generation, request.requestId);
  }

  #validateObservation(generation, observation) {
    if (!isPlainDataObject(observation)) {
      fail('INVALID_OBSERVATION', 'Observer evidence must be a plain data object.');
    }
    const keys = [
      'admissionClosed',
      'cleanupIndependentlyVerified',
      'evidenceHash',
      'evidenceId',
      'generationId',
      'managerTerminal',
      'managerTerminalAt',
      'observerId',
      'processesObservedAbsent',
      'processesObservedAbsentAt',
    ].sort();
    const actualKeys = Object.keys(observation).sort();
    if (actualKeys.length !== keys.length || actualKeys.some((key, index) => key !== keys[index])) {
      fail('INVALID_OBSERVATION', 'Observer evidence fields are invalid.');
    }
    if (
      observation.generationId !== generation.generationId
      || observation.admissionClosed !== true
      || observation.processesObservedAbsent !== true
      || observation.managerTerminal !== true
      || observation.cleanupIndependentlyVerified !== true
      || typeof observation.observerId !== 'string'
      || !REQUEST_ID_PATTERN.test(observation.observerId)
      || typeof observation.evidenceId !== 'string'
      || !REQUEST_ID_PATTERN.test(observation.evidenceId)
      || !SHA256_PATTERN.test(observation.evidenceHash)
      || !validTimestamp(observation.processesObservedAbsentAt)
      || !validTimestamp(observation.managerTerminalAt)
    ) {
      fail('INVALID_OBSERVATION', 'Observer evidence is incomplete or generation-mismatched.');
    }
  }

  #validateDurableResult(generation, result, observation) {
    if (
      result?.generationId !== generation.generationId
      || result.persisted !== true
      || typeof result.evidenceId !== 'string'
      || !REQUEST_ID_PATTERN.test(result.evidenceId)
      || !SHA256_PATTERN.test(result.evidenceHash)
      || result.observerEvidenceId !== observation.evidenceId
      || result.observerEvidenceHash !== observation.evidenceHash
    ) {
      fail('EVIDENCE_NOT_DURABLE', 'Evidence store did not confirm matching durable evidence.');
    }
  }

  async #retrieveEvidence(generation) {
    if (generation.state !== 'CLEANUP_VERIFIED') {
      fail('INVALID_TRANSITION', 'Evidence is unavailable before cleanup is durably verified.');
    }
    if (typeof this.#evidenceStore?.retrieveEvidence !== 'function') {
      fail('COMPONENT_UNAVAILABLE', 'Durable evidence retrieval is unavailable.');
    }
    const stored = await this.#evidenceStore.retrieveEvidence({
      generationId: generation.generationId,
    });
    if (
      stored?.generationId !== generation.generationId
      || stored.persisted !== true
      || typeof this.#verifyStoredEvidence !== 'function'
      || await this.#verifyStoredEvidence(stored) !== true
    ) {
      fail('EVIDENCE_INVALID', 'Stored evidence is missing, mismatched, or unauthenticated.');
    }
    return structuredClone(stored);
  }

  #transitionTime(generation, state) {
    const transition = generation.transitions.findLast((entry) => entry.state === state);
    if (!transition) fail('EVIDENCE_INCOMPLETE', `Generation has no ${state} transition.`);
    return transition.at;
  }

  async #quarantine(generation, reason) {
    if (FINAL_STATES.has(generation.state)) return;
    let at = null;
    try {
      at = this.#timestamp();
    } catch (error) {
      if (!(error instanceof AdmissionContractError) || error.code !== 'INVALID_CLOCK') throw error;
      reason = `${reason}:clock-unavailable`;
    }
    generation.state = 'QUARANTINED';
    generation.admissionClosed = true;
    generation.quarantineReason = reason;
    generation.uncertainty = true;
    generation.updatedAt = at || generation.updatedAt;
    generation.transitions.push({
      state: 'QUARANTINED',
      at,
      reason,
      sequence: this.#durableStore.sequence + 1,
    });
    await this.#persist('lifecycle-transition', null, generation);
  }

  #asContractError(error) {
    if (error instanceof AdmissionContractError) return error;
    return new AdmissionContractError('COMPONENT_FAILURE', 'Admission component failed; generation is unresolved.');
  }

  #query(generation) {
    return this.#snapshot(generation);
  }
}

module.exports = {
  AdmissionContract,
  AdmissionContractError,
  CONTRACT_VERSION,
  GENERATION_ID_PATTERN,
  OPERATION_NAMES,
};
