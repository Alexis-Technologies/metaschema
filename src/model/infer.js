// The reverse of `sample` (`infer`): a definition that accepts every sample
// given, to bootstrap a model from documents that exist. One pass builds a
// summary of every place of the values (the kinds seen there, how often,
// the keys of records with their presence, the elements of lists), fusing
// the records of one place into one record with optional keys, as the
// schema inference of Baazizi et al. (EDBT 2017) does; the summary is then
// written as the most readable definition, and the definition is checked
// against every sample, so that what comes back is a schema the samples
// pass. The samples are input: the walk is bounded, no key is trusted, and
// what no type describes is `any` rather than an error.
const { define, IDENTIFIER, shorten, isBytes } = require('../util.js');
const { Schema } = require('../schema.js');
const { SchemaDefinitionError, invalidTarget } = require('../errors.js');
const { readsAsStruct } = require('../types.js');
const { FORMATS } = require('../rules.js');
const { toDotPath, finalize } = require('../issues.js');
const en = require('../locales/en.js');
const { DEPTH, capitalize } = require('./data.js');

const invalid = (code, reason) => new SchemaDefinitionError(code, reason);

const invalidOptions = (reason) => invalid('ERR_INVALID_OPTIONS', reason);

// The kinds a place may hold, a bit each: a place that held values of
// several kinds is a union of them, and null and undefined decide presence.
const NULL = 1;
const UNDEF = 2;
const BOOLEAN = 4;
const INTEGER = 8;
const FLOAT = 16;
const BIGINT = 32;
const STRING = 64;
const DATE = 128;
const LIST = 256;
const SET = 512;
const MAP = 1024;
const RECORD = 2048;
// An empty dictionary or Map was seen: a required one rejects it.
const BLANK = 4096;
// A value no type describes but `any`: a function, a symbol, an invalid Date.
const ANY = 8192;
const BYTES = 16384;

const PRESENCE = NULL | UNDEF;

// How a key is written: a field, its presence (absent, undefined or null
// among its values) written as the language writes it.
const REQUIRED = 0;
const OPTIONAL = 1;
const NULLABLE = 2;

// The summary of one place: one shape for every node. `strings` is the
// distinct strings while there are few enough for an enum (undefined before
// the first, null once there are too many), `texts` how many strings there
// were, `formats` the registered formats every string so far passed
// (undefined before the first, null once none is left), `records` how many
// of the values were records (the presence of a key is counted against it).
const node = () => ({
  bits: 0,
  count: 0,
  records: 0,
  texts: 0,
  keys: null,
  item: null,
  names: null,
  entries: null,
  strings: undefined,
  formats: undefined,
});

// A place in the samples, for the errors: the keys of records, `[]` for
// the elements of a list or the entries of a Map.
const ITEM = Symbol('item');

const where = (state) => {
  let text = '';
  for (let index = 0; index < state.path.length; index += 1) {
    const key = state.path[index];
    if (key === ITEM) text += '[]';
    else if (IDENTIFIER.test(key)) text += text === '' ? shorten(key) : `.${shorten(key)}`;
    else text += `[${JSON.stringify(shorten(key))}]`;
  }
  return text;
};

const tooDeep = (state) =>
  invalid(
    'ERR_INFER_DEPTH',
    `Sample ${state.index} nests deeper than ${state.maxDepth} levels at "${where(state)}" (a cycle?)`,
  );

// The formats of a place narrow with every string: the candidates are the
// registered formats that infer (a format every word passes says not to),
// in the order they were registered, and a string drops the ones it fails.
const addFormats = (target, value, state) => {
  if (target.formats === null) return;
  if (target.formats === undefined) target.formats = state.candidates.slice();
  const list = target.formats;
  let kept = 0;
  for (let index = 0; index < list.length; index += 1) {
    const name = list[index];
    if (FORMATS[name].test(value)) {
      list[kept] = name;
      kept += 1;
    }
  }
  list.length = kept;
  if (kept === 0) target.formats = null;
};

const addString = (target, value, state) => {
  target.texts += 1;
  if (state.candidates.length > 0) addFormats(target, value, state);
  if (target.strings === null) return;
  if (target.strings === undefined) target.strings = new Set();
  target.strings.add(value);
  if (target.strings.size > state.enum) target.strings = null;
};

const childOf = (target, key) => {
  if (target.keys === null) target.keys = new Map();
  let child = target.keys.get(key);
  if (child === undefined) {
    child = node();
    target.keys.set(key, child);
  }
  return child;
};

const addItems = (target, items, state, depth) => {
  if (target.item === null) target.item = node();
  state.path.push(ITEM);
  for (const item of items) add(target.item, item, state, depth + 1);
  state.path.pop();
};

// One value into the summary of its place. The tests are the ones the
// check makes (a Date by its constructor name and a valid time, a Set and a
// Map by name, an integer by Number.isInteger, the keys of a record by
// Object.keys, bytes by the view's own name), so what infer calls a date
// the check accepts as one.
const add = (target, value, state, depth) => {
  target.count += 1;
  if (value === null) {
    target.bits |= NULL;
    return;
  }
  const type = typeof value;
  if (type === 'string') {
    target.bits |= STRING;
    addString(target, value, state);
    return;
  }
  if (type === 'number') {
    target.bits |= Number.isInteger(value) ? INTEGER : FLOAT;
    return;
  }
  if (type === 'boolean') {
    target.bits |= BOOLEAN;
    return;
  }
  if (type === 'undefined') {
    target.bits |= UNDEF;
    return;
  }
  if (type === 'bigint') {
    target.bits |= BIGINT;
    return;
  }
  if (type !== 'object') {
    target.bits |= ANY;
    return;
  }
  if (depth >= state.maxDepth) throw tooDeep(state);
  const name = value.constructor?.name;
  if (name === 'Date' && typeof value.getTime === 'function') {
    target.bits |= Number.isNaN(value.getTime()) ? ANY : DATE;
    return;
  }
  if (Array.isArray(value)) {
    target.bits |= LIST;
    addItems(target, value, state, depth);
    return;
  }
  if (isBytes(value)) {
    target.bits |= BYTES;
    return;
  }
  const iterable = typeof value[Symbol.iterator] === 'function';
  if (name === 'Set' && iterable) {
    target.bits |= SET;
    addItems(target, value, state, depth);
    return;
  }
  if (name === 'Map' && iterable) {
    target.bits |= MAP;
    if (value.size === 0) target.bits |= BLANK;
    if (target.names === null) target.names = node();
    if (target.entries === null) target.entries = node();
    state.path.push(ITEM);
    for (const pair of value) {
      const key = typeof pair[0];
      target.names.bits |= key === 'string' ? STRING : key === 'number' ? FLOAT : ANY;
      add(target.entries, pair[1], state, depth + 1);
    }
    state.path.pop();
    return;
  }
  target.bits |= RECORD;
  target.records += 1;
  const keys = Object.keys(value);
  if (keys.length === 0) target.bits |= BLANK;
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    state.path.push(key);
    add(childOf(target, key), value[key], state, depth + 1);
    state.path.pop();
  }
};

// The summary of one node into another, copies of the nodes under it: what
// the values of a dictionary share.
const fuse = (into, from, cap) => {
  into.bits |= from.bits;
  into.count += from.count;
  into.records += from.records;
  into.texts += from.texts;
  if (from.keys !== null) {
    for (const pair of from.keys) fuse(childOf(into, pair[0]), pair[1], cap);
  }
  if (from.item !== null) into.item = fuse(into.item ?? node(), from.item, cap);
  if (from.names !== null) into.names = fuse(into.names ?? node(), from.names, cap);
  if (from.entries !== null) into.entries = fuse(into.entries ?? node(), from.entries, cap);
  if (from.strings === null || into.strings === null) into.strings = null;
  else if (from.strings !== undefined) {
    if (into.strings === undefined) into.strings = new Set();
    for (const text of from.strings) into.strings.add(text);
    if (into.strings.size > cap) into.strings = null;
  }
  // The formats both kept, in the order of the target.
  if (from.formats === null || into.formats === null) into.formats = null;
  else if (into.formats === undefined) into.formats = from.formats?.slice();
  else if (from.formats !== undefined) {
    const kept = [];
    for (const name of into.formats) if (from.formats.includes(name)) kept.push(name);
    into.formats = kept.length === 0 ? null : kept;
  }
  return into;
};

// A key a program would write as a field: a letter, a digit after it.
const NAME = /^[\p{L}_$][\p{L}\p{N}_$]*$/u;

// Whether the records of a place are a dictionary rather than a struct: no
// key is a name (ids, dates, codes as keys, from one sample on), or there
// are more keys than `map` across several records, every key is missing
// from some record and the values are all of one kind.
const dictionary = (target, state) => {
  const { keys } = target;
  if (state.map === false || keys === null || keys.size === 0) return false;
  let named = false;
  for (const key of keys.keys()) {
    if (NAME.test(key)) {
      named = true;
      break;
    }
  }
  if (!named) return true;
  if (keys.size <= state.map || target.records < 2) return false;
  let kinds = 0;
  for (const child of keys.values()) {
    if (child.count >= target.records) return false;
    const bits = child.bits & ~PRESENCE;
    kinds |= bits & INTEGER ? (bits & ~INTEGER) | FLOAT : bits;
  }
  return kinds !== 0 && (kinds & (kinds - 1)) === 0;
};

// The definition of a form with its presence: a type name is `?name` or
// `{ type, nullable }`, an object form takes `required: false` or
// `nullable: true`, a struct is bare only where it reads as one.
const written = (form, presence) => {
  const { struct } = form;
  if (struct !== undefined) {
    if (presence === REQUIRED) return readsAsStruct(struct) ? struct : { schema: struct };
    if (presence === OPTIONAL) return { schema: struct, required: false };
    return { schema: struct, nullable: true };
  }
  const { def } = form;
  if (typeof def === 'string') {
    if (presence === REQUIRED) return def;
    return presence === OPTIONAL ? `?${def}` : { type: def, nullable: true };
  }
  if (presence === OPTIONAL) def.required = false;
  else if (presence === NULLABLE) def.nullable = true;
  return def;
};

// A place that held nothing but null or undefined.
const bareOf = (bits, absent) => (bits & NULL ? (absent ? '?null' : 'null') : '?unknown');

// The element of a list, the value of a dictionary: `?type` when null or
// undefined was among them.
const itemOf = (target, state) => {
  if (target === null || target.count === 0) return 'unknown';
  const { bits } = target;
  if ((bits & ~PRESENCE) === 0) return bareOf(bits, (bits & UNDEF) !== 0);
  return written(formOf(target, state), bits & PRESENCE ? OPTIONAL : REQUIRED);
};

// An enum of few recurring values, else the first registered format every
// string of the place passed, else a string.
const stringOf = (target, state) => {
  const { strings, texts, formats } = target;
  if (strings != null && texts >= 4 && texts >= 2 * strings.size) {
    return { def: { enum: Array.from(strings) } };
  }
  if (formats != null && formats.length > 0) return { def: { type: 'string', format: formats[0] } };
  return { def: 'string' };
};

const mapOf = (target, state) => {
  const names = target.names === null ? 0 : target.names.bits;
  let key = 'string';
  if (names !== 0 && names !== STRING) {
    if ((names & ~(INTEGER | FLOAT)) !== 0) return { def: 'json' };
    key = 'number';
  }
  const def = { map: { [key]: itemOf(target.entries, state) } };
  if (target.bits & BLANK) def.required = false;
  return { def };
};

// A key of the data as a key of a definition: one ending in `?` would read
// as an optional key, so it is written with one more.
const nameOf = (key) => (key.endsWith('?') ? `${key}?` : key);

// A key of a struct: optional when some record lacks it or holds undefined,
// nullable when every record has it and some hold null.
const keyOf = (child, records, state) => {
  const absent = child.count < records || (child.bits & UNDEF) !== 0;
  const nul = (child.bits & NULL) !== 0;
  if ((child.bits & ~PRESENCE) === 0) return bareOf(child.bits, absent);
  return written(formOf(child, state), absent ? OPTIONAL : nul ? NULLABLE : REQUIRED);
};

const recordOf = (target, state) => {
  if (dictionary(target, state)) {
    const value = node();
    for (const child of target.keys.values()) fuse(value, child, state.enum);
    const def = { object: { string: itemOf(value, state) } };
    if (target.bits & BLANK) def.required = false;
    return { def };
  }
  const fields = {};
  if (target.keys !== null) {
    for (const pair of target.keys) {
      define(fields, nameOf(pair[0]), keyOf(pair[1], target.records, state));
    }
  }
  return { struct: fields };
};

// The form of a place from the kinds it held: one, or a union of them in a
// fixed order with the record last, since a struct accepts any object that
// is not an array and the Set, Map and Date branches must be tried first.
const formOf = (target, state) => {
  const bits = target.bits & ~PRESENCE;
  if (bits & ANY) return { def: 'any' };
  const forms = [];
  if (bits & BOOLEAN) forms.push({ def: 'boolean' });
  if (bits & (INTEGER | FLOAT)) {
    forms.push({ def: (bits & FLOAT) === 0 && state.integer ? 'integer' : 'number' });
  }
  if (bits & BIGINT) forms.push({ def: 'bigint' });
  if (bits & STRING) forms.push(stringOf(target, state));
  if (bits & DATE) forms.push({ def: 'date' });
  if (bits & BYTES) forms.push({ def: 'bytes' });
  if (bits & LIST) forms.push({ def: { array: itemOf(target.item, state) } });
  if (bits & SET) forms.push({ def: { set: itemOf(target.item, state) } });
  if (bits & MAP) forms.push(mapOf(target, state));
  if (bits & RECORD) forms.push(recordOf(target, state));
  if (forms.length === 0) return { def: 'unknown' };
  if (forms.length === 1) return forms[0];
  const union = [];
  for (let index = 0; index < forms.length; index += 1) union.push(written(forms[index], REQUIRED));
  return { def: { union } };
};

const mismatch = (state, index, issue) => {
  finalize([issue], en);
  const at = toDotPath(issue.path, state.name);
  const error = invalid(
    'ERR_INFER_MISMATCH',
    `The inferred definition rejects sample ${index} at "${at}": ${issue.message}`,
  );
  error.index = index;
  return error;
};

const option = (name, expected) => invalidOptions(`Infer option "${name}" must be ${expected}`);

const optionsOf = (options) => {
  if (options === null || typeof options !== 'object') {
    throw invalidOptions('Infer options must be an object');
  }
  const {
    as = 'definition',
    name = '',
    kind = 'struct',
    enum: cap = 8,
    integer = true,
    map = 16,
    maxDepth = DEPTH,
    formats = true,
  } = options;
  if (as !== 'definition' && as !== 'schema') throw option('as', '"definition" or "schema"');
  if (typeof name !== 'string') throw option('name', 'a string');
  if (typeof kind !== 'string' || kind === '') throw option('kind', 'the name of a kind');
  if (cap !== false && (!Number.isInteger(cap) || cap < 0)) {
    throw option('enum', 'an integer of at least 0, or false');
  }
  if (typeof integer !== 'boolean') throw option('integer', 'a boolean');
  if (map !== false && (!Number.isInteger(map) || map < 1)) {
    throw option('map', 'an integer of at least 1, or false');
  }
  if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > DEPTH) {
    throw option('maxDepth', `an integer from 1 to ${DEPTH}`);
  }
  if (typeof formats !== 'boolean') throw option('formats', 'a boolean');
  const state = { as, name, kind, enum: cap === false ? 0 : cap, integer, map, maxDepth };
  state.path = [];
  state.index = 0;
  // The formats a string place may be, in the order they were registered.
  state.candidates = [];
  if (formats) {
    for (const key in FORMATS) if (FORMATS[key].infer !== false) state.candidates.push(key);
  }
  return state;
};

// The samples as a list, read twice (the summary, then the self-check). A
// string is iterable, over its characters, and surely a mistake.
const listOf = (samples) => {
  const iterable =
    samples !== null &&
    samples !== undefined &&
    typeof samples !== 'string' &&
    typeof samples[Symbol.iterator] === 'function';
  if (!iterable) throw invalidTarget('An iterable of samples is expected');
  const list = Array.isArray(samples) ? samples : Array.from(samples);
  if (list.length === 0) throw invalidTarget('At least one sample is expected');
  return list;
};

// A definition (or a Schema, with `as: 'schema'`) that accepts every
// sample. `options`: `as`, `name`, `kind` (the kind of a root that is a
// struct, 'struct'), `enum` (the most distinct strings of a place for an
// enum, 8), `integer` (whole numbers are `integer`, true), `map` (the keys
// past which records read as a dictionary, 16), `maxDepth` (128).
const infer = (samples, options = {}) => {
  const state = optionsOf(options);
  const list = listOf(samples);
  const root = node();
  for (let index = 0; index < list.length; index += 1) {
    state.index = index;
    add(root, list[index], state, 0);
  }
  // A root of records is a struct with its kind; a root of records and
  // null or undefined is a union of that one struct, since the `schema`
  // shorthand at the root is the struct itself and cannot be optional.
  let definition;
  const presence = root.bits & PRESENCE ? OPTIONAL : REQUIRED;
  const form = (root.bits & ~PRESENCE) === 0 ? null : formOf(root, state);
  if (form === null) definition = bareOf(root.bits, (root.bits & UNDEF) !== 0);
  else if (form.struct === undefined) definition = written(form, presence);
  else if (presence === REQUIRED) {
    definition = { [capitalize(state.kind)]: {} };
    for (const key of Object.keys(form.struct)) define(definition, key, form.struct[key]);
  } else definition = written({ def: { union: [written(form, REQUIRED)] } }, presence);
  const schema = new Schema(state.name, definition);
  const check = { unknown: 'reject', maxErrors: 1 };
  for (let index = 0; index < list.length; index += 1) {
    const result = schema.check(list[index], check);
    if (!result.valid) throw mismatch(state, index, result.issues[0]);
  }
  return state.as === 'schema' ? schema : definition;
};

module.exports = { infer };
