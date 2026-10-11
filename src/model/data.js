// What the functions of the `./model` subpath share: a snapshot from a Model
// or as given, and equality of the JSON values a snapshot is made of. A
// snapshot is input (a file, a registry, another program), so what it says
// is checked before it is read, and every error is ERR_INVALID_SNAPSHOT
// located in the entity, never a bare SyntaxError or TypeError.
const { hasBrand, define } = require('../util.js');
const { FORMAT } = require('../snapshot.js');
const { SchemaDefinitionError } = require('../errors.js');
const { isStruct } = require('../struct.js');

// How deep the walks over a snapshot go: a definition nested deeper is not
// one a program wrote.
const DEPTH = 128;

const invalidSnapshot = (reason) => new SchemaDefinitionError('ERR_INVALID_SNAPSHOT', reason);

const tooDeep = () => invalidSnapshot(`A snapshot nested deeper than ${DEPTH} levels`);

// An error of a schema as a whole, which has no field to be located at: the
// schema is the location, written as `locate` writes one.
const atSchema = (error, name) => {
  error.schema = name;
  error.message = `${error.message} in "${name}"`;
  return error;
};

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const isSnapshot = (value) =>
  isObject(value) &&
  value.format === FORMAT &&
  isObject(value.entities) &&
  (value.types === undefined || isObject(value.types));

// The snapshot of a model, or the snapshot given.
const snapshotOf = (target) => {
  if (hasBrand(target, 'Model')) return target.toJSON();
  if (!isSnapshot(target)) {
    throw invalidSnapshot(`A Model or a snapshot of format ${FORMAT} with entities is expected`);
  }
  return target;
};

// Whether two values of a definition are the same: the same primitives (a
// function by identity), the same elements in order, the same keys with the
// same values in any order; a RegExp by its text and a Date by its time, for
// the definitions `merge` compares (a snapshot holds neither).
const same = (a, b, depth = 0) => {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (depth > DEPTH) throw tooDeep();
  const name = a.constructor?.name;
  if (name === 'RegExp' || name === 'Date') {
    if (name !== b.constructor?.name) return false;
    return name === 'Date'
      ? a.getTime() === b.getTime()
      : a.source === b.source && a.flags === b.flags;
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let index = 0; index < a.length; index += 1) {
      if (!same(a[index], b[index], depth + 1)) return false;
    }
    return true;
  }
  if (Array.isArray(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    if (!Object.hasOwn(b, key) || !same(a[key], b[key], depth + 1)) return false;
  }
  return true;
};

const isFunctionMarker = (value) => isObject(value) && value.$function === true;

const capitalize = (name) => name.charAt(0).toUpperCase() + name.slice(1);

// The definition a built field was made from, with its nested fields as
// definitions and its functions kept: what `merge` unifies and `Schema`
// takes back.
const definitionOf = (field) => {
  const def = { type: field.type };
  for (const key of Object.keys(field)) {
    if (key !== 'root' && key !== 'type' && field[key] !== undefined) {
      define(def, key, partOf(field[key]));
    }
  }
  return def;
};

const partOf = (value) => {
  if (hasBrand(value, 'Type')) return definitionOf(value);
  if (isStruct(value)) return structDefinitionOf(value);
  if (Array.isArray(value)) {
    const list = [];
    for (const item of value) list.push(partOf(item));
    return list;
  }
  return value;
};

const structDefinitionOf = (fields) => {
  const def = {};
  for (const key in fields) define(def, key, partOf(fields[key]));
  return def;
};

module.exports = {
  DEPTH,
  invalidSnapshot,
  tooDeep,
  atSchema,
  isObject,
  isSnapshot,
  snapshotOf,
  same,
  isFunctionMarker,
  capitalize,
  definitionOf,
  structDefinitionOf,
};
