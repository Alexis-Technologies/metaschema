// The rule checks a field may carry besides its type. A rule is picked by
// name at construction (`rules: ['length']` on a prototype) and runs after the
// type check with the field, the value and the context.
const { issues } = require('./issues.js');

// The length of a value: the size of a Map or Set, the length of a string
// or an array, the number of keys of an object, and for a number its value.
const lengthOf = (value) => {
  if (typeof value === 'object') {
    const { size, length } = value;
    if (typeof size === 'number') return size;
    if (typeof length === 'number') return length;
    return Object.keys(value).length;
  }
  if (typeof value === 'string') return value.length;
  return Number(value);
};

const checks = {
  length: (value, type, context) => {
    const { min, max } = type.length;
    const actual = lengthOf(value);
    const short = min !== undefined && actual < min;
    const long = max !== undefined && actual > max;
    if (short || long) issues.length(context, min, max, actual);
  },
};

module.exports = { checks };
