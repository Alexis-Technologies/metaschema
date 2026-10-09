const { SchemaDefinitionError } = require('../errors.js');
const { issues } = require('../issues.js');

const missingEnum = (type) => {
  const hint = `Type "${type}" needs a list of values: { type: '${type}', enum: [...] }`;
  return new SchemaDefinitionError('ERR_INVALID_ENUM', hint);
};

// A single comparison on the way through for a valid value; the optional
// case is looked at only when it fails.
const scalarCheck = (scalar, required) => (value, context, key) => {
  // oxlint-disable-next-line valid-typeof
  if (typeof value === scalar) return;
  if (!required && value == null) return;
  issues.type(context, scalar, value, key);
};

const scalar = {
  kind: 'scalar',

  construct() {},

  compile() {
    return scalarCheck(this.scalar, this.required);
  },
};

// Past this many values a Set lookup beats a linear scan.
const ENUM_SET_SIZE = 8;

const enumerable = {
  kind: 'scalar',

  construct(def) {
    const values = def.enum;
    if (!Array.isArray(values) || values.length === 0) throw missingEnum(this.type);
    this.enum = values;
  },

  compile() {
    const values = this.enum;
    const { required } = this;
    if (values.length > ENUM_SET_SIZE) {
      const set = new Set(values);
      return (value, context, key) => {
        if (set.has(value)) return;
        if (!required && value == null) return;
        issues.enum(context, values, key);
      };
    }
    return (value, context, key) => {
      if (values.includes(value)) return;
      if (!required && value == null) return;
      issues.enum(context, values, key);
    };
  },
};

// A number without a fraction; it renders as a number in TypeScript.
const integer = {
  kind: 'scalar',
  scalar: 'number',
  rules: ['min', 'max'],

  construct() {},

  compile() {
    const { required } = this;
    return (value, context, key) => {
      if (Number.isInteger(value)) return;
      if (!required && value == null) return;
      issues.type(context, 'integer', value, key);
    };
  },
};

const string = { scalar: 'string', rules: ['length', 'pattern'], ...scalar };
const number = { scalar: 'number', rules: ['min', 'max'], ...scalar };
const bigint = { scalar: 'bigint', rules: ['min', 'max'], ...scalar };
const boolean = { scalar: 'boolean', ...scalar };

module.exports = { string, number, integer, bigint, boolean, enum: enumerable };
