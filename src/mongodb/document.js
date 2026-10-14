// A record as MongoDB holds it and back: the program keeps the id of a
// stored record and its references as strings (`accountId: '?string'`), the
// database an ObjectId under `_id` and in every reference. The walk goes
// over the built types as the passes of parse do (`infoOf` of codec.js
// tells a node's shape), into nested structs, lists, dictionaries, tuples,
// discriminated unions and the records references embed; a plain union is
// left as it is. The value given is never written to.
const { hasBrand, define, isMap } = require('../util.js');
const { STRUCT, isStruct } = require('../struct.js');
const { embeds } = require('../prototypes/reference.js');
const { infoOf } = require('../codec.js');
const { referencesOf } = require('../context.js');
const { invalidTarget, invalidOption } = require('../errors.js');
const { ID, HEX, driverOf, idOf, isObjectId } = require('./bson.js');

// The shapes of infoOf in codec.js, by name, for the three walks of the
// subpath; `mongodb.test.js` holds them to the numbers of the core.
const SHAPES = Object.freeze({
  LEAF: 0,
  SCHEMA: 1,
  FIELDS: 2,
  NESTED: 3,
  LIST: 4,
  KEYED: 5,
  TUPLE: 6,
  UNION: 7,
  REFERENCE: 8,
});

const { SCHEMA, FIELDS, NESTED, LIST, KEYED, TUPLE, UNION, REFERENCE } = SHAPES;

// A plain object of any realm: its prototype is the root of its realm or
// none (an Array, a Date, a Map or a value of bson has one in between).
const isPlain = (value) => {
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || Object.getPrototypeOf(prototype) === null;
};

// An id: to an ObjectId on the way out (a string of 24 hex digits, when the
// ids are ObjectIds), to its hex string on the way in.
const idValue = (state, value) => {
  if (!state.out) return isObjectId(value) ? value.toHexString() : value;
  if (!state.objectIds || typeof value !== 'string' || !HEX.test(value)) return value;
  return new state.driver.ObjectId(value);
};

// A key of the output: assigned, defined only where assignment would reach
// the prototype (as the passes of codec.js write theirs).
const put = (out, key, value) => {
  if (key === '__proto__') define(out, key, value);
  else out[key] = value;
};

const listOf = (value, each) => {
  const out = [];
  for (let index = 0; index < value.length; index += 1) out.push(each(value[index], index));
  return out;
};

// A record of a schema or a nested struct: the id field of a stored kind is
// `_id` in the document (first, and left out when there is none yet, so
// that the database gives one; an `_id` the value carries beside it is not
// the record's and is left out); the keys of calculated fields and the
// undefined values are not written. A key the schema does not have comes as
// it is; a record met again on its own path (a loop) too, and a `null` (what
// `findOne` gives for nothing) for the check to report.
const record = (state, owner, value) => {
  const fields = hasBrand(owner, 'Schema') ? owner.fields : owner;
  if (!isStruct(fields)) return walk(state, fields, value);
  if (value === null || typeof value !== 'object' || !isPlain(value)) return value;
  if (state.seen.has(value)) return value;
  state.seen.add(value);
  const id = hasBrand(owner, 'Schema') ? idOf(owner) : null;
  const { calculated } = fields[STRUCT];
  const out = {};
  if (state.out && id !== null && value[id] != null) out[ID] = idValue(state, value[id]);
  for (const key of Object.keys(value)) {
    const item = value[key];
    if (state.out) {
      if (key === id || item === undefined || calculated.includes(key)) continue;
      if (key === ID && id !== null && !(ID in fields)) continue;
    } else if (key === ID && !(ID in fields)) {
      // The key of the database: the record's id field, or nothing.
      if (id !== null) put(out, id, idValue(state, item));
      continue;
    }
    const field = fields[key];
    put(out, key, hasBrand(field, 'Type') ? walk(state, field, item) : item);
  }
  state.seen.delete(value);
  return out;
};

// A reference: the record through its entity where it is embedded, else
// the id (a list of them for `many`). The records embedded are counted as
// the check counts them, and one deeper than `maxDepth` is left as it is
// for the check to report: a reference is the one place a graph recurses.
const reference = (state, node, value) => {
  const target = node.root.findReference(node.one || node.many);
  const embedded = target !== null && embeds(target, node.embed, state.references);
  const one = (item) => (embedded ? walk(state, target, item) : idValue(state, item));
  if (embedded) {
    if (state.depth >= state.maxDepth) return value;
    state.depth += 1;
  }
  let out = value;
  if (node.one) out = one(value);
  else if (Array.isArray(value)) out = listOf(value, one);
  if (embedded) state.depth -= 1;
  return out;
};

const walk = (state, node, value) => {
  if (value == null) return value;
  const info = infoOf(node);
  const { shape } = info;
  if (shape === SCHEMA || shape === FIELDS) return record(state, node, value);
  if (shape === NESTED) return record(state, node.schema, value);
  if (shape === REFERENCE) return reference(state, node, value);
  if (shape === LIST || shape === TUPLE) {
    if (!Array.isArray(value)) return value;
    const child = (index) => (shape === TUPLE ? node.value[index] : node.value);
    return listOf(value, (item, index) =>
      child(index) === undefined ? item : walk(state, child(index), item),
    );
  }
  if (shape === KEYED) {
    if (isMap(value)) {
      const out = new Map();
      for (const pair of value) out.set(pair[0], walk(state, node.value, pair[1]));
      return out;
    }
    if (typeof value !== 'object' || !isPlain(value)) return value;
    const out = {};
    for (const key of Object.keys(value)) put(out, key, walk(state, node.value, value[key]));
    return out;
  }
  if (shape === UNION && info.table !== null && typeof value === 'object') {
    const index = info.table.get(value[node.discriminator]);
    return index === undefined ? value : walk(state, node.union[index], value);
  }
  return value;
};

// The state of one walk, the options of the call checked. The driver is
// needed to build ObjectIds, so on the way out with `ids: 'objectId'`
// only: a document is read back without it.
const stateOf = (target, options, out) => {
  if (!hasBrand(target, 'Schema') || !isStruct(target.fields)) {
    throw invalidTarget('A Schema of a struct is expected');
  }
  const { ids = 'objectId', references = 'kind', maxDepth = 128 } = options ?? {};
  if (ids !== 'objectId' && ids !== 'string') {
    throw invalidOption('ids', '"objectId" or "string"', ids);
  }
  referencesOf(references);
  if (!Number.isInteger(maxDepth) || maxDepth < 1) {
    throw invalidOption('maxDepth', 'a positive integer', maxDepth);
  }
  const objectIds = ids === 'objectId';
  const driver = out && objectIds ? driverOf() : null;
  return { out, objectIds, references, seen: new Set(), driver, depth: 0, maxDepth };
};

// The root of a walk is the record itself: a value of a class (a model
// instance, a value of bson) has no document, and is reported rather than
// passed through unchanged.
const rootOf = (value) => {
  if (value !== null && typeof value === 'object' && !isPlain(value)) {
    throw invalidTarget('A plain object is expected');
  }
  return value;
};

// The document of a value: its serializers run, its ids made ObjectIds and
// the id of the record moved to `_id`.
const toDocument = (target, value, options) => {
  const state = stateOf(target, options, true);
  const serialized = target.serialize(rootOf(value), { references: state.references }).value;
  return record(state, target, serialized);
};

const read = (target, document, options) =>
  record(stateOf(target, options, false), target, rootOf(document));

const parsing = (options) => ({ coerce: true, ...options });

// The value of a document: `_id` back to the id field, ObjectIds to their
// hex strings, then parse, which coerces unless the options say otherwise.
const fromDocument = (target, document, options) => {
  const value = read(target, document, options);
  return target.parse(value, parsing(options));
};

const fromDocumentAsync = async (target, document, options) => {
  const value = read(target, document, options);
  return target.parseAsync(value, parsing(options));
};

module.exports = {
  SHAPES,
  toDocument,
  fromDocument,
  fromDocumentAsync,
  walk,
  idValue,
  stateOf,
  listOf,
};
