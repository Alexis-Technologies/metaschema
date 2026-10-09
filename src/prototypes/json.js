const { issues } = require('../issues.js');

const json = {
  kind: 'struct',

  construct() {},

  compile() {
    const { required } = this;
    return (value, context, key) => {
      if (value !== null && typeof value === 'object') return;
      if (!required && (value === null || value === undefined)) return;
      issues.type(context, 'object', value, key);
    };
  },
};

module.exports = { json };
