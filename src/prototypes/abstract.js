const { BRAND, INSPECT, formatters } = require('../util.js');
const { checks } = require('../rules.js');
const { issues, runValidate, runCheckType } = require('../issues.js');
const { SchemaDefinitionError } = require('../errors.js');

// Keys of a field definition become properties of the field, so a key that
// names one of its methods (or the prototype itself) would replace it. The
// methods of the type contract are reserved whether the type has them or not.
const RESERVED = new Set([
  '__proto__',
  'prototype',
  'check',
  'checkType',
  'checkValue',
  'construct',
]);

const reservedKey = (key) =>
  new SchemaDefinitionError('ERR_RESERVED_KEY', `Key "${key}" is reserved in a field definition`);

class AbstractType {
  static checks = Object.create(null);
  static formatters = Object.create(null);

  // The rule checks that apply to this field, chosen once at construction:
  // `length` only matters to a field that has a length, and check is the hot
  // path.
  #rules;

  static setRules(rules = []) {
    for (const rule of rules) {
      if (formatters[rule]) AbstractType.formatters[rule] = formatters[rule];
      if (checks[rule]) AbstractType.checks[rule] = checks[rule];
    }
  }

  constructor(def, preprocessor) {
    this.root = preprocessor.root;
    const { formatters: typeFormatters } = AbstractType;
    for (const pair of Object.entries(def)) {
      const key = pair[0];
      const value = pair[1];
      if (key === 'type' || key === this.type) continue;
      if (RESERVED.has(key) || typeof this[key] === 'function') throw reservedKey(key);
      if (typeFormatters[key]) this[key] = typeFormatters[key](value);
      else this[key] = value;
    }
    this.construct(def, preprocessor);
    if (this.type) this.root.references.add(this.type);
    const rules = [];
    for (const name of Object.keys(AbstractType.checks)) {
      if (this[name]) rules.push(AbstractType.checks[name]);
    }
    this.#rules = rules;
  }

  // Records the problems of a value into the context. A built-in type checks
  // the value with `checkValue`; a custom type has a `checkType(value, path)`
  // that returns messages, run through the validator contract.
  check(value, context) {
    const isEmpty = value === null || value === undefined;
    if (!this.required && isEmpty) return;
    const isObject = typeof value === 'object' && value !== null;
    // A value met again while it is still being checked is a cycle and is
    // reported instead of recursed into.
    if (isObject) {
      if (context.seen === null) context.seen = new Set();
      if (context.seen.has(value)) {
        issues.circular(context);
        return;
      }
      context.seen.add(value);
    }
    if (this.checkValue) this.checkValue(value, context);
    else runCheckType(this, value, context);
    if (this.validate && context.count < context.limit) {
      runValidate(this, this.validate, value, context);
    }
    for (const rule of this.#rules) {
      if (context.count >= context.limit) break;
      rule(value, this, context);
    }
    if (isObject) context.seen.delete(value);
  }

  toJSON() {
    const { root, ...rest } = this;
    return rest;
  }

  [INSPECT](depth, options, inspect) {
    return inspect(this.toJSON(), options);
  }
}

AbstractType.prototype[BRAND] = 'Type';

module.exports = { AbstractType };
