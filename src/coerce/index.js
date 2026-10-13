// The `./coerce` subpath: the converters of coercion, by type name. The core
// has the policy (`coerce` of a parse call, of the kind metadata, of a field)
// and the step in the pass before the check; it converts nothing until
// register() installed the table here. The converters are strict: a string
// is a number only when it is written as one, a boolean only as `true`,
// `false`, `1` or `0`, a date only with its zone, and the empty string is
// never converted. A value a converter cannot read comes back as it was, so
// the check reports it as given.
const { hasBrand, isSet, isMap } = require('../util.js');
const { isFirstLower } = require('../metautil.js');
const { Schema } = require('../schema.js');
const { createContext } = require('../context.js');
const { COERCE, COERCION, PREPARE, infoOf, apply, wantOf, looped } = require('../codec.js');
const { SchemaDefinitionError, invalidTarget } = require('../errors.js');

const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const INTEGER = /^[+-]?\d+$/;
const ISO =
  /^(\d{4})-(\d{2})-(\d{2})(?:[Tt ]([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:[Zz]|[+-](?:[01]\d|2[0-3]):[0-5]\d))?$/;
const SAFE = BigInt(Number.MAX_SAFE_INTEGER);

const toNumber = (value) => {
  if (typeof value === 'string') {
    if (!DECIMAL.test(value)) return value;
    const number = Number(value);
    return Number.isFinite(number) ? number : value;
  }
  if (typeof value === 'bigint' && value >= -SAFE && value <= SAFE) return Number(value);
  return value;
};

const toInteger = (value) => {
  const number = toNumber(value);
  return Number.isSafeInteger(number) ? number : value;
};

const toBigint = (value) => {
  if (typeof value === 'string') return INTEGER.test(value) ? BigInt(value) : value;
  return Number.isSafeInteger(value) ? BigInt(value) : value;
};

const toBoolean = (value) => {
  if (value === 'true' || value === '1' || value === 1) return true;
  if (value === 'false' || value === '0' || value === 0) return false;
  return value;
};

const isLeap = (year) => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

const daysIn = (year, month) => {
  if (month === 2) return isLeap(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
};

// A calendar date (midnight UTC) or a date-time with its zone: a local time
// would depend on the zone of the server. The engine rolls `2026-02-31`
// over to March, so the day is checked here.
const toDate = (value) => {
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date;
  }
  if (typeof value !== 'string') return value;
  const match = ISO.exec(value);
  if (match === null) return value;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysIn(Number(match[1]), month)) return value;
  const text = match[4] === undefined ? value : `${value.slice(0, 10)}T${value.slice(11)}`;
  const date = new Date(text.toUpperCase());
  return Number.isNaN(date.getTime()) ? value : date;
};

const toText = (value) => {
  const type = typeof value;
  if (type === 'number') return Number.isFinite(value) ? String(value) : value;
  return type === 'bigint' || type === 'boolean' ? String(value) : value;
};

const isPrimitive = (value) => {
  const type = typeof value;
  return type === 'number' || type === 'boolean' || type === 'bigint';
};

// The member a value is written as: a string for a number, a boolean or a
// bigint member, or one of those for a string member.
const toEnum = (value, field) => {
  const members = field.enum;
  if (members.includes(value)) return value;
  const text = typeof value === 'string';
  if (!text && !isPrimitive(value)) return value;
  for (const member of members) {
    if (text ? isPrimitive(member) && String(member) === value : member === String(value)) {
      return member;
    }
  }
  return value;
};

// A single value where a list is expected (`?tag=a` against `?tag=a&tag=b`).
const isItem = (value) => (typeof value === 'string' ? value !== '' : isPrimitive(value));

const toArray = (value) => {
  if (isSet(value)) return Array.from(value);
  return isItem(value) ? [value] : value;
};

const toSet = (value) => {
  if (Array.isArray(value)) return new Set(value);
  return isItem(value) ? new Set([value]) : value;
};

const isPairs = (value) => {
  for (const pair of value) if (!Array.isArray(pair) || pair.length !== 2) return false;
  return true;
};

// A plain object or a list of pairs; the keys of a map of numbers that are
// written as numbers become numbers.
const toMap = (value, field) => {
  if (value === null || typeof value !== 'object' || isMap(value)) return value;
  const list = Array.isArray(value);
  if (list && !isPairs(value)) return value;
  const map = new Map();
  for (const pair of list ? value : Object.entries(value)) {
    const key = field.key === 'number' && typeof pair[0] === 'string' ? toNumber(pair[0]) : pair[0];
    map.set(key, pair[1]);
  }
  return map;
};

const BUILT_IN = {
  string: toText,
  number: toNumber,
  integer: toInteger,
  bigint: toBigint,
  boolean: toBoolean,
  date: toDate,
  enum: toEnum,
  array: toArray,
  set: toSet,
  map: toMap,
};

// The table: a converter by type name, `(value, field) => value`.
const COERCIONS = Object.create(null);

const invalidCoercion = (reason) => new SchemaDefinitionError('ERR_INVALID_COERCION', reason);

// The converter of a field: its type's, or the one of the type it is an
// alias of (`{ money: { js: 'number' } }` converts as a number); an alias
// names a type registered before it, so the chain ends. Cached per field,
// and dropped when the table changes.
let converters = new WeakMap();

const converterOf = (field) => {
  let Type = field.constructor;
  let name = field.type;
  for (;;) {
    const converter = COERCIONS[name];
    if (converter !== undefined) return converter;
    const js = Type?.source?.js;
    if (typeof js !== 'string') return null;
    name = js;
    Type = field.root.types[js];
  }
};

// What the core calls for every node of a coercing pass: a node that is not
// a field (a schema, a struct) has nothing to convert of its own, and a
// converter that throws leaves the value to the check.
const convert = (value, node) => {
  let converter = converters.get(node);
  if (converter === undefined) {
    converter = hasBrand(node, 'Type') ? converterOf(node) : null;
    converters.set(node, converter);
  }
  if (converter === null) return value;
  try {
    return converter(value, node);
  } catch {
    return value;
  }
};

const add = (name, converter) => {
  if (!isFirstLower(name)) throw invalidCoercion(`Converter "${name}" needs the name of a type`);
  if (typeof converter !== 'function') {
    throw invalidCoercion(`Converter "${name}" must be a function`);
  }
  const known = COERCIONS[name];
  if (known === converter) return;
  if (known !== undefined) {
    const reason = `Converter "${name}" is registered already with another function`;
    throw new SchemaDefinitionError('ERR_COERCION_REGISTERED', reason);
  }
  COERCIONS[name] = converter;
};

// The value with the conversions of the schema applied, and its defaults:
// the pass parse runs before its check, with coercion on and nothing
// checked. The value given is never written to; it comes back itself when
// nothing changed, and as it was when it loops through its references.
const coerce = (schema, value, options) => {
  if (!hasBrand(schema, 'Schema')) throw invalidTarget('A Schema is expected');
  const context = createContext(options, schema.name, schema.unknown, true);
  const want = wantOf(PREPARE, context) | COERCE;
  const out = apply(infoOf(schema), schema, value, context, undefined, PREPARE, want);
  return looped(context) ? value : out;
};

// Installed like class members: not enumerable. A copy per subpath rather
// than a helper of the core: the core is measured on its own, the subpaths
// on top of it.
const install = (target, members) => {
  const descriptors = Object.getOwnPropertyDescriptors(members);
  for (const name in descriptors) {
    descriptors[name].enumerable = false;
    Object.defineProperty(target, name, descriptors[name]);
  }
};

let installed = false;

// Fills the table with the built-in converters and the program's own, once
// per name, process-wide (another function under a registered name is
// ERR_COERCION_REGISTERED; a converter of an alias type is the way to read a
// type differently), and adds `schema.coerce(value, options)`.
const register = (custom = {}) => {
  if (custom === null || typeof custom !== 'object' || Array.isArray(custom)) {
    throw invalidCoercion('The converters must be an object of functions by type name');
  }
  for (const name of Object.keys(BUILT_IN)) add(name, BUILT_IN[name]);
  for (const name of Object.keys(custom)) add(name, custom[name]);
  converters = new WeakMap();
  COERCION.convert = convert;
  if (installed) return;
  installed = true;
  install(Schema.prototype, {
    coerce(value, options) {
      return coerce(this, value, options);
    },
  });
};

module.exports = { COERCIONS, coerce, register };
