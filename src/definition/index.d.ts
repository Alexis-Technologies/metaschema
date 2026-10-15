// The `@alexify/metaschema/definition` subpath: the core's own Schema and
// Model, built and read without the half that validates. Until the core
// entry is loaded as well, `check`, `checkAsync`, `parse`, `parseAsync`,
// `serialize`, `validate`, `checkConsistency`, `warnings`, the `check` of a
// field and `model.warnings` throw a `TypeError` with the code
// `ERR_NOT_REGISTERED`, and a schema has no `~standard`; the typings are the
// core's, since loading the core installs all of them into these classes.
export {
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
} from '../../index.js';
