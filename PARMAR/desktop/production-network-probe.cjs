'use strict';

const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const PROBE_OPT_IN = 'PARMAR_AETHER_PRODUCTION_NETWORK_PROBE';
const PROBE_TARGETS = 'PARMAR_AETHER_PRODUCTION_NETWORK_PROBE_TARGETS';
const REPORT_FILENAME = 'production-network-probe.jsonl';
const ALLOWED_BLOCK_ERRORS = new Set([
  'EACCES',
  'EADDRNOTAVAIL',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPERM',
]);
const TARGETS = [
  { family: 'ipv4', host: '127.0.0.1' },
  { family: 'ipv6', host: '::1' },
];

function productionProbeEnabled(environment = process.env) {
  return environment[PROBE_OPT_IN] === '1';
}

function readProbeConfiguration(environment = process.env) {
  if (!productionProbeEnabled(environment)) return null;
  if (typeof environment[PROBE_TARGETS] !== 'string') {
    throw new Error('The AETHER production network probe targets are missing.');
  }

  let configuration;
  try {
    configuration = JSON.parse(environment[PROBE_TARGETS]);
  } catch {
    throw new Error('The AETHER production network probe targets are invalid JSON.');
  }

  if (
    !configuration
    || typeof configuration !== 'object'
    || Array.isArray(configuration)
    || Object.keys(configuration).sort().join(',') !== 'reportPath,runId,targets,version'
    || configuration.version !== 1
    || typeof configuration.runId !== 'string'
    || !/^[A-Za-z0-9_-]{16,64}$/.test(configuration.runId)
    || !Array.isArray(configuration.targets)
    || configuration.targets.length !== TARGETS.length
  ) {
    throw new Error('The AETHER production network probe configuration is invalid.');
  }

  const targets = configuration.targets.map((target) => {
    if (
      !target
      || typeof target !== 'object'
      || Array.isArray(target)
      || Object.keys(target).sort().join(',') !== 'family,host,port'
    ) {
      throw new Error('An AETHER production network probe target is invalid.');
    }
    const expected = TARGETS.find((entry) => entry.family === target.family);
    if (
      !expected
      || target.host !== expected.host
      || !Number.isSafeInteger(target.port)
      || target.port < 1
      || target.port > 65535
    ) {
      throw new Error('An AETHER production network probe target is not an approved loopback listener.');
    }
    return { ...expected, port: target.port };
  });
  if (new Set(targets.map((target) => target.family)).size !== TARGETS.length) {
    throw new Error('The AETHER production network probe must include one IPv4 and one IPv6 target.');
  }

  if (typeof configuration.reportPath !== 'string' || !path.isAbsolute(configuration.reportPath)) {
    throw new Error('The AETHER production network probe report path is invalid.');
  }
  const reportPath = path.resolve(configuration.reportPath);
  const reportDirectory = path.dirname(reportPath);
  const reportDirectoryStat = fs.lstatSync(reportDirectory);
  const realTemporaryDirectory = fs.realpathSync(os.tmpdir());
  const realReportDirectory = fs.realpathSync(reportDirectory);
  if (
    !reportDirectoryStat.isDirectory()
    || reportDirectoryStat.isSymbolicLink()
    || !realReportDirectory.startsWith(`${path.join(realTemporaryDirectory, 'parmar-aether-ui-')}`)
    || path.basename(reportPath) !== REPORT_FILENAME
  ) {
    throw new Error('The AETHER production network probe report must be inside its test temporary directory.');
  }
  try {
    if (fs.lstatSync(reportPath).isSymbolicLink()) {
      throw new Error('The AETHER production network probe report cannot be a symbolic link.');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  return {
    reportPath,
    runId: configuration.runId,
    targets,
  };
}

function classifyProbeResult({ attempted, connected, errorCode }) {
  if (!attempted) return 'unexecuted';
  if (connected) return 'connected';
  if (ALLOWED_BLOCK_ERRORS.has(errorCode)) return 'blocked';
  return 'inconclusive';
}

function attemptTcpConnection(target, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let completed = false;
    const result = {
      attempted: false,
      connected: false,
      errorCode: null,
      errorMessage: null,
    };
    const finish = () => {
      if (completed) return;
      completed = true;
      socket.destroy();
      result.result = classifyProbeResult(result);
      resolve(result);
    };

    socket.setTimeout(timeoutMs, () => {
      result.errorCode = 'ETIMEDOUT';
      result.errorMessage = `Connection attempt exceeded ${timeoutMs} ms.`;
      finish();
    });
    socket.once('connect', () => {
      result.connected = true;
      finish();
    });
    socket.once('error', (error) => {
      result.errorCode = error.code || 'UNKNOWN';
      result.errorMessage = error.message;
      finish();
    });

    result.attempted = true;
    try {
      socket.connect({ host: target.host, port: target.port, family: target.family === 'ipv4' ? 4 : 6 });
    } catch (error) {
      result.errorCode = error.code || 'UNKNOWN';
      result.errorMessage = error.message;
      finish();
    }
  });
}

async function runProductionNetworkProbe(isolation, environment = process.env) {
  const configuration = readProbeConfiguration(environment);
  if (!configuration) return { enabled: false, results: [] };
  if (!isolation || typeof isolation.namespaceId !== 'string') {
    throw new Error('The AETHER production network probe requires verified isolation evidence.');
  }

  const results = [];
  for (const target of configuration.targets) {
    const attempt = await attemptTcpConnection(target);
    results.push({
      ...attempt,
      destination: `${target.family === 'ipv6' ? `[${target.host}]` : target.host}:${target.port}`,
      executable: process.execPath,
      family: target.family,
      host: target.host,
      networkIsolation: {
        effectiveCapabilities: isolation.effectiveCapabilities,
        interfaces: isolation.interfaces,
        ipv4Routes: isolation.ipv4Routes,
        ipv6Routes: isolation.ipv6Routes,
        noNewPrivileges: isolation.noNewPrivileges,
      },
      namespaceId: isolation.namespaceId,
      parentNamespaceId: isolation.parentNamespaceId,
      pid: process.pid,
      port: target.port,
      processArguments: process.argv,
      timestamp: new Date().toISOString(),
    });
  }

  const report = {
    event: 'production-network-probe',
    runId: configuration.runId,
    results,
  };
  fs.appendFileSync(configuration.reportPath, `${JSON.stringify(report)}\n`, {
    encoding: 'utf8',
    flag: 'a',
    mode: 0o600,
  });
  return { enabled: true, ...report };
}

module.exports = {
  classifyProbeResult,
  productionProbeEnabled,
  readProbeConfiguration,
  runProductionNetworkProbe,
};
