// The rule checks a field may carry besides its type. A type lists the rules
// it accepts (`rules: ['length']` on a prototype); a rule in a definition of a
// type that does not accept it is a definition error, not a silent no-op. A
// rule's value is checked and normalized when the field is built (`format`),
// and its check is compiled into a closure over the field's bounds, run after
// the type check.
const { issues } = require('./issues.js');
const { SchemaDefinitionError } = require('./errors.js');
const { isMap, isSet } = require('./util.js');

const invalidRule = (reason) => new SchemaDefinitionError('ERR_INVALID_RULE', reason);

const invalidLength = (reason = 'needs a number, [min, max] or { min, max }') =>
  new SchemaDefinitionError('ERR_INVALID_LENGTH', `Rule "length" ${reason}`);

const isBound = (value) => value === undefined || typeof value === 'number';

const isLimit = (value) => typeof value === 'number' || typeof value === 'bigint';

const formatLength = (length) => {
  if (typeof length === 'number') return { max: length };
  if (length === null || typeof length !== 'object') throw invalidLength();
  const min = Array.isArray(length) ? length[0] : length.min;
  const max = Array.isArray(length) ? length[1] : length.max;
  if (!isBound(min) || !isBound(max)) throw invalidLength();
  if (min !== undefined && max !== undefined && min > max) throw invalidLength('has min above max');
  return { min, max };
};

// A number or a bigint, kept as it is: a bigint bound compared with a number
// value (and the other way round) is exact in JavaScript, Number(bigint) is not.
const formatLimit = (name) => (value) => {
  if (!isLimit(value)) throw invalidRule(`Rule "${name}" needs a number or a bigint`);
  return value;
};

// A pattern is compiled once, here, with the `u` flag (so `\p{L}` and
// astral characters mean what they say), and without `g` and `y`, whose
// lastIndex would make the same test give different answers in a row.
const formatPattern = (value) => {
  const isRegExp = value instanceof RegExp;
  if (!isRegExp && typeof value !== 'string') {
    throw invalidRule('Rule "pattern" needs a string or a RegExp');
  }
  const source = isRegExp ? value.source : value;
  const given = isRegExp ? value.flags.replace(/[guy]/g, '') : '';
  try {
    return new RegExp(source, `${given}u`);
  } catch (error) {
    throw invalidRule(`Rule "pattern" is not a valid regular expression: ${error.message}`);
  }
};

// The formatter of each rule, by name; the names are the rules that exist. A
// null-prototype dictionary: a definition key may be called `constructor`.
const FORMAT = Object.assign(Object.create(null), {
  length: formatLength,
  min: formatLimit('min'),
  max: formatLimit('max'),
  pattern: formatPattern,
});

const notApplicable = (rule, type, rules) => {
  const hint = rule === 'length' && rules.has('min') ? '; use min and max' : '';
  return invalidRule(`Rule "${rule}" does not apply to type "${type}"${hint}`);
};

// Code points of a string: a surrogate pair counts once, a lone surrogate
// once too.
const codePoints = (text) => {
  const { length } = text;
  let count = 0;
  for (let index = 0; index < length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) index += 1;
    }
    count += 1;
  }
  return count;
};

// The own keys of an object, counted without a list of them.
const keyCount = (value) => {
  let count = 0;
  for (const name in value) if (Object.hasOwn(value, name)) count += 1;
  return count;
};

// The length of a value, by what the value is rather than by what it carries
// (an object with a `size` key is an object): the units of a string, the
// length of an array, the size of a Set or a Map, the own keys of an object.
const lengthOf = (value) => {
  if (typeof value === 'string' || Array.isArray(value)) return value.length;
  return isMap(value) || isSet(value) ? value.size : keyCount(value);
};

// A string field measures its units, or its code points when it asks for
// them; anything else is measured by what it is. One closure per case, each
// calling its measure directly: a measure held in a variable is a call site
// shared by every length rule of the process, which V8 then cannot inline.
const compileLength = (type) => {
  const { min, max } = type.length;
  if (type.scalar === 'string') {
    if (type.unicode === true) {
      return (value, context, key) => {
        const actual = codePoints(value);
        const short = min !== undefined && actual < min;
        const long = max !== undefined && actual > max;
        if (short || long) issues.length(context, min, max, actual, key);
      };
    }
    return (value, context, key) => {
      const actual = value.length;
      const short = min !== undefined && actual < min;
      const long = max !== undefined && actual > max;
      if (short || long) issues.length(context, min, max, actual, key);
    };
  }
  return (value, context, key) => {
    const actual = lengthOf(value);
    const short = min !== undefined && actual < min;
    const long = max !== undefined && actual > max;
    if (short || long) issues.length(context, min, max, actual, key);
  };
};

// One closure for both bounds when a field has both.
const compileRange = (type) => {
  const { min, max } = type;
  if (min === undefined) {
    return (value, context, key) => {
      if (value > max) issues.range(context, min, max, value, key);
    };
  }
  if (max === undefined) {
    return (value, context, key) => {
      if (value < min) issues.range(context, min, max, value, key);
    };
  }
  if (min > max) throw invalidRule('Rule "max" is below "min"');
  return (value, context, key) => {
    if (value < min || value > max) issues.range(context, min, max, value, key);
  };
};

// The units a pattern may be run over: `length.max` (twice it when the
// length counts code points, each at most two units), so that a string past
// the bound, reported for its length already, never reaches a pattern that
// backtracks over it; no limit without the bound.
const patternLimit = (type) => {
  const max = type.length?.max;
  if (max === undefined) return Infinity;
  return type.unicode === true ? 2 * max : max;
};

const compilePattern = (type) => {
  const { pattern } = type;
  const { source } = pattern;
  const limit = patternLimit(type);
  return (value, context, key) => {
    if (value.length <= limit && !pattern.test(value)) issues.pattern(context, source, key);
  };
};

// The rules a field carries, by name, in the order its type lists them, min
// and max as the one `range`: the order the closures run them in and the JIT
// emits them in.
const ruleNames = (type) => {
  const names = [];
  let range = false;
  for (const name of type.constructor.rules) {
    if (type[name] === undefined) continue;
    if (name === 'min' || name === 'max') range = true;
    else names.push(name);
  }
  if (range) names.push('range');
  return names;
};

const COMPILERS = Object.assign(Object.create(null), {
  length: compileLength,
  pattern: compilePattern,
  range: compileRange,
});

// The checks of the rules a field carries.
const compileRules = (type) => {
  const names = ruleNames(type);
  const checks = [];
  for (let index = 0; index < names.length; index += 1) checks.push(COMPILERS[names[index]](type));
  return checks;
};

module.exports = {
  FORMAT,
  notApplicable,
  ruleNames,
  compileRules,
  patternLimit,
  codePoints,
  lengthOf,
};
