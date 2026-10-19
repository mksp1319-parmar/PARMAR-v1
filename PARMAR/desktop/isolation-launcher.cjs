'use strict';

const { randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const {
  authorizeBrokerMessage,
  createBrokerSession,
} = require('./broker-protocol.cjs');
const { verifyIsolationReport } = require('./isolation-probe.cjs');

const DESKTOP_DIRECTORY = __dirname;
const PROBE_PATH = path.join(DESKTOP_DIRECTORY, 'isolation-probe.cjs');
const DEFAULT_STARTUP_TIMEOUT_MS = 5000;
const COMMAND_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
const NAMESPACE_BOOTSTRAP = [
  'node="$1"; probe="$2"; parent_ns="$3"; ip_path="$4"; nft_path="$5"; setpriv="$6"; capability="$PARMAR_AETHER_BROKER_CAPABILITY"',
  'network="$("$node" "$probe" --verify-network "$parent_ns" "$ip_path" "$nft_path")" || exit 1',
  'export PARMAR_AETHER_VERIFIED_NETWORK="$network"',
  'export PARMAR_AETHER_BROKER_CAPABILITY="$capability"',
  'export PARMAR_AETHER_PARENT_NETNS="$parent_ns"',
  'export PARMAR_AETHER_IP_PATH="$ip_path"',
  'export PARMAR_AETHER_NFT_PATH="$nft_path"',
  'exec "$setpriv" --bounding-set=-all --inh-caps=-all --ambient-caps=-all --no-new-privs -- "$node" "$probe"',
].join('; ');

function executablePath(command, pathValue = COMMAND_PATH) {
  for (const directory of pathValue.split(path.delimiter)) {
    const candidate = path.join(directory, command);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error(`Required isolation command is unavailable: ${command}.`);
}

function validateOptions(options, platform) {
  if (platform !== 'linux') {
    throw new Error('The AETHER isolation prototype supports Linux only.');
  }
  if (!options || options.mode !== 'offline') {
    throw new Error('Only offline isolation mode is implemented; remote browsing is unavailable.');
  }
  if (Object.hasOwn(options, 'proxy')) {
    throw new Error('AETHER has no isolated proxy integration; proxy configuration is rejected.');
  }
  const timeout = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 60_000) {
    throw new TypeError('The isolation startup timeout must be between 100 and 60000 ms.');
  }
  return timeout;
}

function readNamespaceId(pid = 'self') {
  return fs.readlinkSync(`/proc/${pid}/ns/net`);
}

function readEffectiveUid(pid) {
  const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
  const line = status.split('\n').find((entry) => entry.startsWith('Uid:'));
  if (!line) throw new Error('The isolated child UID could not be verified.');
  const uid = Number(line.trim().split(/\s+/)[2]);
  if (!Number.isSafeInteger(uid) || uid < 0) throw new Error('The isolated child UID is invalid.');
  return uid;
}

function terminateProcessGroup(child, signal = 'SIGKILL') {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

function createLauncher({
  platform = process.platform,
  spawnProcess = spawn,
  resolveExecutable = executablePath,
  parentNamespace = readNamespaceId,
  brokerPeerUid = process.geteuid?.(),
  processUidReader = readEffectiveUid,
  killProcessGroup = terminateProcessGroup,
} = {}) {
  async function launch(options = {}) {
    const startupTimeoutMs = validateOptions(options, platform);
    if (!Number.isSafeInteger(brokerPeerUid) || brokerPeerUid < 0) {
      throw new Error('The AETHER broker requires a valid parent process UID.');
    }
    const unsharePath = resolveExecutable('unshare');
    const setprivPath = resolveExecutable('setpriv');
    const ipPath = resolveExecutable('ip');
    const nftPath = resolveExecutable('nft');
    const shellPath = resolveExecutable('sh');
    const parentNamespaceId = parentNamespace();
    const capability = randomBytes(32).toString('base64url');
    const child = spawnProcess(unsharePath, [
      '--user',
      '--map-root-user',
      '--net',
      '--',
      shellPath,
      '-c',
      NAMESPACE_BOOTSTRAP,
      'aether-isolation-bootstrap',
      process.execPath,
      PROBE_PATH,
      parentNamespaceId,
      ipPath,
      nftPath,
      setprivPath,
    ], {
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        PATH: COMMAND_PATH,
        PARMAR_AETHER_BROKER_CAPABILITY: capability,
      },
    });
    child.on('error', () => {});
    let childUid;
    try {
      if (!Number.isSafeInteger(child.pid) || child.pid < 1) {
        throw new Error('The isolated child process did not start.');
      }
      childUid = processUidReader(child.pid);
      if (childUid !== brokerPeerUid) {
        throw new Error('The isolated child is running under an unexpected UID.');
      }
    } catch (error) {
      killProcessGroup(child);
      await new Promise((resolve) => child.once('close', resolve));
      throw error;
    }

    const brokerSession = createBrokerSession(
      { pid: child.pid, uid: childUid },
      Date.now(),
      capability,
    );
    let groupCleanupError = null;
    let groupKillRequested = false;
    const killGroup = () => {
      if (groupKillRequested) return;
      groupKillRequested = true;
      try {
        killProcessGroup(child);
      } catch (error) {
        groupCleanupError = error;
      }
    };
    const output = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    let readyMessage = null;
    let statusReceived = false;
    let childError = '';
    let resolveReady;
    let rejectReady;
    let resolveClosed;
    let closeResult;
    const ready = new Promise((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const closed = new Promise((resolve) => {
      resolveClosed = resolve;
    });
    const startupTimer = setTimeout(() => {
      rejectReady(new Error('AETHER isolation startup timed out.'));
      killGroup();
    }, startupTimeoutMs);
    startupTimer.unref?.();

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      if (childError.length < 4096) childError += chunk.slice(0, 4096 - childError.length);
    });
    child.on('error', (error) => rejectReady(error));
    child.on('close', (code, signal) => {
      killGroup();
      closeResult = groupCleanupError
        ? { code, signal, cleanupError: groupCleanupError.message }
        : { code, signal };
      clearTimeout(startupTimer);
      if (!statusReceived) {
        rejectReady(new Error(
          `AETHER isolated startup failed${childError ? `: ${childError.trim()}` : ` (exit ${code ?? signal})`}.`,
        ));
      }
      resolveClosed(closeResult);
    });

    output.on('line', (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        rejectReady(new Error('AETHER isolation broker sent malformed data.'));
        killGroup();
        return;
      }
      if (message?.event === 'isolation.ready') {
        if (readyMessage) {
          rejectReady(new Error('AETHER isolation broker sent duplicate readiness.'));
          killGroup();
          return;
        }
        const actualNamespace = readNamespaceId(child.pid);
        if (
          actualNamespace !== message.snapshot?.namespaceId
          || message.snapshot?.parentNamespaceId !== parentNamespaceId
        ) {
          rejectReady(new Error('The isolated child namespace identity could not be verified.'));
          killGroup();
          return;
        }
        try {
          readyMessage = verifyIsolationReport(message.snapshot);
        } catch (error) {
          rejectReady(error);
          killGroup();
        }
        return;
      }

      let peerUid;
      try {
        peerUid = processUidReader(child.pid);
      } catch {
        rejectReady(new Error('AETHER broker peer identity could not be verified.'));
        killGroup();
        return;
      }
      const authorization = authorizeBrokerMessage(
        brokerSession,
        { pid: child.pid, uid: peerUid },
        line,
      );
      if (!authorization.ok) {
        rejectReady(new Error(`AETHER broker authorization failed: ${authorization.error}`));
        killGroup();
        return;
      }
      if (authorization.type === 'browser.status' && readyMessage && !statusReceived) {
        statusReceived = true;
        clearTimeout(startupTimer);
        try {
          sendBrokerMessage('browser.status');
        } catch (error) {
          rejectReady(error);
          killGroup();
          return;
        }
        resolveReady({
          isolation: readyMessage,
          pid: child.pid,
          state: 'ready',
        });
      }
    });

    let nextSequence = 0;
    const sendBrokerMessage = (type) => {
      if (child.stdin.destroyed || !child.stdin.writable) {
        throw new Error('AETHER isolation broker is disconnected.');
      }
      child.stdin.write(`${JSON.stringify({
        capability,
        payload: {},
        sequence: nextSequence++,
        type,
      })}\n`);
    };

    try {
      const startup = await ready;
      return {
        ...startup,
        closed,
        disconnect() {
          if (child.stdin.destroyed) return closed;
          child.stdin.end();
          const timeout = setTimeout(killGroup, 1000);
          return closed.finally(() => clearTimeout(timeout));
        },
        async stop() {
          if (closeResult) return closeResult;
          try {
            sendBrokerMessage('browser.stop');
          } catch (error) {
            killGroup();
            const result = await closed;
            if (result.cleanupError) {
              throw new Error(`AETHER process-group cleanup failed: ${result.cleanupError}`, { cause: error });
            }
            throw error;
          }
          const timeout = setTimeout(killGroup, 1000);
          try {
            const result = await closed;
            if (result.cleanupError) {
              throw new Error(`AETHER process-group cleanup failed: ${result.cleanupError}`);
            }
            return result;
          } finally {
            clearTimeout(timeout);
          }
        },
      };
    } catch (error) {
      clearTimeout(startupTimer);
      killGroup();
      const result = await closed;
      if (result.cleanupError) {
        throw new Error(`AETHER process-group cleanup failed: ${result.cleanupError}`, { cause: error });
      }
      throw error;
    }
  }

  return { launch };
}

const { launch } = createLauncher();

module.exports = {
  createLauncher,
  launchOfflineProbe: (options) => launch({ mode: 'offline', ...options }),
  terminateProcessGroup,
  validateOptions,
};
