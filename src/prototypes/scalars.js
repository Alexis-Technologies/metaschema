const { SchemaDefinitionError } = require('../errors.js');
const { issues } = require('../issues.js');

const missingEnum = (type) => {
  const hint = `Type "${type}" needs a list of values: { type: '${type}', enum: [...] }`;
  return new SchemaDefinitionError('ERR_INVALID_ENUM', hint);
};

// One closure per JavaScript type, each with a literal `typeof` comparison
// (which the engine turns into a type check rather than a string compare),
// and a single comparison on the way through for a valid value.
const SCALAR_CHECKS = {
  string: (required) => (value, context, key) => {
    if (typeof value === 'string') return;
    if (!required && (value === null || value === undefined)) return;
    issues.type(context, 'string', value, key);
  },
  number: (required) => (value, context, key) => {
    if (typeof value === 'number') return;
    if (!required && (value === null || value === undefined)) return;
    issues.type(context, 'number', value, key);
  },
  bigint: (required) => (value, context, key) => {
    if (typeof value === 'bigint') return;
    if (!required && (value === null || value === undefined)) return;
    issues.type(context, 'bigint', value, key);
  },
  boolean: (required) => (value, context, key) => {
    if (typeof value === 'boolean') return;
    if (!required && (value === null || value === undefined)) return;
    issues.type(context, 'boolean', value, key);
  },
};

const scalar = {
  kind: 'scalar',

  construct() {},

  compile() {
    return SCALAR_CHECKS[this.scalar](this.required);
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
        if (!required && (value === null || value === undefined)) return;
        issues.enum(context, values, key);
      };
    }
    return (value, context, key) => {
      if (values.includes(value)) return;
      if (!required && (value === null || value === undefined)) return;
      issues.enum(context, values, key);
    };
  },
};

const string = { scalar: 'string', rules: ['length'], ...scalar };
const number = { scalar: 'number', rules: ['length'], ...scalar };
const bigint = { scalar: 'bigint', rules: ['length'], ...scalar };
const boolean = { scalar: 'boolean', ...scalar };

module.exports = { string, number, bigint, boolean, enum: enumerable };
