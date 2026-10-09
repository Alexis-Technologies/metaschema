const { SchemaDefinitionError } = require('../errors.js');

const reference = {
  kind: 'struct',

  construct(def) {
    const key = def.many === undefined ? 'one' : 'many';
    const reference = def[key];
    if (typeof reference !== 'string' || reference === '') {
      const reason = `Reference "${key}" needs an entity name, got ${JSON.stringify(reference)}`;
      throw new SchemaDefinitionError('ERR_INVALID_REFERENCE', reason);
    }
    const relation = key === 'many' ? 'many-to-one' : 'one-to-many';
    this[key] = reference;
    this.type = reference;
    this.root.relations.add({ to: reference, type: relation });
  },

  checkType(source, path) {
    const { one, many, root } = this;
    if (one) {
      const schema = root.findReference(one);
      if (!schema) return `Entity "${one}" is not found`;
      return schema.check(source, path);
    }
    const schema = root.findReference(many);
    if (!schema) return `Entity "${many}" is not found`;
    if (!Array.isArray(source)) return `Field "${path}" not of expected type: array of ${many}`;
    for (const record of source) {
      const result = schema.check(record, path);
      if (!result.valid) return result;
    }
    return null;
  },
};

module.exports = { reference };
