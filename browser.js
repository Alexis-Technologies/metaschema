'use strict';

const { constants, getKindMetadata } = require('./src/kinds.js');
const schema = require('./src/schema.js');
const model = require('./src/model.js');

module.exports = {
  ...constants,
  getKindMetadata,
  ...schema,
  ...model,
};
