// The model as data: `model.toJSON()` writes the entities of a model, their
// fields and the types they use as plain JSON, in dependency order and with
// a fixed key order, so that two builds of one model give the same text and
// a committed snapshot is a baseline a later model can be compared with
// (Drizzle's approach to migrations, without a database). A function has no
// JSON form and is written as `{ $function: true }` wherever it stands (a
// validate, a decoder, a default factory, a calculated field); a bigint, a
// Date, bytes, a Map and a Set are tagged the same way, a RegExp is its
// source. The metadata of the
// program (`database`, the `custom` metadata of a kind, an index definition)
// is written as given. `fromJSON` of the `./model` subpath reads it back.
// `schema.toSnapshot()` is the same document for one schema and the
// entities it reaches through its references, with the name of the schema
// as `root`.
const { isFirstUpper } = require('./metautil.js');
const { hasBrand, define, isBytes, isMap, isSet, isDate, isRegExp } = require('./util.js');
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

const listOf = (values) => {
  const list = [];
  for (const item of values) list.push(valueOf(item));
  return list;
};

// The bytes of a view as base64 text: what a default of `bytes` is in JSON.
const base64Of = (bytes) => {
  let text = '';
  for (let index = 0; index < bytes.length; index += 1) text += String.fromCharCode(bytes[index]);
  return btoa(text);
};

// A value of a definition as JSON: a built field as its snapshot, a tag for
// a function, a bigint, a Date, bytes, a Map (its entries) and a Set (its
// values); what has no JSON form at all (a symbol, NaN) is left to
// JSON.stringify, which drops or nulls it.
const valueOf = (value) => {
  const type = typeof value;
  if (type === 'function') return { $function: true };
  if (type === 'bigint') return { $bigint: String(value) };
  if (type !== 'object' || value === null) return value;
  if (hasBrand(value, 'Type')) return fieldOf(value);
  if (Array.isArray(value)) return listOf(value);
  if (isBytes(value)) return { $bytes: base64Of(value) };
  if (isMap(value)) return { $map: listOf(value) };
  if (isSet(value)) return { $set: listOf(value) };
  if (isRegExp(value)) {
    return value.flags === 'u' ? value.source : { source: value.source, flags: value.flags };
  }
  if (isDate(value)) return { $date: value.toISOString() };
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

// The names the fields of a schema use (a type, an entity), each with the
// schema that resolves it: the root of the field, which is the schema, or a
// schema it reuses as a field (`{ inner: Inner }`), whose fields keep their
// own. `references` holds the names of both, without saying which schema
// resolves a name; this does, at any depth. A default and examples are
// values and hold no fields.
const usesOf = (schema) => {
  const uses = [];
  const walk = (value) => {
    if (hasBrand(value, 'Type')) {
      uses.push([value.type, value.root]);
      for (const key of Object.keys(value)) {
        if (key !== 'root' && key !== 'default' && key !== 'examples') walk(value[key]);
      }
    } else if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) walk(value[index]);
    } else if (hasBrand(value, 'Struct')) {
      for (const key of Object.keys(value)) walk(value[key]);
    }
  };
  walk(schema.fields);
  return uses;
};

// A type as the snapshot writes it: an alias as its `js`, a type with a
// check of its own as `check: true` with its kind, a built-in only when it
// carries metadata (a built-in is in every registry), else null.
const typeOf = (Type) => {
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
  return source !== undefined || Object.keys(entry.metadata).length > 0 ? entry : null;
};

const typeClash = (name) =>
  new SchemaDefinitionError(
    'ERR_UNREPRESENTABLE',
    `Two types named "${name}" cannot be represented in one snapshot`,
  );

// The types the entities use, by name, and the custom types their aliases
// name down the chain (a model is restored from them): each from the table
// of the schema whose fields use it (`tableOf` for an entity, its own for a
// schema it reuses). Two custom types of one name that are written apart
// (two registries) cannot be one snapshot.
const typesOf = (entities, tableOf) => {
  const found = new Map();
  const add = (name, table) => {
    const Type = table[name];
    if (Type === undefined) return;
    const known = found.get(name);
    if (known !== undefined) {
      const differs = known !== Type && (known.source !== undefined || Type.source !== undefined);
      if (differs && JSON.stringify(typeOf(known)) !== JSON.stringify(typeOf(Type))) {
        throw typeClash(name);
      }
      return;
    }
    found.set(name, Type);
    const js = Type.source?.js;
    if (js !== undefined && table[js]?.source !== undefined) add(js, table);
  };
  for (const entity of entities) {
    const uses = usesOf(entity);
    for (let index = 0; index < uses.length; index += 1) {
      const root = uses[index][1];
      add(uses[index][0], root === entity ? tableOf(entity) : root.types);
    }
  }
  const out = {};
  for (const name of Array.from(found.keys()).sort()) {
    const entry = typeOf(found.get(name));
    if (entry !== null) out[name] = entry;
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

// The order of the entities of a model and of a snapshot: depth first from
// each start in turn, every entity after the ones its edges reach
// (`edgesOf` gives `[name, schema]` pairs), a cycle cut where it closes and
// told to `onCycle`. A loop rather than a recursion, so that a chain of
// entities of any length orders. `nodes` holds the schema met under each
// name: one name for two schemas is a clash. `order` may come with names
// already in it (a model puts `Identifier` first).
const orderOf = (starts, edgesOf, onCycle, order = new Set(), nodes = new Map()) => {
  const path = new Set();
  const stack = [];
  const enter = (name, schema) => {
    nodes.set(name, schema);
    path.add(name);
    stack.push({ name, edges: edgesOf(schema), index: 0 });
  };
  for (const start of starts) {
    if (!nodes.has(start[0]) && !order.has(start[0])) enter(start[0], start[1]);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame.index === frame.edges.length) {
        stack.pop();
        path.delete(frame.name);
        order.add(frame.name);
        continue;
      }
      const edge = frame.edges[frame.index];
      frame.index += 1;
      const name = edge[0];
      const known = nodes.get(name);
      if (known !== undefined && known !== edge[1]) throw clash(name);
      if (name === frame.name || order.has(name)) continue;
      if (path.has(name)) onCycle(frame.name, name);
      else enter(name, edge[1]);
    }
  }
  return order;
};

// The entities a schema reaches, by the name a reference reached each
// through (an anonymous schema of a model is the entity of the name the
// model gives it): its references resolved as its fields resolve them
// (`usesOf`), and the parent of a projection, which restoring it needs.
const edgesOf = (schema) => {
  const uses = usesOf(schema);
  if (schema.parent !== '') uses.push([schema.parent, schema]);
  const edges = [];
  for (let index = 0; index < uses.length; index += 1) {
    const ref = uses[index][0];
    if (!isFirstUpper(ref)) continue;
    const target = uses[index][1].findReference(ref);
    if (target !== null) edges.push([ref, target]);
  }
  return edges;
};

// The snapshot of one schema: the format of a model's, with the schema's
// name as `root` and no database metadata. An anonymous schema is the
// entity ''. The entities are in the order a walk from the schema meets
// them, each after the ones it references (a cycle cut where it closes),
// `Identifier` first: not the order of a model, which depends on the order
// its entities were given in, so that a schema restored from its snapshot
// writes the same text again, a cycle included.
const schemaSnapshotOf = (schema) => {
  const found = new Map();
  const order = Array.from(orderOf([[schema.name, schema]], edgesOf, () => {}, new Set(), found));
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

module.exports = { FORMAT, snapshotOf, schemaSnapshotOf, usesOf, orderOf };
