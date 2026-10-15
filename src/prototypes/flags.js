const { SchemaDefinitionError } = require('../errors.js');
const { issues } = require('../issues.js');

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

  compile() {
    const { required, type } = this;
    // A null-prototype dictionary: a key such as `constructor` is not a name.
    const known = Object.create(null);
    for (const name of this.flags) known[name] = true;
    return (value, context, key) => {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        if (!required && value == null) return;
        issues.type(context, type, value, key);
        return;
      }
      const nested = key !== undefined;
      if (nested) context.path.push(key);
      let unexpected = null;
      for (const name in value) {
        if (!Object.hasOwn(value, name)) continue;
        if (context.count >= context.limit) break;
        if (known[name] === true) {
          const item = value[name];
          if (typeof item !== 'boolean') issues.type(context, 'boolean', item, name);
        } else if (context.unknown === 'reject') {
          if (unexpected === null) unexpected = [];
          unexpected.push(name);
        }
      }
      if (unexpected !== null && context.count < context.limit) {
        issues.unexpected(context, unexpected);
      }
      if (nested) context.path.pop();
    };
  },
};

module.exports = { flags };
