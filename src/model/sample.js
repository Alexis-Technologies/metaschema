// A witness of a schema (`sample`): a value that `check` accepts, built from
// the definition with a seeded generator, so the same seed gives the same
// value on every run. Every field is verified with its own check as it is
// built and drawn again when it fails (a pattern a length rule contradicts,
// a validate function), and a field no draw satisfies is an error: a
// definition that no value can satisfy is found here, not in production
// (witness generation as a satisfiability check).
const { hasBrand, define } = require('../util.js');
const { createContext } = require('../context.js');
const { SchemaDefinitionError, invalidTarget } = require('../errors.js');
const { isStruct } = require('../struct.js');
const { baseTypeOf } = require('../types.js');
const { embeds } = require('../prototypes/reference.js');
const { toDotPath, finalize } = require('../issues.js');
const en = require('../locales/en.js');
const { int, pick, patternOf, fromPattern } = require('./pattern.js');
const { FORMATS } = require('../rules.js');

const invalid = (code, reason) => new SchemaDefinitionError(code, reason);

const invalidOptions = (reason) => invalid('ERR_INVALID_OPTIONS', reason);

// mulberry32: a 32-bit generator, the same numbers for a seed everywhere.
const prng = (seed) => {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// The letters of a free string, by locale.
const LETTERS = Object.assign(Object.create(null), {
  en: 'abcdefghijklmnopqrstuvwxyz',
  uk: 'абвгґдеєжзиіїйклмнопрстуфхцчшщьюя',
});

// How many draws a field gets before it is given up on, and how many an
// optional field is present in, out of four.
const DRAWS = 24;
const PRESENT = 3;

// What a draw returns for a field the value leaves out: an optional
// reference nested too deep.
const ABSENT = Symbol('absent');

// The built-in type a field validates as: its own, or the one its alias
// chain ends in; a custom type with a check of its own has none.
const baseOf = (field) => {
  const Type = baseTypeOf(field);
  return Type.source === undefined ? Type.type : null;
};

// A count within the bounds a length rule gives, `low` when it gives none.
const countOf = (state, length, low, span = 3) => {
  const min = length?.min ?? low;
  const max = length?.max ?? min + span;
  return min + int(state, Math.max(max - min, 0));
};

const lettersOf = (state, count) => {
  let text = '';
  for (let index = 0; index < count; index += 1) text += pick(state, state.letters);
  return text;
};

// A string of the pattern, or of the letters within the length rule; a
// pattern whose shortest string is over `length.max` is unsatisfiable before
// a string is built.
const stringOf = (state, field, key) => {
  const { pattern, length, format } = field;
  // A format draws one of the examples it was registered with; the check of
  // the field decides whether its other rules accept it.
  if (format !== undefined) return pick(state, FORMATS[format].examples);
  if (pattern !== undefined) {
    const { node, minLength } = patternOf(pattern);
    const max = length?.max;
    if (max !== undefined && minLength > max) {
      const reason = `the pattern needs at least ${minLength} characters, over the maximum ${max}`;
      throw unsatisfiable(state, key, reason);
    }
    const extra = Math.min(max ?? 3, Math.max(3, length?.min ?? 0));
    return fromPattern(state, node, extra);
  }
  return lettersOf(state, countOf(state, length, 1, 7));
};

const asNumber = (value) => (typeof value === 'bigint' ? Number(value) : value);

// A number within the bounds; a whole one, or one of `decimals` decimals,
// rounded toward the inside of the bounds.
const numberOf = (state, field, whole) => {
  const min = asNumber(field.min);
  const max = asNumber(field.max);
  const low = min ?? (max === undefined ? 0 : max - 100);
  const high = max ?? low + 100;
  const value = low + state.random() * (high - low);
  const scale = whole ? 1 : field.decimals === undefined ? 0 : 10 ** field.decimals;
  if (scale === 0) return value;
  const up = Math.ceil(value * scale) / scale;
  return up > high ? Math.floor(value * scale) / scale : up;
};

// The widest span a bigint is drawn from: what a number holds exactly.
const SPAN = 2n ** 53n;

const bigintOf = (state, field) => {
  const low =
    field.min === undefined
      ? field.max === undefined
        ? 0n
        : BigInt(field.max) - 100n
      : BigInt(field.min);
  const high = field.max === undefined ? low + 100n : BigInt(field.max);
  const span = high - low > SPAN ? SPAN : high - low;
  return low + BigInt(int(state, Number(span)));
};

// Up to sixteen random bytes.
const bytesOf = (state) => {
  const bytes = new Uint8Array(int(state, 16));
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = int(state, 255);
  return bytes;
};

// Every name of a flags field present half the time, each true or false.
const flagsOf = (state, field) => {
  const out = {};
  for (const name of field.flags) if (state.random() < 0.5) out[name] = state.random() < 0.5;
  return out;
};

const idOf = (state, name) => `${name.toLowerCase()}-${int(state, 0xffff).toString(16)}`;

const keyOf = (state, index, numeric) =>
  numeric ? index + 1 : `${pick(state, state.letters)}${index}`;

const listOf = (state, field, key) => {
  const count = countOf(state, field.length, 0);
  const list = [];
  for (let index = 0; index < count; index += 1) {
    const item = sampleField(field.value, state, index);
    if (item !== ABSENT) list.push(item);
  }
  return field.type === 'set' || baseOf(field) === 'set' ? new Set(list) : list;
};

const keyedOf = (state, field) => {
  const count = countOf(state, field.length, field.required ? 1 : 0);
  const numeric = field.key === 'number';
  const map = baseOf(field) === 'map';
  const out = map ? new Map() : {};
  for (let index = 0; index < count; index += 1) {
    const name = keyOf(state, index, numeric);
    const item = sampleField(field.value, state, name);
    if (item === ABSENT) continue;
    if (map) out.set(name, item);
    else out[name] = item;
  }
  return out;
};

const tupleOf = (state, field) => {
  const list = [];
  for (let index = 0; index < field.value.length; index += 1) {
    const item = sampleField(field.value[index], state, index);
    list.push(item === ABSENT ? undefined : item);
  }
  return list;
};

// The errors of a branch that another branch may not have: a union tries
// every branch from a random one on and fails with the last error only when
// every branch failed.
const RETRIED = new Set(['ERR_UNSATISFIABLE', 'ERR_SAMPLE_PATTERN', 'ERR_SAMPLE_TYPE']);

const unionOf = (state, field, key) => {
  const branches = field.union;
  const start = int(state, branches.length - 1);
  const { depth } = state;
  const at = state.path.length;
  let error = null;
  for (let index = 0; index < branches.length; index += 1) {
    const branch = branches[(start + index) % branches.length];
    try {
      return sampleField(branch, state, key);
    } catch (thrown) {
      if (!RETRIED.has(thrown?.code)) throw thrown;
      error = thrown;
      state.depth = depth;
      state.path.length = at;
    }
  }
  throw error;
};

// A referenced entity: its id, or the record itself where the check embeds
// it, as a nested struct; a record nested deeper than `maxDepth` is left
// out of an optional field and is an error on a required one.
const referenceOf = (state, field, key) => {
  const name = field.one || field.many;
  const target = field.root.findReference(name);
  if (target === null) {
    throw unsatisfiable(state, key, `Entity "${name}" is not found`);
  }
  const embedded = embeds(target, field.embed, state.references);
  // The record under the key it is met at, as the check reports it.
  const one = (at) => {
    if (!embedded) return idOf(state, name);
    if (state.depth >= state.maxDepth) return ABSENT;
    state.depth += 1;
    const record = drawValue(target.fields, state, at);
    state.depth -= 1;
    return record;
  };
  if (field.many === undefined) {
    const record = one(key);
    if (record === ABSENT && field.required) {
      throw unsatisfiable(state, key, `"${name}" nests deeper than ${state.maxDepth} references`);
    }
    return record;
  }
  const count = int(state, 3);
  const list = [];
  const nested = key !== undefined;
  if (nested) state.path.push(key);
  for (let index = 0; index < count; index += 1) {
    const record = one(index);
    if (record !== ABSENT) list.push(record);
  }
  if (nested) state.path.pop();
  return list;
};

// A value of a custom type: what `metadata.sample` gives (a function of the
// field and the random source, or a value), else nothing can.
const customOf = (state, field, key) => {
  const { sample: given } = field.constructor.metadata;
  if (given === undefined) {
    const hint = `Type "${field.type}" needs metadata.sample to be sampled`;
    throw invalid(
      'ERR_SAMPLE_TYPE',
      `${hint} in "${toDotPath(pathOf(state, key), state.root.name)}"`,
    );
  }
  return typeof given === 'function' ? given(field, state.random) : given;
};

const pathOf = (state, key) => (key === undefined ? state.path : state.path.concat([key]));

// A field no value satisfies, with the seed the draws were made with, so
// that the error is reproduced with the same call.
const unsatisfiable = (state, key, reason) => {
  const where = toDotPath(pathOf(state, key), state.root.name);
  const { seed } = state;
  const error = invalid(
    'ERR_UNSATISFIABLE',
    `No value satisfies "${where}" (seed ${seed}): ${reason}`,
  );
  error.seed = seed;
  return error;
};

// One draw for a field, by the built-in type it validates as.
const draw = (state, field, key) => {
  const { examples } = field;
  if (Array.isArray(examples) && examples.length > 0 && state.random() < 0.5) {
    return pick(state, examples);
  }
  switch (baseOf(field)) {
    case 'string':
      return stringOf(state, field, key);
    case 'number':
      return numberOf(state, field, false);
    case 'integer':
      return numberOf(state, field, true);
    case 'bigint':
      return bigintOf(state, field);
    case 'boolean':
      return state.random() < 0.5;
    case 'date':
      return new Date(1_600_000_000_000 + Math.floor(state.random() * 100_000_000_000));
    case 'bytes':
      return bytesOf(state);
    case 'flags':
      return flagsOf(state, field);
    case 'null':
      return null;
    case 'any':
    case 'unknown':
      return lettersOf(state, 4);
    case 'json':
      return {};
    case 'enum':
      return pick(state, field.enum);
    case 'array':
    case 'set':
      return listOf(state, field, key);
    case 'object':
    case 'map':
      return keyedOf(state, field);
    case 'tuple':
      return tupleOf(state, field);
    case 'union':
      return unionOf(state, field, key);
    case 'schema':
      return drawValue(field.schema, state, key);
    case 'reference':
    case 'one':
    case 'many':
      return referenceOf(state, field, key);
    default:
      return customOf(state, field, key);
  }
};

// Whether a draw passes the field's own check (its type, its rules, its
// validate), in a context of the options the sample is for.
const accepted = (state, field, value, key) => {
  const context = createContext(state.options, state.root.name, state.root.unknown);
  field.check(value, context, key);
  return context.count === 0 ? null : context.issues[0];
};

// A struct: a value for every field, an optional one three times out of
// four, null for a nullable one one time out of five.
const drawStruct = (fields, state, key) => {
  const nested = key !== undefined;
  if (nested) state.path.push(key);
  const out = {};
  for (const name in fields) {
    const field = fields[name];
    if (!hasBrand(field, 'Type')) continue;
    if (!field.required && int(state, PRESENT) === 0) continue;
    if (field.nullable === true && int(state, 4) === 0) {
      define(out, name, null);
      continue;
    }
    const value = sampleField(field, state, name);
    if (value !== ABSENT) define(out, name, value);
  }
  if (nested) state.path.pop();
  return out;
};

// A nested definition: a struct, or a field.
const drawValue = (node, state, key) =>
  isStruct(node) ? drawStruct(node, state, key) : sampleField(node, state, key);

// A field: draws until one passes the field's check.
const sampleField = (field, state, key) => {
  let issue = null;
  for (let attempt = 0; attempt < DRAWS; attempt += 1) {
    const value = draw(state, field, key);
    if (value === ABSENT) return value;
    issue = accepted(state, field, value, key);
    if (issue === null) return value;
  }
  finalize([issue], en);
  throw unsatisfiable(state, key, issue.message);
};

// How a reference may be held, as in check, and how deep embedded records
// may nest: a `many` reference fans out by up to four records a level.
const REFERENCES = ['kind', 'embed', 'id'];
const MAX_DEPTH = 32;

const optionsOf = (options) => {
  if (options === null || typeof options !== 'object') {
    throw invalidOptions('Sample options must be an object');
  }
  const { seed = 1, locale = 'en', references = 'kind', maxDepth = 3 } = options;
  if (!Number.isInteger(seed)) throw invalidOptions('Sample option "seed" must be an integer');
  if (LETTERS[locale] === undefined) {
    throw invalidOptions(
      `Sample option "locale" must be "en" or "uk", got ${JSON.stringify(locale)}`,
    );
  }
  if (!REFERENCES.includes(references)) {
    throw invalidOptions(
      `Sample option "references" must be "kind", "embed" or "id", got ${JSON.stringify(references)}`,
    );
  }
  if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > MAX_DEPTH) {
    throw invalidOptions(`Sample option "maxDepth" must be an integer from 0 to ${MAX_DEPTH}`);
  }
  return { seed, letters: LETTERS[locale], references, maxDepth };
};

// A value the schema accepts, the same for a seed. `options`: `seed` (1),
// `locale` ('en' or 'uk', the letters of free strings), `references` (how a
// reference is held, as in check) and `maxDepth` (how deep embedded records
// nest, 3, at most 32).
const sample = (schema, options = {}) => {
  if (!hasBrand(schema, 'Schema')) throw invalidTarget('A Schema is expected');
  const { seed, letters, references, maxDepth } = optionsOf(options);
  const state = {
    random: prng(seed),
    seed,
    letters,
    references,
    maxDepth,
    depth: 0,
    root: schema,
    path: [],
    options: { references, maxErrors: 1, maxDepth: maxDepth + 1 },
  };
  let issue = null;
  for (let attempt = 0; attempt < DRAWS; attempt += 1) {
    const value = drawValue(schema.fields, state, undefined);
    const result = schema.check(value, state.options);
    if (result.valid) return value;
    issue = result.issues[0];
  }
  throw unsatisfiable(state, undefined, issue.message);
};

module.exports = { sample };
