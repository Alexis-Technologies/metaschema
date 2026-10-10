const { getKindMetadata } = require('./kinds.js');
const { ValidationResult } = require('./result.js');
const { SchemaDefinitionError, asyncReturn } = require('./errors.js');
const { isThenable } = require('./issues.js');

// The functions of a schema definition that are the schema's own: its
// validate, its decoder, its serializer and `format`.
const OPTIONS = new Set(['validate', 'parse', 'serialize', 'format']);

// The unknown-keys policy of a schema is the default of its `check`, so a
// value with keys the schema does not have is rejected or ignored without
// an option on every call; the option of a call still wins.
const unknownOf = (unknown) => {
  if (unknown === undefined) return 'reject';
  if (unknown !== 'reject' && unknown !== 'ignore') {
    const reason = `Schema metadata "unknown" must be "reject" or "ignore", got ${JSON.stringify(unknown)}`;
    throw new SchemaDefinitionError('ERR_INVALID_OPTIONS', reason);
  }
  return unknown;
};

// `indexes` is a null-prototype dictionary keyed by definition keys, which may
// be called `extract` or `constructor`; `options` only ever holds the four
// keys below and stays a plain object with fast properties: the compiled
// check reads `options.validate` on every call, and V8 keeps an object made
// by `Object.create(null)` in dictionary mode.
const createOptions = () => ({ validate: null, format: null, parse: null, serialize: null });

const extractOption = (options, key, field) => {
  const isOption = typeof field === 'function' && OPTIONS.has(key);
  if (isOption) options[key] = field;
  return isOption;
};

// Index definitions (`index`, `primary`, `unique` arrays) are taken out of the
// fields; a `many` relation is recorded as well but stays a field, so only
// whether the entry was taken is reported.
const extractIndex = (indexes, key, field) => {
  if (field === null || typeof field !== 'object') return false;
  const { index, primary, unique, many } = field;
  const isIndex = Array.isArray(index || primary || unique);
  if (isIndex || many) indexes[key] = field;
  return isIndex;
};

class SchemaMetadata {
  constructor() {
    this.kind = 'struct';
    this.scope = 'local';
    this.store = 'memory';
    this.allow = 'write';
    this.parent = '';
    this.unknown = 'reject';
    this.indexes = Object.create(null);
    this.options = createOptions();
    this.custom = {};
    this.references = new Set();
    this.relations = new Set();
  }

  #setMany(values) {
    const { kind, scope, store, allow, parent, unknown, ...custom } = values;
    this.kind = kind || this.kind;
    this.scope = scope || this.scope;
    this.store = store || this.store;
    this.allow = allow || this.allow;
    this.parent = parent || this.parent;
    this.unknown = unknownOf(unknown);
    this.custom = custom;
  }

  updateFromSchema({ references = [], relations = [] }) {
    for (const ref of references) this.references.add(ref);
    for (const rel of relations) this.relations.add(rel);
  }

  updateFromKind({ kind, meta, root }) {
    const { defs, metadata } = getKindMetadata(kind, meta, root);
    this.#setMany(metadata);
    return defs;
  }

  extractMetadata(defs) {
    const fields = Object.create(null);
    for (const key of Object.keys(defs)) {
      const field = defs[key];
      const option = extractOption(this.options, key, field);
      const index = extractIndex(this.indexes, key, field);
      if (!option && !index) fields[key] = field;
    }
    return fields;
  }

  // Runs only the schema-level validate function, as a result of its own; a
  // function that returns a promise is an error here, as in check.
  validate(value, path = '') {
    if (!this.options.validate) return null;
    const result = new ValidationResult();
    try {
      const output = this.options.validate.call(this, value, path);
      if (isThenable(output)) throw asyncReturn('validator', path, 'checkAsync');
      return result.add(output);
    } catch (error) {
      if (error.code === 'ERR_ASYNC_VALIDATOR') throw error;
      return result.add({
        code: 'exception',
        message: `validation failed ${error}`,
        params: { error },
      });
    }
  }
}

module.exports = { ValidationResult, SchemaMetadata };
