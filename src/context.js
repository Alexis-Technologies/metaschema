// The state of one `check` call. Validation used to keep the current ancestors
// and the error limit in module globals, which only worked because validation
// is synchronous; a context per call keeps two checks independent of each
// other and leaves the door open to async validators.
const en = require('./locales/en.js');

const { NONE } = require('./issues.js');

// The limit when there is none: the largest small integer, so the comparison
// with the count on every field stays an integer comparison.
const UNLIMITED = 2 ** 30 - 1;

const invalidMaxErrors = (value) =>
  new TypeError(`maxErrors must be a number of at least 1, got ${value}`);

const maxErrorsOf = (maxErrors) => {
  const valid = typeof maxErrors === 'number' && maxErrors >= 1;
  if (!valid) throw invalidMaxErrors(maxErrors);
  return Math.min(maxErrors, UNLIMITED);
};

const messagesOf = (messages) => {
  const isTable = messages !== null && typeof messages === 'object';
  if (!isTable && typeof messages !== 'function') {
    throw new TypeError('messages must be a locale table or a function');
  }
  return messages;
};

const UNKNOWN = ['reject', 'ignore'];

const unknownOf = (unknown) => {
  if (!UNKNOWN.includes(unknown)) {
    throw new TypeError(`unknown must be "reject" or "ignore", got ${JSON.stringify(unknown)}`);
  }
  return unknown;
};

const rootOf = (root) => {
  if (typeof root !== 'string') throw new TypeError(`root must be a string, got ${root}`);
  return root;
};

// The 1.x signature was check(value, path, options); a string here is that
// path, and the message says where it went.
const invalidOptions = (options) =>
  new TypeError(
    `check options must be an object, got ${typeof options}` +
      (typeof options === 'string' ? ': the path is options.root now' : ''),
  );

// One object shape for every context: the keys are always present, in this
// order, so the hot path sees a single hidden class.
const createContext = (options, name = '') => {
  let limit = UNLIMITED;
  let messages = en;
  let unknown = 'reject';
  let root = name;
  if (options !== undefined) {
    if (options === null || typeof options !== 'object') throw invalidOptions(options);
    if (options.maxErrors !== undefined) limit = maxErrorsOf(options.maxErrors);
    if (options.messages !== undefined) messages = messagesOf(options.messages);
    if (options.unknown !== undefined) unknown = unknownOf(options.unknown);
    if (options.root !== undefined) root = rootOf(options.root);
  }
  return {
    issues: NONE,
    count: 0,
    limit,
    path: [],
    // The objects on the current path, created at the first object met so a
    // check over scalars never allocates it.
    seen: null,
    unknown,
    root,
    messages,
  };
};

module.exports = { createContext, UNLIMITED };
