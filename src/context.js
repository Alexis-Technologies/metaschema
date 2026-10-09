// The state of one `check` call. Validation used to keep the current ancestors
// and the error limit in module globals, which only worked because validation
// is synchronous; a context per call keeps two checks independent of each
// other and leaves the door open to async validators.
const en = require('./locales/en.js');

const { NONE } = require('./issues.js');

// The limit when there is none: the largest small integer, so the comparison
// with the count on every field stays an integer comparison.
const UNLIMITED = 2 ** 30 - 1;

const invalid = (name, expected, value) =>
  new TypeError(`${name} must be ${expected}, got ${JSON.stringify(value) ?? String(value)}`);

const maxErrorsOf = (maxErrors) => {
  const valid = typeof maxErrors === 'number' && maxErrors >= 1;
  if (!valid) throw invalid('maxErrors', 'a number of at least 1', maxErrors);
  return Math.min(maxErrors, UNLIMITED);
};

const messagesOf = (messages) => {
  const isTable = messages !== null && typeof messages === 'object';
  if (!isTable && typeof messages !== 'function') {
    throw invalid('messages', 'a locale table or a function', messages);
  }
  return messages;
};

const unknownOf = (unknown) => {
  if (unknown !== 'reject' && unknown !== 'ignore') {
    throw invalid('unknown', '"reject" or "ignore"', unknown);
  }
  return unknown;
};

const REFERENCES = ['kind', 'embed', 'id'];

const referencesOf = (references) => {
  if (!REFERENCES.includes(references)) {
    throw invalid('references', '"kind", "embed" or "id"', references);
  }
  return references;
};

const rootOf = (root) => {
  if (typeof root !== 'string') throw invalid('root', 'a string', root);
  return root;
};

// The 1.x signature was check(value, path, options); a string here is that
// path, and the message says where it went.
const optionsOf = (options) => {
  if (options !== null && typeof options === 'object') return options;
  const hint = typeof options === 'string' ? ' (the path is options.root now)' : '';
  throw invalid('check options', `an object${hint}`, options);
};

// The options of a call, checked and written over the defaults. Kept out of
// createContext so that the allocation stays small enough for V8 to inline
// into Schema#check: a check without options is the common call.
const configure = (context, options) => {
  optionsOf(options);
  if (options.maxErrors !== undefined) context.limit = maxErrorsOf(options.maxErrors);
  if (options.messages !== undefined) context.messages = messagesOf(options.messages);
  if (options.unknown !== undefined) context.unknown = unknownOf(options.unknown);
  if (options.references !== undefined) context.references = referencesOf(options.references);
  if (options.root !== undefined) context.root = rootOf(options.root);
};

// One object shape for every context: the keys are always present, in this
// order, so the hot path sees a single hidden class. `unknown` is what the
// schema being checked says (its unknown-keys policy); an option of the call
// wins over it.
const createContext = (options, name = '', unknown = 'reject') => {
  const context = {
    issues: NONE,
    count: 0,
    limit: UNLIMITED,
    path: [],
    // The objects on the current path, created at the first object met so a
    // check over scalars never allocates it.
    seen: null,
    unknown,
    // How a reference is checked: by the kind of its target ('kind'), as
    // the record itself ('embed') or as its id ('id').
    references: 'kind',
    root: name,
    messages: en,
  };
  if (options !== undefined) configure(context, options);
  return context;
};

module.exports = { createContext, UNLIMITED };
