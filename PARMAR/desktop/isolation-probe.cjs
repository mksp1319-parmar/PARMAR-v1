'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const readline = require('node:readline');
const {
  authorizeBrokerMessage,
  createBrokerSession,
} = require('./broker-protocol.cjs');

const COMMAND_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

function readNamespaceId(pid = 'self') {
  return fs.readlinkSync(`/proc/${pid}/ns/net`);
}

function readEffectiveUid(pid) {
  const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
  const line = status.split('\n').find((entry) => entry.startsWith('Uid:'));
  if (!line) throw new Error('The broker peer UID is unavailable.');
  const uid = Number(line.trim().split(/\s+/)[2]);
  if (!Number.isSafeInteger(uid) || uid < 0) throw new Error('The broker peer UID is invalid.');
  return uid;
}

function readEffectiveCapabilities() {
  const status = fs.readFileSync('/proc/self/status', 'utf8');
  const line = status.split('\n').find((entry) => entry.startsWith('CapEff:'));
  if (!line || !/^0+$/.test(line.trim().split(/\s+/)[1] || '')) {
    throw new Error('The isolated process retained effective capabilities.');
  }
  return '0';
}

function commandJson(command, args) {
  const output = execFileSync(command, args, {
    encoding: 'utf8',
    env: { PATH: COMMAND_PATH },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(output);
}

function inspectIsolation(expectedParentNamespace) {
  const namespaceId = readNamespaceId();
  const ipPath = process.env.PARMAR_AETHER_IP_PATH;
  if (!ipPath) throw new Error('The network namespace inspection tool is not configured.');
  const interfaces = commandJson(ipPath, ['-j', 'link', 'show']);
  const ipv4Routes = commandJson(ipPath, ['-j', '-4', 'route', 'show', 'table', 'all']);
  const ipv6Routes = commandJson(ipPath, ['-j', '-6', 'route', 'show', 'table', 'all']);

  const snapshot = {
    namespaceId,
    parentNamespaceId: expectedParentNamespace,
    interfaces,
    ipv4Routes,
    ipv6Routes,
  };
  verifyNetworkSnapshot(snapshot);
  return snapshot;
}

function verifyNetworkSnapshot(snapshot) {
  if (
    !snapshot
    || typeof snapshot.namespaceId !== 'string'
    || !/^net:\[\d+\]$/.test(snapshot.namespaceId)
    || typeof snapshot.parentNamespaceId !== 'string'
    || !/^net:\[\d+\]$/.test(snapshot.parentNamespaceId)
    || snapshot.namespaceId === snapshot.parentNamespaceId
  ) {
    throw new Error('AETHER did not enter a distinct network namespace.');
  }
  if (
    !Array.isArray(snapshot.interfaces)
    || snapshot.interfaces.length !== 1
    || snapshot.interfaces[0].ifname !== 'lo'
    || !Array.isArray(snapshot.interfaces[0].flags)
    || !snapshot.interfaces[0].flags.includes('LOOPBACK')
    || snapshot.interfaces[0].flags.includes('UP')
    || snapshot.interfaces[0].operstate !== 'DOWN'
  ) {
    throw new Error('The isolated namespace has an unexpected or active network interface.');
  }
  if (
    !Array.isArray(snapshot.ipv4Routes)
    || snapshot.ipv4Routes.length !== 0
    || !Array.isArray(snapshot.ipv6Routes)
    || snapshot.ipv6Routes.length !== 0
  ) {
    throw new Error('The isolated namespace has an unexpected IP route.');
  }
  return {
    namespaceId: snapshot.namespaceId,
    parentNamespaceId: snapshot.parentNamespaceId,
    interfaces: ['lo (down)'],
    ipv4Routes: 0,
    ipv6Routes: 0,
  };
}

function verifyIsolationSnapshot(snapshot) {
  const verified = verifyNetworkSnapshot(snapshot);
  if (snapshot.effectiveCapabilities !== '0' || snapshot.noNewPrivileges !== '1') {
    throw new Error('The isolated process privilege state is not restricted.');
  }
  return {
    ...verified,
    effectiveCapabilities: '0',
    noNewPrivileges: true,
  };
}

function verifyIsolationReport(report) {
  if (
    !report
    || typeof report.namespaceId !== 'string'
    || !/^net:\[\d+\]$/.test(report.namespaceId)
    || typeof report.parentNamespaceId !== 'string'
    || !/^net:\[\d+\]$/.test(report.parentNamespaceId)
    || report.namespaceId === report.parentNamespaceId
    || !Array.isArray(report.interfaces)
    || report.interfaces.length !== 1
    || report.interfaces[0] !== 'lo (down)'
    || report.ipv4Routes !== 0
    || report.ipv6Routes !== 0
    || report.effectiveCapabilities !== '0'
    || report.noNewPrivileges !== true
  ) {
    throw new Error('The isolated child reported an invalid network-isolation state.');
  }
  return report;
}

function verifyCurrentIsolation(expectedParentNamespace = process.env.PARMAR_AETHER_PARENT_NETNS) {
  if (!expectedParentNamespace) throw new Error('The expected parent network namespace is missing.');
  const snapshot = inspectIsolation(expectedParentNamespace);
  snapshot.effectiveCapabilities = readEffectiveCapabilities();
  snapshot.noNewPrivileges = fs.readFileSync('/proc/self/status', 'utf8')
    .split('\n')
    .find((entry) => entry.startsWith('NoNewPrivs:'))?.trim().split(/\s+/)[1];
  return verifyIsolationSnapshot(snapshot);
}

function sendLine(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function startProbe() {
  const capability = process.env.PARMAR_AETHER_BROKER_CAPABILITY;
  const parentNamespaceId = process.env.PARMAR_AETHER_PARENT_NETNS;
  if (typeof capability !== 'string' || !parentNamespaceId) {
    throw new Error('The isolated probe launch configuration is incomplete.');
  }
  const snapshot = verifyCurrentIsolation(parentNamespaceId);
  const parentIdentity = { pid: process.ppid, uid: readEffectiveUid(process.ppid) };
  const brokerSession = createBrokerSession(parentIdentity, Date.now(), capability);
  let nextSequence = 0;
  let stopping = false;
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

  sendLine({ event: 'isolation.ready', snapshot });
  sendLine({
    capability,
    payload: {},
    sequence: nextSequence++,
    type: 'browser.status',
  });

  input.on('line', (line) => {
    const authorized = authorizeBrokerMessage(
      brokerSession,
      { pid: process.ppid, uid: readEffectiveUid(process.ppid) },
      line,
    );
    if (!authorized.ok) {
      process.exitCode = 1;
      input.close();
      return;
    }
    if (authorized.type === 'browser.stop') {
      stopping = true;
      input.close();
      process.exit(0);
    }
    sendLine({
      capability,
      payload: {},
      sequence: nextSequence++,
      type: 'browser.status',
    });
  });
  input.on('close', () => {
    if (!stopping) process.exitCode = 1;
  });
}

if (require.main === module) {
  try {
    startProbe();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Isolation verification failed.'}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  verifyIsolationReport,
  verifyCurrentIsolation,
  verifyNetworkSnapshot,
  verifyIsolationSnapshot,
};
