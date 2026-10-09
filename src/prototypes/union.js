const { SchemaDefinitionError } = require('../errors.js');
const { issues } = require('../issues.js');

const invalidUnion = (reason) => new SchemaDefinitionError('ERR_INVALID_UNION', `Union ${reason}`);

// What a branch is called in the message of a value that matched none.
const nameOf = (branch) => (branch.type === 'schema' ? 'object' : branch.type);

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

// A value of one of several definitions. Without a discriminator the
// branches are tried in order and the first one that records nothing wins;
// what a failed branch recorded is dropped. With one, the branch is picked
// by the value of that field in one Map lookup.
const union = {
  kind: 'struct',

  construct(def, prep) {
    const branches = def.union;
    if (!Array.isArray(branches) || branches.length === 0) {
      throw invalidUnion('needs a list of branches: { union: [...] }');
    }
    this.union = branches.map((branch, index) => {
      const { Type, defs } = prep.parse(branch);
      if (!Type) throw invalidUnion(`branch ${index} cannot be a function`);
      return new Type(defs, prep);
    });
    const { discriminator } = this;
    if (discriminator === undefined) return;
    if (typeof discriminator !== 'string' || discriminator === '') {
      throw invalidUnion('discriminator needs a field name');
    }
    const seen = new Set();
    this.union.forEach((branch, index) => {
      for (const value of valuesOf(branch, discriminator, index)) {
        if (seen.has(value))
          throw invalidUnion(`discriminator value ${JSON.stringify(value)} is in two branches`);
        seen.add(value);
      }
    });
  },

  compile() {
    const { required, discriminator } = this;
    if (discriminator === undefined) return this.compilePlain(required);
    const table = new Map();
    for (const branch of this.union) {
      for (const value of branch.schema[discriminator].enum) table.set(value, branch.check);
    }
    const expected = Array.from(table.keys());
    return (value, context, key) => {
      if (value === null || typeof value !== 'object') {
        if (!required && value == null) return;
        issues.type(context, 'object', value, key);
        return;
      }
      const check = table.get(value[discriminator]);
      if (check !== undefined) {
        check(value, context, key);
        return;
      }
      const nested = key !== undefined;
      if (nested) context.path.push(key);
      issues.union(context, expected, discriminator, discriminator);
      if (nested) context.path.pop();
    };
  },

  compilePlain(required) {
    const checks = this.union.map((branch) => branch.check);
    const expected = this.union.map(nameOf);
    const { length } = checks;
    return (value, context, key) => {
      if (!required && value == null) return;
      const { count } = context;
      for (let index = 0; index < length; index += 1) {
        checks[index](value, context, key);
        if (context.count === count) return;
        context.issues.length = count;
        context.count = count;
      }
      issues.union(context, expected, undefined, key);
    };
  },
};

module.exports = { union };
