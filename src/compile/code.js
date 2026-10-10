// The builder of the generated source. Generated code holds identifiers,
// numbers, booleans and JSON strings only: a regular expression, a Set, a
// function, a nested check or a dictionary of known keys goes into the scope
// and is reached by name (the ajv and schemasafe rule, ROADMAP P9), so
// nothing taken from a schema is ever part of the source text.
const { IDENTIFIER } = require('../util.js');

// JSON.stringify leaves U+2028 and U+2029 in place (legal in a string literal
// since ES2019); they are escaped anyway, so the source holds no line
// terminator a tool that reads it could trip on.
const TERMINATORS = new RegExp(`[${String.fromCharCode(0x2028, 0x2029)}]`, 'g');

const escape = (char) => `\\u${char.charCodeAt(0).toString(16)}`;

const quote = (text) => JSON.stringify(text).replace(TERMINATORS, escape);

// `object.key` for an identifier, `object["key"]` for any other string, and
// `object[0]` for an index.
const prop = (object, key) => {
  if (typeof key === 'number') return `${object}[${key}]`;
  return IDENTIFIER.test(key) ? `${object}.${key}` : `${object}[${quote(key)}]`;
};

// The source text of a primitive that has an exact one; anything else is
// undefined and goes through the scope. A finite number round-trips through
// String, except -0, which prints as 0.
const literal = (value) => {
  switch (typeof value) {
    case 'string':
      return quote(value);
    case 'boolean':
      return String(value);
    case 'bigint':
      return `${value}n`;
    case 'undefined':
      return 'void 0';
    case 'number':
      return Number.isFinite(value) && !Object.is(value, -0) ? String(value) : undefined;
    default:
      return value === null ? 'null' : undefined;
  }
};

class Code {
  #names = 0;
  #scope = new Map();
  values = [];
  lines = [];

  // A fresh identifier.
  name(prefix) {
    this.#names += 1;
    return `${prefix}${this.#names}`;
  }

  // The name of a real value in the scope; the same value is added once.
  ref(value) {
    let name = this.#scope.get(value);
    if (name === undefined) {
      name = `s${this.values.length}`;
      this.#scope.set(value, name);
      this.values.push(value);
    }
    return name;
  }

  // A primitive as its literal, anything else by name.
  value(value) {
    const text = literal(value);
    return text === undefined ? this.ref(value) : text;
  }

  push(line) {
    this.lines.push(line);
  }

  // The source of a factory over the scope that returns the check.
  source() {
    let names = '';
    for (let index = 0; index < this.values.length; index += 1) {
      names += `${index === 0 ? '' : ', '}s${index} = scope[${index}]`;
    }
    const preamble = names === '' ? '' : `const ${names};\n`;
    return `${preamble}return function jit(v, c, k) {\n${this.lines.join('\n')}\n};`;
  }
}

module.exports = { IDENTIFIER, quote, prop, literal, Code };
