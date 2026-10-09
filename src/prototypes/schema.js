const { hasBrand } = require('../util.js');
const { createStruct, checkStruct } = require('../struct.js');
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
    const { schema: definition, required } = defs;
    if (!isDefinition(definition)) throw missingSchema(this.type);
    this.required = required ?? true;
    const isStruct = hasBrand(definition, 'Struct');
    if (isStruct) this.schema = definition;
    else this.schema = createStruct(definition, prep);
    this.validate = defs.schema.validate || undefined;
  },

  checkValue(source, context) {
    checkStruct(this.schema, source, context);
  },
};

module.exports = { schema };
