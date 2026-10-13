// Lints of a built schema: what is not wrong enough to throw, but is not
// what the author meant either. A contradiction that can never validate
// (an enum without values, a min above max) is a SchemaDefinitionError at
// build time; these are warnings, as `Warning [code]: text` strings.
const { hasBrand } = require('./util.js');

const warning = (code, text) => `Warning [${code}]: ${text}`;

// A field lints by its definition keys: the keys every type knows, the
// annotations that any field may carry for code that reads the schema, and
// the options of its own type. A custom type with its own construct owns
// its vocabulary and is not linted.
const KNOWN = new Set([
  'root',
  'type',
  'required',
  'nullable',
  'coerce',
  'validate',
  'parse',
  'serialize',
  'default',
  'unique',
  'index',
  'primary',
  'title',
  'description',
  'examples',
  'deprecated',
  'aliases',
]);

const isCustom = (Type) => Type.source !== undefined && Type.source.js === undefined;

// `element` says the field is an element of a tuple, whose `name` is the
// name the tuple gave it (`[{ x: 'number' }]`), not an option; `member`
// that it is a field of a struct, the one place aliases are read from.
const lintField = (field, path, warnings, element = false, member = false) => {
  const Type = field.constructor;
  if (!isCustom(Type)) {
    for (const key of Object.keys(field)) {
      if (KNOWN.has(key) || Type.options.has(key)) continue;
      if (element && key === 'name') continue;
      const text = `option "${key}" of "${path}" is not known to type "${field.type}"`;
      warnings.push(warning('unknown-option', text));
    }
  }
  if (field.aliases !== undefined && !member) {
    const text = `"${path}" has aliases, but only a field of a struct is read from them`;
    warnings.push(warning('dead-aliases', text));
  }
  if (field.pattern !== undefined && field.length?.max === undefined) {
    const text = `"${path}" has a pattern without length.max (see the note on ReDoS)`;
    warnings.push(warning('unbounded-pattern', text));
  }
  if (field.schema !== undefined) lintStruct(field.schema, path, warnings);
  const { value, union } = field;
  if (value !== undefined) {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        lintField(value[index], `${path}[${index}]`, warnings, true);
      }
    } else {
      lintField(value, `${path}[]`, warnings);
    }
  }
  if (union !== undefined) {
    for (let index = 0; index < union.length; index += 1) {
      lintField(union[index], `${path}|${index}`, warnings);
    }
  }
};

const lintStruct = (fields, prefix, warnings) => {
  if (!hasBrand(fields, 'Struct')) {
    lintField(fields, prefix, warnings);
    return;
  }
  for (const key of Object.keys(fields)) {
    const field = fields[key];
    if (!hasBrand(field, 'Type')) continue;
    lintField(field, prefix ? `${prefix}.${key}` : key, warnings, false, true);
  }
};

const lintIndexes = (schema, warnings) => {
  const { name, indexes, fields } = schema;
  for (const key of Object.keys(indexes)) {
    const index = indexes[key];
    const columns = index.index || index.primary || index.unique;
    if (!Array.isArray(columns)) continue;
    for (const column of columns) {
      if (hasBrand(fields[column], 'Type')) continue;
      const text = `index "${key}" of "${name}" names a field "${column}" it does not have`;
      warnings.push(warning('missing-index-field', text));
    }
  }
};

// The warnings of one schema on its own: everything that needs no model.
const lintSchema = (schema) => {
  const warnings = [];
  lintStruct(schema.fields, schema.name, warnings);
  lintIndexes(schema, warnings);
  return warnings;
};

module.exports = { warning, lintSchema };
