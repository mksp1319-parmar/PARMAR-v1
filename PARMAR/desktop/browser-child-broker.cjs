'use strict';

const readline = require('node:readline');
const fs = require('node:fs');
const { authorizeBrokerMessage, createBrokerSession } = require('./broker-protocol.cjs');

function readEffectiveUid(pid) {
  const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
  const line = status.split('\n').find((entry) => entry.startsWith('Uid:'));
  if (!line) throw new Error('The AETHER parent UID could not be verified.');
  const uid = Number(line.trim().split(/\s+/)[2]);
  if (!Number.isSafeInteger(uid) || uid < 0) throw new Error('The AETHER parent UID is invalid.');
  return uid;
}

function startBrowserChildBroker({
  input = process.stdin,
  output = process.stdout,
  environment = process.env,
  parentPid = process.ppid,
  processUidReader = readEffectiveUid,
  onStop,
  onFocus,
  onNewTab,
  onCloseTab,
  onFailure,
} = {}) {
  const capability = environment.PARMAR_AETHER_BROKER_CAPABILITY;
  if (typeof capability !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(capability)) {
    throw new Error('The AETHER browser child broker configuration is invalid.');
  }
  const session = createBrokerSession(
    { pid: parentPid, uid: processUidReader(parentPid) },
    Date.now(),
    capability,
  );
  let sequence = 0;
  let failed = false;
  let stopping = false;
  const reader = readline.createInterface({ input, crlfDelay: Infinity });

  const fail = (error) => {
    if (failed) return;
    failed = true;
    reader.close();
    onFailure(error);
  };

  reader.on('line', (line) => {
    let authorization;
    try {
      authorization = authorizeBrokerMessage(
        session,
        { pid: parentPid, uid: processUidReader(parentPid) },
        line,
      );
    } catch (error) {
      fail(error);
      return;
    }
    if (!authorization.ok) {
      fail(new Error(`AETHER parent IPC was rejected: ${authorization.error}`));
      return;
    }
    const action = {
      'browser.focus': onFocus,
      'browser.new-tab': onNewTab,
      'browser.close-tab': onCloseTab,
      'browser.ready': () => {},
      'browser.stop': onStop,
    }[authorization.type];
    if (typeof action !== 'function') {
      fail(new Error('AETHER parent IPC requested an unauthorized action.'));
      return;
    }
    if (authorization.type === 'browser.stop') stopping = true;
    try {
      const result = action();
      if (result && typeof result.then === 'function') {
        result.catch(fail);
      }
    } catch (error) {
      fail(error);
    }
  });
  reader.on('close', () => {
    if (!failed && !stopping) onFailure(new Error('The AETHER browser parent disconnected.'));
  });

  return {
    sendStatus() {
      if (failed || output.destroyed || !output.writable) {
        throw new Error('The AETHER browser child broker is disconnected.');
      }
      output.write(`${JSON.stringify({
        capability,
        payload: {},
        sequence: sequence++,
        type: 'browser.status',
      })}\n`);
    },
    close: () => {
      stopping = true;
      reader.close();
    },
  };
}

module.exports = { startBrowserChildBroker };
