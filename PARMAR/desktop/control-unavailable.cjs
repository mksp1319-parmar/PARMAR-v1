'use strict';

const button = document.querySelector('#open-aether');
const status = document.querySelector('#aether-desktop-status');
const bridge = window.parmarAetherDesktop;

if (button && status && bridge) {
  button.addEventListener('click', async () => {
    button.disabled = true;
    status.textContent = 'Opening the restricted AETHER shell.';
    try {
      const result = await bridge.openBrowser();
      if (!result?.ok) throw new Error(result?.error || 'AETHER could not be opened.');
      status.textContent = 'AETHER is open in restricted mode. Remote browsing is disabled.';
    } catch (error) {
      status.textContent = error instanceof Error
        ? `AETHER is unavailable: ${error.message}`
        : 'AETHER is unavailable.';
    } finally {
      button.disabled = false;
    }
  });
} else if (status) {
  status.textContent = 'The AETHER desktop bridge is unavailable; remote browsing remains disabled.';
}
