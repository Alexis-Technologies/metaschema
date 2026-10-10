// The JSON Schema export of a schema or a model: the rules of `check`, written
// out as a document of a target dialect. A struct is an object with its
// required keys and no others, an optional field accepts null, a rule is the
// matching keyword, and a reference is an id or the record by the kind of its
// target. What has no JSON form (a bigint, a Date or a Set on the way out, a
// custom type without metadata) throws, or renders as `{}` when the call says
// `unrepresentable: 'any'`.
const { hasBrand } = require('./util.js');
const { isStruct } = require('./struct.js');
const { SchemaDefinitionError } = require('./errors.js');
const { embeds } = require('./prototypes/reference.js');

// What differs between the dialects: the keyword of a type, where the
// definitions live, whether `const`, tuples, `propertyNames` and siblings of
// `$ref` exist, how null is allowed (OpenAPI 3.0 has `nullable`), which
// annotations pass through and whether the strict profile applies.
const TARGETS = {
  'draft-2020-12': {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    definitions: '#/$defs/',
    tuple: 'prefixItems',
    const: true,
    names: true,
    siblings: true,
    strict: true,
    annotations: ['title', 'description', 'default', 'examples', 'deprecated'],
  },
  'draft-07': {
    $schema: 'http://json-schema.org/draft-07/schema#',
    definitions: '#/definitions/',
    tuple: 'items',
    const: true,
    names: true,
    strict: true,
    annotations: ['title', 'description', 'default', 'examples'],
  },
  'openapi-3.0': {
    definitions: '#/components/schemas/',
    nullable: true,
    oneOf: true,
    annotations: ['title', 'description', 'default', 'example', 'deprecated'],
  },
  mongodb: {
    tuple: 'items',
    annotations: ['title', 'description'],
  },
};

const TARGET_NAMES = Object.keys(TARGETS);

// BSON type names where they differ from the JSON Schema ones.
const BSON = { boolean: 'bool', integer: ['int', 'long'], bigint: 'long' };

// The keys of a JSON object are strings, so a number key is a pattern.
const NUMBER_KEY = '^-?\\d+(\\.\\d+)?$';

// The key every stored MongoDB document has.
const ID = '_id';

const invalidOptions = (reason) => new SchemaDefinitionError('ERR_INVALID_OPTIONS', reason);

const option = (options, name, allowed) => {
  const value = options[name];
  if (value === undefined) return allowed[0];
  if (!allowed.includes(value)) {
    const list = allowed.map((item) => JSON.stringify(item)).join(', ');
    const got = JSON.stringify(value);
    throw invalidOptions(`JSON Schema option "${name}" must be one of ${list}, got ${got}`);
  }
  return value;
};

const isPointer = (value) =>
  typeof value === 'string' && value.length > 3 && value.startsWith('#/') && value.endsWith('/');

// The state of one export: the target and the options, the definitions met
// so far (by entity name, in the order they were met), the entities being
// inlined (the mongodb target has no `$ref`, so a cycle is an error), the
// root schema (a reference to it is `#`) and the schema being rendered (for
// the location of an error).
const createContext = (options, unknown) => {
  if (options === null || typeof options !== 'object') {
    throw invalidOptions('JSON Schema options must be an object');
  }
  const name = option(options, 'target', TARGET_NAMES);
  const target = TARGETS[name];
  const io = option(options, 'io', ['input', 'output']);
  const any = option(options, 'unrepresentable', ['throw', 'any']) === 'any';
  const references = option(options, 'references', ['kind', 'embed', 'id']);
  const { profile, definitions = target.definitions } = options;
  if (profile !== undefined && profile !== 'strict') {
    const got = JSON.stringify(profile);
    throw invalidOptions(`JSON Schema option "profile" must be "strict", got ${got}`);
  }
  const strict = profile === 'strict';
  if (strict && target.strict !== true) {
    throw invalidOptions(
      `Profile "strict" needs target "draft-2020-12" or "draft-07", got "${name}"`,
    );
  }
  const mongo = name === 'mongodb';
  if (!mongo && !isPointer(definitions)) {
    throw invalidOptions('JSON Schema option "definitions" must be a pointer such as "#/$defs/"');
  }
  return {
    name,
    target,
    key: mongo ? 'bsonType' : 'type',
    mongo,
    // A BSON document is the stored value itself, so the mongodb target has
    // no input side and no output side.
    input: mongo || io === 'input',
    any,
    references,
    strict,
    closed: strict || unknown !== 'ignore',
    prefix: mongo ? null : definitions,
    defs: new Map(),
    stack: new Set(),
    root: null,
    owner: '',
  };
};

const unrepresentable = (context, what) => {
  if (context.any) return {};
  const reason = `${what} cannot be represented in JSON Schema target "${context.name}"`;
  throw new SchemaDefinitionError('ERR_UNREPRESENTABLE', reason);
};

const typed = (name, context) =>
  context.mongo ? { bsonType: BSON[name] || name } : { type: name };

// A field that accepts null: the type takes 'null' beside it, an enum takes
// the value, anything else (a $ref, a union) goes into an anyOf with null.
// OpenAPI 3.0 has no type lists and says `nullable: true` instead.
const withNull = (json, context) => {
  const { key } = context;
  if (context.target.nullable === true) {
    const wrapped = json.$ref === undefined ? json : { allOf: [json] };
    if (wrapped.enum !== undefined && !wrapped.enum.includes(null)) {
      wrapped.enum = [...wrapped.enum, null];
    }
    wrapped.nullable = true;
    return wrapped;
  }
  if (json.const !== undefined) return { enum: [json.const, null] };
  if (json.enum !== undefined && !json.enum.includes(null)) json.enum = [...json.enum, null];
  const type = json[key];
  if (typeof type === 'string') {
    if (type !== 'null') json[key] = [type, 'null'];
    return json;
  }
  if (Array.isArray(type)) {
    if (!type.includes('null')) json[key] = [...type, 'null'];
    return json;
  }
  if (json.enum !== undefined) return json;
  if (json.anyOf !== undefined) {
    json.anyOf.push({ [key]: 'null' });
    return json;
  }
  return Object.keys(json).length === 0 ? json : { anyOf: [json, { [key]: 'null' }] };
};

// The annotations of the field, by the names the target knows; OpenAPI 3.0
// has one `example`, the first of `examples`. Draft-07 and OpenAPI ignore the
// siblings of a `$ref`, so a bare reference carries none.
const annotate = (json, field, context) => {
  if (json.$ref !== undefined && context.target.siblings !== true) return json;
  for (const name of context.target.annotations) {
    const key = name === 'example' ? 'examples' : name;
    let value = field[key];
    if (value === undefined) continue;
    if (key !== name) {
      if (!Array.isArray(value) || value.length === 0) continue;
      value = value[0];
    }
    json[name] = value;
  }
  return json;
};

const bounds = (json, length, min, max) => {
  if (length === undefined) return;
  if (length.min !== undefined) json[min] = length.min;
  if (length.max !== undefined) json[max] = length.max;
};

// A bigint bound of a number field is written as a number.
const ranged = (json, field, context) => {
  if (context.strict) return json;
  if (field.min !== undefined) json.minimum = Number(field.min);
  if (field.max !== undefined) json.maximum = Number(field.max);
  return json;
};

const list = (field, context) => {
  const json = { [context.key]: 'array', items: render(field.value, context) };
  if (!context.strict) bounds(json, field.length, 'minItems', 'maxItems');
  return json;
};

// The LLM dialects of the strict profile accept no value without a type
// and no object without its properties listed.
const unconstrained = (context, name) =>
  context.strict ? unrepresentable(context, `Type "${name}" (profile strict)`) : null;

// An `object` or `map`: free keys with values of one type. A required one
// must not be empty, as in `check`.
const dictionary = (field, context) => {
  if (context.strict) return unconstrained(context, field.type);
  const json = { [context.key]: 'object', additionalProperties: render(field.value, context) };
  if (field.key === 'number' && context.target.names === true) {
    json.propertyNames = { pattern: NUMBER_KEY };
  }
  bounds(json, field.length, 'minProperties', 'maxProperties');
  if (field.required && !(json.minProperties >= 1)) json.minProperties = 1;
  return json;
};

const isJSON = (value) =>
  value === null || (typeof value !== 'object' && typeof value !== 'bigint');

const enumeration = (field, context) => {
  const values = field.enum;
  for (const value of values) {
    if (!isJSON(value)) return unrepresentable(context, `Enum value ${String(value)}`);
  }
  if (values.length === 1 && context.target.const === true) return { const: values[0] };
  return { enum: values.slice() };
};

// A tuple is `prefixItems` in 2020-12 and an `items` list before it; OpenAPI
// 3.0 has neither. The elements up to the last required one must be there.
const tuple = (field, context) => {
  const form = context.target.tuple;
  if (form === undefined) return unrepresentable(context, 'Type "tuple"');
  const elements = field.value;
  const items = elements.map((element) => render(element, context));
  const json = { [context.key]: 'array' };
  if (form === 'prefixItems') {
    json.prefixItems = items;
    json.items = false;
  } else {
    json.items = items;
    json.additionalItems = false;
  }
  if (context.strict) return json;
  let min = 0;
  elements.forEach((element, index) => {
    if (element.required) min = index + 1;
  });
  if (min > 0) json.minItems = min;
  return json;
};

const union = (field, context) => {
  const branches = field.union.map((branch) => render(branch, context));
  if (field.discriminator !== undefined && context.target.oneOf === true) {
    return { oneOf: branches, discriminator: { propertyName: field.discriminator } };
  }
  return { anyOf: branches };
};

// A reference by the rule of `check`: an id (a string) for a stored kind,
// the record for a memory kind, `embed` on the field and the `references`
// option deciding otherwise. A target that cannot be resolved is held as
// an id, as the dts does, unless the field embeds it.
const reference = (field, context) => {
  const name = field.type;
  const target = field.root.findReference(name);
  let json;
  if (target === null) {
    if (field.embed === true) json = unrepresentable(context, `Reference "${name}" (embed)`);
    else json = typed('string', context);
  } else if (!embeds(target, field.embed, context.references)) {
    json = typed('string', context);
  } else {
    json = definition(target, context);
  }
  return field.many === undefined ? json : { [context.key]: 'array', items: json };
};

// A referenced entity: `#` for the root of the document, a `$ref` into the
// definitions (rendered once) otherwise, and inline where the target has no
// `$ref` (mongodb), where a cycle has no form.
const definition = (schema, context) => {
  const { name } = schema;
  if (context.prefix === null) {
    if (context.stack.has(name)) return unrepresentable(context, `Recursive reference "${name}"`);
    context.stack.add(name);
    const json = renderSchema(schema, context);
    context.stack.delete(name);
    return json;
  }
  if (schema === context.root) return { $ref: '#' };
  if (!context.defs.has(name)) {
    context.defs.set(name, null);
    context.defs.set(name, renderSchema(schema, context));
  }
  return { $ref: context.prefix + name };
};

const RENDER = {
  string: (field, context) => {
    const json = typed('string', context);
    if (context.strict) return json;
    bounds(json, field.length, 'minLength', 'maxLength');
    if (field.pattern !== undefined) json.pattern = field.pattern.source;
    return json;
  },
  number: (field, context) => ranged(typed('number', context), field, context),
  integer: (field, context) => ranged(typed('integer', context), field, context),
  bigint: (field, context) =>
    context.mongo ? typed('bigint', context) : unrepresentable(context, 'Type "bigint"'),
  boolean: (field, context) => typed('boolean', context),
  date: (field, context) => {
    if (context.mongo) return typed('date', context);
    if (context.input) return { type: 'string', format: 'date-time' };
    return unrepresentable(context, 'Type "date" (output)');
  },
  null: (field, context) => typed('null', context),
  any: (field, context) => unconstrained(context, 'any') || {},
  unknown: (field, context) => unconstrained(context, 'unknown') || {},
  json: (field, context) =>
    unconstrained(context, 'json') || { [context.key]: ['object', 'array'] },
  enum: enumeration,
  array: list,
  set: (field, context) => {
    if (!context.input || context.mongo) return unrepresentable(context, 'Type "set"');
    const json = list(field, context);
    if (!context.strict) json.uniqueItems = true;
    return json;
  },
  object: dictionary,
  map: (field, context) =>
    context.input ? dictionary(field, context) : unrepresentable(context, 'Type "map" (output)'),
  tuple,
  union,
  schema: (field, context) =>
    isStruct(field.schema) ? struct(field.schema, context) : render(field.schema, context),
  reference,
  one: reference,
  many: reference,
};

// The built-in type a field validates as: its own, or the one its alias
// chain ends in.
const baseOf = (field) => {
  const { types } = field.root;
  let Type = field.constructor;
  while (Type.source !== undefined && Type.source.js !== undefined) Type = types[Type.source.js];
  return Type.type;
};

// The schema of the type of a field: the metadata of a custom type when it
// says (`jsonSchema`, or `bson` for mongodb), else the built-in it is or
// aliases, else nothing.
const renderType = (field, context) => {
  const { metadata } = field.constructor;
  if (context.mongo) {
    if (metadata.bson !== undefined) return { bsonType: metadata.bson };
  } else if (metadata.jsonSchema !== undefined) {
    return { ...metadata.jsonSchema };
  }
  const renderer = RENDER[baseOf(field)];
  if (renderer !== undefined) return renderer(field, context);
  const hint = context.mongo ? 'bson' : 'jsonSchema';
  return unrepresentable(context, `Type "${field.type}" (without metadata.${hint})`);
};

// A field: its type, null when the field is nullable or optional (`check`
// accepts null for an optional field), then its annotations.
const render = (field, context) => {
  let json = renderType(field, context);
  if (field.nullable === true || field.required === false) json = withNull(json, context);
  return annotate(json, field, context);
};

// A struct: its validated fields as properties (a calculated field is a
// function and has no schema), the required ones listed, no other keys
// unless the schema ignores them. The strict profile lists every property.
const struct = (fields, context) => {
  const properties = {};
  const required = [];
  for (const key of Object.keys(fields)) {
    const field = fields[key];
    if (!hasBrand(field, 'Type')) continue;
    try {
      properties[key] = render(field, context);
    } catch (error) {
      const own = error.field === '' || error.schema === context.owner;
      if (error instanceof SchemaDefinitionError && own) error.locate(context.owner, key);
      throw error;
    }
    if (field.required || context.strict) required.push(key);
  }
  const json = { [context.key]: 'object', properties };
  if (required.length > 0) json.required = required;
  if (context.closed) json.additionalProperties = false;
  return json;
};

// The schema being rendered owns the location of an error met in it, and
// is restored when the rendering leaves it, thrown out of or not.
const renderSchema = (schema, context) => {
  const { owner } = context;
  const { fields } = schema;
  context.owner = schema.name;
  try {
    return isStruct(fields) ? struct(fields, context) : render(fields, context);
  } finally {
    context.owner = owner;
  }
};

// The document of one schema: its own unknown-keys policy applies to the
// whole document, as it does to a check.
const renderRoot = (schema, context) => {
  context.closed = context.strict || schema.unknown !== 'ignore';
  if (context.strict && !isStruct(schema.fields)) {
    throw invalidOptions(
      `Profile "strict" needs a struct at the root, got "${schema.fields.type}"`,
    );
  }
  const json = renderSchema(schema, context);
  // Every stored document has an `_id`; a closed mongodb root must let it in.
  if (context.mongo && json.additionalProperties === false && json.properties[ID] === undefined) {
    json.properties[ID] = {};
  }
  return json;
};

// The definitions go where the `definitions` pointer says: `$defs`,
// `definitions` or `components.schemas`.
const place = (document, context) => {
  if (context.target.$schema !== undefined) document.$schema = context.target.$schema;
  if (context.defs.size === 0) return document;
  const path = context.prefix.slice(2, -1).split('/');
  let node = document;
  for (let index = 0; index < path.length - 1; index += 1) {
    node[path[index]] = {};
    node = node[path[index]];
  }
  node[path[path.length - 1]] = Object.fromEntries(context.defs);
  return document;
};

const toJSONSchema = (schema, options = {}) => {
  const context = createContext(options, schema.unknown);
  context.root = schema;
  const json = renderRoot(schema, context);
  if (context.mongo) return json;
  const document = context.target.$schema === undefined ? {} : { $schema: '' };
  return place(Object.assign(document, json), context);
};

// The model as one document of definitions, one per entity in dependency
// order, or the document of the entity `root` with the definitions it needs.
// The mongodb target has no definitions: one document per entity, inline.
const modelToJSONSchema = (model, options = {}) => {
  const { root, ...rest } = options;
  if (root !== undefined) {
    const entity = model.entities.get(root);
    if (entity === undefined) throw invalidOptions(`Entity "${root}" is not in the model`);
    return toJSONSchema(entity, rest);
  }
  const context = createContext(rest, 'reject');
  if (context.strict) throw invalidOptions('Profile "strict" needs a root entity');
  const { entities, order } = model;
  const documents = new Map();
  for (const name of order) documents.set(name, null);
  for (const name of order) {
    context.defs = context.mongo ? new Map() : documents;
    documents.set(name, renderRoot(entities.get(name), context));
  }
  if (context.mongo) return Object.fromEntries(documents);
  context.defs = documents;
  return place({}, context);
};

const STANDARD_TARGETS = ['draft-2020-12', 'draft-07', 'openapi-3.0'];

// The converter of Standard JSON Schema: `input` and `output` take the
// target (one of the three JSON ones) and the other options as
// `libraryOptions`.
const standardConverter = (schema) => {
  const convert = (io) => (options) => {
    const target = options === null || typeof options !== 'object' ? undefined : options.target;
    if (!STANDARD_TARGETS.includes(target)) {
      throw invalidOptions(`JSON Schema target ${JSON.stringify(target)} is not supported`);
    }
    return toJSONSchema(schema, { ...options.libraryOptions, target, io });
  };
  return { input: convert('input'), output: convert('output') };
};

module.exports = { toJSONSchema, modelToJSONSchema, standardConverter };
