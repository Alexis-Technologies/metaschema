const { SchemaDefinitionError } = require('../errors.js');
const { RUN } = require('../util.js');
const { issues } = require('../issues.js');

const invalidEmbed = () =>
  new SchemaDefinitionError('ERR_INVALID_DEFINITION', 'Option "embed" needs a boolean');

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

// Whether a referenced value is the record itself (the graph view) or its
// id (the storage view): the mode of the check when it says so, otherwise
// the field's `embed`, otherwise the store of the target's kind. A stored
// kind lives in its own table, so a row holds its id; a memory kind has no
// table of its own, so it is part of the row.
const embeds = (schema, embed, mode) => {
  if (mode !== 'kind') return mode === 'embed';
  return embed === undefined ? schema.store !== 'persistent' : embed;
};

const reference = {
  kind: 'struct',
  options: ['one', 'many', 'embed'],

  construct(def) {
    const key = def.many === undefined ? 'one' : 'many';
    const target = def[key];
    if (typeof target !== 'string' || target === '') {
      const reason = `Reference "${key}" needs an entity name, got ${JSON.stringify(target)}`;
      throw new SchemaDefinitionError('ERR_INVALID_REFERENCE', reason);
    }
    if (this.embed !== undefined && typeof this.embed !== 'boolean') throw invalidEmbed();
    // Read from the referencing side: a `many` field holds the many end of
    // a one-to-many relation, a single reference the many end of many-to-one.
    const relation = key === 'many' ? 'one-to-many' : 'many-to-one';
    this[key] = target;
    this.type = target;
    this.root.relations.add({ to: target, type: relation });
  },

  // The target is looked up at check time: entities of a model are built in
  // any order and a namespace may be attached later.
  compile() {
    const { one, many, root, required, embed } = this;
    if (one) {
      return (value, context, key) => {
        if (!required && value == null) return;
        const schema = root.findReference(one);
        if (!schema) {
          issues.reference(context, one, key);
          return;
        }
        if (embeds(schema, embed, context.references)) runReferenced(schema, value, context, key);
        else if (typeof value !== 'string') issues.type(context, 'string', value, key);
      };
    }
    const expected = `array of ${many}`;
    return (value, context, key) => {
      if (!required && value == null) return;
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
      const embedded = embeds(schema, embed, context.references);
      for (let index = 0; index < value.length; index += 1) {
        if (context.count >= context.limit) break;
        const item = value[index];
        if (embedded) runReferenced(schema, item, context, index);
        else if (typeof item !== 'string') issues.type(context, 'string', item, index);
      }
      if (nested) context.path.pop();
    };
  },
};

module.exports = { reference, embeds };
