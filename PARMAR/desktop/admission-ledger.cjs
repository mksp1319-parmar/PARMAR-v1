'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_VERSION = 1;
const MAX_LEDGER_BYTES = 1024 * 1024;
const MAX_GENERATIONS = 256;
const MAX_REQUESTS = 2048;
const MAX_EVENTS = 8192;
const MAX_TRANSITIONS = 64;
const LEDGER_NAME = 'lifecycle-ledger.json';
const INITIALIZED_NAME = 'ledger-initialized';
const LEGACY_MARKER_NAME = 'service-started';
const TEMP_PREFIX = '.lifecycle-ledger.tmp.';
const INSTANCE_ID_PATTERN = /^[0-9a-f]{32}$/;
const GENERATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/i;
const STATES = new Set([
  'CREATED',
  'ADMISSION_CLOSED',
  'STARTING',
  'RUNNING',
  'TERMINATING',
  'CLEANUP_VERIFIED',
  'FAILED',
  'QUARANTINED',
]);
const TRANSITIONS = {
  CREATED: new Set(['ADMISSION_CLOSED', 'FAILED', 'QUARANTINED']),
  ADMISSION_CLOSED: new Set(['STARTING', 'TERMINATING', 'QUARANTINED']),
  STARTING: new Set(['RUNNING', 'FAILED', 'QUARANTINED']),
  RUNNING: new Set(['ADMISSION_CLOSED', 'QUARANTINED']),
  TERMINATING: new Set(['CLEANUP_VERIFIED', 'QUARANTINED']),
  CLEANUP_VERIFIED: new Set(),
  FAILED: new Set(),
  QUARANTINED: new Set(['CLEANUP_VERIFIED']),
};
const EVENT_TYPES = new Set([
  'request-intent',
  'request-completed',
  'generation-created',
  'lifecycle-transition',
  'restart-quarantine',
  'service-instance-started',
  'service-shutdown',
]);

class AdmissionLedgerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AdmissionLedgerError';
    this.code = code;
  }
}

function ledgerFail(code, message) {
  throw new AdmissionLedgerError(code, message);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, required, optional = []) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => required.includes(key) || optional.includes(key));
}

function validTimestamp(value) {
  return typeof value === 'string'
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.keys(value).sort()
      .map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function digest(value) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function checkDirectory(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)
    || path.normalize(directory) !== directory || directory.includes('\0')) {
    ledgerFail('UNSAFE_STATE_DIRECTORY', 'Lifecycle state directory path is unsafe.');
  }
  const components = directory.split(path.sep).filter(Boolean);
  let current = path.parse(directory).root;
  for (const component of components) {
    if (component === '.' || component === '..') {
      ledgerFail('UNSAFE_STATE_DIRECTORY', 'Lifecycle state directory path is unsafe.');
    }
    current = path.join(current, component);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      ledgerFail('STATE_DIRECTORY_UNAVAILABLE', `Lifecycle state path cannot be inspected (${error.code}).`);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      ledgerFail('UNSAFE_STATE_DIRECTORY', 'Lifecycle state path contains a symlink or non-directory.');
    }
    const isFinal = current === directory;
    if (!isFinal && (stat.mode & 0o022) !== 0
      && !(stat.uid === 0 && (stat.mode & 0o1000) !== 0)) {
      ledgerFail('UNSAFE_STATE_DIRECTORY', 'Lifecycle state path has a writable unsafe ancestor.');
    }
  }

  const stat = fs.lstatSync(directory);
  const owner = typeof process.getuid === 'function' ? process.getuid() : null;
  const group = typeof process.getgid === 'function' ? process.getgid() : null;
  if (owner === null || group === null || stat.uid !== owner || stat.gid !== group
    || (stat.mode & 0o7777) !== 0o700) {
    ledgerFail('UNSAFE_STATE_DIRECTORY', 'Lifecycle state directory ownership or permissions are invalid.');
  }
  let resolved;
  try {
    resolved = fs.realpathSync(directory);
  } catch (error) {
    ledgerFail('STATE_DIRECTORY_UNAVAILABLE', `Lifecycle state directory cannot be resolved (${error.code}).`);
  }
  if (resolved !== directory) {
    ledgerFail('UNSAFE_STATE_DIRECTORY', 'Lifecycle state directory resolves through an unsafe path.');
  }
  return { dev: stat.dev, ino: stat.ino, uid: stat.uid, gid: stat.gid };
}

function checkDirectoryIdentity(directory, identity) {
  const current = checkDirectory(directory);
  if (current.dev !== identity.dev || current.ino !== identity.ino) {
    ledgerFail('UNSAFE_STATE_DIRECTORY', 'Lifecycle state directory identity changed during use.');
  }
}

function checkFileStat(stat, name) {
  const owner = typeof process.getuid === 'function' ? process.getuid() : null;
  const group = typeof process.getgid === 'function' ? process.getgid() : null;
  if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== owner || stat.gid !== group
    || (stat.mode & 0o7777) !== 0o600 || stat.size > MAX_LEDGER_BYTES) {
    ledgerFail('INVALID_LEDGER_FILE', `Lifecycle ${name} file ownership, permissions, type, or size is invalid.`);
  }
}

function validateEvidence(evidence, generationId) {
  if (!hasExactKeys(evidence, [
    'version',
    'generationId',
    'terminationRequestedAt',
    'admissionClosedAt',
    'processesObservedAbsentAt',
    'managerTerminalAt',
    'cleanupIndependentlyVerifiedAt',
    'observerId',
    'observerEvidenceId',
    'observerEvidenceHash',
    'durableEvidence',
    'durableAcknowledgement',
  ]) || evidence.version !== 1 || evidence.generationId !== generationId
    || (evidence.terminationRequestedAt !== null && !validTimestamp(evidence.terminationRequestedAt))
    || !validTimestamp(evidence.admissionClosedAt)
    || !validTimestamp(evidence.processesObservedAbsentAt)
    || !validTimestamp(evidence.managerTerminalAt)
    || !validTimestamp(evidence.cleanupIndependentlyVerifiedAt)
    || !REQUEST_ID_PATTERN.test(evidence.observerId)
    || !REQUEST_ID_PATTERN.test(evidence.observerEvidenceId)
    || !HASH_PATTERN.test(evidence.observerEvidenceHash)
    || !hasExactKeys(evidence.durableEvidence, ['evidenceId', 'evidenceHash', 'persisted'])
    || !REQUEST_ID_PATTERN.test(evidence.durableEvidence.evidenceId)
    || !HASH_PATTERN.test(evidence.durableEvidence.evidenceHash)
    || evidence.durableEvidence.persisted !== true
    || !hasExactKeys(evidence.durableAcknowledgement, [
      'acknowledgementId',
      'persistedAt',
      'persisted',
    ])
    || !REQUEST_ID_PATTERN.test(evidence.durableAcknowledgement.acknowledgementId)
    || !validTimestamp(evidence.durableAcknowledgement.persistedAt)
    || evidence.durableAcknowledgement.persisted !== true) {
    return false;
  }
  return true;
}

function validateTransition(transition, generationId, previousState, previousSequence) {
  if (!hasExactKeys(transition, ['state', 'at', 'sequence'], [
    'reason',
    'terminationRequestedAt',
    'recoveryRequestId',
  ]) || !STATES.has(transition.state) || !validTimestamp(transition.at)
    || !Number.isSafeInteger(transition.sequence) || transition.sequence <= previousSequence) {
    return false;
  }
  if (previousState === null) {
    return transition.state === 'CREATED';
  }
  if (!TRANSITIONS[previousState]?.has(transition.state)) return false;
  if (previousState === 'QUARANTINED' && transition.state === 'CLEANUP_VERIFIED'
    && !REQUEST_ID_PATTERN.test(transition.recoveryRequestId)) return false;
  if (Object.hasOwn(transition, 'reason')
    && (typeof transition.reason !== 'string' || transition.reason.length > 256)) return false;
  if (Object.hasOwn(transition, 'terminationRequestedAt')
    && !validTimestamp(transition.terminationRequestedAt)) return false;
  return true;
}

function validateGeneration(generation, serviceInstanceIds, ledgerSequence) {
  if (!hasExactKeys(generation, [
    'generationId',
    'serviceInstanceId',
    'state',
    'admissionClosed',
    'terminationRequestedAt',
    'createdAt',
    'updatedAt',
    'transitions',
    'evidence',
    'quarantineReason',
    'uncertainty',
  ]) || !GENERATION_ID_PATTERN.test(generation.generationId)
    || !INSTANCE_ID_PATTERN.test(generation.serviceInstanceId)
    || !serviceInstanceIds.includes(generation.serviceInstanceId)
    || !STATES.has(generation.state)
    || typeof generation.admissionClosed !== 'boolean'
    || (generation.terminationRequestedAt !== null && !validTimestamp(generation.terminationRequestedAt))
    || !validTimestamp(generation.createdAt)
    || !validTimestamp(generation.updatedAt)
    || !Array.isArray(generation.transitions)
    || generation.transitions.length === 0
    || generation.transitions.length > MAX_TRANSITIONS
    || (generation.evidence !== null && !validateEvidence(generation.evidence, generation.generationId))
    || (generation.quarantineReason !== null
      && (typeof generation.quarantineReason !== 'string' || generation.quarantineReason.length > 256))
    || typeof generation.uncertainty !== 'boolean') {
    return false;
  }
  let previousState = null;
  let previousSequence = 0;
  for (const transition of generation.transitions) {
    if (!validateTransition(transition, generation.generationId, previousState, previousSequence)
      || transition.sequence > ledgerSequence) return false;
    previousState = transition.state;
    previousSequence = transition.sequence;
  }
  return generation.transitions[0].state === 'CREATED'
    && generation.state === previousState
    && ((generation.state === 'QUARANTINED')
      === (generation.quarantineReason !== null && generation.uncertainty))
    && (generation.state !== 'CLEANUP_VERIFIED' || generation.evidence !== null)
    && (generation.state !== 'CLEANUP_VERIFIED' || generation.uncertainty === false);
}

function validateRequest(record, serviceInstanceIds, ledgerSequence) {
  return hasExactKeys(record, [
    'requestId',
    'fingerprint',
    'operation',
    'generationId',
    'callerRole',
    'status',
    'serviceInstanceId',
    'sequence',
  ]) && REQUEST_ID_PATTERN.test(record.requestId)
    && HASH_PATTERN.test(record.fingerprint)
    && typeof record.operation === 'string'
    && /^[A-Za-z][A-Za-z0-9]{0,31}$/.test(record.operation)
    && (record.generationId === null || GENERATION_ID_PATTERN.test(record.generationId))
    && ['admission', 'lifecycle', 'observer', 'operator'].includes(record.callerRole)
    && ['pending', 'completed'].includes(record.status)
    && INSTANCE_ID_PATTERN.test(record.serviceInstanceId)
    && serviceInstanceIds.includes(record.serviceInstanceId)
    && Number.isSafeInteger(record.sequence)
    && record.sequence > 0
    && record.sequence <= ledgerSequence;
}

function validateLedger(document) {
  if (!hasExactKeys(document, [
    'schemaVersion',
    'serviceInstanceId',
    'serviceInstanceIds',
    'sequence',
    'updatedAt',
    'generations',
    'requests',
    'events',
    'integrity',
  ]) || document.schemaVersion !== SCHEMA_VERSION
    || !INSTANCE_ID_PATTERN.test(document.serviceInstanceId)
    || !Array.isArray(document.serviceInstanceIds)
    || document.serviceInstanceIds.length === 0
    || document.serviceInstanceIds.length > 256
    || document.serviceInstanceIds.some((id) => !INSTANCE_ID_PATTERN.test(id))
    || new Set(document.serviceInstanceIds).size !== document.serviceInstanceIds.length
    || !document.serviceInstanceIds.includes(document.serviceInstanceId)
    || !Number.isSafeInteger(document.sequence)
    || document.sequence < 0
    || !validTimestamp(document.updatedAt)
    || !Array.isArray(document.generations)
    || document.generations.length > MAX_GENERATIONS
    || !Array.isArray(document.requests)
    || document.requests.length > MAX_REQUESTS
    || !Array.isArray(document.events)
    || document.events.length > MAX_EVENTS
    || document.sequence !== document.events.length
    || !HASH_PATTERN.test(document.integrity)) {
    return false;
  }
  if (new Set(document.generations.map((generation) => generation?.generationId)).size
    !== document.generations.length
    || !document.generations.every((generation) => (
      validateGeneration(generation, document.serviceInstanceIds, document.sequence)
    ))) return false;
  if (new Set(document.requests.map((record) => record?.requestId)).size
    !== document.requests.length
    || !document.requests.every((record) => (
      validateRequest(record, document.serviceInstanceIds, document.sequence)
    ))) return false;
  if (!document.events.every((event, index) => (
    hasExactKeys(event, ['sequence', 'type', 'at', 'generationId', 'requestId'])
      && event.sequence === index + 1
      && EVENT_TYPES.has(event.type)
      && validTimestamp(event.at)
      && (event.generationId === null || GENERATION_ID_PATTERN.test(event.generationId))
      && (event.requestId === null || REQUEST_ID_PATTERN.test(event.requestId))
  ))) return false;
  const unsigned = { ...document };
  delete unsigned.integrity;
  return digest(unsigned) === document.integrity;
}

function validateEvent(event) {
  if (!isPlainObject(event) || !EVENT_TYPES.has(event.type)
    || (event.generationId !== null && !GENERATION_ID_PATTERN.test(event.generationId))
    || (event.requestId !== null && !REQUEST_ID_PATTERN.test(event.requestId))) {
    ledgerFail('INVALID_LEDGER_EVENT', 'Lifecycle ledger event is invalid.');
  }
}

function withIntegrity(document) {
  const unsigned = { ...document };
  delete unsigned.integrity;
  return { ...unsigned, integrity: digest(unsigned) };
}

class AdmissionLedger {
  #directory;
  #identity;
  #serviceInstanceId;
  #antiRollbackAnchor;
  #document;
  #ledgerFileIdentity;
  #now;

  constructor({
    directory,
    serviceInstanceId,
    antiRollbackAnchor,
    now = () => new Date().toISOString(),
  }) {
    if (!INSTANCE_ID_PATTERN.test(serviceInstanceId)) {
      ledgerFail('INVALID_SERVICE_INSTANCE', 'Service instance identity is invalid.');
    }
    if (!antiRollbackAnchor
      || typeof antiRollbackAnchor.read !== 'function'
      || typeof antiRollbackAnchor.initialize !== 'function'
      || typeof antiRollbackAnchor.compareAndSwap !== 'function') {
      ledgerFail(
        'ANTI_ROLLBACK_ANCHOR_UNAVAILABLE',
        'An independently managed monotonic anti-rollback anchor is required.',
      );
    }
    this.#directory = directory;
    this.#serviceInstanceId = serviceInstanceId;
    this.#antiRollbackAnchor = antiRollbackAnchor;
    this.#now = now;
  }

  get sequence() {
    return this.#document.sequence;
  }

  get serviceInstanceId() {
    return this.#document.serviceInstanceId;
  }

  get document() {
    return structuredClone(this.#document);
  }

  async open() {
    this.#identity = checkDirectory(this.#directory);
    const anchor = await this.#readAnchor();
    const entries = fs.readdirSync(this.#directory);
    const incomplete = entries.some((name) => name.startsWith(TEMP_PREFIX));
    const unexpected = entries.some((name) => ![
      LEDGER_NAME,
      INITIALIZED_NAME,
      LEGACY_MARKER_NAME,
    ].includes(name) && !name.startsWith(TEMP_PREFIX));
    const ledgerPath = path.join(this.#directory, LEDGER_NAME);
    const initializedPath = path.join(this.#directory, INITIALIZED_NAME);
    const legacyPath = path.join(this.#directory, LEGACY_MARKER_NAME);
    if (unexpected) {
      ledgerFail('UNSAFE_STATE_DIRECTORY', 'Lifecycle state directory contains an unexpected entry.');
    }
    if (incomplete) {
      ledgerFail('INCOMPLETE_LEDGER_WRITE', 'An incomplete lifecycle ledger write was found.');
    }

    let ledgerStat;
    try {
      ledgerStat = fs.lstatSync(ledgerPath);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        ledgerFail('LEDGER_IO_FAILURE', `Lifecycle ledger cannot be inspected (${error.code}).`);
      }
    }

    if (!ledgerStat) {
      if (anchor !== null || entries.includes(INITIALIZED_NAME)
        || entries.includes(LEGACY_MARKER_NAME)) {
        ledgerFail('MISSING_LEDGER', 'Previously initialized lifecycle state has no ledger.');
      }
      this.#document = withIntegrity({
        schemaVersion: SCHEMA_VERSION,
        serviceInstanceId: this.#serviceInstanceId,
        serviceInstanceIds: [this.#serviceInstanceId],
        sequence: 0,
        updatedAt: this.#timestamp(),
        generations: [],
        requests: [],
        events: [],
      });
      await this.#initializeAnchor(this.#document);
      this.#writeDocument(this.#document);
      this.#writeInitializedMarker();
      return this.document;
    }

    if (ledgerStat.isSymbolicLink()) {
      ledgerFail('INVALID_LEDGER_FILE', 'Lifecycle ledger must not be a symlink.');
    }
    checkFileStat(ledgerStat, 'ledger');
    let markerStat;
    try {
      markerStat = fs.lstatSync(initializedPath);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        ledgerFail('LEDGER_IO_FAILURE', `Lifecycle initialization marker cannot be inspected (${error.code}).`);
      }
    }
    if (markerStat) this.#validateInitializedMarker(markerStat);
    let legacyStat;
    try {
      legacyStat = fs.lstatSync(legacyPath);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        ledgerFail('LEDGER_IO_FAILURE', `Legacy startup marker cannot be inspected (${error.code}).`);
      }
    }
    if (legacyStat) {
      ledgerFail('LEGACY_STARTUP_MARKER', 'Legacy startup marker requires explicit state migration.');
    }

    let raw;
    try {
      const fd = fs.openSync(ledgerPath, fs.constants.O_RDWR | fs.constants.O_NOFOLLOW);
      try {
        const opened = fs.fstatSync(fd);
        checkFileStat(opened, 'ledger');
        if (opened.dev !== ledgerStat.dev || opened.ino !== ledgerStat.ino) {
          ledgerFail('INVALID_LEDGER_FILE', 'Lifecycle ledger changed while it was opened.');
        }
        fs.fsyncSync(fd);
        const directoryFd = fs.openSync(this.#directory,
          fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
        try {
          fs.fsyncSync(directoryFd);
        } finally {
          fs.closeSync(directoryFd);
        }
        raw = fs.readFileSync(fd, 'utf8');
      } finally {
        fs.closeSync(fd);
      }
      if (Buffer.byteLength(raw, 'utf8') > MAX_LEDGER_BYTES) {
        ledgerFail('INVALID_LEDGER_FILE', 'Lifecycle ledger exceeds its storage limit.');
      }
    } catch (error) {
      if (error instanceof AdmissionLedgerError) throw error;
      ledgerFail('LEDGER_IO_FAILURE', `Lifecycle ledger could not be read or synchronized (${error.code || error.name}).`);
    }
    try {
      this.#document = JSON.parse(raw);
    } catch (error) {
      ledgerFail('CORRUPT_LEDGER', `Lifecycle ledger JSON is invalid (${error.name}).`);
    }
    if (this.#document?.schemaVersion !== SCHEMA_VERSION) {
      ledgerFail('UNSUPPORTED_LEDGER_VERSION', 'Lifecycle ledger schema version is unsupported.');
    }
    if (!validateLedger(this.#document)) {
      ledgerFail('CORRUPT_LEDGER', 'Lifecycle ledger schema, sequence, or integrity validation failed.');
    }
    this.#validateAnchor(anchor, this.#document);
    this.#ledgerFileIdentity = { dev: ledgerStat.dev, ino: ledgerStat.ino };
    if (this.#document.serviceInstanceId === this.#serviceInstanceId) {
      ledgerFail('STALE_SERVICE_INSTANCE', 'Service instance identity was reused from an earlier run.');
    }
    if (!markerStat) this.#writeInitializedMarker();
    return this.document;
  }

  async activateServiceInstance() {
    if (this.#document.serviceInstanceId === this.#serviceInstanceId) return;
    if (this.#document.serviceInstanceIds.includes(this.#serviceInstanceId)) {
      ledgerFail('STALE_SERVICE_INSTANCE', 'Service instance identity has already been used.');
    }
    if (this.#document.serviceInstanceIds.length >= 256) {
      ledgerFail('LEDGER_CAPACITY', 'Lifecycle service-instance history is full.');
    }
    const previousIds = this.#document.serviceInstanceIds;
    const previousId = this.#document.serviceInstanceId;
    this.#document.serviceInstanceIds = [...previousIds, this.#serviceInstanceId];
    this.#document.serviceInstanceId = this.#serviceInstanceId;
    try {
      await this.#commitDocument({
        type: 'service-instance-started',
        generationId: null,
        requestId: null,
      });
    } catch (error) {
      this.#document.serviceInstanceIds = previousIds;
      this.#document.serviceInstanceId = previousId;
      throw error;
    }
  }

  async commit({ generations, requests, event }) {
    validateEvent(event);
    if (!Array.isArray(generations) || !Array.isArray(requests)) {
      ledgerFail('INVALID_LEDGER_SNAPSHOT', 'Lifecycle ledger snapshot is invalid.');
    }
    const previous = this.#document;
    this.#document = {
      ...previous,
      generations: structuredClone(generations),
      requests: structuredClone(requests),
    };
    try {
      await this.#commitDocument(event);
    } catch (error) {
      this.#document = previous;
      throw error;
    }
  }

  #timestamp() {
    const value = this.#now();
    if (!validTimestamp(value)) {
      ledgerFail('INVALID_CLOCK', 'Lifecycle ledger clock returned an invalid timestamp.');
    }
    return value;
  }

  async #commitDocument(event) {
    checkDirectoryIdentity(this.#directory, this.#identity);
    if (this.#document.events.length >= MAX_EVENTS) {
      ledgerFail('LEDGER_CAPACITY', 'Lifecycle ledger event history is full.');
    }
    const sequence = this.#document.sequence + 1;
    const eventTimestamp = this.#timestamp();
    const candidate = withIntegrity({
      ...this.#document,
      sequence,
      updatedAt: eventTimestamp,
      events: [
        ...this.#document.events,
        {
          sequence,
          type: event.type,
          at: eventTimestamp,
          generationId: event.generationId,
          requestId: event.requestId,
        },
      ],
    });
    if (!validateLedger(candidate)) {
      ledgerFail('INVALID_LEDGER_SNAPSHOT', 'Lifecycle ledger snapshot failed strict validation.');
    }
    const serialized = `${JSON.stringify(candidate)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > MAX_LEDGER_BYTES) {
      ledgerFail('LEDGER_CAPACITY', 'Lifecycle ledger reached its storage limit.');
    }
    this.#writeDocument(candidate);
    await this.#advanceAnchor(this.#document, candidate);
    this.#document = candidate;
  }

  async #readAnchor() {
    let value;
    try {
      value = await this.#antiRollbackAnchor.read();
    } catch (error) {
      ledgerFail(
        'ANTI_ROLLBACK_ANCHOR_UNAVAILABLE',
        `Anti-rollback anchor could not be read (${error.code || error.name}).`,
      );
    }
    if (value === null) return null;
    if (!isPlainObject(value) || Object.keys(value).length !== 2
      || !Number.isSafeInteger(value.sequence) || value.sequence < 0
      || !HASH_PATTERN.test(value.integrity)) {
      ledgerFail('ANTI_ROLLBACK_ANCHOR_MISMATCH', 'Anti-rollback anchor state is invalid.');
    }
    return value;
  }

  async #initializeAnchor(document) {
    try {
      const initialized = await this.#antiRollbackAnchor.initialize({
        sequence: document.sequence,
        integrity: document.integrity,
      });
      if (initialized !== true) {
        ledgerFail('ANTI_ROLLBACK_ANCHOR_MISMATCH', 'Anti-rollback anchor refused first initialization.');
      }
    } catch (error) {
      if (error instanceof AdmissionLedgerError) throw error;
      ledgerFail(
        'ANTI_ROLLBACK_ANCHOR_UNAVAILABLE',
        `Anti-rollback anchor initialization failed (${error.code || error.name}).`,
      );
    }
  }

  #validateAnchor(anchor, document) {
    if (!anchor || anchor.sequence !== document.sequence || anchor.integrity !== document.integrity) {
      ledgerFail(
        'ANTI_ROLLBACK_ANCHOR_MISMATCH',
        'Lifecycle ledger does not match the independently stored anti-rollback anchor.',
      );
    }
  }

  async #advanceAnchor(previous, candidate) {
    try {
      const advanced = await this.#antiRollbackAnchor.compareAndSwap({
        expected: {
          sequence: previous.sequence,
          integrity: previous.integrity,
        },
        next: {
          sequence: candidate.sequence,
          integrity: candidate.integrity,
        },
      });
      if (advanced !== true) {
        ledgerFail('ANTI_ROLLBACK_ANCHOR_MISMATCH', 'Anti-rollback anchor rejected a sequence update.');
      }
    } catch (error) {
      if (error instanceof AdmissionLedgerError) throw error;
      ledgerFail(
        'ANTI_ROLLBACK_ANCHOR_UNAVAILABLE',
        `Anti-rollback anchor update failed (${error.code || error.name}).`,
      );
    }
  }

  #writeDocument(document) {
    checkDirectoryIdentity(this.#directory, this.#identity);
    const directoryPath = this.#directory;
    const directoryFd = fs.openSync(directoryPath,
      fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    const temporaryName = `${TEMP_PREFIX}${crypto.randomBytes(16).toString('hex')}`;
    const temporaryPath = path.join(directoryPath, temporaryName);
    const ledgerPath = path.join(directoryPath, LEDGER_NAME);
    let fileFd = -1;
    let fileIdentity;
    try {
      fileFd = fs.openSync(temporaryPath,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
        0o600);
      fs.fchmodSync(fileFd, 0o600);
      fileIdentity = fs.fstatSync(fileFd);
      const contents = `${JSON.stringify(document)}\n`;
      let offset = 0;
      while (offset < contents.length) {
        const written = fs.writeSync(fileFd, contents, offset, contents.length - offset, null);
        if (written <= 0) {
          ledgerFail('LEDGER_IO_FAILURE', 'Lifecycle ledger write made no progress.');
        }
        offset += written;
      }
      fs.fsyncSync(fileFd);
      fs.closeSync(fileFd);
      fileFd = -1;
      checkDirectoryIdentity(directoryPath, this.#identity);
      let existing;
      try {
        existing = fs.lstatSync(ledgerPath);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (this.#ledgerFileIdentity) {
        if (!existing || existing.isSymbolicLink() || !existing.isFile()
          || existing.dev !== this.#ledgerFileIdentity.dev
          || existing.ino !== this.#ledgerFileIdentity.ino) {
          ledgerFail('INVALID_LEDGER_FILE', 'Lifecycle ledger path changed before atomic replacement.');
        }
        checkFileStat(existing, 'ledger');
      } else if (existing) {
        ledgerFail('INVALID_LEDGER_FILE', 'Unexpected lifecycle ledger already exists.');
      }
      fs.renameSync(temporaryPath, ledgerPath);
      const writtenStat = fs.lstatSync(ledgerPath);
      checkFileStat(writtenStat, 'ledger');
      if (writtenStat.dev !== fileIdentity.dev || writtenStat.ino !== fileIdentity.ino) {
        ledgerFail('INVALID_LEDGER_FILE', 'Atomic lifecycle ledger replacement could not be verified.');
      }
      this.#ledgerFileIdentity = { dev: writtenStat.dev, ino: writtenStat.ino };
      fs.fsyncSync(directoryFd);
    } catch (error) {
      if (error instanceof AdmissionLedgerError) throw error;
      ledgerFail('LEDGER_IO_FAILURE', `Lifecycle ledger persistence failed (${error.code || error.name}).`);
    } finally {
      if (fileFd >= 0) fs.closeSync(fileFd);
      fs.closeSync(directoryFd);
    }
  }

  #writeInitializedMarker() {
    checkDirectoryIdentity(this.#directory, this.#identity);
    const filePath = path.join(this.#directory, INITIALIZED_NAME);
    let fd;
    try {
      fd = fs.openSync(filePath,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
        0o600);
      fs.fchmodSync(fd, 0o600);
      const marker = Buffer.from('AETHER_LIFECYCLE_LEDGER_INITIALIZED_V1\n', 'ascii');
      fs.writeSync(fd, marker, 0, marker.length, 0);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      const directoryFd = fs.openSync(this.#directory,
        fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
      try {
        fs.fsyncSync(directoryFd);
      } finally {
        fs.closeSync(directoryFd);
      }
    } catch (error) {
      if (error instanceof AdmissionLedgerError) throw error;
      ledgerFail('LEDGER_IO_FAILURE', `Lifecycle initialization marker persistence failed (${error.code || error.name}).`);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }

  #validateInitializedMarker(stat) {
    checkFileStat(stat, 'initialization marker');
    const markerPath = path.join(this.#directory, INITIALIZED_NAME);
    let fd;
    try {
      fd = fs.openSync(markerPath, fs.constants.O_RDWR | fs.constants.O_NOFOLLOW);
      const opened = fs.fstatSync(fd);
      checkFileStat(opened, 'initialization marker');
      if (opened.dev !== stat.dev || opened.ino !== stat.ino) {
        ledgerFail('INVALID_LEDGER_FILE', 'Lifecycle initialization marker changed while it was opened.');
      }
      const contents = fs.readFileSync(fd, 'utf8');
      if (contents !== 'AETHER_LIFECYCLE_LEDGER_INITIALIZED_V1\n') {
        ledgerFail('CORRUPT_LEDGER', 'Lifecycle initialization marker content is invalid.');
      }
      fs.fsyncSync(fd);
      const directoryFd = fs.openSync(this.#directory,
        fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
      try {
        fs.fsyncSync(directoryFd);
      } finally {
        fs.closeSync(directoryFd);
      }
    } catch (error) {
      if (error instanceof AdmissionLedgerError) throw error;
      ledgerFail('LEDGER_IO_FAILURE', `Lifecycle initialization marker could not be read (${error.code || error.name}).`);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }
}

module.exports = {
  AdmissionLedger,
  AdmissionLedgerError,
  MAX_LEDGER_BYTES,
  SCHEMA_VERSION,
  validateLedger,
};
