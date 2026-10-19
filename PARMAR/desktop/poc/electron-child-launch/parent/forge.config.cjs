'use strict';

const path = require('node:path');

module.exports = {
  packagerConfig: {
    name: 'ParmarChildLaunch',
    executableName: 'parmar-child-launch',
    asar: true,
    extraResource: [path.resolve(__dirname, '../aether-child')],
  },
  makers: [],
};
