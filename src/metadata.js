const { getKindMetadata } = require('./kinds.js');
const { ValidationResult } = require('./result.js');
const OPTIONS = ['validate', 'parse', 'serialize', 'format'];
const METADATA_COLLECTIONS = ['indexes', 'options'];

class Options {
  constructor() {
    this.validate = null;
    this.format = null;
    this.parse = null;
    this.serialize = null;
  }

  extract(key, field) {
    const isFn = typeof field === 'function';
    const isOption = OPTIONS.includes(key) && isFn;
    if (isOption) this[key] = field;
    return isOption;
  }
}

class Indexes {
  // Index definitions (`index`, `primary`, `unique` arrays) are taken out of the
  // fields; a `many` relation is recorded here as well but stays a field, so
  // the method reports only whether the entry was taken.
  extract(key, field) {
    if (field === null || typeof field !== 'object') return false;
    const { index, primary, unique, many } = field;
    const isIndex = Array.isArray(index || primary || unique);
    if (isIndex || many) this[key] = field;
    return isIndex;
  }
}

class SchemaMetadata {
  constructor() {
    this.kind = 'struct';
    this.scope = 'local';
    this.store = 'memory';
    this.allow = 'write';
    this.parent = '';
    this.indexes = new Indexes();
    this.options = new Options();
    this.custom = {};
    this.references = new Set();
    this.relations = new Set();
  }

  #setMany(values) {
    const { kind, scope, store, allow, parent, ...custom } = values;
    this.kind = kind || this.kind;
    this.scope = scope || this.scope;
    this.store = store || this.store;
    this.allow = allow || this.allow;
    this.parent = parent || this.parent;
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
    for (const pair of Object.entries(defs)) {
      const key = pair[0];
      const field = pair[1];
      let extracted = false;
      for (const collection of METADATA_COLLECTIONS) {
        const taken = this[collection].extract(key, field);
        if (taken) extracted = true;
      }
      if (!extracted) fields[key] = field;
    }
    return fields;
  }

  // Runs only the schema-level validate function, as a result of its own.
  validate(value, path = '') {
    if (!this.options.validate) return null;
    const result = new ValidationResult();
    try {
      return result.add(this.options.validate(value, path));
    } catch (error) {
      return result.add({
        code: 'exception',
        message: `validation failed ${error}`,
        params: { error },
      });
    }
  }
}

module.exports = { ValidationResult, SchemaMetadata };
