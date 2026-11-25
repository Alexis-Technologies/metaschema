// Lints of a built schema: what is not wrong enough to throw, but is not
// what the author meant either. A contradiction that can never validate
// (an enum without values, a min above max) is a SchemaDefinitionError at
// build time; these are warnings, as `Warning [code]: text` strings.
const { hasBrand, formatters, KINDS } = require('./util.js');
const { firstKey } = require('./metautil.js');
const { embeds } = require('./prototypes/reference.js');

const warning = (code, text) => `Warning [${code}]: ${text}`;

// The types no converter of coercion exists for: a value of them is taken
// as it is.
const NEVER_CONVERTED = new Set(['any', 'unknown', 'json', 'null', 'flags']);

// A `coerce` key where no conversion can happen: a reference checked as an
// id (the record it names is never entered), a type that takes any value.
const deadCoerce = (field) => {
  const name = field.one || field.many;
  if (name !== undefined) {
    const target = field.root.findReference(name);
    if (target !== null && embeds(target, field.embed, 'kind')) return '';
    return 'a reference checked as an id';
  }
  return NEVER_CONVERTED.has(field.type) ? `a value of type "${field.type}"` : '';
};

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
  if (field.decimals !== undefined) {
    // The check tells a decimal too many apart below 2⁴³ units of the last
    // decimal (ULPS of checks.js); a bound past it lets any number through.
    // A side without a bound counts as 1.
    const bound = Math.max(Math.abs(field.min ?? 1), Math.abs(field.max ?? 1));
    const limit = 2 ** 43 / 10 ** field.decimals;
    if (bound >= limit) {
      const below = Number(limit.toPrecision(2));
      const text =
        `"${path}" has ${field.decimals} decimals, ` +
        `which the check tells apart only below ${below}`;
      warnings.push(warning('unenforceable-decimals', text));
    }
  }
  if (field.coerce !== undefined) {
    const dead = deadCoerce(field);
    if (dead !== '') {
      warnings.push(warning('dead-coerce', `"${path}" has coerce, but ${dead} is never converted`));
    }
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
  if (!hasBrand(fields, 'Struct')) return void lintField(fields, prefix, warnings);
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

// Whether the first key of an object makes it the long form or the
// shorthand of a type.
const startsField = (def, types) => {
  const first = firstKey(def);
  if (first === undefined) return false;
  const { field } = formatters.key(first);
  return field === 'type' || types[field] !== undefined;
};

// Whether a value under a key reads as the definition of a field: the name
// of a type, or an object its first key makes one.
const readsAsField = (value, types) => {
  if (typeof value === 'string') return types[formatters.type(value).type] !== undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return startsField(value, types);
};

// A kind of the program's own (`{ Settings: { theme: 'dark' }, ... }`) whose
// metadata reads as a field or holds fields: most likely a field with a name
// like `Address`, first in its struct, that the first key made a kind, so
// the struct has no such field. The kinds are the ones the definition named
// at any depth, as the preprocessor kept them. `unknown` is a type name and
// a key of the metadata of every kind, where it is the policy.
const lintKinds = (schema, warnings) => {
  const kinds = schema[KINDS];
  if (!kinds) return;
  const { name, types } = schema;
  for (const pair of kinds) {
    const key = pair[0];
    const meta = pair[1];
    let suspect = firstKey(meta) !== 'unknown' && startsField(meta, types);
    if (!suspect) {
      for (const option of Object.keys(meta)) {
        if (!readsAsField(meta[option], types)) continue;
        suspect = true;
        break;
      }
    }
    if (!suspect) continue;
    const text =
      `"${key}" of "${name}" is read as a kind, and its metadata reads as field definitions: ` +
      `a field of that name needs a kind before it ({ Struct: {}, ${key}: ... })`;
    warnings.push(warning('ambiguous-kind', text));
  }
};

// The warnings of one schema on its own: everything that needs no model.
const lintSchema = (schema) => {
  const warnings = [];
  lintStruct(schema.fields, schema.name, warnings);
  lintIndexes(schema, warnings);
  lintKinds(schema, warnings);
  return warnings;
};

module.exports = { warning, lintSchema };
