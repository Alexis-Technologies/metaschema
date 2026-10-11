// A witness of a schema (`sample`): a value that `check` accepts, built from
// the definition with a seeded generator, so the same seed gives the same
// value on every run. Every field is verified with its own check as it is
// built and drawn again when it fails (a pattern a length rule contradicts,
// a validate function), and a field no draw satisfies is an error: a
// definition that no value can satisfy is found here, not in production
// (witness generation as a satisfiability check, ROADMAP §3).
const { hasBrand } = require('../util.js');
const { createContext } = require('../context.js');
const { SchemaDefinitionError } = require('../errors.js');
const { isStruct } = require('../struct.js');
const { embeds } = require('../prototypes/reference.js');
const { toDotPath, finalize } = require('../issues.js');
const en = require('../locales/en.js');

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

const DIGITS = '0123456789';

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
  const { types } = field.root;
  let Type = field.constructor;
  while (Type.source !== undefined && Type.source.js !== undefined) Type = types[Type.source.js];
  return Type.source === undefined ? Type.type : null;
};

const int = (state, max) => Math.floor(state.random() * (max + 1));

const pick = (state, list) => list[int(state, list.length - 1)];

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

// --- patterns ---------------------------------------------------------------
//
// A string for a pattern, from the source of the regular expression: the
// alternatives, groups, classes, escapes and quantifiers that a validation
// pattern is made of. What generates no string (a lookaround, a back
// reference, a word boundary) is ERR_SAMPLE_PATTERN.

const unsupported = (what, source) =>
  invalid('ERR_SAMPLE_PATTERN', `Pattern /${source}/ cannot be sampled: ${what}`);

const code = (char) => char.codePointAt(0);

const range = (from, to) => [code(from), code(to)];

const CLASSES = Object.assign(Object.create(null), {
  d: [range('0', '9')],
  w: [range('0', '9'), range('A', 'Z'), range('a', 'z'), range('_', '_')],
  s: [range(' ', ' ')],
});

// The Unicode property escapes a validation pattern uses.
const PROPERTIES = Object.assign(Object.create(null), {
  L: 'letters',
  Letter: 'letters',
  Lu: [range('A', 'Z')],
  Ll: [range('a', 'z')],
  N: [range('0', '9')],
  Nd: [range('0', '9')],
});

// The nodes of a pattern: { alt }, { seq }, { set, negate }, { text }, and
// { node, min, max } for a repetition.
class PatternParser {
  constructor(source, letters) {
    this.source = source;
    this.letters = letters;
    this.at = 0;
  }

  fail(what) {
    return unsupported(what, this.source);
  }

  peek() {
    return this.source[this.at];
  }

  next() {
    const char = this.source[this.at];
    this.at += 1;
    return char;
  }

  parse() {
    const node = this.alternatives();
    if (this.at < this.source.length) throw this.fail(`unexpected "${this.peek()}"`);
    return node;
  }

  alternatives() {
    const alt = [this.sequence()];
    while (this.peek() === '|') {
      this.next();
      alt.push(this.sequence());
    }
    return alt.length === 1 ? alt[0] : { alt };
  }

  sequence() {
    const seq = [];
    while (this.at < this.source.length && this.peek() !== '|' && this.peek() !== ')') {
      const atom = this.atom();
      if (atom !== null) seq.push(this.quantified(atom));
    }
    return { seq };
  }

  // An atom, or null for an anchor, which generates nothing.
  atom() {
    const char = this.next();
    if (char === '^' || char === '$') return null;
    if (char === '(') return this.group();
    if (char === '[') return this.set();
    if (char === '.') return { set: this.lettersSet(), negate: false };
    if (char === '\\') return this.escape(false);
    if (char === '*' || char === '+' || char === '?') throw this.fail(`nothing to repeat`);
    return { text: char };
  }

  group() {
    if (this.peek() === '?') {
      this.next();
      const kind = this.next();
      if (kind === ':') {
        // A non-capturing group.
      } else if (kind === '<' && this.peek() !== '=' && this.peek() !== '!') {
        while (this.next() !== '>') if (this.at >= this.source.length) throw this.fail('a name');
      } else throw this.fail('a lookaround');
    }
    const node = this.alternatives();
    if (this.next() !== ')') throw this.fail('an unclosed group');
    return node;
  }

  lettersSet() {
    const ranges = [];
    for (const letter of this.letters) ranges.push(range(letter, letter));
    return ranges;
  }

  // A class escape (\d, \w, \s, \p{..}) as ranges, the negated ones as
  // what they are not among the letters and digits, or one character.
  escape(inSet) {
    const char = this.next();
    if (char === undefined) throw this.fail('a trailing backslash');
    const lower = char.toLowerCase();
    if (CLASSES[lower] !== undefined) {
      return { set: CLASSES[lower], negate: char !== lower };
    }
    if (lower === 'p') {
      if (this.next() !== '{') throw this.fail('a property escape');
      let name = '';
      while (this.peek() !== '}') {
        if (this.at >= this.source.length) throw this.fail('a property escape');
        name += this.next();
      }
      this.next();
      const property = PROPERTIES[name.replace(/^(General_Category|gc)=/, '')];
      if (property === undefined) throw this.fail(`the property "${name}"`);
      const set = property === 'letters' ? this.lettersSet() : property;
      return { set, negate: char !== lower };
    }
    if (char === 'b' && !inSet) throw this.fail('a word boundary');
    if (char === 'B' || char === 'k' || (char >= '1' && char <= '9')) {
      throw this.fail('a back reference');
    }
    const named = { t: '\t', n: '\n', r: '\r', f: '\f', v: '\v', 0: '\0', b: '\b' };
    if (named[char] !== undefined) return { text: named[char] };
    if (char === 'x' || char === 'u') return { text: this.codePoint(char) };
    return { text: char };
  }

  codePoint(kind) {
    let hex = '';
    if (kind === 'u' && this.peek() === '{') {
      this.next();
      while (this.peek() !== '}') hex += this.next();
      this.next();
    } else {
      for (let index = 0; index < (kind === 'x' ? 2 : 4); index += 1) hex += this.next();
    }
    const point = Number.parseInt(hex, 16);
    if (Number.isNaN(point)) throw this.fail(`the escape \\${kind}${hex}`);
    return String.fromCodePoint(point);
  }

  // A character class: ranges, single characters and class escapes.
  set() {
    const negate = this.peek() === '^';
    if (negate) this.next();
    const set = [];
    while (this.peek() !== ']') {
      if (this.at >= this.source.length) throw this.fail('an unclosed class');
      let char = this.next();
      if (char === '\\') {
        const escaped = this.escape(true);
        if (escaped.set !== undefined) {
          if (escaped.negate) throw this.fail('a negated class escape inside a class');
          for (const pair of escaped.set) set.push(pair);
          continue;
        }
        char = escaped.text;
      }
      if (
        this.peek() === '-' &&
        this.source[this.at + 1] !== ']' &&
        this.at + 1 < this.source.length
      ) {
        this.next();
        let to = this.next();
        if (to === '\\') to = this.escape(true).text;
        set.push([code(char), code(to)]);
      } else set.push([code(char), code(char)]);
    }
    this.next();
    return { set, negate };
  }

  // The quantifier after an atom; a lazy one generates the same.
  quantified(node) {
    const char = this.peek();
    let min = 1;
    let max = 1;
    if (char === '*') {
      min = 0;
      max = Infinity;
    } else if (char === '+') max = Infinity;
    else if (char === '?') min = 0;
    else if (char === '{') {
      const close = this.source.indexOf('}', this.at);
      const match = /^\{(\d+)(,(\d*))?\}$/.exec(this.source.slice(this.at, close + 1));
      if (match === null) return node;
      min = Number(match[1]);
      max = match[2] === undefined ? min : match[3] === '' ? Infinity : Number(match[3]);
      this.at = close;
    } else return node;
    this.next();
    if (this.peek() === '?') this.next();
    return { node, min, max };
  }
}

const PATTERNS = new WeakMap();

const patternOf = (pattern, letters) => {
  let node = PATTERNS.get(pattern);
  if (node === undefined) {
    node = new PatternParser(pattern.source, letters).parse();
    PATTERNS.set(pattern, node);
  }
  return node;
};

// The pool a negated class draws from: the letters and digits that are not
// in it.
const POOL = `${DIGITS}abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_- `;

const inSet = (set, point) => {
  for (const pair of set) if (point >= pair[0] && point <= pair[1]) return true;
  return false;
};

const fromSet = (state, node) => {
  if (node.negate) {
    const out = [];
    for (const char of POOL) if (!inSet(node.set, code(char))) out.push(char);
    if (out.length === 0) throw invalid('ERR_SAMPLE_PATTERN', 'A class excludes every character');
    return pick(state, out);
  }
  if (node.set.length === 0) throw invalid('ERR_SAMPLE_PATTERN', 'A class allows no character');
  const pair = pick(state, node.set);
  return String.fromCodePoint(pair[0] + int(state, pair[1] - pair[0]));
};

// `extra` is how many repetitions an unbounded quantifier may add: the
// length the field asks for, when it does, else a few.
const fromPattern = (state, node, extra) => {
  if (node.text !== undefined) return node.text;
  if (node.set !== undefined) return fromSet(state, node);
  if (node.alt !== undefined) return fromPattern(state, pick(state, node.alt), extra);
  if (node.seq !== undefined) {
    let text = '';
    for (const part of node.seq) text += fromPattern(state, part, extra);
    return text;
  }
  const max = node.max === Infinity ? node.min + extra : node.max;
  const count = node.min + int(state, max - node.min);
  let text = '';
  for (let index = 0; index < count; index += 1) text += fromPattern(state, node.node, extra);
  return text;
};

// --- values -----------------------------------------------------------------

const stringOf = (state, field) => {
  const { pattern, length } = field;
  if (pattern !== undefined) {
    const extra = Math.min(length?.max ?? 3, Math.max(3, length?.min ?? 0));
    return fromPattern(state, patternOf(pattern, state.letters), extra);
  }
  return lettersOf(state, countOf(state, length, 1, 7));
};

const asNumber = (value) => (typeof value === 'bigint' ? Number(value) : value);

const numberOf = (state, field, whole) => {
  const min = asNumber(field.min);
  const max = asNumber(field.max);
  const low = min ?? (max === undefined ? 0 : max - 100);
  const high = max ?? low + 100;
  const value = low + state.random() * (high - low);
  return whole ? Math.min(Math.ceil(value), Math.floor(high)) : value;
};

const bigintOf = (state, field) => {
  const low =
    field.min === undefined
      ? field.max === undefined
        ? 0n
        : BigInt(field.max) - 100n
      : BigInt(field.min);
  const high = field.max === undefined ? low + 100n : BigInt(field.max);
  return low + BigInt(int(state, Number(high - low)));
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

const unionOf = (state, field, key) => sampleField(pick(state, field.union), state, key);

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
    const record = valueOf(target.fields, state, at);
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

const unsatisfiable = (state, key, reason) => {
  const where = toDotPath(pathOf(state, key), state.root.name);
  return invalid('ERR_UNSATISFIABLE', `No value satisfies "${where}": ${reason}`);
};

// One draw for a field, by the built-in type it validates as.
const draw = (state, field, key) => {
  const { examples } = field;
  if (Array.isArray(examples) && examples.length > 0 && state.random() < 0.5) {
    return pick(state, examples);
  }
  switch (baseOf(field)) {
    case 'string':
      return stringOf(state, field);
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
      return valueOf(field.schema, state, key);
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
const structOf = (fields, state, key) => {
  const nested = key !== undefined;
  if (nested) state.path.push(key);
  const out = {};
  for (const name in fields) {
    const field = fields[name];
    if (!hasBrand(field, 'Type')) continue;
    if (!field.required && int(state, PRESENT) === 0) continue;
    if (field.nullable === true && int(state, 4) === 0) {
      out[name] = null;
      continue;
    }
    const value = sampleField(field, state, name);
    if (value !== ABSENT) out[name] = value;
  }
  if (nested) state.path.pop();
  return out;
};

// A nested definition: a struct, or a field.
const valueOf = (node, state, key) =>
  isStruct(node) ? structOf(node, state, key) : sampleField(node, state, key);

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
  if (!Number.isInteger(maxDepth) || maxDepth < 0) {
    throw invalidOptions('Sample option "maxDepth" must be an integer of at least 0');
  }
  return { seed, letters: LETTERS[locale], references, maxDepth };
};

// A value the schema accepts, the same for a seed. `options`: `seed` (1),
// `locale` ('en' or 'uk', the letters of free strings), `references` (how a
// reference is held, as in check) and `maxDepth` (how deep embedded records
// nest, 3).
const sample = (schema, options = {}) => {
  if (!hasBrand(schema, 'Schema')) throw new TypeError('A Schema is expected');
  const { seed, letters, references, maxDepth } = optionsOf(options);
  const state = {
    random: prng(seed),
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
    const value = valueOf(schema.fields, state, undefined);
    const result = schema.check(value, state.options);
    if (result.valid) return value;
    issue = result.issues[0];
  }
  throw unsatisfiable(state, undefined, issue.message);
};

module.exports = { sample };
