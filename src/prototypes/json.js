const { issues } = require('../issues.js');

const json = {
  kind: 'struct',

  construct() {},

  checkValue(value, context) {
    const isObject = value !== null && typeof value === 'object';
    if (!isObject) issues.type(context, 'object', value);
  },
};

module.exports = { json };
