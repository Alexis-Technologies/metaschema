// The English messages. A locale is a table of renderers by issue code: each
// one turns the params of an issue into the text that follows the field in a
// message. `field` renders the location prefix of an error line.
const { shorten, safeString } = require('../util.js');

const field = (path) => `Field "${path}"`;

const required = () => 'is required';

const type = ({ expected, key }) =>
  key === undefined ? `not of expected type: ${expected}` : `keys must be of type ${expected}`;

// The first keys of the list and how many more there are: a value with a
// million keys the schema does not have is one issue, and its message is
// not the million keys.
const SHOWN = 10;

const list = (keys) => {
  const count = Math.min(keys.length, SHOWN);
  let text = shorten(keys[0]);
  for (let index = 1; index < count; index += 1) text += `, ${shorten(keys[index])}`;
  return keys.length > SHOWN ? `${text} and ${keys.length - SHOWN} more` : text;
};

const unexpected = ({ keys }) => `has unexpected keys: ${list(keys)}`;

const enumeration = ({ values }) => `value is not of enum: ${values.join(', ')}`;

const length = ({ min, actual }) =>
  min !== undefined && actual < min ? 'value is too short' : 'exceeds the maximum length';

const range = ({ min, max, actual }) =>
  min !== undefined && actual < min ? `is less than ${min}` : `is greater than ${max}`;

const pattern = ({ pattern: source }) => `does not match the pattern ${source}`;

const format = ({ format: name }) => `is not a valid ${name}`;

const decimals = ({ decimals: count, received }) =>
  received === undefined
    ? `has more than ${count} decimals`
    : `is ${received}, not a finite number`;

const union = ({ expected, discriminator }) =>
  discriminator === undefined
    ? `does not match any of: ${expected.join(', ')}`
    : `is not one of: ${expected.join(', ')}`;

const reference = ({ entity }) => `Entity "${entity}" is not found`;

const circular = () => 'is a circular reference';

const depth = ({ max }) => `is nested deeper than ${max} references`;

const exception = ({ error }) => `validation failed ${safeString(error)}`;

const custom = () => 'validation error';

module.exports = {
  field,
  required,
  type,
  unexpected,
  enum: enumeration,
  length,
  range,
  pattern,
  format,
  decimals,
  union,
  reference,
  circular,
  depth,
  exception,
  custom,
};

// A table without a prototype: a code a validator makes up (`constructor`)
// finds no renderer here. Set after the literal, which cjs-module-lexer reads
// for the named exports of the ESM interop.
Object.setPrototypeOf(module.exports, null);
