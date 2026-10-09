// A validation issue is data: { code, path, message, params }. The library's
// own checks record the code, the path (an array of keys from the root of the
// value) and the params of the problem, and leave the message empty; messages
// are rendered once, at the end of the check, through the locale of that check.
// Every issue has the same keys in the same order, so loops over them see one
// shape.
const { hasBrand, shorten } = require('./util.js');
const en = require('./locales/en.js');

// Shared by the issues that carry no params, so none of them is ever undefined.
const EMPTY = Object.freeze({});

const record = (context, code, params, message = '') => {
  context.issues.push({ code, path: context.path.slice(), message, params });
  context.count += 1;
};

const typeOf = (value) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
};

const issues = {
  required: (context) => record(context, 'required', EMPTY),
  type: (context, expected, value) =>
    record(context, 'type', { expected, received: typeOf(value) }),
  key: (context, expected, key) => record(context, 'type', { expected, received: typeof key, key }),
  unexpected: (context, keys) => record(context, 'unexpected', { keys }),
  enum: (context, values) => record(context, 'enum', { values }),
  length: (context, min, max, actual) => record(context, 'length', { min, max, actual }),
  reference: (context, entity) => record(context, 'reference', { entity }),
  circular: (context) => record(context, 'circular', EMPTY),
  exception: (context, error) => record(context, 'exception', { error }),
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
const relative = (context, path) => {
  if (path === undefined) return context.path.slice();
  if (Array.isArray(path)) return context.path.concat(path);
  const keys = context.path.slice();
  keys.push(path);
  return keys;
};

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
    record(context, code, EMPTY, output);
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
      context.issues.push({ code: issue.code, path, message: issue.message, params: issue.params });
      context.count += 1;
    }
    return;
  }
  if (isIssue(output)) {
    const path = relative(context, output.path);
    const params = output.params === undefined ? EMPTY : output.params;
    context.issues.push({ code: output.code || code, path, message: output.message, params });
    context.count += 1;
    return;
  }
  record(context, code, EMPTY, String(output));
};

const render = (messages, issue) => {
  if (typeof messages === 'function') return messages(issue);
  const detail = messages[issue.code] || en[issue.code];
  return detail === undefined ? issue.message : detail(issue.params, issue);
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

// The two places where user code runs, and the only ones with a try/catch: an
// exception from a validator is reported as an issue, not thrown.
const runValidate = (owner, validate, value, context) => {
  let output;
  try {
    output = validate.call(owner, value, toDotPath(context.path, context.root));
  } catch (error) {
    issues.exception(context, error);
    return;
  }
  absorb(context, output, 'custom', EMPTY);
};

const runCheckType = (type, value, context) => {
  let output;
  try {
    output = type.checkType(value, toDotPath(context.path, context.root));
  } catch (error) {
    issues.exception(context, error);
    return;
  }
  if (output === false) {
    issues.type(context, type.type, value);
    return;
  }
  absorb(context, output, 'type', EMPTY);
};

module.exports = {
  EMPTY,
  issues,
  typeOf,
  toDotPath,
  absorb,
  finalize,
  describe,
  runValidate,
  runCheckType,
};
