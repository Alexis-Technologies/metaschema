const { SchemaDefinitionError } = require('../errors.js');

const invalidFlags = (type) => {
  const hint = `Type "${type}" needs a list of distinct names: { ${type}: ['read', 'write'] }`;
  return new SchemaDefinitionError('ERR_INVALID_DEFINITION', hint);
};

// A set of named switches: an object whose keys are names of the list, each
// true or false, any of them left out. A key the list does not have is one
// the schema does not have, reported as `unexpected` under the unknown-keys
// policy of the check, as a struct reports its own.
const flags = {
  kind: 'struct',
  options: ['flags'],

  construct(def) {
    const names = def.flags;
    if (!Array.isArray(names) || names.length === 0) throw invalidFlags(this.type);
    const seen = new Set();
    for (const name of names) {
      if (typeof name !== 'string' || name === '' || name === '__proto__' || seen.has(name)) {
        throw invalidFlags(this.type);
      }
      seen.add(name);
    }
    this.flags = names;
  },
};

module.exports = { flags };
