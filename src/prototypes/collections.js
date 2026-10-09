const { issues } = require('../issues.js');

// Collections iterate their source directly: an object with for...in over
// its own keys, a Map and a Set through their iterators, an array by index.
// A collection pushes its own key on the path before its elements and pops
// it after them; an element is checked with its key or index.
const object = {
  rules: ['length'],
  kind: 'struct',

  construct(def, prep) {
    const { type } = this;
    const { [type]: short, key, value } = def;
    const pair = short ? Object.entries(short)[0] : [key, value];
    const keyType = pair[0];
    const valueDef = pair[1];
    this.key = keyType;
    const { Type, defs } = prep.parse(valueDef);
    this.value = new Type(defs, prep);
  },

  compile() {
    const { required, type, key: keyType } = this;
    const { check } = this.value;
    return (value, context, key) => {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        if (!required && value == null) return;
        issues.type(context, type, value, key);
        return;
      }
      const nested = key !== undefined;
      if (nested) context.path.push(key);
      let count = 0;
      for (const name in value) {
        if (!Object.hasOwn(value, name)) continue;
        if (context.count >= context.limit) break;
        count += 1;
        // oxlint-disable-next-line valid-typeof
        if (typeof name !== keyType) {
          issues.key(context, keyType, name);
          break;
        }
        check(value[name], context, name);
      }
      if (count === 0 && required) issues.required(context);
      if (nested) context.path.pop();
    };
  },

  isInstance(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  },
};

const map = {
  ...object,

  compile() {
    const { required, type, key: keyType } = this;
    const { check } = this.value;
    return (value, context, key) => {
      if (value?.constructor?.name !== 'Map') {
        if (!required && value == null) return;
        issues.type(context, type, value, key);
        return;
      }
      if (value.size === 0) {
        if (required) issues.required(context, key);
        return;
      }
      const nested = key !== undefined;
      if (nested) context.path.push(key);
      for (const pair of value) {
        if (context.count >= context.limit) break;
        const name = pair[0];
        // oxlint-disable-next-line valid-typeof
        if (typeof name !== keyType) {
          issues.key(context, keyType, name);
          break;
        }
        check(pair[1], context, name);
      }
      if (nested) context.path.pop();
    };
  },

  isInstance(value) {
    return value?.constructor?.name === 'Map';
  },
};

// An array and a Set are walked the same way, by position; only the type
// test differs.
const compileList = (type, isList) => {
  const { required } = type;
  const { check } = type.value;
  const name = type.type;
  return (value, context, key) => {
    if (!isList(value)) {
      if (!required && value == null) return;
      issues.type(context, name, value, key);
      return;
    }
    const nested = key !== undefined;
    if (nested) context.path.push(key);
    let index = 0;
    for (const item of value) {
      if (context.count >= context.limit) break;
      check(item, context, index);
      index += 1;
    }
    if (nested) context.path.pop();
  };
};

const array = {
  kind: 'struct',
  rules: ['length'],

  construct(def, prep) {
    const { type } = this;
    const source = def[type] || def.value;
    const { Type, defs } = prep.parse(source);
    this.value = new Type(defs, prep);
  },

  compile() {
    return compileList(this, this.isInstance);
  },

  isInstance(value) {
    return Array.isArray(value);
  },
};

const set = {
  ...array,

  isInstance(value) {
    return value?.constructor?.name === 'Set';
  },
};

module.exports = { object, map, array, set };
