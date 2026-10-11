// A validation issue is data: { code, path, message, params }. The library's
// own checks record the code, the path (an array of keys from the root of the
// value) and the params of the problem, and leave the message empty; messages
// are rendered once, at the end of the check, through the locale of that check.
// Every issue has the same keys in the same order, so loops over them see one
// shape.
const { hasBrand, shorten, safeString } = require('./util.js');
const { asyncReturn } = require('./errors.js');
const en = require('./locales/en.js');

// Shared by the issues that carry no params, so none of them is ever undefined.
const EMPTY = Object.freeze({});

// The issues of a context before the first one is recorded: a valid check
// never allocates a list.
const NONE = Object.freeze([]);

const push = (context, issue) => {
  if (context.issues === NONE) context.issues = [];
  context.issues.push(issue);
  context.count += 1;
};

// The path of an issue: the current path, plus the key of the field under
// check when its check was given one instead of pushing it on the path (a
// leaf check never pushes; a container pushes its key before its children).
const pathOf = (context, key) => {
  const { path } = context;
  if (key === undefined) return path.slice();
  if (path.length === 0) return [key];
  const keys = path.slice();
  keys.push(key);
  return keys;
};

const record = (context, code, params, key, message = '') => {
  push(context, { code, path: pathOf(context, key), message, params });
};

const typeOf = (value) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
};

const issues = {
  required: (context, key) => record(context, 'required', EMPTY, key),
  type: (context, expected, value, key) =>
    record(context, 'type', { expected, received: typeOf(value) }, key),
  key: (context, expected, name, key) =>
    record(context, 'type', { expected, received: typeof name, key: name }, key),
  unexpected: (context, keys, key) => record(context, 'unexpected', { keys }, key),
  enum: (context, values, key) => record(context, 'enum', { values }, key),
  length: (context, min, max, actual, key) => record(context, 'length', { min, max, actual }, key),
  range: (context, min, max, actual, key) => record(context, 'range', { min, max, actual }, key),
  pattern: (context, pattern, key) => record(context, 'pattern', { pattern }, key),
  union: (context, expected, discriminator, key) =>
    record(context, 'union', { expected, discriminator }, key),
  reference: (context, entity, key) => record(context, 'reference', { entity }, key),
  circular: (context, key) => record(context, 'circular', EMPTY, key),
  depth: (context, max, key) => record(context, 'depth', { max }, key),
  exception: (context, error, key) => record(context, 'exception', { error }, key),
};

// A key of the value that is not an identifier is bracketed and quoted, so
// `a.b` as one key and `a` then `b` render differently. Keys taken from the
// value may be huge; a message must not be.
const IDENTIFIER = /^[\w$]+$/;

const toDotPath = (path, root = '') => {
  let text = root;
  for (let index = 0; index < path.length; index += 1) {
    const key = path[index];
    if (typeof key === 'number') {
      text += `[${key}]`;
      continue;
    }
    const name = String(key);
    if (!IDENTIFIER.test(name)) text += `[${JSON.stringify(shorten(name))}]`;
    else text += text === '' ? shorten(name) : `.${shorten(name)}`;
  }
  return text;
};

// The path of an issue returned by a validator is relative to the field the
// validator belongs to: an array of keys, or a single key.
const relative = (context, path) =>
  Array.isArray(path) ? context.path.concat(path) : pathOf(context, path);

const isIssue = (output) =>
  output !== null && typeof output === 'object' && typeof output.message === 'string';

// Everything a validator or a custom checkType may return, recorded as
// issues: true, null and undefined are nothing; false is a generic error with
// `fallback` as its params; a string is a message; an object with a message is
// an issue of its own; an array holds any of these; a ValidationResult holds
// issues already.
const absorb = (context, output, code, fallback) => {
  if (output === true || output === null || output === undefined) return;
  if (output === false) {
    record(context, code, fallback);
    return;
  }
  if (typeof output === 'string') {
    record(context, code, EMPTY, undefined, output);
    return;
  }
  if (Array.isArray(output)) {
    // One by one: a validator may legitimately return more messages than a
    // spread call accepts.
    for (const item of output) {
      if (context.count >= context.limit) return;
      absorb(context, item, code, fallback);
    }
    return;
  }
  if (hasBrand(output, 'ValidationResult')) {
    for (const issue of output.issues) {
      if (context.count >= context.limit) return;
      const path = context.path.concat(issue.path);
      push(context, { code: issue.code, path, message: issue.message, params: issue.params });
    }
    return;
  }
  if (isIssue(output)) {
    const path = relative(context, output.path);
    const params = output.params === undefined ? EMPTY : output.params;
    push(context, { code: output.code || code, path, message: output.message, params });
    return;
  }
  record(context, code, EMPTY, undefined, safeString(output));
};

// The renderer of a code: the locale's own, else the built-in one. The tables
// have no prototype (the built-in ones by construction, a caller's through
// `messagesOf` in context.js), so a code a validator made up (`constructor`
// included) finds no renderer and keeps the validator's message.
const render = (messages, issue) => {
  if (typeof messages === 'function') return messages(issue);
  const detail = messages[issue.code] || en[issue.code];
  return typeof detail === 'function' ? detail(issue.params, issue) : issue.message;
};

// Messages are produced once, after the walk, for the issues that have none
// (a validator's own message is kept as it is).
const finalize = (list, messages) => {
  for (let index = 0; index < list.length; index += 1) {
    const issue = list[index];
    if (issue.message === '') issue.message = render(messages, issue);
  }
};

// A message that already names its field (`Field "User.name" is not hex`, the
// upstream convention for custom types) is kept as it is.
const PREFIXED = 'Field';

const describe = (messages, root, issue) => {
  const { message } = issue;
  if (message.startsWith(PREFIXED)) return message;
  const field = typeof messages === 'function' ? en.field : messages.field || en.field;
  return `${field(toDotPath(issue.path, root))} ${message}`;
};

const isThenable = (value) =>
  value !== null && typeof value === 'object' && typeof value.then === 'function';

// A promise nothing waits for any more (a synchronous call that throws for
// it, a settle stopped by the error limit, the trial of a union branch) is
// still observed, so that its rejection is never an unhandled one.
const swallow = () => {};

const abandon = (thenable) => {
  Promise.resolve(thenable).then(undefined, swallow);
};

// Drops the entries of a list of pending validators from `from` on (a failed
// branch of a union, a trial of parse, a settle stopped by the error limit):
// their promises are observed, never awaited.
const release = (list, from) => {
  for (let index = from; index < list.length; index += 1) {
    if (list[index].promise !== null) abandon(list[index].promise);
  }
  list.length = from;
};

// The params of a bare `false`: for a checkType the type it expected and what
// it got, built only now that there is something to record.
const fallbackOf = (code, owner, value) =>
  code === 'type' ? { expected: owner.type, received: typeOf(value) } : EMPTY;

// What a validator or a checkType returned, into the context.
const conclude = (context, output, code, owner, value) => {
  if (output === true || output == null) return;
  const bare = output === false || Array.isArray(output);
  absorb(context, output, code, bare ? fallbackOf(code, owner, value) : EMPTY);
};

// Whether a path lies under a prefix: the prefix itself, or a key below it.
const under = (prefix, path) => {
  if (path.length < prefix.length) return false;
  for (let index = 0; index < prefix.length; index += 1) {
    if (path[index] !== prefix[index]) return false;
  }
  return true;
};

// Where user code runs (a validator, a custom checkType; the decoders have
// their own place in codec.js): an exception is reported as an issue, not
// thrown, and the function gets the value and the dotted path of the field,
// called on its owner here rather than through a closure made per call. In
// an async check (`context.async` is a list) a promise is kept with the path
// it was met at, and a validator met later is kept too, uncalled, when a
// promise is pending under its path (the fields of the value it validates
// were met before it, so their entries are the end of the list), so that the
// rule "a validator runs only when nothing under it failed" holds over the
// promises as well; every other validator runs at once, as in check, and
// its promise is in flight with the rest. `settle` runs the list after the
// walk, in field order. In a synchronous check a promise is an error of the
// call.
const guarded = (context, code, owner, fn, value) => {
  const pending = context.async;
  const { path, count } = context;
  if (pending !== null && pending.length > 0 && under(path, pending[pending.length - 1].path)) {
    pending.push({ owner, fn, value, promise: null, path: path.slice(), code, count });
    return;
  }
  let output;
  try {
    output = fn.call(owner, value, toDotPath(path, context.root));
  } catch (error) {
    issues.exception(context, error);
    return;
  }
  if (isThenable(output)) {
    if (pending === null) {
      abandon(output);
      throw asyncReturn('validator', toDotPath(path, context.root), 'checkAsync or parseAsync');
    }
    pending.push({ owner, fn: null, value, promise: output, path: path.slice(), code, count });
    return;
  }
  conclude(context, output, code, owner, value);
};

// Whether an issue recorded since the validator was deferred lies under its
// path: the fields of the value it validates were checked before it.
const failedUnder = (context, entry) => {
  const { issues: list } = context;
  for (let index = entry.count; index < list.length; index += 1) {
    if (under(entry.path, list[index].path)) return true;
  }
  return false;
};

// Settles the entries an async check kept, in the order they were met: a
// promise is awaited (it has been in flight since the walk), a validator kept
// uncalled is called once the promises under it have settled, each recording
// under the path it was met at; the error limit stops the list as it stops
// the walk.
const settle = async (context) => {
  const pending = context.async;
  for (let index = 0; index < pending.length; index += 1) {
    if (context.count >= context.limit) {
      release(pending, index);
      break;
    }
    const entry = pending[index];
    if (entry.fn !== null && failedUnder(context, entry)) continue;
    context.path = entry.path;
    let output;
    try {
      output =
        entry.fn === null
          ? await entry.promise
          : await entry.fn.call(entry.owner, entry.value, toDotPath(entry.path, context.root));
    } catch (error) {
      issues.exception(context, error);
      continue;
    }
    conclude(context, output, entry.code, entry.owner, entry.value);
  }
  context.path = [];
};

const runValidate = (owner, validate, value, context) =>
  guarded(context, 'custom', owner, validate, value);

const runCheckType = (type, value, context) =>
  guarded(context, 'type', type, type.checkType, value);

module.exports = {
  EMPTY,
  NONE,
  issues,
  typeOf,
  pathOf,
  toDotPath,
  absorb,
  finalize,
  describe,
  isThenable,
  abandon,
  release,
  runValidate,
  runCheckType,
  settle,
};
