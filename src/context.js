// The state of one `check` call. Validation used to keep the current ancestors
// and the error limit in module globals, which only worked because validation
// is synchronous; a context per call keeps two checks independent of each
// other and leaves the door open to async validators.
const en = require('./locales/en.js');

const invalidMaxErrors = (value) =>
  new TypeError(`maxErrors must be a number of at least 1, got ${value}`);

const maxErrorsOf = (maxErrors) => {
  const valid = typeof maxErrors === 'number' && maxErrors >= 1;
  if (!valid) throw invalidMaxErrors(maxErrors);
  return maxErrors;
};

const messagesOf = (messages) => {
  const isTable = messages !== null && typeof messages === 'object';
  if (!isTable && typeof messages !== 'function') {
    throw new TypeError('messages must be a locale table or a function');
  }
  return messages;
};

// One object shape for every context: the keys are always present, in this
// order, so the hot path sees a single hidden class.
const createContext = (options = {}, root = '') => {
  const { maxErrors, messages } = options;
  const limit = maxErrors === undefined ? Infinity : maxErrorsOf(maxErrors);
  return {
    issues: [],
    count: 0,
    limit,
    path: [],
    // The objects on the current path, created at the first object met so a
    // check over scalars never allocates it.
    seen: null,
    unknown: 'reject',
    root,
    messages: messages === undefined ? en : messagesOf(messages),
  };
};

module.exports = { createContext };
