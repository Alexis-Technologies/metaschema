// The emitters: one per built-in prototype, each rendering as straight-line
// code the check its `compile()` closes over, so a compiled schema records
// exactly the issues of the closure backend, in the same order, with the
// same paths and params. What is not inlined (a reference, a custom type, a
// validate function, the unknown-keys scan) is the closure backend's own
// function, called through the scope.
//
// Generated code names three things: `v` the value, `c` the context and `k`
// the key the root was called with. Every other identifier is fresh.
const { issues, runValidate } = require('../issues.js');
const { codePoints, lengthOf } = require('../rules.js');
const { STRUCT, isStruct } = require('../struct.js');
const scalars = require('../prototypes/scalars.js');
const collections = require('../prototypes/collections.js');
const { schema } = require('../prototypes/schema.js');
const { tuple } = require('../prototypes/tuple.js');
const { union } = require('../prototypes/union.js');
const { json } = require('../prototypes/json.js');
const { prop, quote, literal } = require('./code.js');

// Past this many values a Set lookup replaces a chain of comparisons.
const ENUM_SET_SIZE = 8;

// The key of the field under check, as source: a quoted name, an index, a
// loop variable, or nothing at the root (`undefined` here, `void 0` there).
const keyOf = (key) => (key === undefined ? 'void 0' : key);

// The path of an issue is the stack of container keys plus the key of the
// field. The closure backend pushes a container's key before its children;
// here the keys since the last real push are known at generation time
// (`prefix`) and pushed only around a statement that records or calls out,
// so a valid value never touches the path.
const located = (keys, statement) => {
  const { length } = keys;
  if (length === 0) return statement;
  const pop = length === 1 ? 'c.path.pop();' : `c.path.length -= ${length};`;
  return `c.path.push(${keys.join(', ')}); ${statement} ${pop}`;
};

// A statement that may record, with its path, then the error limit: past it
// everything stops, up to the nearest union branch or the root.
const record = (state, statement, extra = []) => {
  const keys = extra.length === 0 ? state.prefix : state.prefix.concat(extra);
  state.code.push(`${located(keys, statement)} if (c.count >= c.limit) break ${state.label};`);
};

// The state under a container: its key joins the prefix of its children.
const inside = (state, key) =>
  key === undefined ? state : { ...state, prefix: [...state.prefix, key] };

const issue = (state, name, args) => `${state.code.ref(issues)}.${name}(c, ${args});`;

const typeIssue = (state, expected, x, key) =>
  issue(state, 'type', `${quote(expected)}, ${x}, ${keyOf(key)}`);

const notObject = (x) => `${x} === null || typeof ${x} !== "object" || Array.isArray(${x})`;

// The conditions of the bounds a field has.
const outside = (state, x, min, max) => {
  const parts = [];
  if (min !== undefined) parts.push(`${x} < ${state.code.value(min)}`);
  if (max !== undefined) parts.push(`${x} > ${state.code.value(max)}`);
  return parts.join(' || ');
};

const emitLength = (type, x, key, state) => {
  const { code } = state;
  const { min, max } = type.length;
  if (min === undefined && max === undefined) return;
  const n = code.name('n');
  const string = type.scalar === 'string';
  const unicode = string && type.unicode === true;
  const measure = unicode ? `${code.ref(codePoints)}(${x})` : `${code.ref(lengthOf)}(${x})`;
  code.push(`const ${n} = ${string && !unicode ? `${x}.length` : measure};`);
  code.push(`if (${outside(state, n, min, max)}) {`);
  const bounds = `${code.value(min)}, ${code.value(max)}, ${n}, ${keyOf(key)}`;
  record(state, issue(state, 'length', bounds));
  code.push('}');
};

const emitPattern = (type, x, key, state) => {
  const { code } = state;
  const { pattern } = type;
  code.push(`if (!${code.ref(pattern)}.test(${x})) {`);
  record(state, issue(state, 'pattern', `${quote(pattern.source)}, ${keyOf(key)}`));
  code.push('}');
};

const emitRange = (type, x, key, state) => {
  const { code } = state;
  const { min, max } = type;
  code.push(`if (${outside(state, x, min, max)}) {`);
  const bounds = `${code.value(min)}, ${code.value(max)}, ${x}, ${keyOf(key)}`;
  record(state, issue(state, 'range', bounds));
  code.push('}');
};

const RULES = { length: emitLength, pattern: emitPattern };

// The rules of a field in the order the closure backend runs them: length,
// pattern, then one range check for min and max.
const rulesOf = (type) => {
  const list = [];
  let range = false;
  for (const name of type.constructor.rules) {
    if (type[name] === undefined) continue;
    if (name === 'min' || name === 'max') range = true;
    else list.push(RULES[name]);
  }
  if (range) list.push(emitRange);
  return list;
};

// The rules, then the validate function on a value that passed them.
const emitTail = (type, x, key, state, rules) => {
  const { code } = state;
  const { validate } = type;
  const guarded = validate && rules.length > 0;
  const before = guarded ? code.name('b') : '';
  if (guarded) code.push(`const ${before} = c.count;`);
  for (const rule of rules) rule(type, x, key, state);
  if (!validate) return;
  if (guarded) code.push(`if (c.count === ${before}) {`);
  const call = `${code.ref(runValidate)}(${code.ref(type)}, ${code.ref(validate)}, ${x}, c);`;
  record(state, call, key === undefined ? [] : [key]);
  if (guarded) code.push('}');
};

// A type check as `if (fails) { issue } else { body; rules; validate }`: the
// rules and the validate function run only on a value of the type, and
// after a body (the elements, the fields) only when it recorded nothing.
const typed = (type, x, key, state, fails, failure, body) => {
  const { code } = state;
  code.push(`if (${fails}) {`);
  record(state, failure);
  const rules = type === null ? [] : rulesOf(type);
  const tail = type !== null && (rules.length > 0 || type.validate);
  if (body === undefined && !tail) {
    code.push('}');
    return;
  }
  code.push('} else {');
  const before = body !== undefined && tail ? code.name('b') : '';
  if (before) code.push(`const ${before} = c.count;`);
  if (body !== undefined) body();
  if (before) code.push(`if (c.count === ${before}) {`);
  if (tail) emitTail(type, x, key, state, rules);
  if (before) code.push('}');
  code.push('}');
};

const emitScalar = (type, x, key, state) => {
  const { scalar } = type;
  typed(type, x, key, state, `typeof ${x} !== ${quote(scalar)}`, typeIssue(state, scalar, x, key));
};

const emitInteger = (type, x, key, state) =>
  typed(type, x, key, state, `!Number.isInteger(${x})`, typeIssue(state, 'integer', x, key));

const emitDate = (type, x, key, state) => {
  const fails = `!(${x}?.constructor?.name === "Date" && !Number.isNaN(${x}.getTime()))`;
  typed(type, x, key, state, fails, typeIssue(state, 'date', x, key));
};

const emitNull = (type, x, key, state) =>
  typed(type, x, key, state, `${x} !== null`, typeIssue(state, 'null', x, key));

const emitJson = (type, x, key, state) => {
  const fails = `${x} === null || typeof ${x} !== "object"`;
  typed(type, x, key, state, fails, typeIssue(state, 'object', x, key));
};

// Any value at all; only a validate function can say otherwise.
const emitAny = (type, x, key, state) => emitTail(type, x, key, state, []);

const emitEnum = (type, x, key, state) => {
  const { code } = state;
  const values = type.enum;
  const texts = values.map(literal);
  let fails;
  if (values.length <= ENUM_SET_SIZE && texts.every((text) => text !== undefined)) {
    fails = texts.map((text) => `${x} !== ${text}`).join(' && ');
  } else if (values.length > ENUM_SET_SIZE) {
    fails = `!${code.ref(new Set(values))}.has(${x})`;
  } else {
    fails = `!${code.ref(values)}.includes(${x})`;
  }
  const failure = issue(state, 'enum', `${code.ref(values)}, ${keyOf(key)}`);
  typed(type, x, key, state, fails, failure);
};

const emitObject = (type, x, key, state) => {
  const { code } = state;
  const failure = typeIssue(state, type.type, x, key);
  typed(type, x, key, state, notObject(x), failure, () => {
    const children = inside(state, key);
    const count = code.name('t');
    const name = code.name('n');
    const label = code.name('o');
    code.push(`let ${count} = 0;`);
    code.push(`${label}: for (const ${name} in ${x}) {`);
    code.push(`if (!Object.hasOwn(${x}, ${name})) continue;`);
    code.push(`${count} += 1;`);
    if (type.key === 'string') {
      const item = code.name('x');
      code.push(`const ${item} = ${x}[${name}];`);
      emitField(type.value, item, name, children);
    } else {
      // A key of an object is a string, so any other key type fails on the
      // first key, as it does in the closure backend.
      record(children, issue(state, 'key', `${quote(type.key)}, ${name}`));
      code.push(`break ${label};`);
    }
    code.push('}');
    if (!type.required) return;
    code.push(`if (${count} === 0) {`);
    record(state, issue(state, 'required', keyOf(key)));
    code.push('}');
  });
};

const emitMap = (type, x, key, state) => {
  const { code } = state;
  const failure = typeIssue(state, type.type, x, key);
  typed(type, x, key, state, `${x}?.constructor?.name !== "Map"`, failure, () => {
    if (type.required) {
      code.push(`if (${x}.size === 0) {`);
      record(state, issue(state, 'required', keyOf(key)));
      code.push('} else {');
    } else {
      code.push(`if (${x}.size !== 0) {`);
    }
    const children = inside(state, key);
    const label = code.name('m');
    const pair = code.name('p');
    const name = code.name('n');
    const item = code.name('x');
    code.push(`${label}: for (const ${pair} of ${x}) {`);
    code.push(`const ${name} = ${pair}[0];`);
    code.push(`if (typeof ${name} !== ${quote(type.key)}) {`);
    record(children, issue(state, 'key', `${quote(type.key)}, ${name}`));
    code.push(`break ${label};`);
    code.push('}');
    code.push(`const ${item} = ${pair}[1];`);
    emitField(type.value, item, name, children);
    code.push('}');
    code.push('}');
  });
};

// An array by index, a Set through its iterator; only the type test differs.
const emitList = (type, x, key, state) => {
  const { code } = state;
  const set = type.isInstance === collections.set.isInstance;
  const fails = set ? `${x}?.constructor?.name !== "Set"` : `!Array.isArray(${x})`;
  typed(type, x, key, state, fails, typeIssue(state, type.type, x, key), () => {
    const children = inside(state, key);
    const index = code.name('i');
    const item = code.name('x');
    if (set) {
      code.push(`let ${index} = 0;`);
      code.push(`for (const ${item} of ${x}) {`);
      emitField(type.value, item, index, children);
      code.push(`${index} += 1;`);
    } else {
      code.push(`for (let ${index} = 0; ${index} < ${x}.length; ${index} += 1) {`);
      code.push(`const ${item} = ${x}[${index}];`);
      emitField(type.value, item, index, children);
    }
    code.push('}');
  });
};

const emitTuple = (type, x, key, state) => {
  const { code } = state;
  const elements = type.value;
  const { length } = elements;
  typed(type, x, key, state, `!Array.isArray(${x})`, typeIssue(state, type.type, x, key), () => {
    code.push(`if (${x}.length > ${length}) {`);
    record(state, issue(state, 'length', `void 0, ${length}, ${x}.length, ${keyOf(key)}`));
    code.push('} else {');
    const children = inside(state, key);
    for (let index = 0; index < length; index += 1) {
      const item = code.name('x');
      code.push(`const ${item} = ${x}[${index}];`);
      emitField(elements[index], item, String(index), children);
    }
    code.push('}');
  });
};

// The fields of a struct over `x`: a keyed load per field, `Object.hasOwn`
// only to tell a missing required key from one set to undefined (first for a
// field named after a member of Object.prototype), and the unknown-keys scan
// only when the value has more keys than the plan found.
const emitStruct = (fields, x, key, state) => {
  const { code } = state;
  const { plan, known } = fields[STRUCT];
  const children = inside(state, key);
  const found = code.name('f');
  code.push(`let ${found} = 0;`);
  for (const entry of plan) {
    const { required, own } = entry;
    const name = quote(entry.key);
    const item = code.name('x');
    code.push(`const ${item} = ${prop(x, entry.key)};`);
    if (required) {
      const missing = own ? '' : `${item} === undefined && `;
      code.push(`if (${missing}!Object.hasOwn(${x}, ${name})) {`);
      record(children, issue(state, 'required', name));
      code.push('} else {');
    } else {
      const present = own ? ` && Object.hasOwn(${x}, ${name})` : '';
      code.push(`if (${item} !== undefined${present}) {`);
    }
    code.push(`${found} += 1;`);
    emitField(entry.type, item, name, children);
    code.push('}');
  }
  const total = code.name('t');
  const name = code.name('n');
  const unexpected = code.name('u');
  code.push('if (c.unknown === "reject") {');
  code.push(`let ${total} = 0;`);
  code.push(`for (const ${name} in ${x}) ${total} += 1;`);
  code.push(`if (${total} !== ${found}) {`);
  // The scan of struct.js with the known keys as cases: a key for...in
  // yields is an internalized string, so a case is a pointer comparison
  // where a dictionary lookup would hash it.
  const cases = Object.keys(known).map((field) => `case ${quote(field)}:`);
  code.push(`let ${unexpected} = null;`);
  code.push(`for (const ${name} in ${x}) {`);
  if (cases.length > 0) code.push(`switch (${name}) { ${cases.join(' ')} continue; }`);
  code.push(`if (!Object.hasOwn(${x}, ${name})) continue;`);
  code.push(`if (${unexpected} === null) ${unexpected} = [];`);
  code.push(`${unexpected}.push(${name});`);
  code.push('}');
  code.push(`if (${unexpected} !== null) {`);
  record(children, issue(state, 'unexpected', unexpected));
  code.push('}');
  code.push('}');
  code.push('}');
};

// A nested struct: its fields, then the validate function it carries. A
// Schema instance of one type used as a field is that type (its validate, if
// any, is the field's own: a schema of one type has no schema-level one).
const emitSchema = (type, x, key, state) => {
  const fields = type.schema;
  if (!isStruct(fields)) {
    emitField(fields, x, key, state);
    return;
  }
  const body = () => emitStruct(fields, x, key, state);
  typed(type, x, key, state, notObject(x), typeIssue(state, 'object', x, key), body);
};

// What a branch is called in the message of a value that matched none.
const branchName = (branch) => (branch.type === 'schema' ? 'object' : branch.type);

// Without a discriminator the branches are tried in order and what a failed
// branch recorded is dropped, so the error limit inside a branch stops that
// branch only. With one, the branch is picked by the value of that field.
const emitUnion = (type, x, key, state) => {
  const { code } = state;
  const { discriminator } = type;
  const branches = type.union;
  if (discriminator === undefined) {
    const before = code.name('b');
    const pending = code.name('a');
    const label = code.name('u');
    code.push(`const ${before} = c.count;`);
    // The validators a failed branch set aside in an async check go with its
    // issues, as in the closure backend.
    code.push(`const ${pending} = c.async === null ? 0 : c.async.length;`);
    code.push(`${label}: {`);
    for (const branch of branches) {
      const own = code.name('u');
      code.push(`${own}: {`);
      emitField(branch, x, key, { ...state, label: own });
      code.push('}');
      code.push(`if (c.count === ${before}) break ${label};`);
      code.push(`c.issues.length = ${before}; c.count = ${before};`);
      code.push(`if (c.async !== null) c.async.length = ${pending};`);
    }
    const expected = code.ref(branches.map(branchName));
    record(state, issue(state, 'union', `${expected}, void 0, ${keyOf(key)}`));
    code.push('}');
    if (!type.validate) return;
    code.push(`if (c.count === ${before}) {`);
    emitTail(type, x, key, state, []);
    code.push('}');
    return;
  }
  const fails = `${x} === null || typeof ${x} !== "object"`;
  typed(type, x, key, state, fails, typeIssue(state, 'object', x, key), () => {
    const expected = [];
    const cases = branches.map((branch) => {
      const values = branch.schema[discriminator].enum;
      expected.push(...values);
      return values.map(literal);
    });
    const direct = cases.every((texts) => texts.every((text) => text !== undefined));
    // A value with no literal (NaN, an object) selects its branch through a
    // Map of value to branch index, as the closure backend's table does.
    const table = direct
      ? null
      : new Map(
          branches.flatMap((branch, index) =>
            branch.schema[discriminator].enum.map((value) => [value, index]),
          ),
        );
    const subject = prop(x, discriminator);
    code.push(`switch (${direct ? subject : `${code.ref(table)}.get(${subject})`}) {`);
    branches.forEach((branch, index) => {
      const labels = direct ? cases[index] : [String(index)];
      for (const text of labels) code.push(`case ${text}:`);
      code.push('{');
      emitField(branch, x, key, state);
      code.push('break;');
      code.push('}');
    });
    code.push('default: {');
    const name = quote(discriminator);
    record(inside(state, key), issue(state, 'union', `${code.ref(expected)}, ${name}, ${name}`));
    code.push('}');
    code.push('}');
  });
};

const EMITTERS = new Map([
  [scalars.string.compile, emitScalar],
  [scalars.integer.compile, emitInteger],
  [scalars.date.compile, emitDate],
  [scalars.null.compile, emitNull],
  [scalars.any.compile, emitAny],
  [scalars.enum.compile, emitEnum],
  [json.compile, emitJson],
  [collections.object.compile, emitObject],
  [collections.map.compile, emitMap],
  [collections.array.compile, emitList],
  [tuple.compile, emitTuple],
  [union.compile, emitUnion],
  [schema.compile, emitSchema],
]);

// The check of one field over the local `x`. A built-in prototype is
// inlined by the emitter of its `compile`; a reference, a custom type or a
// prototype with a compile of its own is its closure, which does everything
// (rules, validate and nullable included). An optional field skips null and
// undefined, a nullable one null, before anything else.
const emitField = (type, x, key, state) => {
  const emitter = EMITTERS.get(type.compile);
  if (emitter === undefined) {
    record(state, `${state.code.ref(type.check)}(${x}, c, ${keyOf(key)});`);
    return;
  }
  const { code } = state;
  const { required } = type;
  let guard = null;
  if (!required) guard = `${x} != null`;
  else if (type.nullable === true) guard = `${x} !== null`;
  if (guard !== null) code.push(`if (${guard}) {`);
  emitter(type, x, key, state);
  if (guard !== null) code.push('}');
};

// The body of a schema's check, `(v, c, k)`: the key the root was called
// with (through a reference) is pushed on the path at entry, so the root
// records with no key of its own and everything under it carries `k`; the
// schema-level validate runs last, on a value whose fields all passed.
const emitRoot = (target, code) => {
  const { fields, options } = target;
  const { validate } = options;
  const state = { code, label: 'r', prefix: [] };
  const before = validate ? code.name('b') : '';
  if (validate) code.push(`const ${before} = c.count;`);
  code.push('if (k !== undefined) c.path.push(k);');
  code.push('r: {');
  if (isStruct(fields)) {
    const body = () => emitStruct(fields, 'v', undefined, state);
    typed(
      null,
      'v',
      undefined,
      state,
      notObject('v'),
      typeIssue(state, 'object', 'v', undefined),
      body,
    );
  } else {
    emitField(fields, 'v', undefined, state);
  }
  code.push('}');
  if (validate) {
    const call = `${code.ref(runValidate)}(${code.ref(target)}, ${code.ref(validate)}, v, c);`;
    code.push(`if (c.count === ${before}) ${call}`);
  }
  code.push('if (k !== undefined) c.path.pop();');
};

module.exports = { emitRoot };
