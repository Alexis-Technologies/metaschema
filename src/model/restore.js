// A model from a snapshot (`fromJSON`): the structure, the rules and the
// metadata come back as they were written; a function has no body in JSON,
// so a placeholder stands in for it (a validate that passes, a decoder, a
// serializer and a format that return the value, a default factory and a
// calculated field that give nothing, a custom type whose check accepts
// everything and every rule). The model validates the structure, then;
// `options.types` brings the real custom types where the model should
// validate as the original did.
const { define } = require('../util.js');
const { Schema } = require('../schema.js');
const { Model } = require('../model.js');
const { invalidSnapshot, isObject, isSnapshot, isFunctionMarker } = require('./data.js');

const nothing = () => undefined;
const identity = (value) => value;

// What stands in for a function, by the key it is under.
const placeholderOf = (key) =>
  key === 'parse' || key === 'serialize' || key === 'format' ? identity : nothing;

// A value of a snapshot as a value of a definition: the tags revived, a
// function marker as the placeholder of its key.
const revive = (value, key) => {
  if (Array.isArray(value)) {
    const list = [];
    for (let index = 0; index < value.length; index += 1) list.push(revive(value[index], key));
    return list;
  }
  if (!isObject(value)) return value;
  if (value.$function === true) return placeholderOf(key);
  if (typeof value.$bigint === 'string') return BigInt(value.$bigint);
  if (typeof value.$date === 'string') return new Date(value.$date);
  const out = {};
  for (const name of Object.keys(value)) define(out, name, revive(value[name], name));
  return out;
};

const isField = (value) => isObject(value) && typeof value.type === 'string';

// A field of a snapshot as a definition: `type` first, a pattern as a
// RegExp, a nested struct, an element or the branches as definitions, a
// schema of one type held by a field as a Schema instance (the one form the
// schema type takes it in).
const fieldDef = (def) => {
  if (!isField(def)) throw invalidSnapshot('A field of a snapshot needs a type');
  const out = { type: def.type };
  for (const key of Object.keys(def)) {
    const item = def[key];
    if (key === 'type') continue;
    if (key === 'pattern' && isObject(item)) out.pattern = new RegExp(item.source, item.flags);
    else if (key === 'schema' && isObject(item)) {
      out.schema = isField(item) ? Schema.from(fieldDef(item)) : structDef(item);
    } else if (key === 'value' || key === 'union') {
      out[key] = Array.isArray(item) ? listDef(item) : fieldDef(item);
    } else out[key] = revive(item, key);
  }
  return out;
};

const listDef = (list) => {
  const out = [];
  for (let index = 0; index < list.length; index += 1) out.push(fieldDef(list[index]));
  return out;
};

// The fields of a struct: a function marker is a calculated field or one of
// the functions of the struct, by its key.
const structDef = (fields) => {
  const out = {};
  for (const key of Object.keys(fields)) {
    const item = fields[key];
    define(out, key, isFunctionMarker(item) ? placeholderOf(key) : fieldDef(item));
  }
  return out;
};

const capitalize = (name) => name.charAt(0).toUpperCase() + name.slice(1);

// An entity as a definition: its kind as the first key with the metadata,
// then its fields and its indexes; a schema of one type is that type.
const entityDef = (entity) => {
  if (!isObject(entity) || typeof entity.kind !== 'string') {
    throw invalidSnapshot('An entity of a snapshot needs a kind');
  }
  const { scope, store, allow, unknown, custom, fields, indexes } = entity;
  if (fields === undefined) return fieldDef(entity.type);
  const meta = { scope, store, allow, unknown, ...revive(custom, 'custom') };
  const def = { [capitalize(entity.kind)]: meta };
  const struct = structDef(fields);
  for (const key of Object.keys(struct)) define(def, key, struct[key]);
  if (indexes !== undefined) {
    for (const key of Object.keys(indexes)) define(def, key, revive(indexes[key], key));
  }
  return def;
};

// A type as an entry of the table Model takes: an alias, or a placeholder
// for a type with a check of its own.
const typeDef = (entry) => {
  if (!isObject(entry)) throw invalidSnapshot('A type of a snapshot needs an object');
  const out = {};
  if (entry.js !== undefined) out.js = entry.js;
  else if (entry.check === true) {
    if (entry.kind !== undefined) out.kind = entry.kind;
    out.rules = ['length', 'min', 'max', 'pattern'];
    out.construct = nothing;
    out.checkType = nothing;
  }
  if (entry.metadata !== undefined) out.metadata = revive(entry.metadata, 'metadata');
  return out;
};

// The types in an order the registry accepts: an alias after the type it
// aliases.
const typesDef = (given) => {
  const out = {};
  const seen = new Set();
  const add = (name) => {
    if (seen.has(name)) return;
    seen.add(name);
    const entry = given[name];
    if (isObject(entry) && typeof entry.js === 'string' && Object.hasOwn(given, entry.js)) {
      add(entry.js);
    }
    define(out, name, typeDef(entry));
  };
  for (const name of Object.keys(given)) add(name);
  return out;
};

// The model of a snapshot. `options.types` are entries of the table Model
// takes, over the ones of the snapshot (the real custom types); the
// registry is 'isolated' unless `options.registry` says otherwise, so the
// placeholders never reach the shared one.
const fromJSON = (snapshot, options = {}) => {
  if (!isSnapshot(snapshot)) {
    throw invalidSnapshot('A snapshot of format 1 with entities is expected');
  }
  const types = typesDef(isObject(snapshot.types) ? snapshot.types : {});
  if (options.types !== undefined) Object.assign(types, options.types);
  const entities = [];
  for (const name of Object.keys(snapshot.entities)) {
    entities.push([name, entityDef(snapshot.entities[name])]);
  }
  const { registry = 'isolated' } = options;
  return new Model(types, entities, snapshot.database ?? null, { registry });
};

module.exports = { fromJSON };
