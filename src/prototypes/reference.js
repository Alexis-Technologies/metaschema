const { SchemaDefinitionError } = require('../errors.js');
const { ValidationResult } = require('../metadata.js');
const { RUN, issue } = require('../util.js');

const reference = {
  kind: 'struct',

  construct(def) {
    const key = def.many === undefined ? 'one' : 'many';
    const target = def[key];
    if (typeof target !== 'string' || target === '') {
      const reason = `Reference "${key}" needs an entity name, got ${JSON.stringify(target)}`;
      throw new SchemaDefinitionError('ERR_INVALID_REFERENCE', reason);
    }
    const relation = key === 'many' ? 'many-to-one' : 'one-to-many';
    this[key] = target;
    this.type = target;
    this.root.relations.add({ to: target, type: relation });
  },

  checkType(source, path, context) {
    const { one, many, root } = this;
    if (one) {
      const schema = root.findReference(one);
      if (!schema) return issue('reference', path, `Entity "${one}" is not found`);
      return schema[RUN](source, path, context);
    }
    const schema = root.findReference(many);
    if (!schema) return issue('reference', path, `Entity "${many}" is not found`);
    if (!Array.isArray(source)) {
      return issue('type', path, `not of expected type: array of ${many}`);
    }
    const result = new ValidationResult(path, context);
    for (let index = 0; index < source.length; index += 1) {
      if (result.full) break;
      result.add(schema[RUN](source[index], `${path}[${index}]`, context));
    }
    return result;
  },
};

module.exports = { reference };
