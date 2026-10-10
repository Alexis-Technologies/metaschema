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

// How deep a value may nest through embedded references before the check
// gives up on it: a graph that deep is a `depth` issue, not a stack overflow.
const MAX_DEPTH = 128;

const maxDepthOf = (maxDepth) => {
  if (!Number.isInteger(maxDepth) || maxDepth < 1) {
    throw invalid('maxDepth', 'an integer of at least 1', maxDepth);
  }
  return maxDepth;
};

const messagesOf = (messages) => {
  const isTable = messages !== null && typeof messages === 'object';
  if (!isTable && typeof messages !== 'function') {
    throw invalid('messages', 'a locale table or a function', messages);
  }
  return messages;
};

// `strip` is a policy of parse alone: the check behind it treats it as
// `ignore`, and the pass that builds the output drops the keys.
const unknownOf = (unknown, parsing) => {
  if (unknown === 'reject' || unknown === 'ignore' || (parsing && unknown === 'strip')) {
    return unknown;
  }
  throw invalid(
    'unknown',
    parsing ? '"reject", "ignore" or "strip"' : '"reject" or "ignore"',
    unknown,
  );
};

const referencesOf = (references) => {
  if (references !== 'kind' && references !== 'embed' && references !== 'id') {
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
const configure = (context, options, parsing) => {
  optionsOf(options);
  if (options.maxErrors !== undefined) context.limit = maxErrorsOf(options.maxErrors);
  if (options.maxDepth !== undefined) context.maxDepth = maxDepthOf(options.maxDepth);
  if (options.messages !== undefined) context.messages = messagesOf(options.messages);
  if (options.unknown !== undefined) context.unknown = unknownOf(options.unknown, parsing);
  if (options.references !== undefined) context.references = referencesOf(options.references);
  if (options.root !== undefined) context.root = rootOf(options.root);
};

// One object shape for every context: the keys are always present, in this
// order, so the hot path sees a single hidden class. `unknown` is what the
// schema being checked says (its unknown-keys policy); an option of the call
// wins over it. `parsing` is set by parse, whose options accept `strip`.
const createContext = (options, name = '', unknown = 'reject', parsing = false) => {
  const context = {
    issues: NONE,
    count: 0,
    limit: UNLIMITED,
    // How many embedded records the check is inside, and how many it may be.
    depth: 0,
    maxDepth: MAX_DEPTH,
    path: [],
    // The objects on the current path, created at the first object met so a
    // check over scalars never allocates it.
    seen: null,
    // The value the check started from, when the schema can reach it again
    // through a reference (Schema#check sets it): it joins `seen` when the
    // first embedded record creates the set, so a check that embeds nothing
    // never allocates it.
    source: null,
    unknown,
    // How a reference is checked: by the kind of its target ('kind'), as
    // the record itself ('embed') or as its id ('id').
    references: 'kind',
    root: name,
    messages: en,
    // The validators that returned a promise, in field order, settled after
    // the walk by checkAsync and parseAsync; null in a synchronous check,
    // where such a promise is an error.
    async: null,
    // The context parse tries the branches of a plain union in, made at the
    // first such union of a pass and reused for the rest; null in a check.
    scratch: null,
  };
  if (options !== undefined) configure(context, options, parsing);
  return context;
};

module.exports = { createContext, UNLIMITED, MAX_DEPTH };
