const { BRAND, INSPECT } = require('../util.js');
const { FORMAT, notApplicable, compileRules } = require('../rules.js');
const { runValidate, runCheckType } = require('../issues.js');
const { SchemaDefinitionError } = require('../errors.js');

// Keys of a field definition become properties of the field, so a key that
// names one of its methods (or the prototype itself) would replace it. The
// methods of the type contract are reserved whether the type has them or not.
const RESERVED = new Set(['__proto__', 'prototype', 'check', 'checkType', 'compile', 'construct']);

const reservedKey = (key) =>
  new SchemaDefinitionError('ERR_RESERVED_KEY', `Key "${key}" is reserved in a field definition`);

const invalidNullable = () =>
  new SchemaDefinitionError('ERR_INVALID_DEFINITION', 'Option "nullable" needs a boolean');

// A nullable field accepts null in place of a value of its type, whatever
// its rules; `required` still says whether the key must be there.
const nullable = (inner) => (value, context, key) => {
  if (value === null) return;
  inner(value, context, key);
};

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
  // The rules the type accepts, by name; a type class sets its own.
  static rules = new Set();

  // The compiled check of the field: a closure built once from the field,
  // kept out of its definition (toJSON, util.inspect) as a private field.
  #check;

  constructor(def, preprocessor) {
    this.root = preprocessor.root;
    const { rules } = this.constructor;
    for (const key of Object.keys(def)) {
      const value = def[key];
      if (key === 'type' || key === this.type) continue;
      if (RESERVED.has(key) || typeof this[key] === 'function') throw reservedKey(key);
      const format = FORMAT[key];
      if (format === undefined) {
        this[key] = value;
        continue;
      }
      if (!rules.has(key)) throw notApplicable(key, this.type, rules);
      this[key] = format(value);
    }
    this.construct(def, preprocessor);
    if (this.type) this.root.references.add(this.type);
    if (this.nullable !== undefined && typeof this.nullable !== 'boolean') throw invalidNullable();
    // The rule checks that apply to this field, compiled once: a field
    // without rules is its type check alone, and check is the hot path.
    const checks = compileRules(this, rules);
    const inner = this.compile();
    const plain = checks.length === 0 && !this.validate;
    const check = plain ? inner : withRules(this, inner, checks);
    this.#check = this.nullable === true ? nullable(check) : check;
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
