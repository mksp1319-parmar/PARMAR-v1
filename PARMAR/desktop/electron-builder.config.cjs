'use strict';

module.exports = {
  appId: 'com.parmar.aether',
  productName: 'PARMAR AETHER',
  asar: true,
  publish: null,
  directories: {
    output: 'dist',
  },
  files: [
    'main.cjs',
    'broker-protocol.cjs',
    'browser-child-broker.cjs',
    'browser-child-supervisor.cjs',
    'browser-preload.cjs',
    'browser-renderer.cjs',
    'browser.css',
    'browser.html',
    'control-preload.cjs',
    'control-unavailable.cjs',
    'control-unavailable.html',
    'isolation-launcher.cjs',
    'isolation-probe.cjs',
    'newtab.html',
    'package.json',
    'security.cjs',
    'store.cjs',
  ],
  extraResources: [
    {
      from: '../interface/static/assets/parmar-emblem.png',
      to: 'aether/parmar-emblem.png',
    },
  ],
  linux: {
    category: 'Network',
    executableArgs: [],
    icon: '../interface/static/assets/parmar-emblem.png',
    syncDesktopName: true,
    target: ['AppImage'],
  },
};