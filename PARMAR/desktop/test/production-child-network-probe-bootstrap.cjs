'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, WebContentsView } = require('electron');

if (process.argv.includes('--aether-browser-child')) {
  const probeConfigurationPath = path.join(__dirname, 'production-network-probe-config.json');
  if (fs.existsSync(probeConfigurationPath)) {
    const probeConfiguration = JSON.parse(fs.readFileSync(probeConfigurationPath, 'utf8'));
    if (
      !probeConfiguration
      || Object.keys(probeConfiguration).sort().join(',')
        !== 'chromiumConfiguration,networkConfiguration,version'
      || probeConfiguration.version !== 1
    ) {
      throw new Error('The test-only production network probe configuration is invalid.');
    }
    process.env.PARMAR_AETHER_PRODUCTION_NETWORK_PROBE = '1';
    process.env.PARMAR_AETHER_PRODUCTION_NETWORK_PROBE_TARGETS = JSON.stringify(
      probeConfiguration.networkConfiguration,
    );
    process.env.PARMAR_AETHER_PRODUCTION_CHROMIUM_PROBE_TARGETS = JSON.stringify(
      probeConfiguration.chromiumConfiguration,
    );
  }
}

if (process.env.PARMAR_AETHER_PRODUCTION_CHROMIUM_PROBE_TARGETS !== undefined) {
  for (const name of [
    'disable-background-networking',
    'disable-component-update',
    'disable-sync',
    'no-first-run',
  ]) {
    app.commandLine.appendSwitch(name);
  }
}

if (process.argv.includes('--aether-browser-child')) {
  const isolationProbe = require('../isolation-probe.cjs');
  const {
    readProbeConfiguration,
    runProductionNetworkProbe,
  } = require('../production-network-probe.cjs');
  const configuration = readProbeConfiguration();
  if (!configuration) {
    throw new Error('The test-only production child network probe is not configured.');
  }

  const verifyCurrentIsolation = isolationProbe.verifyCurrentIsolation;
  isolationProbe.verifyCurrentIsolation = (...arguments_) => {
    const isolation = verifyCurrentIsolation(...arguments_);
    runProductionNetworkProbe(isolation).catch((error) => {
      process.stderr.write(`AETHER production-child network probe failed: ${error.message}\n`);
      fs.appendFileSync(configuration.reportPath, `${JSON.stringify({
        error: error instanceof Error ? error.message : 'The production child probe failed.',
        event: 'production-network-probe-error',
        pid: process.pid,
        runId: configuration.runId,
      })}\n`, { encoding: 'utf8', flag: 'a', mode: 0o600 });
    });
    return isolation;
  };

  const rendererProbeValue = process.env.PARMAR_AETHER_PRODUCTION_CHROMIUM_PROBE_TARGETS;
  if (rendererProbeValue !== undefined) {
    const rendererConfiguration = JSON.parse(rendererProbeValue);
    if (
      !rendererConfiguration
      || Object.keys(rendererConfiguration).sort().join(',') !== 'reportPath,runId,targets,version'
      || rendererConfiguration.version !== 1
      || typeof rendererConfiguration.runId !== 'string'
      || !/^[a-f0-9]{24}$/.test(rendererConfiguration.runId)
      || !Array.isArray(rendererConfiguration.targets)
      || rendererConfiguration.targets.length !== 5
      || typeof rendererConfiguration.reportPath !== 'string'
      || !path.isAbsolute(rendererConfiguration.reportPath)
    ) {
      throw new Error('The test-only Chromium renderer probe configuration is invalid.');
    }
    const reportPath = path.resolve(rendererConfiguration.reportPath);
    const reportDirectory = path.dirname(reportPath);
    const directoryStat = fs.lstatSync(reportDirectory);
    const realDirectory = fs.realpathSync(reportDirectory);
    const temporaryPrefix = `${path.join(fs.realpathSync(os.tmpdir()), 'parmar-aether-ui-probe-')}`;
    if (
      !directoryStat.isDirectory()
      || directoryStat.isSymbolicLink()
      || !realDirectory.startsWith(temporaryPrefix)
      || path.basename(reportPath) !== 'production-chromium-network-probe.jsonl'
    ) {
      throw new Error('The Chromium renderer probe report must be in its test temporary directory.');
    }

    const targets = rendererConfiguration.targets.map((target) => {
      if (
        !target
        || Object.keys(target).sort().join(',') !== 'host,name,path,port,protocol'
        || !['http', 'ipv6-http', 'redirect', 'redirect-target', 'websocket'].includes(target.name)
        || !['http', 'ws'].includes(target.protocol)
        || typeof target.path !== 'string'
        || !target.path.startsWith('/')
        || !Number.isSafeInteger(target.port)
        || target.port < 1
        || target.port > 65535
        || !['127.0.0.1', '::1'].includes(target.host)
        || (target.name === 'ipv6-http') !== (target.host === '::1')
        || (target.name === 'websocket') !== (target.protocol === 'ws')
      ) {
        throw new Error('A test-only Chromium renderer probe target is invalid.');
      }
      return { ...target };
    });
    if (new Set(targets.map(({ name }) => name)).size !== 5) {
      throw new Error('The Chromium renderer probe must contain each unique controlled target.');
    }

    const expectedNewTabUrl = require('node:url').pathToFileURL(
      path.join(__dirname, '..', 'newtab.html'),
    ).href;
    const instrumentedTabContents = new WeakSet();
    const originalSetBounds = WebContentsView.prototype.setBounds;
    WebContentsView.prototype.setBounds = function setBoundsWithTabProbe(...arguments_) {
      const contents = this.webContents;
      if (!instrumentedTabContents.has(contents)) {
        instrumentedTabContents.add(contents);
        const startWhenLoaded = () => {
          if (contents.getURL() !== expectedNewTabUrl) return;
          startTabRendererProbe(contents, {
            expectedNewTabUrl,
            reportPath,
            runId: rendererConfiguration.runId,
            targets,
          });
        };
        contents.on('did-finish-load', startWhenLoaded);
        setImmediate(startWhenLoaded);
      }
      return originalSetBounds.apply(this, arguments_);
    };

    const originalLoadFile = BrowserWindow.prototype.loadFile;
    BrowserWindow.prototype.loadFile = function loadFileWithRendererProbe(filePath, ...arguments_) {
      const expectedBrowserHtml = path.join(__dirname, '..', 'browser.html');
      const isBrowserWindow = path.resolve(filePath) === expectedBrowserHtml;
      const loaded = originalLoadFile.call(this, filePath, ...arguments_);
      if (!isBrowserWindow) return loaded;
      return loaded.then((result) => {
        const probeScript = `(() => {
          const targets = ${JSON.stringify(targets)};
          const results = [];
          window.__AETHER_TEST_PROBE_RESULTS__ = results;
          const record = (result) => results.push(result);
          const fetchProbe = (target) => {
            const url = target.protocol + '://' + (target.host.includes(':') ? '[' + target.host + ']' : target.host)
              + ':' + target.port + target.path;
            fetch(url, {
              cache: 'no-store',
              mode: 'no-cors',
              redirect: 'follow',
              signal: AbortSignal.timeout(6000),
            }).then((response) => {
              record({ name: target.name, outcome: 'response', status: response.status, type: response.type });
            }).catch((error) => {
              record({ name: target.name, outcome: 'error', error: error.name });
            });
          };
          const websocketProbe = (target) => {
            let settled = false;
            const finish = (outcome, error = null) => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              record({ name: target.name, outcome, error });
            };
            const url = target.protocol + '://' + (target.host.includes(':') ? '[' + target.host + ']' : target.host)
              + ':' + target.port + target.path;
            const socket = new WebSocket(url);
            const timer = setTimeout(() => {
              socket.close();
              finish('timeout');
            }, 8000);
            socket.addEventListener('open', () => finish('open'), { once: true });
            socket.addEventListener('error', () => finish('error'), { once: true });
          };
          fetchProbe(targets.find(({ name }) => name === 'http'));
          fetchProbe(targets.find(({ name }) => name === 'ipv6-http'));
          fetchProbe(targets.find(({ name }) => name === 'redirect'));
          websocketProbe(targets.find(({ name }) => name === 'websocket'));
          return true;
        })()`;
        const browserWindow = this;
        setImmediate(() => {
          const debuggerApi = browserWindow.webContents.debugger;
          const targetUrls = new Set(targets.map((target) => (
            `${target.protocol}://${target.host === '::1' ? `[${target.host}]` : target.host}:${target.port}${target.path}`
          )));
          const requestIds = new Set();
          const recordNetworkEvent = (_event, method, parameters) => {
            if (
              !method.startsWith('Network.')
              && method !== 'Runtime.consoleAPICalled'
              && method !== 'Log.entryAdded'
            ) return;
            const requestId = parameters.requestId;
            const url = parameters.request?.url || parameters.url;
            if (method === 'Network.requestWillBeSent' && targetUrls.has(url)) {
              requestIds.add(requestId);
            }
            if (method === 'Network.webSocketCreated' && targetUrls.has(url)) {
              requestIds.add(requestId);
            }
            fs.appendFileSync(reportPath, `${JSON.stringify({
              event: 'production-chromium-network-event',
              runId: rendererConfiguration.runId,
              mainPid: process.pid,
              rendererPid: browserWindow.webContents.getOSProcessId(),
              method,
              parameters,
              timestamp: new Date().toISOString(),
            })}\n`, { encoding: 'utf8', flag: 'a', mode: 0o600 });
          };
          const writeProbeFailure = (error) => {
            fs.appendFileSync(reportPath, `${JSON.stringify({
              event: 'production-chromium-renderer-network-probe-error',
              runId: rendererConfiguration.runId,
              error: error instanceof Error ? error.message : 'The renderer probe failed.',
              timestamp: new Date().toISOString(),
            })}\n`, { encoding: 'utf8', flag: 'a', mode: 0o600 });
          };
          try {
            debuggerApi.attach('1.3');
            debuggerApi.on('message', recordNetworkEvent);
            Promise.all([
              debuggerApi.sendCommand('Network.enable'),
              debuggerApi.sendCommand('Runtime.enable'),
              debuggerApi.sendCommand('Log.enable'),
            ])
              .then(() => debuggerApi.sendCommand('Runtime.evaluate', {
                expression: probeScript,
                awaitPromise: false,
                returnByValue: true,
              }))
              .then(async (evaluation) => {
                if (evaluation.exceptionDetails) {
                  throw new Error(`Renderer probe evaluation failed: ${JSON.stringify(evaluation.exceptionDetails)}`);
                }
                if (evaluation.result?.value !== true) {
                  throw new Error('The renderer probe did not start.');
                }
                fs.appendFileSync(reportPath, `${JSON.stringify({
                  event: 'production-chromium-renderer-network-probe',
                  runId: rendererConfiguration.runId,
                  mainPid: process.pid,
                  rendererPid: browserWindow.webContents.getOSProcessId(),
                  metrics: app.getAppMetrics().map(({ pid, type }) => ({ pid, type })),
                  targets,
                  probeStarted: true,
                  rendererResultCollection: 'not-collected',
                  timestamp: new Date().toISOString(),
                })}\n`, { encoding: 'utf8', flag: 'a', mode: 0o600 });
              })
              .catch((error) => {
                writeProbeFailure(error);
                if (debuggerApi.isAttached()) debuggerApi.detach();
              });
          } catch (error) {
            writeProbeFailure(error);
            if (debuggerApi.isAttached()) debuggerApi.detach();
          }
        });
        return result;
      });
    };
  }
}

function startTabRendererProbe(contents, { expectedNewTabUrl, reportPath, runId, targets }) {
  const debuggerApi = contents.debugger;
  const requestIds = new Set();
  const websocketLifecycleEvents = new Set([
    'Network.webSocketFrameError',
    'Network.webSocketHandshakeResponseReceived',
    'Network.webSocketWillSendHandshakeRequest',
    'Network.webSocketClosed',
  ]);
  const targetUrls = new Set(targets.map((target) => (
    `${target.protocol}://${target.host === '::1' ? `[${target.host}]` : target.host}:${target.port}${target.path}`
  )));
  const rendererPid = contents.getOSProcessId();
  const recordEvent = (_event, method, parameters) => {
    if (!method.startsWith('Network.')) return;
    const url = parameters.request?.url || parameters.url;
    if (method === 'Network.requestWillBeSent' && targetUrls.has(url)) {
      requestIds.add(parameters.requestId);
    }
    if (method === 'Network.webSocketCreated' && targetUrls.has(url)) {
      requestIds.add(parameters.requestId);
    }
    if (
      !targetUrls.has(url)
      && !(
        requestIds.has(parameters.requestId)
        && (method === 'Network.loadingFailed' || websocketLifecycleEvents.has(method))
      )
    ) return;
    fs.appendFileSync(reportPath, `${JSON.stringify({
      event: 'production-chromium-tab-network-event',
      runId,
      mainPid: process.pid,
      rendererPid,
      tabWebContentsId: contents.id,
      tabUrl: expectedNewTabUrl,
      method,
      parameters,
      timestamp: new Date().toISOString(),
    })}\n`, { encoding: 'utf8', flag: 'a', mode: 0o600 });
  };
  const recordFailure = (error) => {
    fs.appendFileSync(reportPath, `${JSON.stringify({
      event: 'production-chromium-tab-renderer-probe-error',
      runId,
      mainPid: process.pid,
      rendererPid,
      tabWebContentsId: contents.id,
      error: error instanceof Error ? error.message : 'The tab renderer probe failed.',
      timestamp: new Date().toISOString(),
    })}\n`, { encoding: 'utf8', flag: 'a', mode: 0o600 });
  };
  const probeScript = `(() => {
    const targets = ${JSON.stringify(targets)};
    for (const target of targets.filter(({ name }) => (
      ['http', 'ipv6-http', 'redirect', 'websocket'].includes(name)
    ))) {
      const host = target.host.includes(':') ? '[' + target.host + ']' : target.host;
      const url = target.protocol + '://' + host + ':' + target.port + target.path;
      if (target.protocol === 'ws') {
        const socket = new WebSocket(url);
        socket.addEventListener('error', () => {}, { once: true });
      } else {
        fetch(url, { cache: 'no-store', mode: 'no-cors', redirect: 'follow' })
          .catch(() => {});
      }
    }
    return true;
  })()`;

  try {
    debuggerApi.attach('1.3');
    debuggerApi.on('message', recordEvent);
    Promise.all([
      debuggerApi.sendCommand('Network.enable'),
      debuggerApi.sendCommand('Runtime.enable'),
    ])
      .then(() => debuggerApi.sendCommand('Runtime.evaluate', {
        expression: probeScript,
        awaitPromise: false,
        returnByValue: true,
      }))
      .then((evaluation) => {
        if (evaluation.exceptionDetails) {
          throw new Error(`Tab renderer probe evaluation failed: ${JSON.stringify(evaluation.exceptionDetails)}`);
        }
        if (evaluation.result?.value !== true) {
          throw new Error('The tab renderer probe did not start.');
        }
        fs.appendFileSync(reportPath, `${JSON.stringify({
          event: 'production-chromium-tab-renderer-network-probe',
          runId,
          mainPid: process.pid,
          rendererPid,
          tabWebContentsId: contents.id,
          tabUrl: expectedNewTabUrl,
          webContentsViewIdentified: true,
          sessionPartitionPath: contents.session.getStoragePath(),
          metrics: app.getAppMetrics().map(({ pid, type }) => ({ pid, type })),
          targets,
          probeStarted: true,
          timestamp: new Date().toISOString(),
        })}\n`, { encoding: 'utf8', flag: 'a', mode: 0o600 });
      })
      .catch((error) => {
        recordFailure(error);
        if (debuggerApi.isAttached()) debuggerApi.detach();
      });
  } catch (error) {
    recordFailure(error);
    if (debuggerApi.isAttached()) debuggerApi.detach();
  }
}

require('../main.cjs');
