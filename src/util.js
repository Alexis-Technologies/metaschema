// Identity brand for the package's own classes. A global symbol is shared by every copy of the
// package in a process and by every realm, and it survives bundlers that rename a class
// (`class _Schema`) and minifiers that mangle it, none of which `constructor.name` does.
const BRAND = Symbol.for('alexify.metaschema.brand');

// Node's util.inspect looks this symbol up; a plain Symbol.for keeps the
// browser build free of any Node import.
const INSPECT = Symbol.for('nodejs.util.inspect.custom');

const hasBrand = (value, name) => value?.[BRAND] === name;

// The objects on the current validation path. Validation is synchronous, so
// one set per process is enough; a value met again while it is still being
// checked is a cycle and is reported instead of recursed into.
const ancestors = new Set();

// A result stops collecting once it holds this many messages. Schema#check
// sets it from its options for the duration of the call (validation is
// synchronous) and restores it afterwards.
const limits = { maxErrors: Infinity };

// A validation problem with a code, built by the library's own checks. A
// message from a custom validator gets the code 'custom' (or 'type' from a
// custom checkType) when the result adds it.
const issue = (code, path, detail) => ({ code, path, message: `Field "${path}" ${detail}` });

// Key names taken from the value under check go into messages; a huge key
// must not become a huge message.
const KEY_LIMIT = 100;

const shorten = (key) => {
  const name = String(key);
  return name.length > KEY_LIMIT ? `${name.slice(0, KEY_LIMIT)}...` : name;
};

const { SchemaDefinitionError } = require('./errors.js');

const isBound = (value) => value === undefined || typeof value === 'number';

const invalidLength = () =>
  new SchemaDefinitionError(
    'ERR_INVALID_LENGTH',
    'Rule "length" needs a number, [min, max] or { min, max }',
  );

const formatters = {
  type: (type, req = true) => {
    const required = !type.startsWith('?');
    if (required) return { type, required: req };
    const name = type.substring(1);
    return { type: name, required: false };
  },

  key: (key, req = true) => {
    const required = !key.endsWith('?');
    if (required) return { field: key, required: req };
    const field = key.slice(0, -1);
    return { field, required: false };
  },

  length: (length) => {
    if (typeof length === 'number') return { max: length };
    if (length === null || typeof length !== 'object') throw invalidLength();
    const min = Array.isArray(length) ? length[0] : length.min;
    const max = Array.isArray(length) ? length[1] : length.max;
    if (!isBound(min) || !isBound(max)) throw invalidLength();
    return { min, max };
  },
};

const checks = {
  length: (src, type, path) => {
    const { length, entries } = type;
    const value = entries ? entries(src) : src;
    const size = value?.size;
    const count = value?.length;
    let len = Number(value);
    if (typeof size === 'number') len = size;
    else if (typeof count === 'number') len = count;
    const { min, max } = length;
    if (min !== undefined && len < min) return issue('length', path, 'value is too short');
    if (max !== undefined && len > max) return issue('length', path, 'exceeds the maximum length');
    return null;
  },
};

module.exports = {
  BRAND,
  INSPECT,
  hasBrand,
  ancestors,
  limits,
  issue,
  shorten,
  formatters,
  checks,
};
