'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const desktopDirectory = path.resolve(__dirname, '..');
const {
  classifyProbeResult,
  productionProbeEnabled,
  readProbeConfiguration,
} = require('../production-network-probe.cjs');

test('production network probe is disabled unless explicitly opted in', () => {
  assert.equal(productionProbeEnabled({}), false);
  assert.equal(readProbeConfiguration({}), null);
  assert.equal(productionProbeEnabled({
    PARMAR_AETHER_PRODUCTION_NETWORK_PROBE: '0',
    PARMAR_AETHER_PRODUCTION_NETWORK_PROBE_TARGETS: '{}',
  }), false);
});

test('normal package configuration does not activate the production network probe', () => {
  const builderConfiguration = fs.readFileSync(
    path.join(desktopDirectory, 'electron-builder.config.cjs'),
    'utf8',
  );
  assert.doesNotMatch(builderConfiguration, /PARMAR_AETHER_PRODUCTION_NETWORK_PROBE/);
});

test('production network probe accepts only controlled IPv4 and IPv6 loopback listeners', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'parmar-aether-ui-probe-test-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const configuration = {
    version: 1,
    runId: '0123456789abcdef',
    reportPath: path.join(directory, 'production-network-probe.jsonl'),
    targets: [
      { family: 'ipv4', host: '127.0.0.1', port: 12345 },
      { family: 'ipv6', host: '::1', port: 23456 },
    ],
  };
  const environment = {
    PARMAR_AETHER_PRODUCTION_NETWORK_PROBE: '1',
    PARMAR_AETHER_PRODUCTION_NETWORK_PROBE_TARGETS: JSON.stringify(configuration),
  };

  assert.deepEqual(readProbeConfiguration(environment), {
    reportPath: configuration.reportPath,
    runId: configuration.runId,
    targets: configuration.targets,
  });
  configuration.targets[0].host = '192.0.2.10';
  environment.PARMAR_AETHER_PRODUCTION_NETWORK_PROBE_TARGETS = JSON.stringify(configuration);
  assert.throws(readProbeConfiguration.bind(null, environment), /not an approved loopback listener/);
});

test('probe classification distinguishes blocked, connected, inconclusive, and unexecuted attempts', () => {
  assert.equal(classifyProbeResult({
    attempted: true,
    connected: false,
    errorCode: 'ENETUNREACH',
  }), 'blocked');
  assert.equal(classifyProbeResult({
    attempted: true,
    connected: false,
    errorCode: 'EADDRNOTAVAIL',
  }), 'blocked');
  assert.equal(classifyProbeResult({
    attempted: true,
    connected: true,
    errorCode: null,
  }), 'connected');
  assert.equal(classifyProbeResult({
    attempted: true,
    connected: false,
    errorCode: 'ETIMEDOUT',
  }), 'inconclusive');
  assert.equal(classifyProbeResult({
    attempted: false,
    connected: false,
    errorCode: null,
  }), 'unexecuted');
});
