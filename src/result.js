const { BRAND, INSPECT, hasBrand } = require('./util.js');
const { EMPTY, NONE, absorb, finalize, describe, toDotPath } = require('./issues.js');
const en = require('./locales/en.js');

// Defines an own data property, so a key such as `__proto__` taken from a
// path lands on the object instead of changing its prototype.
const define = (target, key, value) => {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return value;
};

class ValidationResult {
  #root;
  #messages;
  #errors = null;

  // A check builds its result from its context, which carries the root label,
  // the locale of the call and the issues under these names; a validator that
  // builds one of its own needs none of them: its issues are relative to the
  // field the validator belongs to.
  constructor(options = {}) {
    const { root = '', messages = en, issues = NONE } = options;
    this.#root = root;
    this.#messages = messages;
    this.issues = issues;
  }

  get valid() {
    return this.issues.length === 0;
  }

  // The messages with their location, rendered on first use.
  get errors() {
    if (this.#errors === null) {
      const errors = [];
      for (const issue of this.issues) errors.push(describe(this.#messages, this.#root, issue));
      this.#errors = errors;
    }
    return this.#errors;
  }

  get summary() {
    return this.errors.join('\n');
  }

  add(error, code = 'custom') {
    const context = { issues: this.issues, count: this.issues.length, limit: Infinity, path: [] };
    absorb(context, error, code, EMPTY);
    this.issues = context.issues;
    finalize(this.issues, this.#messages);
    this.#errors = null;
    return this;
  }

  // Messages by dotted path, for forms: `formErrors` holds the messages of
  // the value itself, `fieldErrors` those of its fields.
  flatten() {
    const formErrors = [];
    const fieldErrors = {};
    for (const issue of this.issues) {
      const { path, message } = issue;
      if (path.length === 0) {
        formErrors.push(message);
        continue;
      }
      const key = toDotPath(path);
      const list = Object.hasOwn(fieldErrors, key)
        ? fieldErrors[key]
        : define(fieldErrors, key, []);
      list.push(message);
    }
    return { formErrors, fieldErrors };
  }

  // Messages as a tree that follows the value: `properties` by key, `items`
  // by index.
  tree() {
    const root = { errors: [] };
    for (const issue of this.issues) {
      let node = root;
      for (const key of issue.path) {
        if (typeof key === 'number') {
          if (node.items === undefined) node.items = [];
          if (node.items[key] === undefined) node.items[key] = { errors: [] };
          node = node.items[key];
        } else {
          if (node.properties === undefined) node.properties = {};
          const name = String(key);
          node = Object.hasOwn(node.properties, name)
            ? node.properties[name]
            : define(node.properties, name, { errors: [] });
        }
      }
      node.errors.push(issue.message);
    }
    return root;
  }

  // The issues `add` would record for a validator's return value.
  static issuesOf(error, path = [], code = 'custom') {
    const context = { issues: [], count: 0, limit: Infinity, path };
    absorb(context, error, code, EMPTY);
    finalize(context.issues, en);
    return context.issues;
  }

  static isInstance(error) {
    return hasBrand(error, 'ValidationResult');
  }

  [INSPECT](depth, options, inspect) {
    const { valid, errors, issues } = this;
    return `ValidationResult ${inspect({ valid, errors, issues }, options)}`;
  }
}

ValidationResult.prototype[BRAND] = 'ValidationResult';

module.exports = { ValidationResult };
