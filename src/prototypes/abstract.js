const { BRAND, INSPECT, formatters } = require('../util.js');
const { checks } = require('../rules.js');
const { runValidate, runCheckType } = require('../issues.js');
const { SchemaDefinitionError } = require('../errors.js');

// Keys of a field definition become properties of the field, so a key that
// names one of its methods (or the prototype itself) would replace it. The
// methods of the type contract are reserved whether the type has them or not.
const RESERVED = new Set(['__proto__', 'prototype', 'check', 'checkType', 'compile', 'construct']);

const reservedKey = (key) =>
  new SchemaDefinitionError('ERR_RESERVED_KEY', `Key "${key}" is reserved in a field definition`);

// The check of a field with rules or a validate function: the type check,
// then the rules, then the validate function. A type failure cancels the
// rest (a length or a validator makes no sense for a value of another type),
// and validate runs only on a value that passed everything before it, so it
// can rely on the type and the rules. A field with neither is its type check
// alone.
const withRules = (type, inner, rules) => {
  const { required, validate } = type;
  return (value, context, key) => {
    if (value == null && !required) return;
    const before = context.count;
    inner(value, context, key);
    if (context.count !== before) return;
    for (let index = 0; index < rules.length; index += 1) {
      if (context.count >= context.limit) break;
      rules[index](value, context, key);
    }
    if (validate && context.count === before) {
      const nested = key !== undefined;
      if (nested) context.path.push(key);
      runValidate(type, validate, value, context);
      if (nested) context.path.pop();
    }
  };
};

class AbstractType {
  static checks = Object.create(null);
  static formatters = Object.create(null);

  // The compiled check of the field: a closure built once from the field,
  // kept out of its definition (toJSON, util.inspect) as a private field.
  #check;

  static setRules(rules = []) {
    for (const rule of rules) {
      if (formatters[rule]) AbstractType.formatters[rule] = formatters[rule];
      if (checks[rule]) AbstractType.checks[rule] = checks[rule];
    }
  }

  constructor(def, preprocessor) {
    this.root = preprocessor.root;
    const { formatters: typeFormatters } = AbstractType;
    for (const key of Object.keys(def)) {
      const value = def[key];
      if (key === 'type' || key === this.type) continue;
      if (RESERVED.has(key) || typeof this[key] === 'function') throw reservedKey(key);
      if (typeFormatters[key]) this[key] = typeFormatters[key](value);
      else this[key] = value;
    }
    this.construct(def, preprocessor);
    if (this.type) this.root.references.add(this.type);
    // The rule checks that apply to this field, chosen once: `length` only
    // matters to a field that has a length, and check is the hot path.
    const rules = [];
    for (const name of Object.keys(AbstractType.checks)) {
      if (this[name]) rules.push(AbstractType.checks[name](this));
    }
    const inner = this.compile();
    const plain = rules.length === 0 && !this.validate;
    this.#check = plain ? inner : withRules(this, inner, rules);
  }

  // Records the problems of a value into the context of the current check,
  // under `key` when the field is reached through one.
  get check() {
    return this.#check;
  }

  // The type check of a field, as a closure built once from the field. A
  // built-in prototype compiles its own; a custom type has a
  // `checkType(value, path)` that returns messages, run through the
  // validator contract.
  compile() {
    const type = this;
    const { required } = this;
    return (value, context, key) => {
      if (value == null && !required) return;
      const nested = key !== undefined;
      if (nested) context.path.push(key);
      runCheckType(type, value, context);
      if (nested) context.path.pop();
    };
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
