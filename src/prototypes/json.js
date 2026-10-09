const { issue } = require('../util.js');

const json = {
  kind: 'struct',

  construct() {},

  checkType(value, path) {
    const isObject = value !== null && typeof value === 'object';
    if (!isObject) return issue('type', path, 'not of expected type: object');
    return null;
  },
};

module.exports = { json };
