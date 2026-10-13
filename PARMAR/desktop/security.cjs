'use strict';

const net = require('node:net');

const REMOTE_BROWSING_ENABLED = false;
const MAX_ADDRESS_LENGTH = 2048;

function validatedControlUrl(value) {
  let target;
  try {
    target = new URL(value);
  } catch {
    throw new Error('PARMAR_DESKTOP_BACKEND_URL must be a loopback HTTP(S) URL.');
  }
  const hostname = target.hostname.replace(/^\[|\]$/g, '');
  const ipVersion = net.isIP(hostname);
  const isLoopbackAddress = hostname === 'localhost'
    || (ipVersion === 4 && hostname.startsWith('127.'))
    || (ipVersion === 6 && hostname.toLowerCase() === '::1');
  if (
    !['http:', 'https:'].includes(target.protocol)
    || target.username
    || target.password
    || !isLoopbackAddress
    || target.pathname !== '/'
    || target.search
    || target.hash
  ) {
    throw new Error('PARMAR_DESKTOP_BACKEND_URL must be a loopback origin without credentials or a path.');
  }
  return target.origin;
}

function isTrustedControlUrl(value, controlUrl) {
  try {
    return new URL(value).origin === validatedControlUrl(controlUrl);
  } catch {
    return false;
  }
}

function resolveAddressInput(value) {
  if (typeof value !== 'string') {
    return { ok: false, reason: 'Enter a web address or search query.' };
  }

  const input = value.trim();
  if (!input || input.length > MAX_ADDRESS_LENGTH) {
    return { ok: false, reason: 'The address is empty or exceeds the supported length.' };
  }

  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(input)
    && !/^[^/:\s]+:\d+(?:\/|$)/.test(input);
  if (hasScheme && !/^https:\/\//i.test(input)) {
    return { ok: false, reason: 'Only HTTPS web addresses are permitted.' };
  }

  let target;
  try {
    if (/\s/.test(input) || !input.includes('.')) {
      target = new URL(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(input)}`);
    } else {
      target = new URL(/^https:\/\//i.test(input) ? input : `https://${input}`);
    }
  } catch {
    return { ok: false, reason: 'Enter a valid HTTPS address or search query.' };
  }

  if (
    target.protocol !== 'https:'
    || !target.hostname
    || target.username
    || target.password
  ) {
    return { ok: false, reason: 'Only credential-free HTTPS addresses are permitted.' };
  }

  return { ok: true, url: target.href };
}

function navigationPolicy(url) {
  let target;
  try {
    target = new URL(url);
  } catch {
    return { allowed: false, reason: 'The navigation target is invalid.' };
  }

  if (target.protocol !== 'https:' || target.username || target.password) {
    return { allowed: false, reason: 'Only credential-free HTTPS destinations are permitted.' };
  }

  if (!REMOTE_BROWSING_ENABLED) {
    return {
      allowed: false,
      reason: 'Remote browsing is disabled because this installation has no verified operating-system network boundary.',
    };
  }

  return { allowed: true };
}

module.exports = {
  MAX_ADDRESS_LENGTH,
  REMOTE_BROWSING_ENABLED,
  isTrustedControlUrl,
  navigationPolicy,
  resolveAddressInput,
  validatedControlUrl,
};
