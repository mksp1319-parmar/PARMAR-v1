'use strict';

const { randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const DISPLAY_SERVER_XVFB = 'xvfb';
const DISPLAY_SERVER_WESTON = 'weston-xwayland';
const IMAGE_MODE_LEGACY = 'legacy';
const IMAGE_MODE_MAGICK = 'magick';

function displayConfiguration(environment = process.env) {
  const backend = environment.PARMAR_AETHER_UI_DISPLAY_SERVER || DISPLAY_SERVER_XVFB;
  const imageMode = environment.PARMAR_AETHER_UI_IMAGE_MODE || IMAGE_MODE_LEGACY;
  if (![DISPLAY_SERVER_XVFB, DISPLAY_SERVER_WESTON].includes(backend)) {
    throw new Error(`Unsupported AETHER UI display server: ${backend}`);
  }
  if (![IMAGE_MODE_LEGACY, IMAGE_MODE_MAGICK].includes(imageMode)) {
    throw new Error(`Unsupported AETHER UI image mode: ${imageMode}`);
  }
  return { backend, imageMode };
}

function requiredExecutables({ backend, imageMode, toolDirectory = '/usr/bin' }) {
  const executables = [
    path.join(toolDirectory, backend === DISPLAY_SERVER_XVFB ? 'Xvfb' : 'weston'),
    path.join(toolDirectory, 'xdotool'),
    ...(imageMode === IMAGE_MODE_MAGICK
      ? [path.join(toolDirectory, 'magick')]
      : [path.join(toolDirectory, 'import'), path.join(toolDirectory, 'convert')]),
    '/usr/bin/unshare',
    '/usr/bin/setpriv',
  ];
  if (backend === DISPLAY_SERVER_WESTON) executables.push(path.join(toolDirectory, 'Xwayland'));
  return executables;
}

function imageCommand(operation, args, { imageMode, toolDirectory = '/usr/bin' }) {
  if (!['import', 'convert'].includes(operation)) {
    throw new Error(`Unsupported AETHER UI image operation: ${operation}`);
  }
  if (imageMode === IMAGE_MODE_MAGICK) {
    return {
      executable: path.join(toolDirectory, 'magick'),
      arguments: operation === 'import' ? ['import', ...args] : args,
    };
  }
  if (imageMode !== IMAGE_MODE_LEGACY) {
    throw new Error(`Unsupported AETHER UI image mode: ${imageMode}`);
  }
  return { executable: path.join(toolDirectory, operation), arguments: args };
}

function processGroupHasLiveMembers(groupId, procFs = fs) {
  const entries = procFs.readdirSync('/proc');
  return entries.some((entry) => {
    if (!/^\d+$/.test(entry)) return false;
    try {
      const stat = procFs.readFileSync(`/proc/${entry}/stat`, 'utf8');
      const match = stat.match(/^\d+ \(.*\) ([A-Z]) \d+ (\d+)/);
      return match && match[1] !== 'Z' && match[1] !== 'X' && Number(match[2]) === groupId;
    } catch (error) {
      if (['ENOENT', 'ESRCH'].includes(error.code)) return false;
      throw error;
    }
  });
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForProcessClose(server, timeoutMs) {
  if (server.exitCode !== null || server.signalCode !== null) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      server.removeListener('close', onClose);
      resolve(false);
    }, timeoutMs);
    const onClose = () => {
      clearTimeout(timer);
      resolve(true);
    };
    server.once('close', onClose);
  });
}

async function stopDisplay(session, {
  gracePeriodMs = 3000,
  killPeriodMs = 3000,
  signalProcessGroup = (groupId, signal) => process.kill(-groupId, signal),
  hasLiveGroupMembers = processGroupHasLiveMembers,
  sleepFor = sleep,
} = {}) {
  const { backend, server } = session;
  const serverRunning = () => server.exitCode === null && server.signalCode === null;
  const signalGroup = (signal) => {
    try {
      signalProcessGroup(server.pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  if (backend === DISPLAY_SERVER_WESTON) {
    if (!server.pid || server.pid === process.pid) {
      throw new Error('Refusing to signal an invalid Weston process group.');
    }
    if (serverRunning() || hasLiveGroupMembers(server.pid)) signalGroup('SIGTERM');
  } else if (serverRunning()) {
    server.kill('SIGTERM');
  }
  if (serverRunning() && !await waitForProcessClose(server, gracePeriodMs)) {
    if (backend === DISPLAY_SERVER_WESTON) signalGroup('SIGKILL');
    else server.kill('SIGKILL');
    if (!await waitForProcessClose(server, killPeriodMs)) {
      throw new Error(`${backend} did not exit during display cleanup.`);
    }
  }

  if (backend === DISPLAY_SERVER_WESTON) {
    let deadline = Date.now() + gracePeriodMs;
    while (hasLiveGroupMembers(server.pid) && Date.now() < deadline) {
      await sleepFor(50);
    }
    if (hasLiveGroupMembers(server.pid)) {
      signalGroup('SIGKILL');
      deadline = Date.now() + killPeriodMs;
      while (hasLiveGroupMembers(server.pid) && Date.now() < deadline) {
        await sleepFor(50);
      }
    }
    if (hasLiveGroupMembers(server.pid)) {
      throw new Error('Weston/Xwayland process-group cleanup left a live process.');
    }
  }
}

function createWestonEnvironment(environment, toolDirectory, runtimeDirectory) {
  const result = {
    ...environment,
    PATH: `${toolDirectory}${path.delimiter}${environment.PATH || ''}`,
    XDG_RUNTIME_DIR: runtimeDirectory,
  };
  delete result.DISPLAY;
  delete result.WAYLAND_DISPLAY;
  return result;
}

async function startHeadlessDisplay({
  backend = DISPLAY_SERVER_XVFB,
  toolDirectory = '/usr/bin',
  runtimeDirectory,
  environment = process.env,
  width = 1600,
  height = 1000,
  timeoutMs = 5000,
  spawnProcess = spawn,
  fileSystem = fs,
  signalProcessGroup,
  hasLiveGroupMembers,
  sleepFor,
} = {}) {
  if (backend === DISPLAY_SERVER_XVFB) {
    const server = spawnProcess(path.join(toolDirectory, 'Xvfb'), [
      '-displayfd', '1', '-screen', '0', `${width}x${height}x24`, '-nolisten', 'tcp', '-ac',
    ], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    return waitForXvfb({
      backend,
      server,
      timeoutMs,
      stopOptions: { signalProcessGroup, hasLiveGroupMembers, sleepFor },
    });
  }
  if (backend !== DISPLAY_SERVER_WESTON) {
    throw new Error(`Unsupported AETHER UI display server: ${backend}`);
  }
  if (!runtimeDirectory || !path.isAbsolute(runtimeDirectory)) {
    throw new Error('Weston requires an absolute, isolated XDG_RUNTIME_DIR.');
  }

  fileSystem.mkdirSync(runtimeDirectory, { recursive: true, mode: 0o700 });
  fileSystem.chmodSync(runtimeDirectory, 0o700);
  const waylandDisplay = `aether-${randomBytes(8).toString('hex')}`;
  const server = spawnProcess(path.join(toolDirectory, 'weston'), [
    '--backend=headless-backend.so',
    `--width=${width}`,
    `--height=${height}`,
    '--xwayland',
    `--socket=${waylandDisplay}`,
    '--no-config',
  ], {
    detached: true,
    env: createWestonEnvironment(environment, toolDirectory, runtimeDirectory),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return waitForWeston({
    backend,
    server,
    timeoutMs,
    waylandDisplay,
    runtimeDirectory,
    fileSystem,
    stopOptions: { signalProcessGroup, hasLiveGroupMembers, sleepFor },
  });
}

function attachOutput(stream, onData) {
  if (typeof stream.setEncoding === 'function') stream.setEncoding('utf8');
  stream.on('data', onData);
}

function waitForServer({ backend, server, timeoutMs, onData, stopOptions }) {
  return new Promise((resolve, reject) => {
    let output = '';
    let settled = false;
    let readinessPoll;
    const finish = async (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(readinessPoll);
      server.removeListener('error', onError);
      server.removeListener('exit', onExit);
      if (error) {
        try {
          await stopDisplay({ backend, server }, stopOptions);
        } catch (cleanupError) {
          error.message += `; startup cleanup failed: ${cleanupError.message}`;
        }
        reject(error);
      } else {
        resolve(result);
      }
    };
    const check = (chunk = '') => {
      output += chunk;
      try {
        const result = onData(output);
        if (result) void finish(null, result);
      } catch (error) {
        void finish(error);
      }
    };
    const onError = (error) => { void finish(error); };
    const onExit = (code, signal) => {
      void finish(new Error(`${backend} exited before readiness (${code ?? signal}). Output: ${output.trim()}`));
    };
    const timeout = setTimeout(() => {
      void finish(new Error(`${backend} readiness timed out after ${timeoutMs}ms. Output: ${output.trim()}`));
    }, timeoutMs);
    server.once('error', onError);
    server.once('exit', onExit);
    attachOutput(server.stdout, check);
    if (server.stderr) attachOutput(server.stderr, check);
    readinessPoll = setInterval(() => check(), 50);
  });
}

function waitForXvfb({ backend, server, timeoutMs, stopOptions }) {
  return waitForServer({
    backend,
    server,
    timeoutMs,
    stopOptions,
    onData(output) {
      const match = output.match(/(?:^|\n)(\d+)\r?\n/);
      if (!match) return null;
      const number = Number(match[1]);
      if (!Number.isSafeInteger(number) || number < 0) {
        throw new Error(`Xvfb returned an invalid display number: ${match[1]}`);
      }
      return { backend, server, display: `:${number}`, waylandDisplay: null, runtimeDirectory: null };
    },
  });
}

function waitForWeston({
  backend,
  server,
  timeoutMs,
  waylandDisplay,
  runtimeDirectory,
  fileSystem,
  stopOptions,
}) {
  return waitForServer({
    backend,
    server,
    timeoutMs,
    stopOptions,
    onData(output) {
      const match = output.match(/xserver listening on display\s+(:\d+)/i);
      if (!match) return null;
      try {
        if (!fileSystem.statSync(path.join(runtimeDirectory, waylandDisplay)).isSocket()) return null;
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
      return {
        backend,
        server,
        display: match[1],
        waylandDisplay,
        runtimeDirectory,
      };
    },
  });
}

module.exports = {
  DISPLAY_SERVER_WESTON,
  DISPLAY_SERVER_XVFB,
  IMAGE_MODE_LEGACY,
  IMAGE_MODE_MAGICK,
  displayConfiguration,
  imageCommand,
  processGroupHasLiveMembers,
  requiredExecutables,
  startHeadlessDisplay,
  stopDisplay,
};
