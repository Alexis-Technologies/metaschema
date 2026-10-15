const { SchemaDefinitionError } = require('../errors.js');

const invalidEmbed = () =>
  new SchemaDefinitionError('ERR_INVALID_DEFINITION', 'Option "embed" needs a boolean');

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
};

module.exports = { reference, embeds };
