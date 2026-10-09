const { issues } = require('../issues.js');

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

  checkValue(source, context) {
    if (!this.isInstance(source)) {
      issues.type(context, this.type, source);
      return;
    }
    const entries = this.entries(source);
    if (entries.length === 0 && this.required) {
      issues.required(context);
      return;
    }
    const { path } = context;
    for (const pair of entries) {
      if (context.count >= context.limit) return;
      const field = pair[0];
      // oxlint-disable-next-line valid-typeof
      if (typeof field !== this.key) {
        issues.key(context, this.key, field);
        return;
      }
      path.push(field);
      this.value.check(pair[1], context);
      path.pop();
    }
  },

  isInstance(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  },

  entries(value) {
    return Object.entries(value);
  },
};

const map = {
  ...object,

  isInstance(value) {
    return value?.constructor?.name === 'Map';
  },

  entries(value) {
    return [...value.entries()];
  },
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

  checkValue(source, context) {
    if (!this.isInstance(source)) {
      issues.type(context, this.type, source);
      return;
    }
    // A Set is copied to index it; an array is walked as it is.
    const value = Array.isArray(source) ? source : [...source];
    const { path } = context;
    for (let index = 0; index < value.length; index += 1) {
      if (context.count >= context.limit) return;
      path.push(index);
      this.value.check(value[index], context);
      path.pop();
    }
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
