// The rule checks a field may carry besides its type. A type lists the rules
// it accepts (`rules: ['length']` on a prototype); a rule in a definition of a
// type that does not accept it is a definition error, not a silent no-op. A
// rule's value is checked and normalized when the field is built (`format`),
// and its check is compiled into a closure over the field's bounds, run after
// the type check.
const { issues } = require('./issues.js');
const { SchemaDefinitionError } = require('./errors.js');

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

// The formatter of each rule, by name; the names are the rules that exist.
const FORMAT = {
  length: formatLength,
  min: formatLimit('min'),
  max: formatLimit('max'),
  pattern: formatPattern,
};

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

// The length of a value: the size of a Map or Set, the length of a string or
// an array, the number of keys of an object. A string is UTF-16 units unless
// the field asks for code points.
const lengthOf = (value) => {
  if (typeof value === 'string') return value.length;
  const { size, length } = value;
  if (typeof size === 'number') return size;
  if (typeof length === 'number') return length;
  return Object.keys(value).length;
};

const lengthOfUnicode = (value) =>
  typeof value === 'string' ? codePoints(value) : lengthOf(value);

const compileLength = (type) => {
  const { min, max } = type.length;
  const measure = type.unicode === true ? lengthOfUnicode : lengthOf;
  return (value, context, key) => {
    const actual = measure(value);
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

const compilePattern = (type) => {
  const { pattern } = type;
  const { source } = pattern;
  return (value, context, key) => {
    if (!pattern.test(value)) issues.pattern(context, source, key);
  };
};

// The checks of the rules a field carries, in the order the type lists them.
const compileRules = (type, rules) => {
  const checks = [];
  let range = false;
  for (const name of rules) {
    if (type[name] === undefined) continue;
    if (name === 'length') checks.push(compileLength(type));
    else if (name === 'pattern') checks.push(compilePattern(type));
    else if (name === 'min' || name === 'max') range = true;
  }
  if (range) checks.push(compileRange(type));
  return checks;
};

module.exports = { FORMAT, notApplicable, compileRules, codePoints };
