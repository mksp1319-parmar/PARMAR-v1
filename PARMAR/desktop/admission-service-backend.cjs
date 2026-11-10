'use strict';

const readline = require('node:readline');
const {
  AdmissionContract,
  AdmissionContractError,
  CONTRACT_VERSION,
} = require('./admission-contract.cjs');
const { AdmissionLedger } = require('./admission-ledger.cjs');

const MAX_ENVELOPE_BYTES = 4352;
let contract;
let reader;
let requestQueue = Promise.resolve();

function parseArguments(argv) {
  const testAnchorEnabled = process.env.AETHER_ADMISSION_TESTING === '1';
  if ((argv.length !== 4 && argv.length !== 6)
    || argv[0] !== '--state-dir' || argv[2] !== '--service-instance-id'
    || (argv.length === 6 && (!testAnchorEnabled || argv[4] !== '--test-anchor-state'))) {
    throw new Error('Backend startup arguments are invalid.');
  }
  return {
    stateDirectory: argv[1],
    serviceInstanceId: argv[3],
    testAnchorState: argv.length === 6 ? argv[5] : null,
  };
}

function isEnvelope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === 2
    && keys[0] === 'request'
    && keys[1] === 'role'
    && typeof value.role === 'string'
    && ['admission', 'lifecycle', 'observer', 'operator'].includes(value.role);
}

async function handleLine(line) {
  let response;
  try {
    if (Buffer.byteLength(line, 'utf8') > MAX_ENVELOPE_BYTES) {
      throw new AdmissionContractError('INVALID_REQUEST', 'Admission envelope is too large.');
    }
    const envelope = JSON.parse(line);
    if (!isEnvelope(envelope)) {
      throw new AdmissionContractError('INVALID_REQUEST', 'Admission envelope is invalid.');
    }
    const result = await contract.dispatch(envelope.request, {
      authenticated: true,
      role: envelope.role,
    });
    response = { ok: true, result };
  } catch (error) {
    response = {
      ok: false,
      error: {
        code: error instanceof AdmissionContractError ? error.code : 'COMPONENT_FAILURE',
        message: error instanceof AdmissionContractError
          ? error.message
          : 'Admission contract worker failed.',
      },
    };
  }
  if (response.version === undefined) response.version = CONTRACT_VERSION;
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

async function main() {
  const { stateDirectory, serviceInstanceId, testAnchorState } = parseArguments(process.argv.slice(2));
  const antiRollbackAnchor = testAnchorState
    ? require('./admission-test-anchor.cjs').createTestAnchor(testAnchorState)
    : undefined;
  const durableStore = new AdmissionLedger({
    directory: stateDirectory,
    serviceInstanceId,
    antiRollbackAnchor,
  });
  contract = new AdmissionContract({
    authorizeCaller: (caller) => caller?.authenticated === true,
    durableStore,
    serviceInstanceId,
  });
  await contract.initialize();
  process.stdout.write('{"ready":true}\n');

  reader = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  reader.on('line', (line) => {
    requestQueue = requestQueue.then(() => handleLine(line));
  });

  reader.on('close', () => {
    requestQueue.then(() => contract.shutdown())
      .then(() => process.exit(0))
      .catch((error) => {
        process.stderr.write(`AETHER admission ledger shutdown failed: ${error.code || error.name}.\n`);
        process.exitCode = 1;
      });
  });
}

main().catch((error) => {
  process.stderr.write(`AETHER admission ledger initialization failed: ${error.code || error.name}.\n`);
  process.exitCode = 1;
});
