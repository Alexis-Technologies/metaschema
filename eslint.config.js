'use strict';

const init = require('eslint-config-metarhia');

module.exports = [
  ...init,
  {
    files: ['tests/**/*.js'],
    rules: {
      strict: 'off',
    },
  },
];
