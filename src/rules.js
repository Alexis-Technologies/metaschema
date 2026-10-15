// The rules a field may carry besides its type. A type lists the rules it
// accepts (`rules: ['length']` on a prototype); a rule in a definition of a
// type that does not accept it is a definition error, not a silent no-op. A
// rule's value is checked and normalized when the field is built (`format`);
// its check is the validation half's (`compileRules` of `checks.js`),
// compiled into a closure over the field's bounds and run after the type
// check.
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

// The formatter of each rule, by name; the names are the rules that exist. A
// null-prototype dictionary: a definition key may be called `constructor`.
// The formats a string may name (`format: 'email'`): a null-prototype table
// of `{ test, examples }` entries, empty until `register()` of the formats
// subpath fills it (the core knows the rule, the subpath the formats), read
// when the field is built. A name the table lacks is a definition error with
// the hint, never a check that passes everything.
const FORMATS = Object.create(null);

// The entry a field's format named when the field was built: a format the
// program registers later under that name does not change the field, whose
// check is compiled on its first use.
const NAMED = new WeakMap();

const formatName = (value, type) => {
  if (typeof value !== 'string') throw invalidRule('Rule "format" needs the name of a format');
  if (FORMATS[value] === undefined) {
    const hint = 'register() of @alexify/metaschema/formats';
    throw invalidRule(`Rule "format" names a format that is not registered: "${value}" (${hint})`);
  }
  NAMED.set(type, FORMATS[value]);
  return value;
};

const formatOf = (type) => NAMED.get(type);

// The decimals a number may have: what a double holds exactly in a fraction.
const formatDecimals = (value) => {
  if (!Number.isInteger(value) || value < 0 || value > 15) {
    throw invalidRule('Rule "decimals" needs an integer from 0 to 15');
  }
  return value;
};

const FORMAT = Object.assign(Object.create(null), {
  length: formatLength,
  min: formatLimit('min'),
  max: formatLimit('max'),
  pattern: formatPattern,
  format: formatName,
  decimals: formatDecimals,
});

// The bounds of a field leave room for a value: the definition is checked
// when the field is built, its check compiled later.
const checkBounds = (type) => {
  const { min, max } = type;
  if (min !== undefined && max !== undefined && min > max) {
    throw invalidRule('Rule "max" is below "min"');
  }
};

const notApplicable = (rule, type, rules) => {
  const hint = rule === 'length' && rules.has('min') ? '; use min and max' : '';
  return invalidRule(`Rule "${rule}" does not apply to type "${type}"${hint}`);
};

module.exports = { FORMAT, FORMATS, formatOf, checkBounds, notApplicable };
