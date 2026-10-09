const { BRAND, hasBrand, formatters } = require('./util.js');
const { issues } = require('./issues.js');
const { SchemaDefinitionError } = require('./errors.js');

// What a struct computes once at construction, kept on the dictionary under a
// global symbol like BRAND, so a struct built by another copy of the package
// exposes it too: { plan, known, check }, the plan being one frozen entry per
// validated field, `known` the dictionary of its keys, and `check` the
// compiled check over them.
const STRUCT = Symbol.for('alexify.metaschema.struct');

// A field is read with a keyed load, and `Object.hasOwn` is consulted only
// when the value is undefined, to tell a missing key from one set to
// undefined. A field named after a member of Object.prototype (`toString`,
// `constructor`, ...) would read the inherited function from a plain object,
// so such a field always asks `Object.hasOwn` first.
const inherited = (key) => key in Object.prototype;

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
const compileStruct = (plan, known) => (value, context, key) => {
  if (value === null || typeof value !== 'object') {
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
    let item = value[name];
    if (item === undefined || entry.own) {
      if (!Object.hasOwn(value, name)) {
        if (entry.required) issues.required(context, name);
        continue;
      }
      item = value[name];
    }
    found += 1;
    entry.check(item, context, name);
  }
  if (context.unknown === 'reject' && context.count < context.limit) {
    let total = 0;
    // oxlint-disable-next-line no-unused-vars
    for (const name in value) total += 1;
    if (total !== found) scanUnknown(value, known, context);
  }
  if (nested) context.path.pop();
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
  for (const key of Object.keys(defs)) {
    const entry = defs[key];
    const { field, required } = formatters.key(key, entry?.required);
    try {
      const { Type, defs: typeDefs } = prep.parse(entry);
      if (!Type) {
        fields[key] = entry;
        known[key] = true;
        continue;
      }
      // The key ('tags?') and the definition ('?string', required: false)
      // both decide whether the field is required, and the field's check is
      // compiled with the answer, so it is settled before the field is built.
      typeDefs.required = (typeDefs.required ?? true) && required;
      const child = new Type(typeDefs, prep);
      fields[field] = child;
      known[field] = true;
      plan.push({
        key: field,
        type: child,
        required: child.required,
        own: inherited(field),
        check: child.check,
      });
    } catch (error) {
      if (error instanceof SchemaDefinitionError) error.locate(prep.root.name, field);
      throw error;
    }
  }
  Object.freeze(plan);
  const compiled = Object.freeze({ plan, known, check: compileStruct(plan, known) });
  Object.defineProperty(fields, BRAND, { value: 'Struct' });
  Object.defineProperty(fields, STRUCT, { value: compiled });
  return fields;
};

const isStruct = (fields) => hasBrand(fields, 'Struct');

const checkOf = (fields) => fields[STRUCT].check;

module.exports = { STRUCT, createStruct, isStruct, checkOf };
