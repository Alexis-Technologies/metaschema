// The English messages. A locale is a table of renderers by issue code: each
// one turns the params of an issue into the text that follows the field in a
// message. `field` renders the location prefix of an error line.
const { shorten } = require('../util.js');

const field = (path) => `Field "${path}"`;

const required = () => 'is required';

const type = ({ expected, key }) =>
  key === undefined ? `not of expected type: ${expected}` : `keys must be of type ${expected}`;

const unexpected = ({ keys }) => `has unexpected keys: ${keys.map(shorten).join(', ')}`;

const enumeration = ({ values }) => `value is not of enum: ${values.join(', ')}`;

const length = ({ min, actual }) =>
  min !== undefined && actual < min ? 'value is too short' : 'exceeds the maximum length';

const reference = ({ entity }) => `Entity "${entity}" is not found`;

const circular = () => 'is a circular reference';

const exception = ({ error }) => `validation failed ${error}`;

const custom = () => 'validation error';

module.exports = {
  field,
  required,
  type,
  unexpected,
  enum: enumeration,
  length,
  reference,
  circular,
  exception,
  custom,
};
