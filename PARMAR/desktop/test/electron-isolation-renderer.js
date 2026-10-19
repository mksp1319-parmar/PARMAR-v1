'use strict';

const endpoints = JSON.parse(
  new URLSearchParams(window.location.search).get('targets') || '[]',
);

window.__AETHER_TEST_PROBES__ = Promise.all(endpoints.map(async (endpoint) => {
  try {
    const response = await fetch(endpoint, { cache: 'no-store', mode: 'cors' });
    return { endpoint, connected: true, status: response.status };
  } catch (error) {
    return { endpoint, connected: false, error: String(error) };
  }
}));

const redirectEndpoints = JSON.parse(
  new URLSearchParams(window.location.search).get('redirects') || '[]',
);
window.__AETHER_TEST_REDIRECT_PROBES__ = Promise.all(
  redirectEndpoints.map(async (endpoint) => {
    try {
      const response = await fetch(endpoint, { cache: 'no-store', mode: 'cors' });
      return { endpoint, connected: true, status: response.status };
    } catch (error) {
      return { endpoint, connected: false, error: String(error) };
    }
  }),
);

const websocketEndpoints = JSON.parse(
  new URLSearchParams(window.location.search).get('websockets') || '[]',
);
window.__AETHER_TEST_WEBSOCKET_PROBES__ = Promise.all(
  websocketEndpoints.map((endpoint) => new Promise((resolve) => {
    let settled = false;
    const socket = new WebSocket(endpoint);
    const finish = (connected, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.close();
      resolve({ endpoint, connected, ...(error ? { error } : {}) });
    };
    const timeout = setTimeout(() => finish(false, 'timeout'), 2000);
    socket.addEventListener('open', () => finish(true));
    socket.addEventListener('error', () => finish(false, 'connection failed'));
  })),
);
