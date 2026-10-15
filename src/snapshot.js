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
// `schema.toSnapshot()` is the same document for one schema and the
// entities it reaches through its references, with the name of the schema
// as `root`.
const { isFirstUpper } = require('./metautil.js');
const { hasBrand, define } = require('./util.js');
const { SchemaDefinitionError } = require('./errors.js');

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
  for (const key in indexes) if (indexes[key].many === undefined) define(own, key, indexes[key]);
  out.indexes = own;
  out.relations = valueOf(Array.from(schema.relations));
  return out;
};

// The types the entities use, by name, each from the table `tableOf` gives
// for the first entity that uses it, and the custom types their aliases name
// down the chain (a model is restored from them; a built-in is in every
// registry): an alias as its `js`, a type with a check of its own as
// `check: true` with its kind, a built-in only when it carries metadata.
const typesOf = (entities, tableOf) => {
  const found = new Map();
  const add = (name, table) => {
    if (found.has(name)) return;
    const Type = table[name];
    found.set(name, Type);
    const js = Type?.source?.js;
    if (js !== undefined && table[js]?.source !== undefined) add(js, table);
  };
  for (const entity of entities) {
    const table = tableOf(entity);
    for (const name of entity.references) add(name, table);
  }
  const out = {};
  for (const name of Array.from(found.keys()).sort()) {
    const Type = found.get(name);
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

// The entities by name, in dependency order: what a model writes in
// `model.order`, a schema in the order `gather` met them.
const entitiesOf = (names, schemaOf) => {
  const entities = {};
  for (const name of names) define(entities, name, entityOf(schemaOf(name)));
  return entities;
};

const snapshotOf = (model) => {
  const { order } = model;
  const schemas = [];
  for (const name of order) schemas.push(model.entities.get(name));
  return {
    format: FORMAT,
    database: model.database,
    types: typesOf(schemas, () => model.types),
    entities: entitiesOf(order, (name) => model.entities.get(name)),
  };
};

const clash = (name) =>
  new SchemaDefinitionError(
    'ERR_UNREPRESENTABLE',
    `Two schemas named "${name}" cannot be represented in one snapshot`,
  );

// A schema and the entities it reaches, by name, each after the ones it
// references (the order of a model: a cycle is cut where it closes): its
// references resolved through the schema that holds them, and the parent
// of a projection, which restoring it needs. One entity per name.
const gather = (schema, found, order) => {
  const { name } = schema;
  const known = found.get(name);
  if (known !== undefined) {
    if (known !== schema) throw clash(name);
    return;
  }
  found.set(name, schema);
  const names = Array.from(schema.references);
  if (schema.parent !== '') names.push(schema.parent);
  for (const ref of names) {
    if (!isFirstUpper(ref)) continue;
    const target = schema.findReference(ref);
    if (target !== null) gather(target, found, order);
  }
  order.push(name);
};

// The snapshot of one schema: the format of a model's, with the schema's
// name as `root` and no database metadata. An anonymous schema is the
// entity ''.
const schemaSnapshotOf = (schema) => {
  const found = new Map();
  const order = [];
  gather(schema, found, order);
  const at = order.indexOf('Identifier');
  if (at > 0) order.unshift(order.splice(at, 1)[0]);
  const schemas = [];
  for (const name of order) schemas.push(found.get(name));
  return {
    format: FORMAT,
    root: schema.name,
    database: null,
    types: typesOf(schemas, (entity) => entity.types),
    entities: entitiesOf(order, (name) => found.get(name)),
  };
};

module.exports = { FORMAT, snapshotOf, schemaSnapshotOf };
