// The model as data: `model.toJSON()` writes the entities of a model, their
// fields and the types they use as plain JSON, in dependency order and with
// a fixed key order, so that two builds of one model give the same text and
// a committed snapshot is a baseline a later model can be compared with
// (Drizzle's approach to migrations, without a database). A function has no
// JSON form and is written as `{ $function: true }` wherever it stands (a
// validate, a decoder, a default factory, a calculated field); a bigint and a
// Date are tagged the same way, a RegExp is its source. The metadata of the
// program (`database`, the `custom` metadata of a kind, an index definition)
// is written as given. `fromJSON` of the `./model` subpath reads it back.
const { hasBrand, define } = require('./util.js');

const FORMAT = 1;

// The own keys of an object, in order, each value written out.
const objectOf = (value) => {
  const out = {};
  for (const key of Object.keys(value)) {
    const item = value[key];
    if (item !== undefined) define(out, key, valueOf(item));
  }
  return out;
};

// A value of a definition as JSON: a built field as its snapshot, a tag for
// a function, a bigint or a Date; what has no JSON form at all (a symbol,
// NaN) is left to JSON.stringify, which drops or nulls it.
const valueOf = (value) => {
  const type = typeof value;
  if (type === 'function') return { $function: true };
  if (type === 'bigint') return { $bigint: String(value) };
  if (type !== 'object' || value === null) return value;
  if (hasBrand(value, 'Type')) return fieldOf(value);
  if (Array.isArray(value)) {
    const list = [];
    for (let index = 0; index < value.length; index += 1) list.push(valueOf(value[index]));
    return list;
  }
  const name = value.constructor?.name;
  if (name === 'RegExp') {
    return value.flags === 'u' ? value.source : { source: value.source, flags: value.flags };
  }
  if (name === 'Date') return { $date: value.toISOString() };
  return objectOf(value);
};

// A field: its type and whether it is required first, then its other keys
// sorted, so the text does not depend on how the definition was written.
const fieldOf = (field) => {
  const out = { type: field.type, required: field.required };
  for (const key of Object.keys(field).sort()) {
    const item = field[key];
    if (key !== 'root' && item !== undefined) out[key] = valueOf(item);
  }
  return out;
};

// An entity: its metadata, then its fields (`fields`) or, for a schema of
// one type, that type (`type`). The functions of the schema itself (its
// validate, parse, serialize and format) are written among the fields, as
// the ones of a nested struct are.
const entityOf = (schema) => {
  const { kind, scope, store, allow, parent, unknown, custom, options, fields, indexes } = schema;
  const out = { kind, scope, store, allow, parent, unknown, custom };
  if (hasBrand(fields, 'Struct')) {
    out.fields = objectOf(fields);
    for (const key in options) if (options[key] !== null) out.fields[key] = valueOf(options[key]);
  } else out.type = fieldOf(fields);
  const own = {};
  // A `many` field is recorded with the indexes and is not one.
  for (const key in indexes) if (indexes[key].many === undefined) own[key] = indexes[key];
  out.indexes = own;
  out.relations = valueOf(Array.from(schema.relations));
  return out;
};

// The types the entities use, by name: an alias as its `js`, a type with a
// check of its own as `check: true` with its kind, a built-in only when it
// carries metadata.
const typesOf = (model) => {
  const names = new Set();
  for (const entity of model.entities.values()) {
    for (const name of entity.references) names.add(name);
  }
  const out = {};
  for (const name of Array.from(names).sort()) {
    const Type = model.types[name];
    if (Type === undefined) continue;
    const { source } = Type;
    const entry = {};
    if (source !== undefined) {
      if (source.js !== undefined) entry.js = source.js;
      else {
        entry.kind = Type.kind;
        entry.check = true;
      }
    }
    entry.metadata = objectOf(Type.metadata);
    if (source !== undefined || Object.keys(entry.metadata).length > 0) out[name] = entry;
  }
  return out;
};

// The entities in dependency order (`model.order`).
const snapshotOf = (model) => {
  const entities = {};
  for (const name of model.order) define(entities, name, entityOf(model.entities.get(name)));
  return { format: FORMAT, database: model.database, types: typesOf(model), entities };
};

module.exports = { FORMAT, snapshotOf };
