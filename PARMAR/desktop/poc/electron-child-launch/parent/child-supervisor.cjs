'use strict';

const { EventEmitter } = require('node:events');
const { TextDecoder } = require('node:util');

const MAX_PROTOCOL_LINE_BYTES = 4096;
const MAX_STDERR_RECORD_BYTES = 4096;

class ChildSupervisor extends EventEmitter {
  constructor({
    spawnChild,
    executablePath,
    childAppPath,
    childEntryPoint,
    resourcesPath,
    electronVersion,
    parentPid,
    startupTimeoutMs = 15000,
    terminationGraceMs = 3000,
    forceExitTimeoutMs = 2000,
    record = () => {},
  }) {
    super();
    this.spawnChild = spawnChild;
    this.executablePath = executablePath;
    this.childAppPath = childAppPath;
    this.childEntryPoint = childEntryPoint;
    this.resourcesPath = resourcesPath;
    this.electronVersion = electronVersion;
    this.parentPid = parentPid;
    this.startupTimeoutMs = startupTimeoutMs;
    this.terminationGraceMs = terminationGraceMs;
    this.forceExitTimeoutMs = forceExitTimeoutMs;
    this.record = record;
    this.child = null;
    this.state = 'not-started';
    this.protocolBuffer = Buffer.alloc(0);
    this.protocolDecoder = new TextDecoder('utf-8', { fatal: true });
    this.shutdownPromise = null;
    this.startupTimer = null;
    this.terminationTimer = null;
    this.forceExitTimer = null;
    this.forcedTermination = false;
    this.failureStatus = 0;
    this.readyResolve = null;
    this.readyReject = null;
    this.completionResolve = null;
    this.completionPromise = new Promise((resolve) => {
      this.completionResolve = resolve;
    });
  }

  start() {
    if (this.state !== 'not-started') {
      return Promise.reject(new Error('Child supervisor can only be started once.'));
    }
    this.state = 'starting';
    const readyPromise = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });

    try {
      this.child = this.spawnChild();
    } catch (error) {
      this.failStartup('spawn-error', error.message);
      return readyPromise;
    }

    if (!this.child) {
      this.failStartup('spawn-contract-error', 'Child process handle is incomplete.');
      return readyPromise;
    }

    this.record('child-spawned', { childPid: this.child.pid ?? null });
    if (this.child.stdout?.on) {
      this.child.stdout.on('data', (chunk) => this.consumeProtocolChunk(chunk));
    }
    if (this.child.stderr?.on) {
      this.child.stderr.on('data', (chunk) => {
        const text = Buffer.from(chunk).subarray(0, MAX_STDERR_RECORD_BYTES).toString('utf8');
        this.record('child-stderr', {
          childPid: this.child?.pid ?? null,
          text,
          truncated: Buffer.byteLength(chunk) > MAX_STDERR_RECORD_BYTES,
        });
      });
    }
    this.child.once?.('error', (error) => {
      this.record('child-process-error', { reason: error.message });
      if (this.state === 'starting') {
        this.failStartup('spawn-error', error.message);
        if (this.child.pid === undefined) this.handleExit(null, null);
      }
      else if (this.state === 'ready') this.requestShutdown('child-process-error', 1);
    });
    this.child.once?.('exit', (code, signal) => this.handleExit(code, signal));
    this.child.once?.('close', (code, signal) => {
      if (this.state !== 'exited') this.handleExit(code, signal);
    });
    if (typeof this.child.kill !== 'function' || !this.child.stdout?.on
        || !this.child.stderr?.on || typeof this.child.once !== 'function') {
      this.failStartup('spawn-contract-error', 'Child process handle is incomplete.');
    }
    if (this.state !== 'starting') return readyPromise;
    this.startupTimer = setTimeout(() => {
      if (this.state !== 'starting') return;
      this.failStartup('startup-timeout', 'Child did not report readiness before the deadline.');
    }, this.startupTimeoutMs);
    return readyPromise;
  }

  consumeProtocolChunk(chunk) {
    if (!Buffer.isBuffer(chunk)) chunk = Buffer.from(chunk);
    if (this.state !== 'starting') {
      if (this.state === 'ready') {
        this.protocolFailure('Unexpected output after readiness.');
      } else {
        this.record('protocol-error', {
          childPid: this.child?.pid ?? null,
          reason: 'Unexpected output after readiness or during shutdown.',
        });
      }
      return;
    }

    if (this.protocolBuffer.length + chunk.length > MAX_PROTOCOL_LINE_BYTES + 1) {
      this.protocolFailure('Protocol output exceeded the size limit.');
      return;
    }
    this.protocolBuffer = Buffer.concat([this.protocolBuffer, chunk]);
    if (this.protocolBuffer.length > MAX_PROTOCOL_LINE_BYTES
        && !this.protocolBuffer.includes(0x0a)) {
      this.protocolFailure('Protocol message exceeded the size limit.');
      return;
    }

    while (this.state === 'starting') {
      const newline = this.protocolBuffer.indexOf(0x0a);
      if (newline === -1) break;
      if (newline > MAX_PROTOCOL_LINE_BYTES) {
        this.protocolFailure('Protocol message exceeded the size limit.');
        return;
      }
      const line = this.protocolBuffer.subarray(0, newline);
      this.protocolBuffer = this.protocolBuffer.subarray(newline + 1);
      this.consumeProtocolLine(line);
    }

    if (this.state === 'starting' && this.protocolBuffer.length > MAX_PROTOCOL_LINE_BYTES) {
      this.protocolFailure('Protocol message exceeded the size limit.');
    }
  }

  consumeProtocolLine(line) {
    let message;
    try {
      message = JSON.parse(this.protocolDecoder.decode(line));
    } catch {
      this.protocolFailure('Malformed child protocol message.');
      return;
    }

    const expectedKeys = message?.event === 'ready'
      ? [
        'protocol',
        'component',
        'event',
        'electronVersion',
        'executablePath',
        'entryPoint',
        'appPath',
        'resourcesPath',
        'pid',
        'parentPid',
        'localPage',
      ]
      : [
        'protocol',
        'component',
        'event',
        'electronVersion',
        'executablePath',
        'entryPoint',
        'appPath',
        'resourcesPath',
        'pid',
        'parentPid',
        'reason',
      ];
    const actualKeys = message && typeof message === 'object' && !Array.isArray(message)
      ? Object.keys(message).sort()
      : [];
    if (!message || typeof message !== 'object' || Array.isArray(message)
        || JSON.stringify(actualKeys) !== JSON.stringify([...expectedKeys].sort())
        || message.protocol !== 1
        || message.component !== 'aether-child-poc'
        || !['ready', 'startup-failed'].includes(message.event)
        || message.electronVersion !== this.electronVersion
        || message.executablePath !== this.executablePath
        || message.entryPoint !== this.childEntryPoint
        || message.appPath !== this.childAppPath
        || message.resourcesPath !== this.resourcesPath
        || message.pid !== this.child.pid
        || message.parentPid !== this.parentPid) {
      this.protocolFailure('Unexpected child identity or event.');
      return;
    }

    if (message.event === 'ready'
        && message.localPage !== require('node:path').join(this.childAppPath, 'index.html')) {
      this.protocolFailure('Unexpected child readiness page.');
      return;
    }

    if (message.event === 'startup-failed') {
      if (typeof message.reason !== 'string' || message.reason.length === 0
          || message.reason.length > 1024) {
        this.protocolFailure('Invalid child startup-failure message.');
        return;
      }
      this.failStartup('child-startup-failed', message.reason);
      return;
    }

    if (this.protocolBuffer.length > 0) {
      this.protocolFailure('Unexpected data followed the readiness message.');
      return;
    }

    clearTimeout(this.startupTimer);
    this.state = 'ready';
    this.record('child-ready', { childPid: this.child.pid, message });
    this.readyResolve(message);
    this.emit('ready', message);
  }

  protocolFailure(reason) {
    if (this.state === 'starting') {
      this.failStartup('protocol-error', reason);
      return;
    }
    if (this.state === 'ready') {
      this.record('protocol-error', { childPid: this.child?.pid ?? null, reason });
      this.requestShutdown('protocol-error', 1);
    }
  }

  failStartup(kind, reason) {
    if (this.state !== 'starting') return;
    clearTimeout(this.startupTimer);
    this.state = 'startup-failed';
    const error = new Error(reason);
    error.code = kind;
    this.record('startup-failed', { kind, reason, childPid: this.child?.pid ?? null });
    this.readyReject(error);
    this.requestShutdown(kind, 1);
  }

  requestShutdown(reason, failureStatus = 0) {
    this.failureStatus = Math.max(this.failureStatus, failureStatus);
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shutdownPromise = new Promise((resolve) => {
      this.shutdownResolve = resolve;
    });

    if (!this.child || this.state === 'exited') {
      this.state = 'exited';
      const result = { code: null, signal: null, failureStatus };
      this.shutdownResolve(result);
      this.completionResolve(result);
      this.emit('exit', result);
      return this.shutdownPromise;
    }

    if (typeof this.child.kill !== 'function' || typeof this.child.once !== 'function') {
      const result = {
        code: null,
        signal: null,
        failureStatus: 1,
        processStillRunning: true,
      };
      this.record('child-exit-unconfirmed', { childPid: this.child.pid ?? null });
      this.state = 'exit-unconfirmed';
      this.shutdownResolve(result);
      this.completionResolve(result);
      this.emit('exit', result);
      return this.shutdownPromise;
    }

    this.state = this.state === 'startup-failed' ? 'startup-failed' : 'stopping';
    this.record('shutdown-requested', {
      childPid: this.child.pid ?? null,
      reason,
      signal: 'SIGTERM',
    });
    this.child.kill('SIGTERM');
    this.terminationTimer = setTimeout(() => {
      if (this.state === 'exited') return;
      this.record('graceful-shutdown-failed', {
        childPid: this.child?.pid ?? null,
        gracePeriodMs: this.terminationGraceMs,
      });
      this.forcedTermination = true;
      this.child.kill('SIGKILL');
      this.forceExitTimer = setTimeout(() => {
        if (this.state === 'exited') return;
        const result = { code: null, signal: null, failureStatus: 1, processStillRunning: true };
        this.record('child-exit-unconfirmed', { childPid: this.child?.pid ?? null });
        this.state = 'exit-unconfirmed';
        this.shutdownResolve(result);
        this.completionResolve(result);
        this.emit('exit', result);
      }, this.forceExitTimeoutMs);
    }, this.terminationGraceMs);
    return this.shutdownPromise;
  }

  stop(reason = 'parent-requested') {
    if (this.state === 'starting') {
      this.failStartup('parent-shutdown-before-ready', reason);
      return this.shutdownPromise;
    }
    return this.requestShutdown(reason, this.state === 'ready' ? 0 : 1);
  }

  handleExit(code, signal) {
    if (this.state === 'exited') return;
    clearTimeout(this.startupTimer);
    clearTimeout(this.terminationTimer);
    clearTimeout(this.forceExitTimer);
    const wasStarting = this.state === 'starting';
    const hadFailedStartup = this.state === 'startup-failed';
    const normalAfterReady = this.state === 'ready' && code === 0 && signal === null;
    const gracefulRequestedExit = this.state === 'stopping'
      && !this.forcedTermination
      && (code === 0 || signal === 'SIGTERM');
    this.state = 'exited';

    if (this.protocolBuffer.length > 0 && !hadFailedStartup) {
      this.record('protocol-error', { reason: 'Child exited with an unterminated protocol message.' });
    }

    this.record('child-exit', {
      childPid: this.child?.pid ?? null,
      code,
      signal,
      afterReadiness: !wasStarting && !hadFailedStartup,
      expected: hadFailedStartup || normalAfterReady || gracefulRequestedExit,
    });
    if (wasStarting) {
      const error = new Error(`Child exited before readiness (code=${code}, signal=${signal}).`);
      error.code = 'child-exited-before-ready';
      this.record('startup-failed', {
        kind: error.code,
        reason: error.message,
        childPid: this.child?.pid ?? null,
      });
      this.readyReject(error);
    }

    const failureStatus = Math.max(this.failureStatus, hadFailedStartup || wasStarting || this.forcedTermination
      || (!normalAfterReady && !gracefulRequestedExit && !wasStarting)
      ? 1
      : 0);
    const result = { code, signal, failureStatus };
    if (this.shutdownResolve) this.shutdownResolve(result);
    this.completionResolve(result);
    this.emit('exit', result);
  }

  waitForExit() {
    return this.completionPromise;
  }
}

module.exports = {
  ChildSupervisor,
  MAX_PROTOCOL_LINE_BYTES,
};
