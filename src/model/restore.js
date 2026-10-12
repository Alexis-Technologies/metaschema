// A model from a snapshot (`fromJSON`): the structure, the rules and the
// metadata come back as they were written; a function has no body in JSON,
// so a placeholder stands in for it (a validate that passes, a decoder, a
// serializer and a format that return the value, a default factory and a
// calculated field that give nothing, a custom type whose check accepts
// everything and every rule). The model validates the structure, then;
// `options.types` brings the real custom types where the model should
// validate as the original did, and `model.placeholders` lists the paths
// the placeholders stand at. The snapshot is input: whatever fails while it
// is read (a tag that does not read, a nesting deeper than DEPTH, an index
// named like a field) is ERR_INVALID_SNAPSHOT located where the walk was,
// and the kind metadata it declares is never loosened by its `custom` keys.
const { define, shorten } = require('../util.js');
const { Schema } = require('../schema.js');
const { Model } = require('../model.js');
const { SchemaDefinitionError } = require('../errors.js');
const {
  DEPTH,
  tooDeep,
  invalidSnapshot,
  atSchema,
  isObject,
  isSnapshot,
  isFunctionMarker,
  capitalize,
} = require('./data.js');

const nothing = () => undefined;
const identity = (value) => value;

// What stands in for a function, by the key it is under; `at` is the path
// the model lists it under (once: a nested struct's validate is written as
// the field's key and among the struct's fields).
const placeholderOf = (key, at, context) => {
  context.placeholders.add(at);
  return key === 'parse' || key === 'serialize' || key === 'format' ? identity : nothing;
};

// A value of a snapshot as a value of a definition: the tags revived (a
// bigint that does not read throws its own error, a date is checked), a
// function marker as the placeholder of its key. `at` is the path of the
// value (`context.at` while it is read) and `depth` its nesting, which
// stops at DEPTH.
const revive = (value, key, at, depth, context) => {
  context.at = at;
  if (depth > DEPTH) throw tooDeep();
  if (Array.isArray(value)) {
    const list = [];
    for (const item of value) list.push(revive(item, key, at, depth + 1, context));
    return list;
  }
  if (!isObject(value)) return value;
  if (value.$function === true) return placeholderOf(key, at, context);
  if (typeof value.$bigint === 'string') return BigInt(value.$bigint);
  if (typeof value.$date === 'string') {
    const date = new Date(value.$date);
    if (Number.isNaN(+date)) throw invalidSnapshot(`${JSON.stringify(value.$date)} is not a date`);
    return date;
  }
  const out = {};
  for (const name of Object.keys(value)) {
    define(out, name, revive(value[name], name, `${at}.${name}`, depth + 1, context));
  }
  return out;
};

const isField = (value) => isObject(value) && typeof value.type === 'string';

// A field of a snapshot as a definition: `type` first, a pattern with flags
// as a RegExp (it needs a source), a nested struct, an element or the
// branches as definitions, a schema of one type held by a field as a Schema
// instance (the one form the schema type takes it in).
const fieldDef = (def, at, depth, context) => {
  context.at = at;
  if (depth > DEPTH) throw tooDeep();
  if (!isField(def)) throw invalidSnapshot('A field of a snapshot needs a type');
  const out = { type: def.type };
  for (const key of Object.keys(def)) {
    const item = def[key];
    context.at = at;
    if (key === 'type') continue;
    if (key === 'pattern' && isObject(item)) {
      if (typeof item.source !== 'string') throw invalidSnapshot('A pattern needs a string source');
      out.pattern = new RegExp(item.source, item.flags);
    } else if (key === 'schema' && isObject(item)) {
      out.schema = isField(item)
        ? Schema.from(fieldDef(item, at, depth + 1, context))
        : structDef(item, at, depth + 1, context);
    } else if ((key === 'value' || key === 'union') && Array.isArray(item)) {
      const list = [];
      for (const part of item) list.push(fieldDef(part, at, depth + 1, context));
      out[key] = list;
    } else if (key === 'value') out.value = fieldDef(item, at, depth + 1, context);
    else define(out, key, revive(item, key, `${at}.${key}`, depth, context));
  }
  return out;
};

// The fields of a struct: a function marker is a calculated field or one of
// the functions of the struct, by its key.
const structDef = (fields, at, depth, context) => {
  const out = {};
  for (const key of Object.keys(fields)) {
    const item = fields[key];
    const where = `${at}.${shorten(key)}`;
    const def = isFunctionMarker(item)
      ? placeholderOf(key, where, context)
      : fieldDef(item, where, depth, context);
    define(out, key, def);
  }
  return out;
};

// An entity as a definition: its kind as the first key with the metadata,
// then its fields and its indexes; a schema of one type is that type.
const entityDef = (name, entity, context) => {
  context.at = name;
  if (!isObject(entity) || typeof entity.kind !== 'string') {
    throw invalidSnapshot('An entity of a snapshot needs a kind');
  }
  const { scope, store, allow, unknown, custom, fields, indexes } = entity;
  if (fields === undefined) return fieldDef(entity.type, name, 0, context);
  for (const key of ['fields', 'custom', 'indexes']) {
    if (entity[key] !== undefined && !isObject(entity[key])) {
      throw invalidSnapshot(`The ${key} of an entity must be an object`);
    }
  }
  // The keys of the kind win over `custom`: a snapshot does not loosen
  // `unknown` through its metadata.
  const revived = revive(custom, 'custom', `${name}.custom`, 0, context);
  const def = { [capitalize(entity.kind)]: { ...revived, scope, store, allow, unknown } };
  const struct = structDef(fields, name, 0, context);
  for (const key of Object.keys(struct)) define(def, key, struct[key]);
  for (const key of Object.keys(indexes ?? {})) {
    context.at = `${name}.${shorten(key)}`;
    if (Object.hasOwn(fields, key)) throw invalidSnapshot('An index is named like a field');
    define(def, key, revive(indexes[key], key, context.at, 0, context));
  }
  return def;
};

// A type as an entry of the table Model takes: an alias, or a placeholder
// for a type with a check of its own, unless `options.types` brings the
// real one. A shared registry takes no placeholder: it would stand for the
// type in every schema of the process.
const typeDef = (name, entry, context) => {
  context.at = `types.${name}`;
  if (!isObject(entry)) throw invalidSnapshot('A type of a snapshot needs an object');
  const out = {};
  if (entry.js !== undefined) out.js = entry.js;
  else if (entry.check === true && !Object.hasOwn(context.given, name)) {
    if (context.shared) {
      throw invalidSnapshot(
        `Type "${name}" of the snapshot needs options.types or an isolated registry`,
      );
    }
    if (entry.kind !== undefined) out.kind = entry.kind;
    out.rules = ['length', 'min', 'max', 'pattern'];
    out.construct = nothing;
    out.checkType = nothing;
    context.placeholders.add(`${context.at}.checkType`);
  }
  if (entry.metadata !== undefined) {
    out.metadata = revive(entry.metadata, 'metadata', `${context.at}.metadata`, 0, context);
  }
  return out;
};

// The types in an order the registry accepts: an alias after the type it
// aliases, down a chain no longer than DEPTH.
const typesDef = (given, context) => {
  const out = {};
  const seen = new Set();
  const add = (name, depth) => {
    if (seen.has(name)) return;
    if (depth > DEPTH) throw tooDeep();
    seen.add(name);
    const entry = given[name];
    if (isObject(entry) && typeof entry.js === 'string' && Object.hasOwn(given, entry.js)) {
      add(entry.js, depth + 1);
    }
    define(out, name, typeDef(name, entry, context));
  };
  for (const name of Object.keys(given)) add(name, 0);
  return out;
};

// The model of a snapshot. `options.types` are entries of the table Model
// takes, over the ones of the snapshot (the real custom types); the
// registry is 'isolated' unless `options.registry` says otherwise, so the
// placeholders never reach the shared one. The model lists the paths of its
// placeholders, invisibly to `toJSON`.
const fromJSON = (snapshot, options = {}) => {
  if (!isSnapshot(snapshot)) {
    throw invalidSnapshot('A snapshot of format 1 with entities is expected');
  }
  if (!isObject(options)) {
    throw new SchemaDefinitionError('ERR_INVALID_OPTIONS', 'Restore options must be an object');
  }
  const { registry = 'isolated', types: given = {} } = options;
  const context = { name: 'types', at: 'types', given, shared: registry === 'shared' };
  context.placeholders = new Set();
  const entities = [];
  let types;
  try {
    types = typesDef(snapshot.types ?? {}, context);
    for (const name of Object.keys(snapshot.entities)) {
      context.name = name;
      entities.push([name, entityDef(name, snapshot.entities[name], context)]);
    }
  } catch (error) {
    // Whatever fails while the snapshot is read is an error of the snapshot
    // (a bigint or a pattern that does not read throws its own), located in
    // the entity at the path the walk was on, as a struct locates a
    // definition error.
    const located = error instanceof SchemaDefinitionError ? error : invalidSnapshot(error.message);
    const field = context.at.slice(context.name.length + 1);
    throw field ? located.locate(context.name, field) : atSchema(located, context.name);
  }
  Object.assign(types, given);
  const model = new Model(types, entities, snapshot.database ?? null, { registry });
  Object.defineProperty(model, 'placeholders', { value: Array.from(context.placeholders) });
  return model;
};

module.exports = { fromJSON };
