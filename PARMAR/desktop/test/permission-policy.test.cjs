'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SUPPORTED_PERMISSION_TYPES,
  isValidPermissionOrigin,
  permissionDecision,
  privacyStatusPayload,
} = require('../permission-policy.cjs');

test('all supported site permission types are denied by default', () => {
  assert.ok(SUPPORTED_PERMISSION_TYPES.length > 0);
  for (const permission of SUPPORTED_PERMISSION_TYPES) {
    assert.deepEqual(permissionDecision(permission, 'https://example.test'), {
      allowed: false,
      validPermission: true,
      validOrigin: true,
    }, permission);
  }
});

test('unknown permission types and invalid origins fail closed', () => {
  for (const permission of ['unknown-permission', '', null, {}, 'media*']) {
    assert.equal(permissionDecision(permission, 'https://example.test').allowed, false);
  }
  for (const origin of [
    null,
    '',
    'not an origin',
    'http://example.test',
    'file:///tmp/page',
    'https://user:secret@example.test',
    'https://example.test/path',
    'https://example.test/?query',
    'https://example.test/#fragment',
    `https://${'x'.repeat(2048)}.test`,
  ]) {
    assert.equal(permissionDecision('media', origin).allowed, false, String(origin));
  }
  assert.equal(isValidPermissionOrigin('https://example.test'), true);
  assert.equal(isValidPermissionOrigin('https://example.test/'), false);
});

test('privacy status reports policy denial without claiming request history or grants', () => {
  const status = privacyStatusPayload(false);
  assert.equal(status.sitePermissionsAvailable, false);
  assert.match(status.sitePermissionsReason, /Remote browsing is disabled/);
  assert.deepEqual(
    status.permissions.map(({ state }) => state),
    status.permissions.map(() => 'denied'),
  );
  assert.equal(status.otherPermissionsState, 'denied');
  assert.ok(status.localData.some((entry) => /Download metadata/.test(entry)));
  assert.ok(status.clearDataScope.some((entry) => /Neither action deletes downloaded files/.test(entry)));
  assert.ok(status.clearDataScope.some((entry) => /Neither clear action removes bookmarks/.test(entry)));
  assert.ok(status.clearDataScope.some((entry) => /Reset settings to defaults separately/.test(entry)));
});
