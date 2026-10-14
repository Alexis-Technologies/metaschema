// The `./derive` subpath: schemas made from a schema. A subset of its fields
// (`pick`, `omit`), its fields optional or required (`partial`, `required`),
// fields of its own over the ones it has (`extend`), the names of its fields
// as an enum (`keyof`). The result is a new Schema built from the definition
// the source was built from (what `merge` of the `./model` subpath reads
// too), so the source is never touched and every rule of a field comes along.
// `register()` installs the functions as methods of Schema, so they chain.
const { hasBrand, define, formatters } = require('../util.js');
const { isFirstUpper, firstKey } = require('../metautil.js');
const { Schema } = require('../schema.js');
const { isStruct } = require('../struct.js');
const { idFieldOf } = require('../kinds.js');
const { SchemaDefinitionError, invalidTarget, invalidOption } = require('../errors.js');
const { structDefinitionOf, metadataOf, structDefinition, atSchema } = require('../model/data.js');

// The functions of a nested struct that are its own: written for the whole
// struct, they do not hold for a part of it.
const CODECS = ['validate', 'parse', 'serialize'];

const sourceOf = (schema) => {
  if (!hasBrand(schema, 'Schema') || !isStruct(schema.fields)) {
    throw invalidTarget('A Schema of a struct is expected');
  }
  return schema;
};

// The options of a call are the call's (ERR_INVALID_OPTION); the metadata
// among them is a definition, and a wrong one is a definition error.
const optionsOf = (options = {}) => {
  if (options === null || typeof options !== 'object') {
    throw invalidOption('options', 'an object', options);
  }
  const { metadata } = options;
  if (metadata !== undefined && (metadata === null || typeof metadata !== 'object')) {
    throw new SchemaDefinitionError('ERR_INVALID_OPTIONS', 'Option "metadata" must be an object');
  }
  return options;
};

// The id field a stored kind adds, which goes with the kind unless a call
// names it.
const idOf = idFieldOf;

const isStored = (schema) => idFieldOf(schema) !== null;

// The names a call gives, each a field (or a calculated field) of the
// schema; one it does not have is located in it.
const namesOf = (schema, keys) => {
  if (!Array.isArray(keys)) throw invalidOption('keys', 'a list of field names', keys);
  const names = new Set();
  for (const key of keys) {
    if (typeof key !== 'string') throw invalidOption('keys', 'a list of field names', keys);
    if (!(key in schema.fields)) {
      throw new SchemaDefinitionError('ERR_UNKNOWN_FIELD', 'No such field').locate(
        schema.name,
        key,
      );
    }
    names.add(key);
  }
  return names;
};

// A stored kind or a projection is a struct in what is derived from it: the
// first would add its id again and the second copy its parent's fields over
// the ones derived. A memory kind keeps its metadata.
const kindOf = (schema) => {
  const { kind, unknown } = schema;
  if (kind === 'projection' || isStored(schema)) return { kind: 'struct', unknown };
  return metadataOf(schema);
};

// The definitions of the fields, fresh objects a call may change: the id of
// a stored kind is left out unless `names` has it.
const fieldsOf = (schema, names) => {
  const fields = structDefinitionOf(schema.fields);
  const id = idOf(schema);
  if (id !== null && (names === null || !names.has(id))) delete fields[id];
  return fields;
};

// The fields, then the indexes whose columns are all among them (a `many`
// entry is the field's own), then, with `functions`, the schema's own
// validate, parse, serialize and format.
const bodyOf = (schema, fields, functions) => {
  for (const key in schema.indexes) {
    const index = schema.indexes[key];
    if (index.many !== undefined) continue;
    let kept = true;
    for (const column of index.index || index.primary || index.unique) {
      if (!Object.hasOwn(fields, column)) kept = false;
    }
    if (kept) define(fields, key, index);
  }
  if (functions) {
    for (const key in schema.options) {
      const option = schema.options[key];
      if (option !== null) define(fields, key, option);
    }
  }
  return fields;
};

const build = (schema, options, body, namespaces) => {
  const { name = schema.name, metadata } = options;
  const definition = structDefinition(kindOf(schema), metadata, body);
  return new Schema(name, definition, Array.from(namespaces));
};

const select = (schema, keys, options, keep) => {
  sourceOf(schema);
  const settings = optionsOf(options);
  const names = namesOf(schema, keys);
  const all = fieldsOf(schema, keep ? names : null);
  const fields = {};
  for (const key of Object.keys(all)) {
    if (names.has(key) === keep) define(fields, key, all[key]);
  }
  return build(schema, settings, bodyOf(schema, fields, false), schema.namespaces);
};

// The fields named, in the order of the schema.
const pick = (schema, keys, options) => select(schema, keys, options, true);

// Every field but the ones named.
const omit = (schema, keys, options) => select(schema, keys, options, false);

const isNestedStruct = (def) => def.type === 'schema' && typeof def.schema.type !== 'string';

// A field made optional loses its default (a patch leaves a missing key as
// it is stored), unless `defaults`; `deep` goes on into the fields of a
// nested struct, whose own functions an optional struct loses.
const settle = (def, required, deep, defaults) => {
  def.required = required;
  if (!required && !defaults) delete def.default;
  if (!deep || !isNestedStruct(def)) return;
  const fields = def.schema;
  for (const key of Object.keys(fields)) {
    const nested = fields[key];
    if (typeof nested !== 'function') settle(nested, required, deep, defaults);
  }
  if (required) return;
  for (const key of CODECS) {
    delete def[key];
    delete fields[key];
  }
};

const toggle = (schema, options, required) => {
  sourceOf(schema);
  const settings = optionsOf(options);
  const { keys, deep = false, defaults = false } = settings;
  const names = keys === undefined ? null : namesOf(schema, keys);
  const fields = fieldsOf(schema, names);
  for (const key of Object.keys(fields)) {
    const def = fields[key];
    if (typeof def === 'function') continue;
    if (names === null || names.has(key)) settle(def, required, deep, defaults);
  }
  return build(schema, settings, bodyOf(schema, fields, required), schema.namespaces);
};

// Every field (or the ones in `options.keys`) optional. The schema's own
// functions, written for a whole value, do not come along.
const partial = (schema, options) => toggle(schema, options, false);

// Every field (or the ones in `options.keys`) required.
const required = (schema, options) => toggle(schema, options, true);

// The extension's fields over the schema's: one of the same name takes the
// place of the schema's (`'age?'` replaces `age`), the others come after.
// Not a unification: `merge` of the `./model` subpath is that.
const extend = (schema, extension, options) => {
  sourceOf(schema);
  const settings = optionsOf(options);
  let additions = extension;
  let namespaces = schema.namespaces;
  if (hasBrand(extension, 'Schema')) {
    sourceOf(extension);
    additions = bodyOf(extension, fieldsOf(extension, null), true);
    namespaces = new Set([...schema.namespaces, ...extension.namespaces]);
  } else if (extension === null || typeof extension !== 'object' || Array.isArray(extension)) {
    throw invalidTarget('An extension is a Schema of a struct or an object of fields');
  } else if (isFirstUpper(firstKey(extension))) {
    const reason = 'An extension has fields only; the kind is options.metadata';
    throw atSchema(new SchemaDefinitionError('ERR_INVALID_DEFINITION', reason), schema.name);
  }
  const keys = new Map();
  for (const key of Object.keys(additions)) keys.set(formatters.key(key).field, key);
  const base = bodyOf(schema, fieldsOf(schema, null), true);
  const body = {};
  const placed = new Set();
  for (const key of Object.keys(base)) {
    const own = keys.get(key);
    if (own === undefined) define(body, key, base[key]);
    else if (!placed.has(own)) {
      define(body, own, additions[own]);
      placed.add(own);
    }
  }
  for (const key of Object.keys(additions)) {
    if (!placed.has(key)) define(body, key, additions[key]);
  }
  return build(schema, settings, body, namespaces);
};

// The names of the fields a value carries, as a schema of an enum: the
// calculated fields and the id of a stored kind are not among them.
const keyof = (schema, options) => {
  sourceOf(schema);
  const { name = schema.name, metadata } = optionsOf(options);
  if (metadata !== undefined) {
    const reason = 'keyof takes a name only: a schema of an enum has no kind';
    throw atSchema(new SchemaDefinitionError('ERR_INVALID_OPTIONS', reason), schema.name);
  }
  const id = idOf(schema);
  const names = [];
  for (const key in schema.fields) {
    if (key !== id && hasBrand(schema.fields[key], 'Type')) names.push(key);
  }
  return new Schema(name, { enum: names }, Array.from(schema.namespaces));
};

// Installed like class members: not enumerable. A copy per subpath rather
// than a helper of the core: the core is measured on its own, the subpaths
// on top of it.
const install = (target, members) => {
  const descriptors = Object.getOwnPropertyDescriptors(members);
  for (const name in descriptors) {
    descriptors[name].enumerable = false;
    Object.defineProperty(target, name, descriptors[name]);
  }
};

let registered = false;

// Adds `schema.pick(keys, options)`, `schema.omit(keys, options)`,
// `schema.partial(options)`, `schema.required(options)`,
// `schema.extend(extension, options)` and `schema.keyof(options)`. Once per
// process.
const register = () => {
  if (registered) return;
  registered = true;
  install(Schema.prototype, {
    pick(keys, options) {
      return pick(this, keys, options);
    },
    omit(keys, options) {
      return omit(this, keys, options);
    },
    partial(options) {
      return partial(this, options);
    },
    required(options) {
      return required(this, options);
    },
    extend(extension, options) {
      return extend(this, extension, options);
    },
    keyof(options) {
      return keyof(this, options);
    },
  });
};

module.exports = { pick, omit, partial, required, extend, keyof, register };
