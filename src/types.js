const { AbstractType } = require('./prototypes/abstract.js');
const scalars = require('./prototypes/scalars.js');
const collections = require('./prototypes/collections.js');
const { reference } = require('./prototypes/reference.js');
const { schema } = require('./prototypes/schema.js');
const { tuple } = require('./prototypes/tuple.js');
const { union } = require('./prototypes/union.js');
const { json } = require('./prototypes/json.js');
const { flags } = require('./prototypes/flags.js');
const { SchemaDefinitionError } = require('./errors.js');
const { firstKey, isFirstUpper } = require('./metautil.js');

const PROTOTYPES = {
  ...scalars,
  ...collections,
  reference,
  many: reference,
  one: reference,
  schema,
  tuple,
  union,
  json,
  flags,
};

// The prototype objects of the built-in types inherit from AbstractType, so
// that a class made from one inherits from it (below), and what the
// validation half of the core installs on them (their `compile`) reaches
// every class made from them, in every registry, whenever it is installed.
for (const prototype of new Set(Object.values(PROTOTYPES))) {
  Object.setPrototypeOf(prototype, AbstractType.prototype);
}

// What the class of a type inherits from: a built-in's prototype object, the
// class of the base of an alias, or for a custom type a copy of its entry
// (the program's own object is left as it is).
const parentOf = (prototype) =>
  Object.prototype.isPrototypeOf.call(AbstractType.prototype, prototype)
    ? prototype
    : Object.assign(Object.create(AbstractType.prototype), prototype);

const customTypeError = (name, reason) =>
  new SchemaDefinitionError('ERR_INVALID_CUSTOM_TYPE', `Custom type "${name}" ${reason}`);

const createType = (name, prototype) => {
  class Type extends AbstractType {
    // A null-prototype dictionary: a metadata key may be anything.
    static metadata = Object.create(null);
    static type = name;
    static kind = prototype.kind;
    static rules = new Set(prototype.rules);
    // The definition keys the type reads; the lint reports the others.
    static options = new Set(prototype.options);

    constructor(def, preprocessor) {
      super(def, preprocessor);
      const { type } = this;
      this.type = type;
    }
  }
  Object.setPrototypeOf(Type.prototype, parentOf(prototype));
  Type.prototype.type = name;
  return Type;
};

const createTypes = (prototypes) => {
  const types = Object.create(null);
  for (const pair of Object.entries(prototypes)) {
    const name = pair[0];
    const proto = pair[1];
    types[name] = createType(name, proto);
  }
  return types;
};

// The shared, process-wide registry. A model may ask for its own instead.
const TYPES = createTypes(PROTOTYPES);

const createRegistry = () => createTypes(PROTOTYPES);

// Whether a dictionary of fields reads as a struct under the first-key rule
// (`preprocessor.js`): the first key that starts with a letter is a kind
// when capitalized, the long form when it is `type` and a shorthand when it
// is a type name of the registry; a struct that reads otherwise needs the
// `schema` shorthand around it. What generates a definition asks here.
const readsAsStruct = (fields, types = TYPES) => {
  const first = firstKey(fields);
  if (first === undefined) return true;
  const key = first.endsWith('?') ? first.slice(0, -1) : first;
  return key !== 'type' && types[key] === undefined && !isFirstUpper(key);
};

// The own keys of the metadata given, as data: the table has no prototype.
const updateTypeMetadata = (Type, metadata) => {
  Object.assign(Type.metadata, metadata);
};

// A custom prototype brings `construct` and `checkType` (or a `compile` of
// its own); an alias takes its base's, a registered type.
const checkCustomType = (name, proto) => {
  const { construct } = proto;
  const checkType = proto.checkType || proto.compile;
  if (!checkType || !construct) {
    throw customTypeError(name, 'must contain "construct" and "checkType" methods');
  }
  const checkIsFn = typeof checkType === 'function';
  const constructIsFn = typeof construct === 'function';
  if (!checkIsFn || !constructIsFn) {
    throw customTypeError(name, 'methods "construct" and "checkType" must be functions');
  }
};

// The same table is usually registered by every Model in the process, so an
// entry that repeats the definition a type was created from (same `js`, same
// `construct` and `checkType` functions) or only adds metadata is accepted; a
// different definition for a registered name is an error, not a silent no-op.
const redefines = (Type, { js, construct, checkType }) => {
  const metadataOnly = js === undefined && construct === undefined && checkType === undefined;
  if (metadataOnly) return false;
  const source = Type.source || {};
  return js !== source.js || construct !== source.construct || checkType !== source.checkType;
};

const typeFactory = (customTypes, registry = TYPES) => {
  for (const pair of Object.entries(customTypes)) {
    const name = pair[0];
    const value = pair[1];
    if (value === null || typeof value !== 'object') {
      throw customTypeError(name, 'must be an object with methods "construct" and "checkType"');
    }
    const { js, metadata, ...rest } = value;
    const registered = registry[name];
    if (registered) {
      if (redefines(registered, value)) {
        const reason = `Type "${name}" is already registered; only { metadata } may be added`;
        throw new SchemaDefinitionError('ERR_TYPE_REGISTERED', reason);
      }
      updateTypeMetadata(registered, metadata);
      continue;
    }
    let proto = rest;
    if (js !== undefined) {
      const base = registry[js];
      if (!base) {
        const reason = `Unknown js type "${js}" for custom type "${name}"`;
        throw new SchemaDefinitionError('ERR_UNKNOWN_JS_TYPE', reason);
      }
      proto = base.prototype;
    } else checkCustomType(name, proto);
    const Type = createType(name, proto);
    Type.source = { js, construct: rest.construct, checkType: rest.checkType };
    updateTypeMetadata(Type, metadata);
    registry[name] = Type;
  }
  return registry;
};

// The type a field validates as: its own class, or the one its alias chain
// ends in (`{ money: { js: 'number' } }` validates as a number, and so does
// `{ cents: { js: 'money' } }`); a custom type with a check of its own ends
// the chain with `source.js` undefined, and a name the registry cannot
// resolve (a namespace detached since) ends it where it stands. Read by the
// generators, the samples and the mongodb subpath, which look at `.type` and
// `.source` of what comes back.
const baseTypeOf = (field) => {
  const { types } = field.root;
  let Type = field.constructor;
  for (;;) {
    const js = Type.source?.js;
    if (js === undefined) return Type;
    const next = types[js];
    if (next === undefined) return Type;
    Type = next;
  }
};

module.exports = { PROTOTYPES, TYPES, createRegistry, readsAsStruct, typeFactory, baseTypeOf };
