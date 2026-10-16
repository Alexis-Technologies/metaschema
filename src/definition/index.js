// The `./definition` subpath: the half of the core that builds schemas and
// models and reads them (their fields and metadata, the warnings of their
// definitions, `toJSON` and `toSnapshot`), without the half that validates.
// For a program that needs the definitions and their snapshots alone (the
// browser client of a codec built from them): `check`, `parse` and their
// kin say that the core entry is missing. The classes are the core's own,
// so a program that loads the core entry as well validates with these very
// schemas, and a bundle of both carries each module once.
const { constants, getKindMetadata } = require('../kinds.js');
const { Schema } = require('../schema.js');
const { Model } = require('../model.js');
const { SchemaDefinitionError } = require('../errors.js');

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
};
