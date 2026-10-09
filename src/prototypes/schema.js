const { hasBrand } = require('../util.js');
const { Struct } = require('../struct.js');
const { SchemaDefinitionError } = require('../errors.js');

const missingSchema = (type) => {
  const hint = `Type "${type}" needs a schema definition: { type: '${type}', schema: { ... } }`;
  return new SchemaDefinitionError('ERR_MISSING_SCHEMA', hint);
};

const isDefinition = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const schema = {
  kind: 'struct',

  construct(defs, prep) {
    const { schema, required } = defs;
    if (!isDefinition(schema)) throw missingSchema(this.type);
    this.required = required ?? true;
    const isStruct = hasBrand(schema, 'Struct');
    if (isStruct) this.schema = schema;
    else this.schema = new Struct(schema, prep);
    this.validate = defs.schema.validate || undefined;
  },

  checkType(source, path = '') {
    return this.schema.check(source, path);
  },
};

module.exports = { schema };
