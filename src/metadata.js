const { getKindMetadata } = require('./kinds.js');
const { BRAND, hasBrand, limits, issue } = require('./util.js');

const ERR_PREFIX = 'Field';

const prefixed = (message, path) =>
  message.startsWith(ERR_PREFIX) ? message : `${ERR_PREFIX} "${path}" ${message}`;

// Anything with a message is taken as an issue: the library's own, or a
// { code, message } object returned by a custom validator.
const isIssue = (error) =>
  error !== null && typeof error === 'object' && typeof error.message === 'string';
const OPTIONS = ['validate', 'parse', 'serialize', 'format'];
const METADATA_COLLECTIONS = ['indexes', 'options'];

class ValidationResult {
  #path;

  constructor(path = '') {
    this.#path = path;
    this.errors = [];
    this.issues = [];
    this.valid = true;
  }

  // True once the maxErrors of the current check is reached; loops stop early.
  get full() {
    return this.errors.length >= limits.maxErrors;
  }

  add(error, code = 'custom') {
    const issues = ValidationResult.isInstance(error)
      ? error.issues
      : ValidationResult.issuesOf(error, this.#path, code);
    // One by one: a spread call has an argument limit, and a validator may
    // legitimately return more messages than that.
    for (const entry of issues) {
      if (this.full) break;
      this.issues.push(entry);
      this.errors.push(entry.message);
    }
    this.valid = this.errors.length === 0;
    return this;
  }

  // Everything a check or validator may return, as issues: true, null and
  // undefined are nothing; false is a generic error; a string is a message;
  // an array holds any of these; an object with a message is an issue.
  static issuesOf(error, path = '', code = 'custom') {
    if (error === true || error === null || error === undefined) return [];
    if (ValidationResult.isInstance(error)) return error.issues;
    if (error === false) return [issue(code, path, 'validation error')];
    if (Array.isArray(error)) {
      const issues = [];
      for (const item of error) issues.push(...ValidationResult.issuesOf(item, path, code));
      return issues;
    }
    if (isIssue(error)) {
      const found = { code: error.code || code, path: error.path || path };
      return [{ ...found, message: prefixed(error.message, path) }];
    }
    return [{ code, path, message: prefixed(String(error), path) }];
  }

  static format(error, path = '') {
    const issues = ValidationResult.issuesOf(error, path);
    if (issues.length === 0) return null;
    return issues.map((entry) => entry.message);
  }

  static isInstance(error) {
    return hasBrand(error, 'ValidationResult');
  }
}

ValidationResult.prototype[BRAND] = 'ValidationResult';

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

  validate(value, path) {
    if (!this.options.validate) return null;
    const result = new ValidationResult(path);
    try {
      return result.add(this.options.validate(value, path));
    } catch (error) {
      return result.add(issue('exception', path, `validation failed ${error}`));
    }
  }
}

module.exports = { ValidationResult, SchemaMetadata };
