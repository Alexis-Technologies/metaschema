const { SchemaDefinitionError } = require('../errors.js');
const { isMap, isSet } = require('../util.js');

// The keys of a keyed collection are strings or numbers; anything else can
// never match a key, and the JIT quotes the key type into its source.
const invalidKey = (type) => {
  const reason = `Type "${type}" needs a key type of "string" or "number"`;
  return new SchemaDefinitionError('ERR_INVALID_DEFINITION', reason);
};

// The collections: a dictionary (`object`, `map`) of a key type and a value
// definition, a list (`array`, `set`) of an element definition. Their checks
// are in checks/collections.js.
const object = {
  rules: ['length'],
  options: ['key', 'value', 'length'],
  kind: 'struct',

  construct(def, prep) {
    const { type } = this;
    const { [type]: short, key, value } = def;
    let keyType = key;
    let valueDef = value;
    // The shorthand holds one pair: `{ object: { string: 'number' } }`.
    if (short !== null && typeof short === 'object') {
      for (const name in short) {
        if (!Object.hasOwn(short, name)) continue;
        keyType = name;
        valueDef = short[name];
        break;
      }
    }
    if (keyType !== 'string' && keyType !== 'number') throw invalidKey(type);
    this.key = keyType;
    const { Type, defs } = prep.parse(valueDef);
    this.value = new Type(defs, prep);
  },

  isInstance(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  },
};

const map = {
  ...object,

  isInstance(value) {
    return isMap(value);
  },
};

const array = {
  kind: 'struct',
  rules: ['length'],
  options: ['value', 'length'],

  construct(def, prep) {
    const { type } = this;
    const source = def[type] || def.value;
    const { Type, defs } = prep.parse(source);
    this.value = new Type(defs, prep);
  },

  isInstance(value) {
    return Array.isArray(value);
  },
};

const set = {
  ...array,

  isInstance(value) {
    return isSet(value);
  },
};

module.exports = { object, map, array, set };
