'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const {
  app,
  BrowserWindow,
  WebContentsView,
  protocol,
  session,
} = require('electron');
const { AetherProfiles, isValidProfileId } = require('../profiles.cjs');
const { profilePartition } = require('../profile-partitions.cjs');
const { permissionDecision } = require('../permission-policy.cjs');

protocol.registerSchemesAsPrivileged([{
  scheme: 'aether-profile-test',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    allowServiceWorkers: true,
    corsEnabled: true,
  },
}]);

const TEST_URL = 'aether-profile-test://storage.test/index.html';
const TEST_ORIGIN = 'aether-profile-test://storage.test';

function readConfig() {
  let config;
  try {
    config = JSON.parse(process.argv.at(-1));
  } catch (error) {
    throw new Error('The profile runtime test configuration is invalid.', { cause: error });
  }
  if (
    !config
    || typeof config !== 'object'
    || !path.isAbsolute(config.userDataPath)
    || !path.isAbsolute(config.temporaryRoot)
    || !path.isAbsolute(config.evidencePath)
    || !path.isAbsolute(config.reportPath)
    || !/^[0-9a-f]{64}$/.test(config.ownerToken)
    || !isValidProfileId(config.profileId)
    || config.profileId === 'default'
    || !/^[0-9a-f]{48}$/.test(config.expectedMarker)
    || !/^[0-9a-f]{48}$/.test(config.otherMarker)
    || !['seed', 'verify'].includes(config.operation)
    || !/^aether-profile-storage-[A-Za-z0-9_-]+$/.test(path.basename(config.temporaryRoot))
    || path.dirname(config.userDataPath) !== config.temporaryRoot
    || path.basename(config.userDataPath) !== 'user-data'
    || path.dirname(config.evidencePath) !== config.temporaryRoot
    || path.basename(config.evidencePath) !== 'evidence'
    || path.dirname(config.reportPath) !== config.evidencePath
    || fs.realpathSync(config.temporaryRoot) !== config.temporaryRoot
    || path.dirname(config.temporaryRoot) !== fs.realpathSync(os.tmpdir())
    || fs.readFileSync(
      path.join(config.temporaryRoot, '.aether-profile-storage-owner'),
      'utf8',
    ) !== config.ownerToken
    || !isRealDirectory(config.userDataPath)
    || !isRealDirectory(config.evidencePath)
    || fs.existsSync(config.reportPath)
  ) {
    throw new TypeError('The profile runtime test configuration failed validation.');
  }
  return config;
}

function isRealDirectory(directoryPath) {
  try {
    const stat = fs.lstatSync(directoryPath);
    return stat.isDirectory()
      && !stat.isSymbolicLink()
      && fs.realpathSync(directoryPath) === directoryPath;
  } catch {
    return false;
  }
}

function response(body, contentType) {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function installTestProtocol(profileSession) {
  return profileSession.protocol.handle('aether-profile-test', (request) => {
    const url = new URL(request.url);
    if (url.protocol !== 'aether-profile-test:' || url.host !== 'storage.test') {
      return new Response('Not found', { status: 404 });
    }
    if (url.pathname === '/index.html') {
      return response(
        `<!doctype html>
<meta charset="utf-8">
<title>AETHER storage fixture</title>
<body>Local test fixture</body>`,
        'text/html; charset=utf-8',
      );
    }
    if (url.pathname === '/worker.js') {
      const marker = JSON.stringify(url.searchParams.get('marker') || '');
      return response(
        `const marker = ${marker};
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open('aether-profile-test').then((cache) => (
      cache.put('/service-worker-marker', new Response(marker))
    )),
  );
});
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));`,
        'text/javascript; charset=utf-8',
      );
    }
    return new Response('Not found', { status: 404 });
  });
}

function installRestrictivePolicies(profileSession) {
  profileSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    callback(permissionDecision(permission, details?.securityOrigin).allowed);
  });
  profileSession.setPermissionCheckHandler((_contents, permission, origin) => (
    permissionDecision(permission, origin).allowed
  ));
  profileSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (_details, callback) => callback({ cancel: true }),
  );
  profileSession.on('will-download', (_event, item) => item.cancel());
}

function indexedDbOperation(marker, operation) {
  const isSeed = operation === 'seed';
  const transactionMode = isSeed ? 'readwrite' : 'readonly';
  const transactionAction = isSeed
    ? `store.put(${JSON.stringify(marker)}, 'marker');`
    : `const read = store.get('marker');
read.onsuccess = () => resolve(read.result || null);
read.onerror = () => reject(read.error);`;
  return `new Promise((resolve, reject) => {
  const request = indexedDB.open('aether-profile-isolation', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('markers');
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const db = request.result;
    const transaction = db.transaction('markers', '${transactionMode}');
    const store = transaction.objectStore('markers');
    ${transactionAction}
    transaction.oncomplete = () => {
      ${isSeed ? 'resolve(true);' : ''}
      db.close();
    };
    transaction.onerror = () => reject(transaction.error);
  };
})`;
}

async function evaluateStorage(contents, config) {
  const operation = config.operation;
  const marker = config.expectedMarker;

  if (operation === 'verify') {
    const verifyScript = `(() => {
  const cookie = document.cookie.split('; ')
    .find((value) => value.startsWith('aether_profile_marker='))
    ?.split('=').slice(1).join('=') || null;
  const localStorageMarker = localStorage.getItem('aether-profile-marker');
  return (${indexedDbOperation(marker, 'verify')})
    .then((indexedDbMarker) => navigator.serviceWorker.getRegistrations()
      .then((registrations) => Promise.all([
        caches.open('aether-profile-test')
          .then((cache) => cache.match('/page-marker'))
          .then((stored) => stored ? stored.text() : null),
        caches.open('aether-profile-test')
          .then((cache) => cache.match('/service-worker-marker'))
          .then((stored) => stored ? stored.text() : null),
      ]).then(([cacheStorageMarker, serviceWorkerStorageMarker]) => ({
        cookie,
        localStorageMarker,
        indexedDbMarker,
        serviceWorkerRegistration: registrations.some((registration) => (
          registration.active?.scriptURL.includes('marker=${marker}')
        )),
        cacheStorageMarker,
        serviceWorkerStorageMarker,
      }))));
})()`;
    return contents.executeJavaScript(verifyScript, true);
  }

  const seedScript = `(() => {
  document.cookie = ${JSON.stringify(`aether_profile_marker=${marker}; Path=/; SameSite=Lax`)};
  localStorage.setItem('aether-profile-marker', ${JSON.stringify(marker)});
  return (${indexedDbOperation(marker, 'seed')})
    .then(() => caches.open('aether-profile-test')
      .then((cache) => cache.put('/page-marker', new Response(${JSON.stringify(marker)}))))
    .then(() => navigator.serviceWorker.register(
      '/worker.js?marker=${marker}',
      { scope: '/' },
    ))
    .then(() => navigator.serviceWorker.ready)
    .then(() => new Promise((resolve) => setTimeout(resolve, 100)))
    .then(() => true);
})()`;
  return contents.executeJavaScript(seedScript, true);
}

async function main() {
  const config = readConfig();
  app.setName('AETHER Profile Storage Runtime Test');
  app.setPath('userData', config.userDataPath);
  await app.whenReady();
  const profiles = new AetherProfiles(config.userDataPath);
  if (profiles.startupProfileId !== config.profileId) {
    throw new Error('The runtime test profile selection does not match the registry.');
  }
  const partition = profilePartition(config.profileId);
  let profileSession;
  try {
    profileSession = session.fromPartition(partition);
    if (!profileSession) throw new Error('Electron returned no persistent profile session.');
  } catch (error) {
    throw new Error(`Could not initialize the test profile session for ${config.profileId}.`, {
      cause: error,
    });
  }
  installRestrictivePolicies(profileSession);
  await installTestProtocol(profileSession);
  const storagePath = profileSession.getStoragePath();
  if (typeof storagePath !== 'string' || !path.isAbsolute(storagePath)) {
    throw new Error('Electron did not report a persistent profile storage path.');
  }

  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      session: profileSession,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  const view = new WebContentsView({
    webPreferences: {
      session: profileSession,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  view.setBounds({ x: 0, y: 0, width: 800, height: 600 });
  window.contentView.addChildView(view);
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const allowFixtureOnly = (_event, url) => {
    if (!url.startsWith(`${TEST_ORIGIN}/`)) _event.preventDefault();
  };
  view.webContents.on('will-navigate', allowFixtureOnly);
  view.webContents.on('will-redirect', allowFixtureOnly);
  await view.webContents.loadURL(TEST_URL);
  const storageResult = await evaluateStorage(view.webContents, config);
  if (config.operation === 'seed' && storageResult !== true) {
    throw new Error('The storage fixture did not finish writing its markers.');
  }

  const categories = config.operation === 'seed'
    ? {
      cookies: 'seeded',
      localStorage: 'seeded',
      indexedDB: 'seeded',
      serviceWorkerRegistration: 'seeded',
      serviceWorkerStorage: 'seeded',
      cacheStorage: 'seeded',
      crossProfileIsolation: 'not-checked',
      httpCache: 'unverified',
    }
    : {
      cookies: storageResult.cookie === `aether_profile_marker=${config.expectedMarker}`,
      localStorage: storageResult.localStorageMarker === config.expectedMarker,
      indexedDB: storageResult.indexedDbMarker === config.expectedMarker,
      serviceWorkerRegistration: storageResult.serviceWorkerRegistration,
      serviceWorkerStorage: storageResult.serviceWorkerStorageMarker === config.expectedMarker,
      cacheStorage: storageResult.cacheStorageMarker === config.expectedMarker,
      crossProfileIsolation: [
        storageResult.cookie,
        storageResult.localStorageMarker,
        storageResult.indexedDbMarker,
        storageResult.serviceWorkerStorageMarker,
        storageResult.cacheStorageMarker,
      ].every((value) => value !== config.otherMarker),
      httpCache: 'unverified',
    };
  if (Object.values(categories).some((value) => value === false)) {
    throw new Error(`Profile storage assertions failed: ${JSON.stringify(categories)}`);
  }
  const report = {
    profileId: config.profileId,
    partition,
    storagePath,
    operation: config.operation,
    electronVersion: process.versions.electron,
    chromiumVersion: process.versions.chrome,
    categories,
  };
  require('node:fs').writeFileSync(config.reportPath, JSON.stringify(report), { mode: 0o600 });
  await new Promise((resolve) => {
    window.once('closed', resolve);
    window.contentView.removeChildView(view);
    view.webContents.close();
    window.close();
  });
  app.quit();
}

main().catch((error) => {
  console.error(error);
  app.exit(1);
});
