// A string for a pattern (`sample`): the source of a regular expression read
// into nodes once per RegExp, and a string drawn from the nodes with the
// random source of the sample. The subset is what a validation pattern is
// made of: alternatives, groups, classes, escapes and quantifiers; what
// generates no string (a lookaround, a back reference, a word boundary) is
// ERR_SAMPLE_PATTERN. Nothing here reads a schema: `sample.js` hands over
// the RegExp, the letters of the locale and the random source.
const { SchemaDefinitionError } = require('../errors.js');

const invalid = (reason) => new SchemaDefinitionError('ERR_SAMPLE_PATTERN', reason);

// A whole number in [0, max], and an element of a list, from the random
// source of a sample.
const int = (state, max) => Math.floor(state.random() * (max + 1));

const pick = (state, list) => list[int(state, list.length - 1)];

const unsupported = (what, source) => invalid(`Pattern /${source}/ cannot be sampled: ${what}`);

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
const POOL = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_- ';

const inSet = (set, point) => {
  for (const pair of set) if (point >= pair[0] && point <= pair[1]) return true;
  return false;
};

const fromSet = (state, node) => {
  if (node.negate) {
    const out = [];
    for (const char of POOL) if (!inSet(node.set, code(char))) out.push(char);
    if (out.length === 0) throw invalid('A class excludes every character');
    return pick(state, out);
  }
  if (node.set.length === 0) throw invalid('A class allows no character');
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

module.exports = { int, pick, patternOf, fromPattern };
