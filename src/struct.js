const { BRAND, hasBrand, formatters } = require('./util.js');
const { issues } = require('./issues.js');
const { SchemaDefinitionError } = require('./errors.js');

// What a struct computes once at construction, kept on the dictionary under a
// global symbol like BRAND, so a struct built by another copy of the package
// exposes it too: { plan, known, calculated }, the plan being one frozen
// entry per validated field ({ key, type, required, own, aliases }), `known`
// the dictionary of the keys a value may carry and `calculated` the keys of
// the calculated fields among them. The check over the plan is `checkOf`.
const STRUCT = Symbol.for('alexify.metaschema.struct');

// The functions of a nested definition that are the struct's own validate,
// decoder and serializer (as they are options at the root): they stay in the
// fields, where a calculated field lives, but a value has no key by that name.
const CODEC_KEYS = new Set(['validate', 'parse', 'serialize']);

const invalidAliases = (reason) => new SchemaDefinitionError('ERR_INVALID_DEFINITION', reason);

const ALIASES = 'Option "aliases" needs a list of key names';

// The key a value carries for a field that has nothing under its own key: a
// field renamed with `aliases: ['old']` is still read from its old key, and
// the field's own key when the value has none of them.
const aliasOf = (value, aliases, name) => {
  for (const alias of aliases) if (Object.hasOwn(value, alias)) return alias;
  return name;
};

// A field is read with a keyed load, and `Object.hasOwn` is consulted only
// when the value is undefined, to tell a missing key from one set to
// undefined. A field named after a member of Object.prototype (`toString`,
// `constructor`, ...) would read the inherited function from a plain object,
// so such a field (`own`) always asks `Object.hasOwn` first.
const scanUnknown = (value, known, context) => {
  let unexpected = null;
  for (const name in value) {
    if (name in known || !Object.hasOwn(value, name)) continue;
    if (unexpected === null) unexpected = [];
    unexpected.push(name);
  }
  if (unexpected !== null) issues.unexpected(context, unexpected);
};

// The check of a struct, as a closure over its plan: an index loop with no
// lookups in the raw definition, no brand checks and no path strings. Every
// plan entry has the same shape and every field check is a function chosen
// when the field was built, called with the key of the field so that a leaf
// never touches the path. Unknown keys are looked for only when the value has
// more keys than the plan found, so a value with exactly the expected keys is
// never scanned twice.
// A field with nothing under its own key (absent, inherited, or own and set
// to undefined): an alias may hold the value, and the check reports it under
// the key it found it under. Then the same for an optional field, a required
// one asks which (own and undefined is a type error). Kept out of the loop
// of the struct check, whose body is the fast path of a present field; the
// return is what the field adds to the keys found.
const checkAbsent = (entry, value, context, name) => {
  const under = aliasOf(value, entry.aliases, name);
  let item;
  if (under !== name) {
    item = value[under];
    context.renamed = true;
  }
  if (item === undefined) {
    if (!entry.required) return 0;
    if (!Object.hasOwn(value, under)) {
      issues.required(context, name);
      return 0;
    }
  }
  entry.check(item, context, under);
  return 1;
};

// The checks of the fields are taken from them when the struct's check is
// compiled, on its first use, into entries of the shape the loop reads (the
// entry of the plan and the check of its field in one object: a load from
// it is what the loop did when the plan held the checks).
const compileStruct = (entries, known) => {
  const plan = [];
  for (const entry of entries) {
    const { key, type, required, own, aliases } = entry;
    plan.push({ key, type, required, own, aliases, check: type.check });
  }
  Object.freeze(plan);
  return (value, context, key) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      issues.type(context, 'object', value, key);
      return;
    }
    const nested = key !== undefined;
    if (nested) context.path.push(key);
    let found = 0;
    for (let index = 0; index < plan.length; index += 1) {
      if (context.count >= context.limit) break;
      const entry = plan[index];
      const name = entry.key;
      const item = value[name];
      if (item !== undefined && (!entry.own || Object.hasOwn(value, name))) {
        found += 1;
        entry.check(item, context, name);
      } else found += checkAbsent(entry, value, context, name);
    }
    if (context.unknown === 'reject' && context.count < context.limit) {
      let total = 0;
      // oxlint-disable-next-line no-unused-vars
      for (const name in value) total += 1;
      if (total !== found) scanUnknown(value, known, context);
    }
    if (nested) context.path.pop();
  };
};

// A key a value may carry: a field, a calculated field or an alias, each
// once.
const know = (known, key) => {
  if (key in known) throw invalidAliases(`Key "${key}" is a field or an alias already`);
  known[key] = true;
};

// The aliases of a field: the keys it is also read from, as a list of names.
const aliasesOf = (field, known) => {
  const { aliases } = field;
  if (aliases === undefined) return [];
  if (!Array.isArray(aliases) || aliases.length === 0) throw invalidAliases(ALIASES);
  for (const alias of aliases) {
    if (typeof alias !== 'string' || alias === '') throw invalidAliases(ALIASES);
    know(known, alias);
  }
  return aliases;
};

// A struct is a null-prototype dictionary of field name -> Type (or the
// function of a calculated field), not a class instance with methods: a field
// may be named `check`, `name` or `constructor`, and an input key such as
// `__proto__` or `toString` must be reported as unexpected instead of silently
// resolving to something on Object.prototype.
const createStruct = (defs, prep) => {
  const fields = Object.create(null);
  const plan = [];
  const known = Object.create(null);
  const calculated = [];
  for (const key of Object.keys(defs)) {
    const entry = defs[key];
    const { field, required } = formatters.key(key);
    try {
      const { Type, defs: typeDefs } = prep.parse(entry);
      if (!Type) {
        fields[field] = entry;
        if (!CODEC_KEYS.has(field)) {
          know(known, field);
          calculated.push(field);
        }
        continue;
      }
      // The key ('tags?') and the definition ('?string', required: false)
      // both decide whether the field is required, and the field's check is
      // compiled with the answer, so it is settled before the field is built.
      typeDefs.required = (typeDefs.required ?? true) && required;
      const child = new Type(typeDefs, prep);
      fields[field] = child;
      know(known, field);
      plan.push({
        key: field,
        type: child,
        required: child.required,
        own: field in Object.prototype,
        aliases: aliasesOf(child, known),
      });
    } catch (error) {
      if (error instanceof SchemaDefinitionError) error.locate(prep.root.name, field);
      throw error;
    }
  }
  Object.freeze(plan);
  Object.freeze(calculated);
  const compiled = Object.freeze({ plan, known, calculated });
  Object.defineProperty(fields, BRAND, { value: 'Struct' });
  Object.defineProperty(fields, STRUCT, { value: compiled });
  return fields;
};

const isStruct = (fields) => hasBrand(fields, 'Struct');

// The check of a struct, compiled on its first use: kept apart from the
// frozen plan, whose creation is the cost of building a struct.
const CHECKS = new WeakMap();

const checkOf = (fields) => {
  let check = CHECKS.get(fields);
  if (check === undefined) {
    const { plan, known } = fields[STRUCT];
    check = compileStruct(plan, known);
    CHECKS.set(fields, check);
  }
  return check;
};

module.exports = { STRUCT, createStruct, isStruct, checkOf, aliasOf };
