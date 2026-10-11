// What the functions of the `./model` subpath share: a snapshot from a Model
// or as given, and equality of the JSON values a snapshot is made of.
const { hasBrand } = require('../util.js');
const { FORMAT } = require('../snapshot.js');
const { SchemaDefinitionError } = require('../errors.js');

const invalidSnapshot = (reason) => new SchemaDefinitionError('ERR_INVALID_SNAPSHOT', reason);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const isSnapshot = (value) =>
  isObject(value) && value.format === FORMAT && isObject(value.entities);

// The snapshot of a model, or the snapshot given.
const snapshotOf = (target) => {
  if (hasBrand(target, 'Model')) return target.toJSON();
  if (!isSnapshot(target)) {
    throw invalidSnapshot(`A Model or a snapshot of format ${FORMAT} with entities is expected`);
  }
  return target;
};

// Whether two JSON values are the same: the same primitives, the same
// elements in order, the same keys with the same values in any order.
const same = (a, b) => {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let index = 0; index < a.length; index += 1) if (!same(a[index], b[index])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) if (!Object.hasOwn(b, key) || !same(a[key], b[key])) return false;
  return true;
};

const isFunctionMarker = (value) => isObject(value) && value.$function === true;

module.exports = { invalidSnapshot, isObject, isSnapshot, snapshotOf, same, isFunctionMarker };
