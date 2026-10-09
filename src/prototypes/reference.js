const { SchemaDefinitionError } = require('../errors.js');
const { RUN } = require('../util.js');
const { issues } = require('../issues.js');

// A reference is the one place a schema can recurse (Category.parent is a
// Category), so it is where a value met again while it is still being
// checked is a cycle, reported instead of recursed into.
const runReferenced = (schema, value, context, key) => {
  if (value === null || typeof value !== 'object') {
    schema[RUN](value, context, key);
    return;
  }
  if (context.seen === null) context.seen = new Set();
  const { seen } = context;
  if (seen.has(value)) {
    issues.circular(context, key);
    return;
  }
  seen.add(value);
  schema[RUN](value, context, key);
  seen.delete(value);
};

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

  // The target is looked up at check time: entities of a model are built in
  // any order and a namespace may be attached later.
  compile() {
    const { one, many, root, required } = this;
    if (one) {
      return (value, context, key) => {
        if (!required && (value === null || value === undefined)) return;
        const schema = root.findReference(one);
        if (!schema) issues.reference(context, one, key);
        else runReferenced(schema, value, context, key);
      };
    }
    const expected = `array of ${many}`;
    return (value, context, key) => {
      if (!required && (value === null || value === undefined)) return;
      const schema = root.findReference(many);
      if (!schema) {
        issues.reference(context, many, key);
        return;
      }
      if (!Array.isArray(value)) {
        issues.type(context, expected, value, key);
        return;
      }
      const nested = key !== undefined;
      if (nested) context.path.push(key);
      for (let index = 0; index < value.length; index += 1) {
        if (context.count >= context.limit) break;
        runReferenced(schema, value[index], context, index);
      }
      if (nested) context.path.pop();
    };
  },
};

module.exports = { reference };
