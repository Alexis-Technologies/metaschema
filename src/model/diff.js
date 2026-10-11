// The changes between two versions of a model (`diff`), as data, and the
// compatibility class of a list of changes (`compatibility`) by the rules of
// the Confluent Schema Registry: backward when a reader with the new model
// reads data written with the old one, forward when a reader with the old
// model reads data written with the new one, full when both, none when
// neither. Two models compare through their snapshots, so a committed
// snapshot compares with a model, and the rules assume a reader that ignores
// the keys it does not know (`check` with `unknown: 'ignore'`, `parse` with
// `strip`), as those registries do. A snapshot and a list of changes are
// input: the keys read are own keys, an entity is checked before it is
// read, and whatever fails while a change is classified is an error of the
// snapshot located at the change.
const { SchemaDefinitionError, invalidTarget } = require('../errors.js');
const {
  invalidSnapshot,
  atSchema,
  isObject,
  snapshotOf,
  same,
  isFunctionMarker,
} = require('./data.js');

const change = (kind, op, entity, name, from, to, detail) => {
  const entry = { kind, op, entity, name };
  if (from !== undefined) entry.from = from;
  if (to !== undefined) entry.to = to;
  if (detail !== undefined) entry.detail = detail;
  return entry;
};

const own = (object, key) => (Object.hasOwn(object, key) ? object[key] : undefined);

// The keys of either object, sorted.
const keysOf = (a, b) => {
  const keys = new Set(Object.keys(a));
  for (const key of Object.keys(b)) keys.add(key);
  return Array.from(keys).sort();
};

// The keys whose values differ between two objects, sorted.
const changedKeys = (a, b, keys = keysOf(a, b)) => {
  const changed = [];
  for (const key of keys) if (!same(own(a, key), own(b, key))) changed.push(key);
  return changed;
};

// The old key a new field was renamed from: an alias of the new field that
// is a key of the old struct and not of the new one.
const renamedFrom = (field, old, current) => {
  const { aliases } = field;
  if (!Array.isArray(aliases)) return null;
  for (const alias of aliases) {
    if (Object.hasOwn(old, alias) && !Object.hasOwn(current, alias)) return alias;
  }
  return null;
};

const without = (keys, name) => {
  const rest = [];
  for (const key of keys) if (key !== name) rest.push(key);
  return rest;
};

// The fields of a struct: the new ones in their order (changed, renamed
// through an alias, or added), then the ones that are gone.
const diffFields = (entity, old, current, changes) => {
  const renamed = new Set();
  for (const name of Object.keys(current)) {
    const to = current[name];
    if (Object.hasOwn(old, name)) {
      const from = old[name];
      if (same(from, to)) continue;
      changes.push(
        change('field', 'changed', entity, name, from, to, { keys: changedKeys(from, to) }),
      );
      continue;
    }
    const previous = renamedFrom(to, old, current);
    if (previous === null) {
      changes.push(change('field', 'added', entity, name, undefined, to));
      continue;
    }
    renamed.add(previous);
    const from = old[previous];
    const detail = { renamed: previous };
    const keys = without(changedKeys(from, to), 'aliases');
    if (keys.length > 0) detail.keys = keys;
    changes.push(change('field', 'renamed', entity, name, from, to, detail));
  }
  for (const name of Object.keys(old)) {
    if (Object.hasOwn(current, name) || renamed.has(name)) continue;
    const from = old[name];
    const detail = from.deprecated ? { deprecated: true } : undefined;
    changes.push(change('field', 'removed', entity, name, from, undefined, detail));
  }
};

// Two dictionaries of definitions (the indexes of an entity, the types of
// a model): added, removed and changed by key.
const diffKeyed = (kind, entity, old, current, changes) => {
  for (const name of keysOf(old, current)) {
    const from = own(old, name);
    const to = own(current, name);
    if (from === undefined) changes.push(change(kind, 'added', entity, name, undefined, to));
    else if (to === undefined) changes.push(change(kind, 'removed', entity, name, from));
    else if (!same(from, to)) {
      changes.push(
        change(kind, 'changed', entity, name, from, to, { keys: changedKeys(from, to) }),
      );
    }
  }
};

const labelOf = (relation) => `${relation.type} ${relation.to}`;

// The relations as a list: the ones that are gone, then the new ones.
const diffRelations = (entity, old, current, changes) => {
  const counts = new Map();
  for (const relation of current) {
    const label = labelOf(relation);
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  for (const relation of old) {
    const label = labelOf(relation);
    const count = counts.get(label) || 0;
    if (count > 0) counts.set(label, count - 1);
    else changes.push(change('relation', 'removed', entity, relation.to, relation));
  }
  for (const relation of current) {
    const label = labelOf(relation);
    const count = counts.get(label);
    if (count > 0) {
      counts.set(label, count - 1);
      changes.push(change('relation', 'added', entity, relation.to, undefined, relation));
    }
  }
};

const META = ['kind', 'scope', 'store', 'allow', 'parent', 'unknown', 'custom'];

// The metadata of an entity; a schema of one type is its type, so a struct
// that became one (or back) differs in `type`.
const metaOf = (entity) => {
  const meta = {};
  for (const key of META) if (entity[key] !== undefined) meta[key] = entity[key];
  if (entity.fields === undefined) meta.type = entity.type;
  return meta;
};

const isRelations = (list) => {
  if (!Array.isArray(list)) return false;
  for (const item of list) if (!isObject(item)) return false;
  return true;
};

// What `diff` reads of an entity: an object with `fields` (every one an
// object: a definition or a function marker) or a `type`, and the relations
// as a list of objects, when there.
const checkEntity = (entity, name) => {
  const fail = (reason) => atSchema(invalidSnapshot(reason), name);
  if (!isObject(entity)) throw fail('An entity of a snapshot must be an object');
  const { fields, type, relations = [] } = entity;
  if (!isObject(fields === undefined ? type : fields) || !isRelations(relations)) {
    throw fail('An entity needs fields or a type, and relations as a list');
  }
  for (const key in fields) {
    if (!isObject(fields[key])) {
      throw invalidSnapshot('A field must be an object').locate(name, key);
    }
  }
};

const diffEntity = (name, old, current, changes) => {
  checkEntity(old, name);
  checkEntity(current, name);
  const from = metaOf(old);
  const to = metaOf(current);
  const keys = changedKeys(from, to);
  if (keys.length > 0) changes.push(change('entity', 'changed', name, name, from, to, { keys }));
  if (old.fields !== undefined && current.fields !== undefined) {
    diffFields(name, old.fields, current.fields, changes);
  }
  diffKeyed('index', name, old.indexes || {}, current.indexes || {}, changes);
  diffRelations(name, old.relations || [], current.relations || [], changes);
};

// The changes from `prev` to `next`, each a Model or a snapshot: the
// entities of `next` in their order (added, or their changes), the entities
// that are gone, then the types.
const diff = (prev, next) => {
  const old = snapshotOf(prev);
  const current = snapshotOf(next);
  const changes = [];
  for (const name of Object.keys(current.entities)) {
    const to = current.entities[name];
    if (Object.hasOwn(old.entities, name)) diffEntity(name, old.entities[name], to, changes);
    else changes.push(change('entity', 'added', name, name, undefined, to));
  }
  for (const name of Object.keys(old.entities)) {
    if (!Object.hasOwn(current.entities, name)) {
      changes.push(change('entity', 'removed', name, name, old.entities[name]));
    }
  }
  diffKeyed('type', '', old.types || {}, current.types || {}, changes);
  return changes;
};

// The classes as bits, so that the class of several changes is the AND of
// theirs: backward and forward make full, either with its opposite makes
// none.
const NONE = 0;
const BACKWARD = 1;
const FORWARD = 2;
const FULL = 3;

const NAMES = ['none', 'backward', 'forward', 'full'];

// A field a reader may do without: an optional one, or one with a default
// the reader fills in.
const optional = (field) => field.required === false || field.default !== undefined;

const numberOf = (value) =>
  value !== null && typeof value === 'object' ? BigInt(value.$bigint) : value;

// A lower bound raised, or an upper bound lowered, accepts less (the new
// reader rejects old data: forward); the other way accepts more (backward).
const boundLevel = (from, to, lower) => {
  if (to === undefined) return BACKWARD;
  if (from === undefined) return FORWARD;
  const tighter = lower ? numberOf(to) > numberOf(from) : numberOf(to) < numberOf(from);
  return tighter ? FORWARD : BACKWARD;
};

const lengthLevel = (from = {}, to = {}) => {
  let level = FULL;
  if (!same(from.min, to.min)) level &= boundLevel(from.min, to.min, true);
  if (!same(from.max, to.max)) level &= boundLevel(from.max, to.max, false);
  return level;
};

const includes = (list, value) => {
  for (const item of list) if (same(item, value)) return true;
  return false;
};

// Values added accept more (backward), values removed accept less (forward).
const enumLevel = (from, to) => {
  let level = FULL;
  for (const value of to) if (!includes(from, value)) level &= BACKWARD;
  for (const value of from) if (!includes(to, value)) level &= FORWARD;
  return level;
};

// Both lists compared by position; a branch added accepts more, one removed
// accepts less; a tuple is the same length or nothing.
const listLevel = (from, to, extensible) => {
  let level = FULL;
  const shared = Math.min(from.length, to.length);
  for (let index = 0; index < shared; index += 1) level &= fieldLevel(from[index], to[index]);
  if (from.length === to.length) return level;
  if (!extensible) return NONE;
  return level & (to.length > from.length ? BACKWARD : FORWARD);
};

// A function of a struct or a field: a validate added accepts less, one
// removed accepts more; a decoder or a serializer changes nothing the data
// carries.
const functionLevel = (key, from, to) => {
  if (key !== 'validate') return FULL;
  if (from === undefined) return FORWARD;
  if (to === undefined) return BACKWARD;
  return FULL;
};

// The fields of a nested struct, by the rules of the fields of an entity.
const structLevel = (old, current) => {
  let level = FULL;
  const renamed = new Set();
  for (const name of Object.keys(current)) {
    const to = current[name];
    const from = own(old, name);
    if (isFunctionMarker(to) || isFunctionMarker(from)) {
      if (!same(from, to)) level &= functionLevel(name, from, to);
      continue;
    }
    if (from !== undefined) {
      level &= fieldLevel(from, to);
      continue;
    }
    const previous = renamedFrom(to, old, current);
    if (previous === null) {
      level &= optional(to) ? FULL : FORWARD;
      continue;
    }
    renamed.add(previous);
    level &= (optional(old[previous]) ? FULL : BACKWARD) & fieldLevel(old[previous], to);
  }
  for (const name of Object.keys(old)) {
    if (Object.hasOwn(current, name) || renamed.has(name)) continue;
    const from = old[name];
    if (isFunctionMarker(from)) level &= functionLevel(name, from, undefined);
    else level &= optional(from) ? FULL : BACKWARD;
  }
  return level;
};

// An alias removed leaves old data under that key unreadable.
const aliasesLevel = (from = [], to = []) => {
  for (const alias of from) if (!to.includes(alias)) return FORWARD;
  return FULL;
};

// The class of one key of a field definition that changed.
const keyLevel = (key, from, to, field) => {
  switch (key) {
    case 'required':
      return to === false ? BACKWARD : FORWARD;
    case 'default':
      if (from === undefined || to !== undefined) return FULL;
      return field.required === false ? FULL : FORWARD;
    case 'nullable':
      return to === true ? BACKWARD : FORWARD;
    case 'length':
      return lengthLevel(from, to);
    case 'min':
      return boundLevel(from, to, true);
    case 'max':
      return boundLevel(from, to, false);
    case 'pattern':
      return from === undefined ? FORWARD : to === undefined ? BACKWARD : NONE;
    case 'enum':
      return Array.isArray(from) && Array.isArray(to) ? enumLevel(from, to) : NONE;
    case 'validate':
    case 'parse':
    case 'serialize':
      return functionLevel(key, from, to);
    case 'aliases':
      return aliasesLevel(from, to);
    case 'schema':
      return isObject(from) && isObject(to) ? structLevel(from, to) : NONE;
    case 'value':
      if (Array.isArray(from) && Array.isArray(to)) return listLevel(from, to, false);
      return isObject(from) && isObject(to) ? fieldLevel(from, to) : NONE;
    case 'union':
      return Array.isArray(from) && Array.isArray(to) ? listLevel(from, to, true) : NONE;
    case 'key':
    case 'one':
    case 'many':
    case 'embed':
    case 'discriminator':
      return NONE;
    default:
      return FULL;
  }
};

// Two definitions of one field: a type widened from integer to number reads
// old data (backward), narrowed the other way is read by old readers
// (forward), any other type is another thing; then every key that changed.
const fieldLevel = (from, to) => {
  if (isFunctionMarker(from) || isFunctionMarker(to)) return same(from, to) ? FULL : NONE;
  let level = FULL;
  if (from.type !== to.type) {
    if (from.type === 'integer' && to.type === 'number') level = BACKWARD;
    else if (from.type === 'number' && to.type === 'integer') level = FORWARD;
    else return NONE;
  }
  for (const key of keysOf(from, to)) {
    const a = own(from, key);
    const b = own(to, key);
    if (key === 'type' || same(a, b)) continue;
    level &= keyLevel(key, a, b, to);
  }
  return level;
};

const entityLevel = (entry) => {
  const { op, detail, to } = entry;
  if (op === 'added') return FULL;
  if (op === 'removed') return BACKWARD;
  let level = FULL;
  for (const key of detail.keys) {
    if (key === 'kind' || key === 'store' || key === 'parent' || key === 'type') level &= NONE;
    else if (key === 'unknown') level &= to.unknown === 'ignore' ? BACKWARD : FORWARD;
  }
  return level;
};

const levelOf = (entry) => {
  const { kind, op, from, to } = entry;
  if (kind === 'entity') return entityLevel(entry);
  if (kind === 'type') {
    if (op !== 'changed') return FULL;
    return same(entry.detail.keys, ['metadata']) ? FULL : NONE;
  }
  if (kind !== 'field') return FULL;
  // A function among the fields: a calculated field, or a function of the
  // schema itself.
  if (isFunctionMarker(from) || isFunctionMarker(to)) return functionLevel(entry.name, from, to);
  if (op === 'added') return optional(to) ? FULL : FORWARD;
  if (op === 'removed') return optional(from) ? FULL : BACKWARD;
  const level = fieldLevel(from, to);
  return op === 'renamed' ? level & (optional(from) ? FULL : BACKWARD) : level;
};

// What a change carries, as `diff` writes it: a kind and an op, and the
// keys that differ for `changed`.
const isChange = (entry) =>
  isObject(entry) &&
  typeof entry.kind === 'string' &&
  typeof entry.op === 'string' &&
  (entry.op !== 'changed' || Array.isArray(entry.detail?.keys));

// The class of a change as bits. Whatever fails while its definitions are
// read (a bigint that does not read, a nesting the stack cannot take) is an
// error of the snapshot, located at the change.
const classOf = (entry) => {
  if (!isChange(entry)) throw invalidTarget('A list of changes is expected');
  try {
    return levelOf(entry);
  } catch (error) {
    const located = error instanceof SchemaDefinitionError ? error : invalidSnapshot(error.message);
    throw located.locate(entry.entity, entry.name);
  }
};

// The class of one change: 'full', 'backward', 'forward' or 'none'.
const compatibilityOf = (entry) => NAMES[classOf(entry)];

// The class of a list of changes: the class every change allows.
const compatibility = (changes) => {
  if (!Array.isArray(changes)) throw invalidTarget('A list of changes is expected');
  let level = FULL;
  for (const entry of changes) level &= classOf(entry);
  return NAMES[level];
};

module.exports = { diff, compatibility, compatibilityOf };
