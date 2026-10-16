const { constants, getKindMetadata } = require('./kinds.js');
// The core entry: the definition half (the classes) with the validation
// half installed into them (validation.js).
const { Schema, ValidationResult } = require('./validation.js');
const { Model } = require('./model.js');
const { SchemaDefinitionError } = require('./errors.js');

const { KIND, KIND_STORED, KIND_MEMORY, SCOPE, STORE, ALLOW } = constants;

module.exports = {
  KIND,
  KIND_STORED,
  KIND_MEMORY,
  SCOPE,
  STORE,
  ALLOW,
  getKindMetadata,
  Schema,
  Model,
  SchemaDefinitionError,
  ValidationResult,
};
