const { SchemaDefinitionError } = require('../errors.js');

const missingEnum = (type) => {
  const hint = `Type "${type}" needs a list of values: { type: '${type}', enum: [...] }`;
  return new SchemaDefinitionError('ERR_INVALID_ENUM', hint);
};

const scalar = {
  kind: 'scalar',

  construct() {},

  checkType(value, path) {
    // oxlint-disable-next-line valid-typeof
    if (typeof value !== this.scalar) {
      return `Field "${path}" not of expected type: ${this.scalar}`;
    }
    return null;
  },
};

const enumerable = {
  kind: 'scalar',

  construct(def) {
    const values = def.enum;
    if (!Array.isArray(values) || values.length === 0) throw missingEnum(this.type);
    this.enum = values;
  },

  checkType(value, path) {
    if (this.enum.includes(value)) return null;
    const variants = this.enum.join(', ');
    return `Field "${path}" value is not of enum: ${variants}`;
  },
};

const string = { scalar: 'string', rules: ['length'], ...scalar };
const number = { scalar: 'number', rules: ['length'], ...scalar };
const bigint = { scalar: 'bigint', rules: ['length'], ...scalar };
const boolean = { scalar: 'boolean', ...scalar };

module.exports = { string, number, bigint, boolean, enum: enumerable };
