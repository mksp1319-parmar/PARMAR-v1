'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_ADDRESS_LENGTH,
  REMOTE_BROWSING_ENABLED,
  isTrustedControlUrl,
  navigationPolicy,
  resolveAddressInput,
  validatedControlUrl,
} = require('../security.cjs');

test('AETHER remote navigation remains disabled without verified OS enforcement', () => {
  assert.equal(REMOTE_BROWSING_ENABLED, false);
  assert.equal(navigationPolicy('not a URL').allowed, false);
  assert.equal(navigationPolicy('http://example.com/').allowed, false);
  assert.deepEqual(navigationPolicy('https://example.com/'), {
    allowed: false,
    reason: 'Remote browsing is disabled because this installation has no verified operating-system network boundary.',
  });
});

test('address input distinguishes HTTPS destinations from search text', () => {
  assert.deepEqual(resolveAddressInput('example.com/path'), {
    ok: true,
    url: 'https://example.com/path',
  });
  const search = resolveAddressInput('PARMAR browser');
  assert.equal(search.ok, true);
  assert.match(search.url, /^https:\/\/html\.duckduckgo\.com\/html\/\?q=/);
  assert.equal(resolveAddressInput('example.com:443/path').url, 'https://example.com/path');
  assert.equal(
    resolveAddressInput('HTTPS://EXAMPLE.COM:443/a/../path#section').url,
    'https://example.com/path#section',
  );
});

test('address input rejects unsafe schemes, credentials, and excessive input', () => {
  for (const input of [
    'http://example.com',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'https://user:pass@example.com',
    'x'.repeat(MAX_ADDRESS_LENGTH + 1),
  ]) {
    assert.equal(resolveAddressInput(input).ok, false, input.slice(0, 40));
  }
});

test('the desktop control plane accepts only loopback origins', () => {
  assert.equal(validatedControlUrl('http://127.0.0.1:8080'), 'http://127.0.0.1:8080');
  assert.equal(validatedControlUrl('https://localhost:8443/'), 'https://localhost:8443');
  assert.equal(validatedControlUrl('http://[::1]:8080'), 'http://[::1]:8080');
  for (const value of [
    'https://parmar.example',
    'http://192.168.1.12:8080',
    'http://127.0.0.1:8080/api',
    'http://user:pass@127.0.0.1:8080',
    'file:///tmp/page',
  ]) {
    assert.throws(() => validatedControlUrl(value));
  }
});

test('trusted control origin matching rejects redirects and lookalike hostnames', () => {
  const trustedOrigin = 'http://127.0.0.1:8080';
  assert.equal(isTrustedControlUrl('http://127.0.0.1:8080/settings', trustedOrigin), true);
  for (const value of [
    'https://127.0.0.1:8080/',
    'http://127.0.0.1.evil.example:8080/',
    'http://localhost:8080/',
    'file:///tmp/page',
    'not a URL',
  ]) {
    assert.equal(isTrustedControlUrl(value, trustedOrigin), false, value);
  }
});
