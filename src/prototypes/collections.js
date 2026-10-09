const { ValidationResult } = require('../metadata.js');
const { issue, shorten } = require('../util.js');

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

  checkType(source, path, context) {
    if (!this.isInstance(source)) {
      return issue('type', path, `not of expected type: ${this.type}`);
    }
    const entries = this.entries(source);
    if (entries.length === 0 && this.required) return issue('required', path, 'is required');
    const result = new ValidationResult(path, context);
    for (const pair of entries) {
      if (result.full) break;
      const field = pair[0];
      const fieldValue = pair[1];
      // oxlint-disable-next-line valid-typeof
      if (typeof field !== this.key) {
        return result.add(issue('type', path, `keys must be of type ${this.key}`));
      }
      result.add(this.value.check(fieldValue, `${path}.${shorten(field)}`, context));
    }
    return result;
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

  checkType(source, path, context) {
    if (!this.isInstance(source)) {
      return issue('type', path, `not of expected type: ${this.type}`);
    }
    // A Set is copied to index it; an array is walked as it is.
    const value = Array.isArray(source) ? source : [...source];
    const result = new ValidationResult(path, context);
    for (let index = 0; index < value.length; index += 1) {
      if (result.full) break;
      result.add(this.value.check(value[index], `${path}[${index}]`, context));
    }
    return result;
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
