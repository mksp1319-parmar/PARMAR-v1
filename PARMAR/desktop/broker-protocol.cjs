'use strict';

const { randomBytes, timingSafeEqual } = require('node:crypto');

const BROKER_MESSAGE_TYPES = new Set([
  'browser.close-tab',
  'browser.focus',
  'browser.new-tab',
  'browser.ready',
  'browser.stop',
  'browser.status',
]);
const BROKER_SESSION_TTL_MS = 30_000;
const MAX_MESSAGE_LENGTH = 4096;
const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MESSAGE_KEYS = ['capability', 'payload', 'sequence', 'type'];

function validPeerIdentity(identity) {
  return identity
    && Number.isSafeInteger(identity.pid)
    && identity.pid > 0
    && Number.isSafeInteger(identity.uid)
    && identity.uid >= 0;
}

function createBrokerSession(expectedPeer, now = Date.now(), capability = randomBytes(32).toString('base64url')) {
  if (
    !validPeerIdentity(expectedPeer)
    || !Number.isSafeInteger(now)
    || !Number.isSafeInteger(now + BROKER_SESSION_TTL_MS)
    || typeof capability !== 'string'
    || !CAPABILITY_PATTERN.test(capability)
    || Buffer.from(capability, 'base64url').length !== 32
  ) {
    throw new TypeError('A valid OS peer identity, issue time, and capability are required.');
  }

  return {
    expectedPeer: { pid: expectedPeer.pid, uid: expectedPeer.uid },
    capability,
    expiresAt: now + BROKER_SESSION_TTL_MS,
    nextSequence: 0,
    authorized: false,
  };
}

function parseBrokerMessage(serialized) {
  if (
    typeof serialized !== 'string'
    || Buffer.byteLength(serialized, 'utf8') > MAX_MESSAGE_LENGTH
  ) {
    return { ok: false, error: 'Broker message is invalid or too large.' };
  }

  let message;
  try {
    message = JSON.parse(serialized);
  } catch {
    return { ok: false, error: 'Broker message is not valid JSON.' };
  }

  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return { ok: false, error: 'Broker message must be an object.' };
  }
  const keys = Object.keys(message).sort();
  if (keys.length !== MESSAGE_KEYS.length || keys.some((key, index) => key !== MESSAGE_KEYS[index])) {
    return { ok: false, error: 'Broker message fields are not allowed.' };
  }
  if (
    typeof message.capability !== 'string'
    || !CAPABILITY_PATTERN.test(message.capability)
    || !Number.isSafeInteger(message.sequence)
    || message.sequence < 0
    || !BROKER_MESSAGE_TYPES.has(message.type)
    || !message.payload
    || typeof message.payload !== 'object'
    || Array.isArray(message.payload)
    || Object.keys(message.payload).length !== 0
  ) {
    return { ok: false, error: 'Broker message payload is invalid.' };
  }

  return { ok: true, message };
}

function authorizeBrokerMessage(session, peerIdentity, message, now = Date.now()) {
  if (
    !session
    || !validPeerIdentity(peerIdentity)
    || !Number.isSafeInteger(now)
  ) {
    return { ok: false, error: 'Broker authorization context is invalid.' };
  }
  if (
    peerIdentity.pid !== session.expectedPeer.pid
    || peerIdentity.uid !== session.expectedPeer.uid
  ) {
    return { ok: false, error: 'Broker peer is not authorized for this launch.' };
  }
  if (now >= session.expiresAt && !session.authorized) {
    return { ok: false, error: 'Broker launch authorization has expired.' };
  }

  const parsed = parseBrokerMessage(message);
  if (!parsed.ok) return parsed;

  const request = parsed.message;
  if (
    !request
    || typeof request !== 'object'
    || !CAPABILITY_PATTERN.test(request.capability || '')
  ) {
    return { ok: false, error: 'Broker message is invalid.' };
  }

  const suppliedCapability = Buffer.from(request.capability, 'base64url');
  const expectedCapability = Buffer.from(session.capability, 'base64url');
  if (
    suppliedCapability.length !== expectedCapability.length
    || !timingSafeEqual(suppliedCapability, expectedCapability)
  ) {
    return { ok: false, error: 'Broker launch capability is invalid.' };
  }
  if (
    request.sequence !== session.nextSequence
    || session.nextSequence === Number.MAX_SAFE_INTEGER
  ) {
    return { ok: false, error: 'Broker message was replayed or is out of order.' };
  }

  session.nextSequence += 1;
  session.authorized = true;
  return { ok: true, type: request.type };
}

module.exports = {
  BROKER_MESSAGE_TYPES,
  CAPABILITY_PATTERN,
  BROKER_SESSION_TTL_MS,
  MAX_MESSAGE_LENGTH,
  authorizeBrokerMessage,
  createBrokerSession,
  parseBrokerMessage,
};
