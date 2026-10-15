'use strict';

(() => {
  const bridge = window.parmarAetherDesktop;
  const button = document.querySelector('#aether-desktop-open');
  const status = document.querySelector('#aether-desktop-status');
  if (!bridge || !button || !status) return;

  const setStatus = (message) => {
    status.textContent = message;
    window.dispatchEvent(new CustomEvent('parmar-aether-status-changed'));
  };

  button.hidden = false;
  button.addEventListener('click', async () => {
    button.disabled = true;
    setStatus('Opening the restricted AETHER desktop shell.');
    try {
      const result = await bridge.openBrowser();
      if (!result?.ok) throw new Error(result?.error || 'AETHER could not be opened.');
      setStatus('AETHER desktop shell is open. Remote browsing remains disabled until network enforcement is verified.');
    } catch (error) {
      setStatus(error instanceof Error
        ? `AETHER is unavailable: ${error.message}`
        : 'AETHER is unavailable.');
    } finally {
      button.disabled = false;
    }
  });

  bridge.getStatus().then((result) => {
    if (result?.remoteBrowsing === false) {
      setStatus('AETHER desktop shell is available in restricted mode. Remote browsing is disabled because its operating-system network boundary is not verified.');
    }
  }).catch(() => {
    setStatus('AETHER desktop status could not be verified; remote browsing remains unavailable.');
  });
})();
