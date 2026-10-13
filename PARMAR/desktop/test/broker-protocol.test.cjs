'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BROKER_SESSION_TTL_MS,
  MAX_MESSAGE_LENGTH,
  authorizeBrokerMessage,
  createBrokerSession,
  parseBrokerMessage,
} = require('../broker-protocol.cjs');

const peer = { pid: 4321, uid: 1000 };

function request(session, overrides = {}) {
  return JSON.stringify({
    capability: session.capability,
    sequence: 0,
    type: 'browser.status',
    payload: {},
    ...overrides,
  });
}

test('broker protocol accepts only the fixed lifecycle and status message shape', () => {
  const session = createBrokerSession(peer, 100);
  assert.deepEqual(
    authorizeBrokerMessage(session, peer, request(session), 101),
    { ok: true, type: 'browser.status' },
  );

  for (const value of [
    '{',
    '[]',
    JSON.stringify({ capability: session.capability, sequence: 0, type: 'browser.exec', payload: {} }),
    JSON.stringify({ capability: session.capability, sequence: 0, type: 'browser.stop', payload: { command: 'quit' } }),
    JSON.stringify({ capability: session.capability, sequence: -1, type: 'browser.stop', payload: {} }),
    JSON.stringify({ ...JSON.parse(request(session)), extra: true }),
    'x'.repeat(MAX_MESSAGE_LENGTH + 1),
    'ü'.repeat(MAX_MESSAGE_LENGTH),
  ]) {
    assert.equal(parseBrokerMessage(value).ok, false);
  }
  assert.equal(authorizeBrokerMessage(session, peer, JSON.parse(request(session)), 101).ok, false);
});

test('broker authorization rejects an unexpected peer and invalid session identity', () => {
  const session = createBrokerSession(peer, 100);
  assert.equal(
    authorizeBrokerMessage(session, { ...peer, pid: peer.pid + 1 }, request(session), 101).ok,
    false,
  );
  assert.throws(() => createBrokerSession({ pid: 0, uid: peer.uid }, 100), TypeError);
});

test('broker launch capability expires and does not authorize after expiry', () => {
  const session = createBrokerSession(peer, 100);
  assert.equal(
    authorizeBrokerMessage(session, peer, request(session), 100 + BROKER_SESSION_TTL_MS).ok,
    false,
  );
});

test('broker launch capability rejects a replayed sequence number', () => {
  const session = createBrokerSession(peer, 100);
  const first = request(session);
  assert.equal(authorizeBrokerMessage(session, peer, first, 101).ok, true);
  assert.equal(authorizeBrokerMessage(session, peer, first, 102).ok, false);
});

test('broker authorization does not consume a sequence number on a rejected request', () => {
  const session = createBrokerSession(peer, 100);
  const invalid = request(session, { capability: 'A'.repeat(43) });
  assert.equal(authorizeBrokerMessage(session, peer, invalid, 101).ok, false);
  assert.equal(authorizeBrokerMessage(session, peer, request(session), 102).ok, true);
});
