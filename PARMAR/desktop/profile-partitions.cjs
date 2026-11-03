'use strict';

const {
  DEFAULT_PROFILE_ID,
  isValidProfileId,
} = require('./profiles.cjs');

const LEGACY_DEFAULT_PROFILE_PARTITION = 'persist:parmar-aether-browser-v1';
const PROFILE_PARTITION_PREFIX = 'persist:parmar-aether-profile-';

function profilePartition(profileId) {
  if (!isValidProfileId(profileId)) {
    throw new TypeError('The AETHER profile ID is invalid; its Chromium partition cannot be selected.');
  }
  if (profileId === DEFAULT_PROFILE_ID) return LEGACY_DEFAULT_PROFILE_PARTITION;
  return `${PROFILE_PARTITION_PREFIX}${profileId}`;
}

module.exports = {
  LEGACY_DEFAULT_PROFILE_PARTITION,
  PROFILE_PARTITION_PREFIX,
  profilePartition,
};
