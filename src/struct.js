const { ValidationResult } = require('./metadata.js');
const { BRAND, hasBrand, shorten, formatters } = require('./util.js');
const { SchemaDefinitionError } = require('./errors.js');

// The field names of a struct, computed once at construction. A global symbol
// like BRAND, so a struct built by another copy of the package exposes them too.
const KEYS = Symbol.for('alexify.metaschema.keys');

// A struct is a null-prototype dictionary of field name -> Type (or the
// function of a calculated field), not a class instance with methods: a field
// may be named `check`, `name` or `constructor`, and an input key such as
// `__proto__` or `toString` must be reported as unexpected instead of silently
// resolving to something on Object.prototype.
const createStruct = (defs, prep) => {
  const fields = Object.create(null);
  for (const key of Object.keys(defs)) {
    const entry = defs[key];
    const { field, required } = formatters.key(key, entry?.required);
    try {
      const { Type, defs: typeDefs } = prep.parse(entry);
      if (!Type) {
        fields[key] = entry;
        continue;
      }
      const child = new Type(typeDefs, prep);
      child.required &&= required;
      fields[field] = child;
    } catch (error) {
      if (error instanceof SchemaDefinitionError) error.locate(prep.root.name, field);
      throw error;
    }
  }
  Object.defineProperty(fields, BRAND, { value: 'Struct' });
  Object.defineProperty(fields, KEYS, { value: Object.keys(fields) });
  return fields;
};

const checkStruct = (fields, source, path = '') => {
  const result = new ValidationResult(path);
  const isObject = source !== null && typeof source === 'object';
  if (!isObject) return result.add('not of expected type: object');
  const keys = fields[KEYS] || Object.keys(fields);
  for (const name of keys) {
    const type = fields[name];
    if (!hasBrand(type, 'Type')) continue;
    const nestedPath = path ? `${path}.${name}` : name;
    if (!Object.hasOwn(source, name)) {
      if (type.required) result.add(`Field "${nestedPath}" is required`);
      continue;
    }
    result.add(type.check(source[name], nestedPath));
  }
  for (const name of Object.keys(source)) {
    if (!(name in fields)) result.add(`Field "${shorten(name)}" is not expected`);
  }
  return result;
};

module.exports = { createStruct, checkStruct };
