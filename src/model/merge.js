// Two schemas as one (`merge`), by unification: a field in both takes the
// constraints of both (the length and the bounds that satisfy both, the
// values both enums hold, the validate functions of both), a field in one
// comes as it is, and what no value can satisfy (two types, two patterns,
// bounds with nothing in common, two defaults) is ERR_MERGE_CONFLICT with
// the field. CUE composes definitions this way, instead of inheritance.
const { hasBrand } = require('../util.js');
const { Schema } = require('../schema.js');
const { isStruct } = require('../struct.js');
const { isThenable } = require('../issues.js');
const { SchemaDefinitionError } = require('../errors.js');
const { same, capitalize, definitionOf, structDefinitionOf } = require('./data.js');

// The keys a field definition settles by a rule of its own; every other key
// (an annotation, an option of a custom type) comes from the first schema.
const BOOLEANS = new Set(['unique', 'index', 'primary', 'deprecated']);

const conflict = (reason) => new SchemaDefinitionError('ERR_MERGE_CONFLICT', reason);

// Both validate functions, as one that returns what both returned (an
// array of returns is one the check reads), awaited when either is async.
const compose = (first, second) =>
  function validate(value, path) {
    const a = first.call(this, value, path);
    const b = second.call(this, value, path);
    if (isThenable(a) || isThenable(b)) return Promise.all([a, b]);
    return [a, b];
  };

const lower = (a, b) => (a === undefined ? b : b === undefined ? a : a > b ? a : b);

const upper = (a, b) => (a === undefined ? b : b === undefined ? a : a < b ? a : b);

// The length both rules allow: the greater of the minimums, the lesser of
// the maximums.
const mergeLength = (a, b, path) => {
  const min = lower(a.min, b.min);
  const max = upper(a.max, b.max);
  if (min !== undefined && max !== undefined && min > max) {
    throw conflict(`The lengths of "${path}" have nothing in common`);
  }
  const length = {};
  if (min !== undefined) length.min = min;
  if (max !== undefined) length.max = max;
  return length;
};

const mergeEnum = (a, b, path) => {
  const values = [];
  for (const value of a) {
    for (const other of b) {
      if (same(value, other)) {
        values.push(value);
        break;
      }
    }
  }
  if (values.length === 0) throw conflict(`The enums of "${path}" have no value in common`);
  return values;
};

const mergeList = (a, b, path) => {
  if (a.length !== b.length) throw conflict(`The elements of "${path}" differ in number`);
  const list = [];
  for (let index = 0; index < a.length; index += 1) {
    list.push(mergeFields(a[index], b[index], `${path}[${index}]`));
  }
  return list;
};

// One key of two definitions of a field: a value the other side lacks
// stands (null is allowed only where both allow it), the same value stands,
// two values settle by the rule of the key.
const mergeKey = (key, a, b, path) => {
  if (key === 'nullable') return a === true && b === true ? true : undefined;
  if (a === undefined) return b;
  if (b === undefined) return a;
  if (same(a, b)) return a;
  switch (key) {
    case 'required':
      return a || b;
    case 'length':
      return mergeLength(a, b, path);
    case 'min':
      return a > b ? a : b;
    case 'max':
      return a < b ? a : b;
    case 'enum':
      return mergeEnum(a, b, path);
    case 'validate':
      return compose(a, b);
    case 'aliases':
      return Array.from(new Set(a.concat(b)));
    case 'schema':
      if (typeof a.type === 'string' || typeof b.type === 'string') {
        throw conflict(`"${path}" holds a struct in one schema and a type in the other`);
      }
      return mergeStruct(a, b, path);
    case 'value':
      if (Array.isArray(a) !== Array.isArray(b)) {
        throw conflict(`"${path}" holds a tuple in one schema and not in the other`);
      }
      return Array.isArray(a) ? mergeList(a, b, path) : mergeFields(a, b, `${path}[]`);
    case 'pattern':
    case 'default':
    case 'parse':
    case 'serialize':
    case 'union':
    case 'discriminator':
    case 'key':
    case 'one':
    case 'many':
    case 'embed':
      throw conflict(`The ${key} of "${path}" differs between the schemas`);
    default:
      return BOOLEANS.has(key) ? a || b : a;
  }
};

// The types a field may have in the two schemas as one: the same, or any
// (unknown) and a type, or integer and number, which is integer.
const mergeType = (a, b, path) => {
  if (a === b) return a;
  if (a === 'any' || a === 'unknown') return b;
  if (b === 'any' || b === 'unknown') return a;
  if ((a === 'integer' && b === 'number') || (a === 'number' && b === 'integer')) return 'integer';
  throw conflict(`"${path}" is a ${a} in one schema and a ${b} in the other`);
};

// Two definitions of one field as one; a string or a built field is its
// definition first.
const mergeFields = (x, y, path) => {
  const a = typeof x === 'string' ? { type: x } : x;
  const b = typeof y === 'string' ? { type: y } : y;
  const type = mergeType(a.type, b.type, path);
  // The side whose type the result has sets the keys of its type.
  const [first, second] = type === b.type && type !== a.type ? [b, a] : [a, b];
  const def = { type };
  const keys = new Set(Object.keys(first));
  for (const key of Object.keys(second)) keys.add(key);
  for (const key of keys) {
    if (key === 'type') continue;
    const value = mergeKey(key, first[key], second[key], path);
    if (value !== undefined) def[key] = value;
  }
  return def;
};

const isFunction = (value) => typeof value === 'function';

// The fields of two structs as one: the fields of the first in their order,
// then the ones only the second has.
const mergeStruct = (a, b, path) => {
  const fields = {};
  const keys = new Set(Object.keys(a));
  for (const key of Object.keys(b)) keys.add(key);
  for (const key of keys) {
    const x = a[key];
    const y = b[key];
    const where = path === '' ? key : `${path}.${key}`;
    if (x === undefined || y === undefined) {
      fields[key] = x === undefined ? y : x;
    } else if (isFunction(x) || isFunction(y)) {
      if (x === y) fields[key] = x;
      else if (key === 'validate' && isFunction(x) && isFunction(y)) fields[key] = compose(x, y);
      else throw conflict(`"${where}" is a function in one schema and differs in the other`);
    } else fields[key] = mergeFields(x, y, where);
  }
  return fields;
};

// The schema both schemas describe. The kind and its metadata are the first
// schema's (`options.metadata` says otherwise), the name too unless
// `options.name`; the indexes are the ones of either (the same under one
// key), the functions of the schema itself compose as a field's do.
const merge = (a, b, options = {}) => {
  if (!hasBrand(a, 'Schema') || !hasBrand(b, 'Schema')) {
    throw new TypeError('Two Schemas are expected');
  }
  if (options === null || typeof options !== 'object') {
    throw new SchemaDefinitionError('ERR_INVALID_OPTIONS', 'Merge options must be an object');
  }
  const { name = a.name, metadata = {} } = options;
  const namespaces = Array.from(new Set([...a.namespaces, ...b.namespaces]));
  const structA = isStruct(a.fields);
  const structB = isStruct(b.fields);
  try {
    if (!structA || !structB) {
      if (structA !== structB) throw conflict('A struct and a schema of one type cannot be merged');
      return new Schema(
        name,
        mergeFields(definitionOf(a.fields), definitionOf(b.fields), ''),
        namespaces,
      );
    }
    const { kind, scope, store, allow, unknown, custom } = a;
    const meta = { scope, store, allow, unknown, ...custom, ...metadata };
    const { kind: given = kind, ...rest } = meta;
    const definition = { [capitalize(given)]: rest };
    const fields = mergeStruct(structDefinitionOf(a.fields), structDefinitionOf(b.fields), '');
    for (const key of Object.keys(fields)) definition[key] = fields[key];
    for (const source of [a, b]) {
      for (const key in source.indexes) {
        const index = source.indexes[key];
        if (index.many !== undefined) continue;
        if (definition[key] !== undefined && !same(definition[key], index)) {
          throw conflict(`The index "${key}" differs between the schemas`);
        }
        definition[key] = index;
      }
    }
    for (const key in a.options) {
      const x = a.options[key];
      const y = b.options[key];
      if (x === null && y === null) continue;
      if (x === null || y === null || x === y) definition[key] = x === null ? y : x;
      else if (key === 'validate') definition[key] = compose(x, y);
      else throw conflict(`The ${key} of the schemas differ`);
    }
    return new Schema(name, definition, namespaces);
  } catch (error) {
    if (error instanceof SchemaDefinitionError && error.code === 'ERR_MERGE_CONFLICT') {
      error.schema = name;
      error.message = `${error.message} in "${name}"`;
    }
    throw error;
  }
};

module.exports = { merge };
