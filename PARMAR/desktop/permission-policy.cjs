'use strict';

const SUPPORTED_PERMISSION_TYPES = new Set([
  'media',
  'geolocation',
  'notifications',
  'midi',
  'midiSysex',
  'pointerLock',
  'fullscreen',
  'openExternal',
  'clipboard-read',
  'clipboard-sanitized-write',
  'display-capture',
  'mediaKeySystem',
  'idle-detection',
  'speaker-selection',
  'window-management',
  'local-fonts',
  'storage-access',
  'top-level-storage-access',
  'keyboard-lock',
]);

const PERMISSION_ROWS = [
  { id: 'camera', label: 'Camera', permissionTypes: ['media'] },
  { id: 'microphone', label: 'Microphone', permissionTypes: ['media'] },
  { id: 'geolocation', label: 'Geolocation', permissionTypes: ['geolocation'] },
  { id: 'notifications', label: 'Notifications', permissionTypes: ['notifications'] },
  {
    id: 'clipboard',
    label: 'Clipboard read/write',
    permissionTypes: ['clipboard-read', 'clipboard-sanitized-write'],
  },
  { id: 'screen-capture', label: 'Screen capture', permissionTypes: ['display-capture'] },
  { id: 'midi', label: 'MIDI / SysEx', permissionTypes: ['midi', 'midiSysex'] },
  {
    id: 'other',
    label: 'Other site permissions',
    permissionTypes: [...SUPPORTED_PERMISSION_TYPES].filter((type) => ![
      'media',
      'geolocation',
      'notifications',
      'clipboard-read',
      'clipboard-sanitized-write',
      'display-capture',
      'midi',
      'midiSysex',
    ].includes(type)),
  },
];

function isValidPermissionOrigin(origin) {
  if (typeof origin !== 'string' || origin.length > 2048) return false;
  try {
    const target = new URL(origin);
    return target.protocol === 'https:'
      && !target.username
      && !target.password
      && target.origin === origin
      && target.pathname === '/'
      && !target.search
      && !target.hash;
  } catch {
    return false;
  }
}

function permissionDecision(permission, origin) {
  const validPermission = typeof permission === 'string'
    && SUPPORTED_PERMISSION_TYPES.has(permission);
  const validOrigin = isValidPermissionOrigin(origin);
  if (!validPermission || !validOrigin) {
    return { allowed: false, validPermission, validOrigin };
  }
  return {
    allowed: false,
    validPermission,
    validOrigin,
  };
}

function privacyStatusPayload(remoteBrowsingEnabled) {
  const remoteBrowsingDisabled = remoteBrowsingEnabled === false;
  return {
    sitePermissionsAvailable: false,
    sitePermissionsReason: remoteBrowsingDisabled
      ? 'Remote browsing is disabled, so site permission requests and checks are unavailable. AETHER has no per-site permission controls.'
      : 'Per-site permission controls are not implemented.',
    permissions: PERMISSION_ROWS.map((permission) => ({
      ...permission,
      permissionTypes: [...permission.permissionTypes],
      state: 'denied',
    })),
    otherPermissionsState: 'denied',
    localData: [
      'Browsing history: saved HTTPS page titles, URLs, and visit times.',
      'Bookmarks: saved HTTPS page titles and URLs.',
      'Tab/session metadata: saved tab URLs, pinned state, active tab, and per-tab zoom.',
      'Preferences: homepage/startup choices, default zoom, and appearance.',
      'Download metadata: filename, byte counts, status, update time, and error text; destination paths are not stored.',
      'A persistent Chromium session partition may retain cookies, cache, and website storage.',
    ],
    clearDataScope: [
      'Clear browsing history removes history only.',
      'Clear download records removes inactive download metadata only; active download records remain.',
      'Neither action deletes downloaded files.',
      'Neither clear action removes bookmarks (individual removal is available), saved tabs/session metadata, or Chromium cookies, cache, and website storage.',
      'Reset settings to defaults separately resets saved preferences; it preserves history, bookmarks, download records, tabs, and existing tab zoom.',
    ],
  };
}

module.exports = {
  SUPPORTED_PERMISSION_TYPES: [...SUPPORTED_PERMISSION_TYPES],
  isValidPermissionOrigin,
  permissionDecision,
  privacyStatusPayload,
};
