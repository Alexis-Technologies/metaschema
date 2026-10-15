const { SchemaDefinitionError } = require('../errors.js');

const invalidUnion = (reason) => new SchemaDefinitionError('ERR_INVALID_UNION', `Union ${reason}`);

// The values of the discriminator field of a branch: the branch must be a
// struct whose field of that name is an enum, so the branch is known from
// one lookup.
const valuesOf = (branch, discriminator, index) => {
  const field = branch.type === 'schema' ? branch.schema[discriminator] : undefined;
  if (!field || !Array.isArray(field.enum)) {
    const reason = `branch ${index} needs an enum field "${discriminator}" to discriminate on`;
    throw invalidUnion(reason);
  }
  return field.enum;
};

// A value of one of several definitions: plain, or picked by the value of
// a discriminator field (checks/union.js has the check).
const union = {
  kind: 'struct',
  options: ['union', 'discriminator'],

  construct(def, prep) {
    const branches = def.union;
    if (!Array.isArray(branches) || branches.length === 0) {
      throw invalidUnion('needs a list of branches: { union: [...] }');
    }
    const built = [];
    for (let index = 0; index < branches.length; index += 1) {
      const { Type, defs } = prep.parse(branches[index]);
      if (!Type) throw invalidUnion(`branch ${index} cannot be a function`);
      built.push(new Type(defs, prep));
    }
    this.union = built;
    const { discriminator } = this;
    if (discriminator === undefined) return;
    if (typeof discriminator !== 'string' || discriminator === '') {
      throw invalidUnion('discriminator needs a field name');
    }
    const seen = new Set();
    for (let index = 0; index < built.length; index += 1) {
      const values = valuesOf(built[index], discriminator, index);
      // The branch is picked by the value before any default is applied, so
      // a default on the discriminator could never decide anything.
      if (built[index].schema[discriminator].default !== undefined) {
        throw invalidUnion(
          `discriminator "${discriminator}" of branch ${index} cannot have a default`,
        );
      }
      for (let at = 0; at < values.length; at += 1) {
        const value = values[at];
        if (seen.has(value)) {
          const shown = JSON.stringify(value);
          throw invalidUnion(`discriminator value ${shown} is in two branches`);
        }
        seen.add(value);
      }
    }
  },
};

module.exports = { union };
