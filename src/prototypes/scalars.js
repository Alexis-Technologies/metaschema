const { SchemaDefinitionError } = require('../errors.js');

const missingEnum = (type) => {
  const hint = `Type "${type}" needs a list of values: { type: '${type}', enum: [...] }`;
  return new SchemaDefinitionError('ERR_INVALID_ENUM', hint);
};

// The scalar types: what a field of each holds (its check is in
// checks/scalars.js, the validation half of the core).
const scalar = {
  kind: 'scalar',
  options: [],

  construct() {},
};

const enumerable = {
  kind: 'scalar',
  options: ['enum'],

  construct(def) {
    const values = def.enum;
    if (!Array.isArray(values) || values.length === 0) throw missingEnum(this.type);
    this.enum = values;
  },
};

// A number without a fraction; it renders as a number in TypeScript.
const integer = { ...scalar, scalar: 'number', rules: ['min', 'max'], options: ['min', 'max'] };

// A Date instance with a time: an invalid Date is a type error.
const date = { ...scalar, scalar: 'date' };

// A Uint8Array of any realm, a Buffer included: the value of binary data,
// base64 text on a JSON wire. `length` counts its bytes.
const bytes = { ...scalar, scalar: 'bytes', rules: ['length'], options: ['length'] };

const nothing = { ...scalar, scalar: 'null' };

// Any value at all, null and undefined included; `required` still says
// whether the key must be there.
const any = { ...scalar, scalar: 'any' };

const unknown = { ...scalar, scalar: 'unknown' };

const string = {
  ...scalar,
  scalar: 'string',
  rules: ['length', 'pattern', 'format'],
  options: ['length', 'unicode', 'pattern', 'format'],
};
const number = {
  ...scalar,
  scalar: 'number',
  rules: ['min', 'max', 'decimals'],
  options: ['min', 'max', 'decimals'],
};
const bigint = { ...scalar, scalar: 'bigint', rules: ['min', 'max'], options: ['min', 'max'] };
const boolean = { ...scalar, scalar: 'boolean' };

module.exports = {
  string,
  number,
  integer,
  bigint,
  boolean,
  date,
  bytes,
  null: nothing,
  any,
  unknown,
  enum: enumerable,
};
