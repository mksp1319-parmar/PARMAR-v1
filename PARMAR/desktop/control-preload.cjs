'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('parmarAetherDesktop', Object.freeze({
  getStatus: () => ipcRenderer.invoke('parmar-aether:status'),
  openBrowser: () => ipcRenderer.invoke('parmar-aether:open'),
}));
