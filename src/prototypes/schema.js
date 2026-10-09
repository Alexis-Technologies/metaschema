const { hasBrand } = require('../util.js');
const { createStruct, isStruct, checkOf } = require('../struct.js');
const { SchemaDefinitionError } = require('../errors.js');

const missingSchema = (type) => {
  const hint = `Type "${type}" needs a schema definition: { type: '${type}', schema: { ... } }`;
  return new SchemaDefinitionError('ERR_MISSING_SCHEMA', hint);
};

const isDefinition = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

// A nested struct: built from a definition object, or borrowed from a Schema
// instance, whose fields, references and schema-level validate are reused.
const schema = {
  kind: 'struct',
  options: ['schema'],

  construct(defs, prep) {
    const { schema: definition, required } = defs;
    if (!isDefinition(definition)) throw missingSchema(this.type);
    this.required = required ?? true;
    if (hasBrand(definition, 'Schema')) {
      prep.root.updateFromSchema(definition);
      this.schema = definition.fields;
      this.validate = definition.options.validate || undefined;
      return;
    }
    if (isStruct(definition)) this.schema = definition;
    else this.schema = createStruct(definition, prep);
    this.validate = definition.validate || undefined;
  },

  compile() {
    const { required } = this;
    const check = isStruct(this.schema) ? checkOf(this.schema) : this.schema.check;
    return (value, context, key) => {
      if (!required && value == null) return;
      check(value, context, key);
    };
  },
};

module.exports = { schema };
