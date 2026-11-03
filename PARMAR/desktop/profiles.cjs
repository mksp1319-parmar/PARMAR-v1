'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const PROFILE_STORE_VERSION = 1;
const DEFAULT_PROFILE_ID = 'default';
const DEFAULT_PROFILE_NAME = 'Default';
const MAX_PROFILES = 10;
const MAX_PROFILE_NAME_LENGTH = 40;
const PROFILE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROFILE_NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u;

function validateProfileName(value) {
  if (typeof value !== 'string' || value.length > MAX_PROFILE_NAME_LENGTH * 2) return null;
  const name = value.trim().normalize('NFKC');
  if (
    !name
    || name.length > MAX_PROFILE_NAME_LENGTH
    || !PROFILE_NAME_PATTERN.test(name)
  ) return null;
  return name;
}

function profileNameKey(name) {
  return name.normalize('NFKC').toLowerCase();
}

function isValidProfileId(value) {
  return value === DEFAULT_PROFILE_ID
    || (typeof value === 'string' && PROFILE_ID_PATTERN.test(value));
}

function validateProfileMetadata(value) {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'activeProfileId,profiles,version'
    || value.version !== PROFILE_STORE_VERSION
    || !Array.isArray(value.profiles)
    || value.profiles.length < 1
    || value.profiles.length > MAX_PROFILES
  ) return null;

  const ids = new Set();
  const names = new Set();
  const profiles = [];
  for (const profile of value.profiles) {
    if (
      !profile
      || typeof profile !== 'object'
      || Array.isArray(profile)
      || Object.keys(profile).sort().join(',') !== 'createdAt,id,name'
      || !isValidProfileId(profile.id)
      || (profile.id === DEFAULT_PROFILE_ID && profile.name !== DEFAULT_PROFILE_NAME)
      || (profile.id !== DEFAULT_PROFILE_ID && !PROFILE_ID_PATTERN.test(profile.id))
      || !Number.isSafeInteger(profile.createdAt)
      || profile.createdAt < 0
    ) return null;
    const name = validateProfileName(profile.name);
    if (
      typeof profile.name !== 'string'
      || name !== profile.name
      || ids.has(profile.id)
      || names.has(profileNameKey(profile.name))
    ) return null;
    ids.add(profile.id);
    names.add(profileNameKey(profile.name));
    profiles.push({ id: profile.id, name, createdAt: profile.createdAt });
  }
  if (!ids.has(DEFAULT_PROFILE_ID) || !ids.has(value.activeProfileId)) return null;
  return {
    version: PROFILE_STORE_VERSION,
    profiles,
    activeProfileId: value.activeProfileId,
  };
}

class AetherProfiles {
  constructor(userDataPath, { now = Date.now, createId = randomUUID } = {}) {
    if (typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath)) {
      throw new TypeError('The AETHER profile data directory must be an absolute path.');
    }
    this.userDataPath = path.resolve(userDataPath);
    this.filePath = path.join(this.userDataPath, 'aether-profiles.json');
    this.now = now;
    this.createId = createId;
    this.data = null;
    this.startupProfileId = null;
    this.load();
  }

  load() {
    let content;
    try {
      content = fs.readFileSync(this.filePath, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw new Error('AETHER profile metadata could not be read.', { cause: error });
      }
      const initial = {
        version: PROFILE_STORE_VERSION,
        profiles: [{
          id: DEFAULT_PROFILE_ID,
          name: DEFAULT_PROFILE_NAME,
          createdAt: this.now(),
        }],
        activeProfileId: DEFAULT_PROFILE_ID,
      };
      this.save(initial);
      this.data = initial;
      this.startupProfileId = initial.activeProfileId;
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      throw new Error('AETHER profile metadata is invalid JSON and was left unchanged.', { cause: error });
    }
    const safeMetadata = validateProfileMetadata(parsed);
    if (!safeMetadata) {
      throw new Error('AETHER profile metadata is invalid or unsupported and was left unchanged.');
    }
    this.data = safeMetadata;
    this.startupProfileId = safeMetadata.activeProfileId;
  }

  snapshot(currentProfileId = this.startupProfileId) {
    return {
      profiles: this.data.profiles.map((profile) => ({ ...profile })),
      activeProfileId: currentProfileId,
      selectedProfileId: this.data.activeProfileId,
      restartRequired: currentProfileId !== this.data.activeProfileId,
    };
  }

  createProfile(name) {
    const safeName = validateProfileName(name);
    if (!safeName) {
      throw new TypeError(
        `A profile name must use letters, numbers, spaces, hyphens, or underscores and contain 1 to ${MAX_PROFILE_NAME_LENGTH} characters.`,
      );
    }
    if (this.data.profiles.length >= MAX_PROFILES) {
      throw new Error(`AETHER supports at most ${MAX_PROFILES} profiles.`);
    }
    if (this.data.profiles.some((profile) => (
      profileNameKey(profile.name) === profileNameKey(safeName)
    ))) {
      throw new Error('A profile with this name already exists.');
    }
    const id = this.createId();
    if (
      typeof id !== 'string'
      || !PROFILE_ID_PATTERN.test(id)
      || this.data.profiles.some((profile) => profile.id === id)
    ) {
      throw new Error('A unique profile identifier could not be created.');
    }
    const next = {
      ...this.data,
      profiles: [
        ...this.data.profiles,
        { id, name: safeName, createdAt: this.now() },
      ],
    };
    this.save(next);
    this.data = next;
    return this.snapshot();
  }

  selectProfile(id) {
    if (!isValidProfileId(id) || !this.data.profiles.some((profile) => profile.id === id)) {
      throw new TypeError('The selected AETHER profile is invalid.');
    }
    if (this.data.activeProfileId === id) return this.snapshot();
    const next = { ...this.data, activeProfileId: id };
    this.save(next);
    this.data = next;
    return this.snapshot();
  }

  profileDataPath(id) {
    if (!this.data.profiles.some((profile) => profile.id === id)) {
      throw new TypeError('The AETHER profile is unavailable.');
    }
    return id === DEFAULT_PROFILE_ID
      ? this.userDataPath
      : path.join(this.userDataPath, 'profile-data', id);
  }

  save(next) {
    if (!validateProfileMetadata(next)) {
      throw new TypeError('AETHER profile metadata failed validation before it could be saved.');
    }
    const parent = path.dirname(this.filePath);
    fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    let descriptor = null;
    let temporaryCreated = false;
    try {
      descriptor = fs.openSync(temporaryPath, 'wx', 0o600);
      temporaryCreated = true;
      fs.writeFileSync(descriptor, JSON.stringify(next));
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = null;
      fs.renameSync(temporaryPath, this.filePath);
    } catch (error) {
      if (descriptor !== null) {
        try {
          fs.closeSync(descriptor);
        } catch {
          // Preserve the original persistence error.
        }
      }
      if (temporaryCreated) {
        try {
          fs.rmSync(temporaryPath, { force: true });
        } catch {
          // Preserve the original persistence error.
        }
      }
      throw new Error('AETHER profile metadata could not be saved.', { cause: error });
    }
  }
}

module.exports = {
  AetherProfiles,
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_NAME,
  MAX_PROFILES,
  MAX_PROFILE_NAME_LENGTH,
  PROFILE_ID_PATTERN,
  isValidProfileId,
  validateProfileMetadata,
  validateProfileName,
};
