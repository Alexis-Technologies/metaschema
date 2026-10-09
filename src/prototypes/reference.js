const { SchemaDefinitionError } = require('../errors.js');
const { RUN } = require('../util.js');
const { issues } = require('../issues.js');

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

  checkValue(source, context) {
    const { one, many, root } = this;
    if (one) {
      const schema = root.findReference(one);
      if (!schema) issues.reference(context, one);
      else schema[RUN](source, context);
      return;
    }
    const schema = root.findReference(many);
    if (!schema) {
      issues.reference(context, many);
      return;
    }
    if (!Array.isArray(source)) {
      issues.type(context, `array of ${many}`, source);
      return;
    }
    const { path } = context;
    for (let index = 0; index < source.length; index += 1) {
      if (context.count >= context.limit) return;
      path.push(index);
      schema[RUN](source[index], context);
      path.pop();
    }
  },
};

module.exports = { reference };
