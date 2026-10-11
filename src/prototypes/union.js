const { SchemaDefinitionError } = require('../errors.js');
const { issues, release } = require('../issues.js');

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

// The branch of a discriminated union by the value of its discriminator, as
// a Map of value to branch index: built once per field, on first use, and
// shared by the check, the passes of parse and the JIT.
const TABLES = new WeakMap();

const tableOf = (field) => {
  let table = TABLES.get(field);
  if (table === undefined) {
    table = new Map();
    const { union: branches, discriminator } = field;
    for (let index = 0; index < branches.length; index += 1) {
      const values = branches[index].schema[discriminator].enum;
      for (let at = 0; at < values.length; at += 1) table.set(values[at], index);
    }
    TABLES.set(field, table);
  }
  return table;
};

// A value of one of several definitions. Without a discriminator the
// branches are tried in order and the first one that records nothing wins;
// what a failed branch recorded is dropped. With one, the branch is picked
// by the value of that field in one Map lookup.
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

  compile() {
    const { required, discriminator } = this;
    if (discriminator === undefined) return this.compilePlain(required);
    const checks = [];
    for (let index = 0; index < this.union.length; index += 1) checks.push(this.union[index].check);
    const table = tableOf(this);
    const expected = [];
    for (const value of table.keys()) expected.push(value);
    return (value, context, key) => {
      if (value === null || typeof value !== 'object') {
        if (!required && value == null) return;
        issues.type(context, 'object', value, key);
        return;
      }
      const index = table.get(value[discriminator]);
      if (index !== undefined) {
        checks[index](value, context, key);
        return;
      }
      const nested = key !== undefined;
      if (nested) context.path.push(key);
      issues.union(context, expected, discriminator, discriminator);
      if (nested) context.path.pop();
    };
  },

  compilePlain(required) {
    const checks = [];
    const expected = [];
    for (let index = 0; index < this.union.length; index += 1) {
      const branch = this.union[index];
      checks.push(branch.check);
      expected.push(nameOf(branch));
    }
    const { length } = checks;
    return (value, context, key) => {
      if (!required && value == null) return;
      const { count } = context;
      // The validators a failed branch set aside in an async check go with
      // its issues: they belong to a branch the value does not match.
      const pending = context.async === null ? 0 : context.async.length;
      for (let index = 0; index < length; index += 1) {
        checks[index](value, context, key);
        if (context.count === count) return;
        context.issues.length = count;
        context.count = count;
        if (context.async !== null) release(context.async, pending);
      }
      issues.union(context, expected, undefined, key);
    };
  },
};

module.exports = { union, nameOf, tableOf };
