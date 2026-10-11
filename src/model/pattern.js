// A string for a pattern (`sample`): the source of a regular expression read
// into nodes once per RegExp, and a string drawn from the nodes with the
// random source of the sample. The subset is what a validation pattern is
// made of: alternatives, groups, classes, escapes and quantifiers; what
// generates no string (a lookaround, a back reference, a word boundary) is
// ERR_SAMPLE_PATTERN. Nothing here reads a schema: `sample.js` hands over
// the RegExp and the random source, and the letters of the locale are read
// at draw time, so the nodes serve every locale.
const { SchemaDefinitionError } = require('../errors.js');

const invalid = (reason) => new SchemaDefinitionError('ERR_SAMPLE_PATTERN', reason);

// A whole number in [0, max], and an element of a list, from the random
// source of a sample.
const int = (state, max) => Math.floor(state.random() * (max + 1));

const pick = (state, list) => list[int(state, list.length - 1)];

const unsupported = (what, source) => invalid(`Pattern /${source}/ cannot be sampled: ${what}`);

const code = (char) => char.codePointAt(0);

const range = (from, to) => [code(from), code(to)];

// How many times a quantifier may repeat, and how deep groups may nest: the
// bounds of what a draw allocates and of what the parser recurses into.
const MAX_REPEAT = 10_000;
const MAX_GROUPS = 64;

const CLASSES = Object.assign(Object.create(null), {
  d: [range('0', '9')],
  w: [range('0', '9'), range('A', 'Z'), range('a', 'z'), range('_', '_')],
  s: [range(' ', ' ')],
});

// The Unicode property escapes a validation pattern uses; the letters are
// those of the locale, read when the string is drawn.
const PROPERTIES = Object.assign(Object.create(null), {
  L: 'letters',
  Letter: 'letters',
  Lu: [range('A', 'Z')],
  Ll: [range('a', 'z')],
  N: [range('0', '9')],
  Nd: [range('0', '9')],
});

const LETTER = /^[A-Za-z]$/;

const classNode = (set, negate, letters) => ({ set, negate, letters });

// The nodes of a pattern: { alt }, { seq }, { set, negate, letters } for a
// class (`letters`: the letters of the locale are in it), { text }, and
// { node, min, max } for a repetition.
class PatternParser {
  constructor(source) {
    this.source = source;
    this.at = 0;
    this.groups = 0;
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
    if (char === '.') return classNode([], false, true);
    if (char === '\\') return this.escape(false);
    if (char === '*' || char === '+' || char === '?') throw this.fail(`nothing to repeat`);
    return { text: char };
  }

  group() {
    this.groups += 1;
    if (this.groups > MAX_GROUPS) throw this.fail(`groups nested deeper than ${MAX_GROUPS}`);
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
    this.groups -= 1;
    return node;
  }

  // A class escape (\d, \w, \s, \p{..}) as ranges, the negated ones as
  // what they are not among the letters and digits, or one character.
  escape(inSet) {
    const char = this.next();
    if (char === undefined) throw this.fail('a trailing backslash');
    const lower = char.toLowerCase();
    if (CLASSES[lower] !== undefined) return classNode(CLASSES[lower], char !== lower, false);
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
      const letters = property === 'letters';
      return classNode(letters ? [] : property, char !== lower, letters);
    }
    if (char === 'b' && !inSet) throw this.fail('a word boundary');
    if (char === 'B' || char === 'k' || (char >= '1' && char <= '9')) {
      throw this.fail('a back reference');
    }
    const named = { t: '\t', n: '\n', r: '\r', f: '\f', v: '\v', 0: '\0', b: '\b' };
    if (named[char] !== undefined) return { text: named[char] };
    if (char === 'x' || char === 'u') return { text: this.codePoint(char) };
    if (char === 'c') {
      const letter = this.next();
      if (!LETTER.test(letter)) throw this.fail('a control escape');
      return { text: String.fromCharCode(letter.charCodeAt(0) % 32) };
    }
    return { text: char };
  }

  codePoint(kind) {
    let hex = '';
    if (kind === 'u' && this.peek() === '{') {
      this.next();
      while (this.peek() !== '}') {
        if (this.at >= this.source.length) throw this.fail('a code point escape');
        hex += this.next();
      }
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
    let letters = false;
    while (this.peek() !== ']') {
      if (this.at >= this.source.length) throw this.fail('an unclosed class');
      let char = this.next();
      if (char === '\\') {
        const escaped = this.escape(true);
        if (escaped.set !== undefined) {
          if (escaped.negate) throw this.fail('a negated class escape inside a class');
          if (escaped.letters) letters = true;
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
    return classNode(set, negate, letters);
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
      if (min > MAX_REPEAT || (max !== Infinity && max > MAX_REPEAT)) {
        throw this.fail(`a repetition over ${MAX_REPEAT}`);
      }
      this.at = close;
    } else return node;
    this.next();
    if (this.peek() === '?') this.next();
    return { node, min, max };
  }
}

// The fewest code points a string of the node has: a lower bound of its
// length however the length rule counts (a surrogate pair in the source is
// two text nodes and one code point).
const minLengthOf = (node) => {
  if (node.text !== undefined) return /^[\uDC00-\uDFFF]$/.test(node.text) ? 0 : 1;
  if (node.set !== undefined) return 1;
  if (node.alt !== undefined) {
    let least = Infinity;
    for (const branch of node.alt) least = Math.min(least, minLengthOf(branch));
    return least;
  }
  if (node.seq !== undefined) {
    let total = 0;
    for (const part of node.seq) total += minLengthOf(part);
    return total;
  }
  return node.min * minLengthOf(node.node);
};

const PATTERNS = new WeakMap();

// The nodes of a RegExp and the minimal length of its strings, once per
// RegExp: the nodes carry nothing of a locale or a seed.
const patternOf = (pattern) => {
  let entry = PATTERNS.get(pattern);
  if (entry === undefined) {
    const node = new PatternParser(pattern.source).parse();
    entry = { node, minLength: minLengthOf(node) };
    PATTERNS.set(pattern, entry);
  }
  return entry;
};

// The pool a negated class draws from: the letters and digits that are not
// in it; a class that excludes the letters excludes every letter of the
// pool, since \P{L} matches no letter in any locale.
const POOL = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_- ';

const inSet = (set, point) => {
  for (const pair of set) if (point >= pair[0] && point <= pair[1]) return true;
  return false;
};

// A character of a class: one of its ranges, or a letter of the locale
// where the class holds them.
const fromSet = (state, node) => {
  if (node.negate) {
    const out = [];
    for (const char of POOL) {
      if (!inSet(node.set, code(char)) && !(node.letters && LETTER.test(char))) out.push(char);
    }
    if (out.length === 0) throw invalid('A class excludes every character');
    return pick(state, out);
  }
  const choices = node.set.length + (node.letters ? 1 : 0);
  if (choices === 0) throw invalid('A class allows no character');
  const index = int(state, choices - 1);
  if (index === node.set.length) return pick(state, state.letters);
  const pair = node.set[index];
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

module.exports = { int, pick, patternOf, fromPattern };
