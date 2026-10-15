// Identity brand for the package's own classes. A global symbol is shared by every copy of the
// package in a process and by every realm, and it survives bundlers that rename a class
// (`class _Schema`) and minifiers that mangle it, none of which `constructor.name` does.
const BRAND = Symbol.for('alexify.metaschema.brand');

// Node's util.inspect looks this symbol up; a plain Symbol.for keeps the
// browser build free of any Node import.
const INSPECT = Symbol.for('nodejs.util.inspect.custom');

const hasBrand = (value, name) => value?.[BRAND] === name;

// A built-in is recognised by the name of its constructor, which nothing
// renames, and by its shape, which a value parsed from JSON cannot fake: an
// own key called `constructor` holding `{ name: 'Map' }` is data, and
// iterating such a value, or calling `getTime` on it, would throw out of a
// check. The name is tested first, since most values fail it at once.
const iterableNamed = (name) => (value) =>
  value?.constructor?.name === name && typeof value[Symbol.iterator] === 'function';

const isMap = iterableNamed('Map');

const isSet = iterableNamed('Set');

const isDate = (value) =>
  value?.constructor?.name === 'Date' && typeof value.getTime === 'function';

// The bytes of a Uint8Array of any realm, a Buffer included, by the name the
// engine keeps in the view itself: the tag getter of the typed arrays reads
// that slot and gives undefined for anything else, which a key or a symbol
// of the value cannot change.
const TYPED_TAG = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  Symbol.toStringTag,
).get;

const isBytes = (value) => TYPED_TAG.call(value) === 'Uint8Array';

// The type of a value as a message names it: an array and null by name.
const typeOf = (value) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
};

// A JavaScript identifier: what generated code may write as `object.key` and
// a TypeScript declaration as a bare name.
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

// Defines an own data property, so a key such as `__proto__` taken from a
// path or a definition lands on the object instead of changing its prototype.
const define = (target, key, value) => {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return value;
};

// The method that validates a value inside an existing context, shared by
// Schema and the reference type that checks its target through it. A global
// symbol like BRAND, so a schema from another copy of the package has it too.
const RUN = Symbol.for('alexify.metaschema.run');

// A slot on the Schema class for a function to call with every schema built
// (`Schema[HOOK]`): the `./compile` subpath installs its JIT there, so a
// program that registered it gets every later schema compiled. Nothing in the
// core sets it, and it is read once per construction, never per check.
const HOOK = Symbol.for('alexify.metaschema.hook');

// What the validation half of the core keeps on a schema (`validation.js`),
// set when the schema is built: whether the root value joins the cycle
// detection (a struct with references), whether parse coerces unless the
// call says otherwise (the `coerce` of the kind metadata), and the caches
// of the passes of parse and of the Standard Schema props, rebuilt when the
// namespaces change. Own symbols: none of it is part of the definition.
const TRACKED = Symbol('tracked');
const COERCES = Symbol('coerces');
const CODEC = Symbol('codec');
const STANDARD = Symbol('standard');
// The recursive dependencies a model met while ordering its entities, as
// [entity, reference] pairs: the validation half writes the warnings.
const CYCLES = Symbol('cycles');

// Past this many values an enum is checked through a Set instead of a chain
// of comparisons, on both backends.
const ENUM_SET_SIZE = 8;

// Key names taken from the value under check go into messages; a huge key
// must not become a huge message.
const KEY_LIMIT = 100;

const shorten = (key) => {
  const name = String(key);
  return name.length > KEY_LIMIT ? `${name.slice(0, KEY_LIMIT)}...` : name;
};

// The text of a value that may have none (a symbol, an object without a
// prototype), for a message: what a validator threw or returned is anything.
const safeString = (value) => {
  if (typeof value === 'symbol') return value.toString();
  const bare = value !== null && typeof value === 'object' && typeof value.toString !== 'function';
  return bare ? Object.prototype.toString.call(value) : String(value);
};

const formatters = {
  type: (type, req = true) => {
    const required = !type.startsWith('?');
    if (required) return { type, required: req };
    const name = type.substring(1);
    return { type: name, required: false };
  },

  key: (key, req = true) => {
    const required = !key.endsWith('?');
    if (required) return { field: key, required: req };
    const field = key.slice(0, -1);
    return { field, required: false };
  },
};

module.exports = {
  BRAND,
  INSPECT,
  hasBrand,
  isMap,
  isSet,
  isDate,
  isBytes,
  typeOf,
  IDENTIFIER,
  define,
  RUN,
  HOOK,
  TRACKED,
  COERCES,
  CODEC,
  STANDARD,
  CYCLES,
  ENUM_SET_SIZE,
  shorten,
  safeString,
  formatters,
};
