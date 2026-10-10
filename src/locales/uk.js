// Ukrainian messages, with the same table as ./en.js. Pass the table to a
// check as `messages`: `schema.check(value, { messages: uk })`.
const { shorten } = require('../util.js');

const field = (path) => `Поле "${path}"`;

const required = () => 'є обовʼязковим';

const type = ({ expected, key }) =>
  key === undefined ? `не відповідає типу: ${expected}` : `ключі мають бути типу ${expected}`;

const list = (keys) => {
  let text = shorten(keys[0]);
  for (let index = 1; index < keys.length; index += 1) text += `, ${shorten(keys[index])}`;
  return text;
};

const unexpected = ({ keys }) => `має неочікувані ключі: ${list(keys)}`;

const enumeration = ({ values }) => `значення не входить до переліку: ${values.join(', ')}`;

const length = ({ min, actual }) =>
  min !== undefined && actual < min ? 'значення закоротке' : 'перевищує максимальну довжину';

const range = ({ min, max, actual }) =>
  min !== undefined && actual < min ? `менше за ${min}` : `більше за ${max}`;

const pattern = ({ pattern: source }) => `не відповідає шаблону ${source}`;

const union = ({ expected, discriminator }) =>
  discriminator === undefined
    ? `не відповідає жодному з: ${expected.join(', ')}`
    : `не є одним із: ${expected.join(', ')}`;

const reference = ({ entity }) => `сутність "${entity}" не знайдено`;

const circular = () => 'є циклічним посиланням';

const exception = ({ error }) => `перевірка завершилась помилкою ${error}`;

const custom = () => 'помилка перевірки';

module.exports = {
  field,
  required,
  type,
  unexpected,
  enum: enumeration,
  length,
  range,
  pattern,
  union,
  reference,
  circular,
  exception,
  custom,
};
