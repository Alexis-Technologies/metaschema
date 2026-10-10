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
const COMMON = ['root', 'type', 'required', 'nullable', 'validate'];

const ANNOTATIONS = [
  'default',
  'unique',
  'index',
  'primary',
  'title',
  'description',
  'examples',
  'deprecated',
];

const KNOWN = new Set([...COMMON, ...ANNOTATIONS]);

const isCustom = (Type) => Type.source !== undefined && Type.source.js === undefined;

const lintField = (field, path, warnings) => {
  const Type = field.constructor;
  if (!isCustom(Type)) {
    for (const key of Object.keys(field)) {
      if (KNOWN.has(key) || Type.options.has(key)) continue;
      const text = `option "${key}" of "${path}" is not known to type "${field.type}"`;
      warnings.push(warning('unknown-option', text));
    }
  }
  if (field.pattern !== undefined && field.length?.max === undefined) {
    const text = `"${path}" has a pattern without length.max (see the note on ReDoS)`;
    warnings.push(warning('unbounded-pattern', text));
  }
  if (field.schema !== undefined) lintStruct(field.schema, path, warnings);
  if (field.value !== undefined) {
    if (Array.isArray(field.value)) {
      field.value.forEach((element, index) => lintField(element, `${path}[${index}]`, warnings));
    } else {
      lintField(field.value, `${path}[]`, warnings);
    }
  }
  if (field.union !== undefined) {
    field.union.forEach((branch, index) => lintField(branch, `${path}|${index}`, warnings));
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
    lintField(field, prefix ? `${prefix}.${key}` : key, warnings);
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
