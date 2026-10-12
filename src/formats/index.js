// The `./formats` subpath: the formats a string field may name
// (`{ type: 'string', format: 'email' }`). The core knows the rule and keeps
// an empty table (`FORMATS` in rules.js); `register()` fills it with the
// nine formats below and with the program's own, so that a program that
// validates no email carries no email expression. Each format is a `test`
// function over a string, a few `examples` for `sample`, and whether `infer`
// may read it out of data (a format every word passes, like a hostname,
// says not to).
//
// The expressions of email, uuid, uri, hostname, ipv4 and ipv6 are those of
// the fast mode of ajv-formats 3.0.1 (MIT, Copyright (c) 2020 Evgeny
// Poberezkin), copied with the attribution the project gives for a helper
// it carries instead of a dependency; they are anchored and linear, with
// every repetition bounded. The date and time forms are RFC 3339 with the
// ranges checked (a 31st of February is not a date).
const { FORMATS } = require('../rules.js');
const { SchemaDefinitionError } = require('../errors.js');

const invalidFormat = (name, reason) =>
  new SchemaDefinitionError('ERR_INVALID_FORMAT', `Format "${name}" ${reason}`);

const EMAIL =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;

const UUID = /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

const URI = /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/)?[^\s]*$/i;

const HOSTNAME =
  /^(?=.{1,253}\.?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[-0-9a-z]{0,61}[0-9a-z])?)*\.?$/i;

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

const IPV6 =
  /^((([0-9a-f]{1,4}:){7}([0-9a-f]{1,4}|:))|(([0-9a-f]{1,4}:){6}(:[0-9a-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){5}(((:[0-9a-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){4}(((:[0-9a-f]{1,4}){1,3})|((:[0-9a-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){3}(((:[0-9a-f]{1,4}){1,4})|((:[0-9a-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){2}(((:[0-9a-f]{1,4}){1,5})|((:[0-9a-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){1}(((:[0-9a-f]{1,4}){1,6})|((:[0-9a-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9a-f]{1,4}){1,7})|((:[0-9a-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))$/i;

// A full-date of RFC 3339 with the day within its month, and a full-time
// (an offset is required, as the RFC says; a leap second is allowed).
const DATE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

const DAYS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const isDate = (text) => {
  const match = DATE.exec(text);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const leap = month === 2 && year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return Number(match[3]) <= DAYS[month] + (leap ? 1 : 0);
};

const TIME =
  /^([01]\d|2[0-3]):([0-5]\d):([0-5]\d|60)(?:\.\d+)?(?:[zZ]|([+-])([01]\d|2[0-3])(?::?([0-5]\d))?)$/;

// A leap second is the one of 23:59:60 UTC, whatever the offset says.
const isTime = (text) => {
  const match = TIME.exec(text);
  if (match === null) return false;
  if (match[3] !== '60') return true;
  const sign = match[4] === '-' ? -1 : 1;
  const offset =
    match[4] === undefined ? 0 : sign * (Number(match[5]) * 60 + Number(match[6] ?? 0));
  const minutes = (Number(match[1]) * 60 + Number(match[2]) - offset + 1440) % 1440;
  return minutes === 23 * 60 + 59;
};

// A date-time is the two joined by `T` (or, as the RFC allows for
// readability, a space).
const isDateTime = (text) =>
  text.length > 11 &&
  (text[10] === 'T' || text[10] === 't' || text[10] === ' ') &&
  isDate(text.slice(0, 10)) &&
  isTime(text.slice(11));

const tested = (expression) => (text) => expression.test(text);

// In the order `infer` tries them: a form that is also a hostname (a uuid,
// a date, an address) comes before it, and a hostname is never inferred,
// since every word is one.
const BUILT_IN = {
  uuid: {
    test: tested(UUID),
    examples: ['550e8400-e29b-41d4-a716-446655440000', '123e4567-e89b-12d3-a456-426614174000'],
  },
  email: { test: tested(EMAIL), examples: ['ann@example.com', 'ann.lee@mail.example.org'] },
  'date-time': {
    test: isDateTime,
    examples: ['2026-10-11T12:00:00Z', '2026-10-11T12:00:00.000+02:00'],
  },
  date: { test: isDate, examples: ['2026-10-11', '2000-02-29'] },
  time: { test: isTime, examples: ['12:00:00Z', '23:59:59.999+02:00'] },
  ipv4: { test: tested(IPV4), examples: ['192.168.0.1', '10.0.0.255'] },
  ipv6: { test: tested(IPV6), examples: ['::1', '2001:db8::ff00:42:8329'] },
  uri: { test: tested(URI), examples: ['https://example.com/path?q=1', 'mailto:ann@example.com'] },
  hostname: { test: tested(HOSTNAME), examples: ['example.com', 'api.example.org'], infer: false },
};

// An entry as the table keeps it: the test, a copy of the examples, and
// whether infer may read it, frozen.
const entryOf = (name, entry) => {
  if (entry === null || typeof entry !== 'object') {
    throw invalidFormat(name, 'needs { test, examples }');
  }
  const { test, examples, infer } = entry;
  if (typeof test !== 'function') throw invalidFormat(name, 'needs a test function');
  const listed = Array.isArray(examples) && examples.length > 0;
  if (!listed) throw invalidFormat(name, 'needs a list of example strings');
  for (let index = 0; index < examples.length; index += 1) {
    if (typeof examples[index] !== 'string') {
      throw invalidFormat(name, 'needs a list of example strings');
    }
  }
  if (infer !== undefined && typeof infer !== 'boolean') {
    throw invalidFormat(name, 'needs a boolean infer');
  }
  return Object.freeze({ test, examples: Object.freeze(examples.slice()), infer: infer !== false });
};

// A name is registered once: the same test again is nothing, another test
// under a registered name is an error, since the schemas built so far hold
// the first one.
const add = (name, entry) => {
  if (name === '') throw invalidFormat(name, 'needs a name');
  const known = FORMATS[name];
  if (known !== undefined) {
    if (known.test === entry.test) return;
    throw new SchemaDefinitionError(
      'ERR_FORMAT_REGISTERED',
      `Format "${name}" is already registered with another test`,
    );
  }
  FORMATS[name] = entryOf(name, entry);
};

// Registers the built-in formats and the program's own
// (`{ phone: { test, examples } }`); once per name, process-wide, like the
// type registry. Importing the subpath registers nothing.
const register = (custom = {}) => {
  if (custom === null || typeof custom !== 'object') {
    throw new SchemaDefinitionError('ERR_INVALID_FORMAT', 'Formats must be an object of entries');
  }
  for (const name of Object.keys(BUILT_IN)) add(name, BUILT_IN[name]);
  for (const name of Object.keys(custom)) add(name, custom[name]);
};

module.exports = { FORMATS, register };
