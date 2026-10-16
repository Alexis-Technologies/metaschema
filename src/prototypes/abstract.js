const { BRAND, INSPECT } = require('../util.js');
const { FORMAT, checkBounds, notApplicable } = require('../rules.js');
const { SchemaDefinitionError, noValidation } = require('../errors.js');

// Keys of a field definition become properties of the field, so a key that
// names one of its methods (or the prototype itself) would replace it. The
// methods of the type contract are reserved whether the type has them or
// not, and so is `root`, the schema the field belongs to.
const RESERVED = new Set([
  '__proto__',
  'prototype',
  'check',
  'checkType',
  'compile',
  'construct',
  'root',
]);

const reservedKey = (key) =>
  new SchemaDefinitionError('ERR_RESERVED_KEY', `Key "${key}" is reserved in a field definition`);

// The options of a field that are flags: `nullable` (null in place of a
// value) and `coerce` (whether parse converts the input of its subtree).
const FLAGS = ['nullable', 'coerce'];

const invalidFlag = (key) =>
  new SchemaDefinitionError('ERR_INVALID_DEFINITION', `Option "${key}" needs a boolean`);

const invalidCodec = (key) =>
  new SchemaDefinitionError('ERR_INVALID_DEFINITION', `Option "${key}" needs a function`);

// `parse` (the decoder) and `serialize` are read by parse and serialize, on
// any type; a definition that gave them anything else can never work.
const checkCodecs = (type) => {
  if (type.parse !== undefined && typeof type.parse !== 'function') throw invalidCodec('parse');
  if (type.serialize !== undefined && typeof type.serialize !== 'function') {
    throw invalidCodec('serialize');
  }
};

// What builds the checks of a schema and of its fields on their first use:
// the validation half of the core installs them (`validation.js`), and a
// schema built through `./definition` alone says that it cannot validate.
const BUILD = {
  field() {
    throw noValidation('check');
  },
  schema() {
    throw noValidation('check');
  },
};

class AbstractType {
  // The rules the type accepts and the definition keys it reads, by name; a
  // type class sets its own.
  static rules = new Set();
  static options = new Set();

  // The compiled check of the field: a closure built from the field on the
  // first use of `check`, kept out of its definition (toJSON, util.inspect)
  // as a private field. A schema that is only read (rendered, written as a
  // snapshot) never compiles one.
  #check = undefined;

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
      this[key] = format(value, this);
    }
    checkBounds(this);
    this.construct(def, preprocessor);
    if (this.type) this.root.references.add(this.type);
    for (const key of FLAGS) {
      if (this[key] !== undefined && typeof this[key] !== 'boolean') throw invalidFlag(key);
    }
    checkCodecs(this);
  }

  // Records the problems of a value into the context of the current check,
  // under `key` when the field is reached through one.
  get check() {
    if (this.#check === undefined) this.#check = BUILD.field(this);
    return this.#check;
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

module.exports = { AbstractType, BUILD };
