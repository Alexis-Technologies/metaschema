const { SchemaDefinitionError } = require('../errors.js');
const { issues } = require('../issues.js');

const missingEnum = (type) => {
  const hint = `Type "${type}" needs a list of values: { type: '${type}', enum: [...] }`;
  return new SchemaDefinitionError('ERR_INVALID_ENUM', hint);
};

const scalar = {
  kind: 'scalar',

  construct() {},

  checkValue(value, context) {
    // oxlint-disable-next-line valid-typeof
    if (typeof value !== this.scalar) issues.type(context, this.scalar, value);
  },
};

const enumerable = {
  kind: 'scalar',

  construct(def) {
    const values = def.enum;
    if (!Array.isArray(values) || values.length === 0) throw missingEnum(this.type);
    this.enum = values;
  },

  checkValue(value, context) {
    if (!this.enum.includes(value)) issues.enum(context, this.enum);
  },
};

const string = { scalar: 'string', rules: ['length'], ...scalar };
const number = { scalar: 'number', rules: ['length'], ...scalar };
const bigint = { scalar: 'bigint', rules: ['length'], ...scalar };
const boolean = { scalar: 'boolean', ...scalar };

module.exports = { string, number, bigint, boolean, enum: enumerable };
