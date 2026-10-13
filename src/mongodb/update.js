// An update of MongoDB against a schema: the fields its dotted paths name
// (`'address.city'`, `'items.$.qty'`), the values its operators set, push or
// add to. What depends on the document stored (a length after a `$push`, a
// bound after an `$inc`, a parent a dotted `$set` creates) is the
// collection validator's to check; a union, `any` and `json` are not
// entered. A deep partial schema is not the shape of an update: `$set`
// replaces what a path names whole, and names nested fields by their paths.
const { hasBrand, define, RUN } = require('../util.js');
const { isStruct } = require('../struct.js');
const { embeds } = require('../prototypes/reference.js');
const { infoOf, apply, SERIALIZE } = require('../codec.js');
const { createContext } = require('../context.js');
const { issues, finalize } = require('../issues.js');
const { ValidationResult } = require('../result.js');
const { baseTypeOf } = require('../types.js');
const { invalidTarget } = require('../errors.js');
const { ID: KEY, idOf } = require('./bson.js');
const { SHAPES, walk, idValue, stateOf, listOf } = require('./document.js');

const { NESTED, LIST, KEYED, TUPLE, REFERENCE } = SHAPES;

// A place an update is not checked at: a union, any, json.
const LOOSE = Symbol('loose');
// An element of a list of ids: a string.
const ID = Symbol('id');
// A part a node does not have (an element of a string, a field of an id):
// the path is malformed whatever the policy for unknown keys says, which
// decides `null`, a key a struct does not have.
const NONE = Symbol('none');
// A path through more embedded records than `maxDepth`.
const DEEP = Symbol('deep');

const ELEMENT = /^(?:\d+|\$|\$\[\w*\])$/;
const INDEX = /^\d+$/;

// The operators of the values a path is set to, of the lists it adds to or
// takes from, and every operator of an update the subpath reads.
const VALUES = ['$set', '$setOnInsert', '$min', '$max'];
const LISTS = ['$push', '$addToSet', '$pull', '$pullAll'];
const OPERATORS = [...VALUES, ...LISTS, '$unset', '$inc', '$mul', '$currentDate', '$pop'];

// The type a field is of, through the aliases of custom types.
const baseOf = (field) => baseTypeOf(field).type;

// The record of a reference where it is embedded, else null.
const targetOf = (node, references) => {
  const target = node.root.findReference(node.one || node.many);
  return target !== null && embeds(target, node.embed, references) ? target : null;
};

// What one segment of a path names from a node: the field of a struct, the
// element of a list (an index, `$`, `$[]`, `$[name]`) or of a tuple, the
// value of a dictionary, a field of the record a reference embeds; null for
// a key a struct does not have, NONE for a part a node cannot have.
const step = (node, segment, references) => {
  if (hasBrand(node, 'Schema')) return step(node.fields, segment, references);
  if (isStruct(node)) return hasBrand(node[segment], 'Type') ? node[segment] : null;
  const { shape } = infoOf(node);
  if (shape === NESTED) return step(node.schema, segment, references);
  if (shape === LIST) return ELEMENT.test(segment) ? node.value : NONE;
  if (shape === KEYED) return node.value;
  if (shape === TUPLE) {
    if (INDEX.test(segment)) return node.value[Number(segment)] ?? NONE;
    return ELEMENT.test(segment) ? LOOSE : NONE;
  }
  if (shape === REFERENCE) {
    const target = targetOf(node, references);
    // An id has no parts; an element of a list of ids is an id.
    if (node.one) return target === null ? NONE : step(target, segment, references);
    if (!ELEMENT.test(segment)) return NONE;
    return target === null ? ID : target;
  }
  const base = baseOf(node);
  return base === 'union' || base === 'any' || base === 'unknown' || base === 'json' ? LOOSE : NONE;
};

// The node a path names, or null, NONE, LOOSE or DEEP: the records a path
// goes through are counted as the check counts the records it enters.
const resolve = (target, segments, references, maxDepth) => {
  let node = target;
  let depth = 0;
  for (let index = 0; index < segments.length && node !== LOOSE; index += 1) {
    if (node === ID) return NONE;
    if (hasBrand(node, 'Type') && infoOf(node).shape === REFERENCE) {
      depth += 1;
      if (depth > maxDepth) return DEEP;
    }
    node = step(node, segments[index], references);
    if (node === null || node === NONE) return node;
  }
  return node;
};

// The element a `$push` or a `$addToSet` adds to the field, or null when it
// is no list.
const elementOf = (node, references) => {
  if (typeof node === 'symbol' || !hasBrand(node, 'Type')) return null;
  const { shape } = infoOf(node);
  if (shape === LIST) return node.value;
  if (shape !== REFERENCE || !node.many) return null;
  return targetOf(node, references) ?? ID;
};

// The values a list operator carries: one, or the list of `$each`.
const itemsOf = (value) =>
  value !== null && typeof value === 'object' && Array.isArray(value.$each) ? value.$each : [value];

const checkAt = (node, value, context, key) => {
  if (node === ID) {
    if (typeof value !== 'string') issues.type(context, 'string', value, key);
  } else if (hasBrand(node, 'Schema')) node[RUN](value, context, key);
  else node.check(value, context, key);
};

// An operand of `$inc` or `$mul`: a number for a field of numbers (a whole
// one for an integer, a bigint for a bigint), never a field of another type;
// the issue names what the operator takes, not the type of the field.
const checkStep = (node, value, context, key) => {
  const base = hasBrand(node, 'Type') ? baseOf(node) : '';
  const fits =
    base === 'bigint'
      ? typeof value === 'bigint'
      : typeof value === 'number' &&
        (base === 'number' || (base === 'integer' && Number.isInteger(value)));
  if (!fits) {
    const expected = base === 'bigint' || base === 'integer' ? base : 'number';
    issues.type(context, expected, value, key);
  }
};

const checkOperation = (operator, node, value, context, key) => {
  if (VALUES.includes(operator)) checkAt(node, value, context, key);
  else if (operator === '$unset') {
    if (hasBrand(node, 'Type') && node.required) issues.required(context, key);
  } else if (operator === '$inc' || operator === '$mul') checkStep(node, value, context, key);
  else if (operator === '$currentDate') checkAt(node, new Date(), context, key);
  else if (operator === '$push' || operator === '$addToSet') {
    const element = elementOf(node, context.references);
    if (element === null) issues.type(context, 'array', value, key);
    else for (const item of itemsOf(value)) checkAt(element, item, context, key);
  }
};

const segmentOf = (segment) => (INDEX.test(segment) ? Number(segment) : segment);

// One path of an operator: the parents on the path of the context, the
// field it names checked by what the operator does. The id of a stored
// record (its field, or the `_id` of the document it is written to) is set
// by an insert only; a path with an empty segment, or into a part a node
// cannot have, names nothing whatever the policy for unknown keys says.
const checkPath = (target, id, operator, path, value, context) => {
  const segments = path.split('.');
  const last = segments.length - 1;
  for (let index = 0; index < last; index += 1) context.path.push(segmentOf(segments[index]));
  const key = segmentOf(segments[last]);
  const first = segments[0];
  const immutable =
    (first === id || (first === KEY && !(KEY in target.fields))) && operator !== '$setOnInsert';
  const malformed = immutable || segments.includes('');
  const node = malformed ? NONE : resolve(target, segments, context.references, context.maxDepth);
  if (node === DEEP) issues.depth(context, context.maxDepth, key);
  else if (node === NONE || (node === null && context.unknown === 'reject')) {
    issues.unexpected(context, [segments[last]]);
  } else if (node !== null && node !== LOOSE) checkOperation(operator, node, value, context, key);
  context.path.length -= last;
};

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const sourceOf = (target, update) => {
  if (!hasBrand(target, 'Schema') || !isStruct(target.fields)) {
    throw invalidTarget('A Schema of a struct is expected');
  }
  if (!isObject(update)) throw invalidTarget('An update is an object of operators');
};

// The issues of an update against the schema, as a ValidationResult: the
// options of check (`unknown` decides what a path the schema does not have
// is, `references` which records are entered, `maxErrors`, `messages`,
// `root`). An operator the subpath does not know, or that has no object of
// paths, is one `unexpected` issue at the root.
const checkUpdate = (target, update, options) => {
  sourceOf(target, update);
  const context = createContext(options, target.name, target.unknown);
  const id = idOf(target);
  const unknown = [];
  for (const operator of Object.keys(update)) {
    const operand = update[operator];
    if (!OPERATORS.includes(operator) || !isObject(operand)) {
      unknown.push(operator);
      continue;
    }
    for (const path of Object.keys(operand)) {
      if (context.count >= context.limit) break;
      checkPath(target, id, operator, path, operand[path], context);
    }
  }
  if (unknown.length > 0 && context.count < context.limit) issues.unexpected(context, unknown);
  finalize(context.issues, context.messages);
  return new ValidationResult(context);
};

// A value of an update as the document holds it: its serializers run, its
// ids made ObjectIds.
const valueOf = (state, context, node, value) => {
  if (node === ID) return idValue(state, value);
  const serialized = apply(infoOf(node), node, value, context, undefined, SERIALIZE, SERIALIZE);
  return walk(state, node, serialized);
};

const operandOf = (state, context, operator, node, value) => {
  if (VALUES.includes(operator)) return valueOf(state, context, node, value);
  if (!LISTS.includes(operator)) return value;
  const element = elementOf(node, state.references);
  if (element === null) return value;
  const each = (item) => valueOf(state, context, element, item);
  if (operator === '$pullAll') return Array.isArray(value) ? listOf(value, each) : value;
  if (isObject(value)) {
    if (!Array.isArray(value.$each)) return value;
    return { ...value, $each: listOf(value.$each, each) };
  }
  return each(value);
};

// The update as the database takes it: the values the schema knows
// serialized and their ids made ObjectIds, the id of the record as `_id`.
// What `checkUpdate` would reject is not checked here: check first.
const toUpdate = (target, update, options) => {
  sourceOf(target, update);
  const state = stateOf(target, options, true);
  const context = createContext({ references: state.references }, target.name, target.unknown);
  const id = idOf(target);
  const out = {};
  for (const operator of Object.keys(update)) {
    const operand = update[operator];
    if (!isObject(operand)) {
      define(out, operator, operand);
      continue;
    }
    const next = {};
    for (const path of Object.keys(operand)) {
      const segments = path.split('.');
      const node = resolve(target, segments, state.references, state.maxDepth);
      let value = operand[path];
      if (segments[0] === id) {
        segments[0] = KEY;
        if (segments.length === 1) value = idValue(state, value);
      } else if (node !== null && (node === ID || typeof node !== 'symbol')) {
        value = operandOf(state, context, operator, node, value);
      }
      define(next, segments.join('.'), value);
    }
    define(out, operator, next);
  }
  return out;
};

module.exports = { checkUpdate, toUpdate };
