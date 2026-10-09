// Ukrainian messages, with the same table as ./en.js. Pass the table to a
// check as `messages`: `schema.check(value, { messages: uk })`.
const { shorten } = require('../util.js');

const field = (path) => `Поле "${path}"`;

const required = () => 'є обовʼязковим';

const type = ({ expected, key }) =>
  key === undefined ? `не відповідає типу: ${expected}` : `ключі мають бути типу ${expected}`;

const unexpected = ({ keys }) => `має неочікувані ключі: ${keys.map(shorten).join(', ')}`;

const enumeration = ({ values }) => `значення не входить до переліку: ${values.join(', ')}`;

const length = ({ min, actual }) =>
  min !== undefined && actual < min ? 'значення закоротке' : 'перевищує максимальну довжину';

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
  reference,
  circular,
  exception,
  custom,
};
