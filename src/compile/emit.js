// The emitters: one per built-in prototype, each rendering as straight-line
// code the check its `compile()` closes over, so a compiled schema records
// exactly the issues of the closure backend, in the same order, with the
// same paths and params. What is not inlined (a reference, a custom type, a
// validate function, the unknown-keys scan) is the closure backend's own
// function, called through the scope.
//
// Generated code names three things: `v` the value, `c` the context and `k`
// the key the root was called with. Every other identifier is fresh.
const { ENUM_SET_SIZE } = require('../util.js');
const { issues, runValidate, release } = require('../issues.js');
const { FORMATS, NEAR, codePoints, lengthOf, ruleNames, patternLimit } = require('../rules.js');
const { STRUCT, isStruct } = require('../struct.js');
const scalars = require('../prototypes/scalars.js');
const collections = require('../prototypes/collections.js');
const { schema } = require('../prototypes/schema.js');
const { tuple } = require('../prototypes/tuple.js');
const { union, nameOf, tableOf } = require('../prototypes/union.js');
const { json } = require('../prototypes/json.js');
const { prop, quote, literal } = require('./code.js');

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

// A built-in by the name of its constructor and by its shape, as util.js
// tests it: the name alone is what a value parsed from JSON can carry.
const isDateCode = (x) =>
  `${x}?.constructor?.name === "Date" && typeof ${x}.getTime === "function"`;

const isIterableCode = (x, name) =>
  `${x}?.constructor?.name === ${quote(name)} && typeof ${x}[Symbol.iterator] === "function"`;

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
  let measure = `${code.ref(lengthOf)}(${x})`;
  if (type.scalar === 'string') {
    measure = type.unicode === true ? `${code.ref(codePoints)}(${x})` : `${x}.length`;
  }
  code.push(`const ${n} = ${measure};`);
  code.push(`if (${outside(state, n, min, max)}) {`);
  const bounds = `${code.value(min)}, ${code.value(max)}, ${n}, ${keyOf(key)}`;
  record(state, issue(state, 'length', bounds));
  code.push('}');
};

// The condition that keeps a pattern or a format off a string past
// length.max, as the closures do.
const withinLength = (type, x, code) => {
  const limit = patternLimit(type);
  return limit === Infinity ? '' : `${x}.length <= ${code.value(limit)} && `;
};

const emitPattern = (type, x, key, state) => {
  const { code } = state;
  const { pattern } = type;
  code.push(`if (${withinLength(type, x, code)}!${code.ref(pattern)}.test(${x})) {`);
  record(state, issue(state, 'pattern', `${quote(pattern.source)}, ${keyOf(key)}`));
  code.push('}');
};

const emitFormat = (type, x, key, state) => {
  const { code } = state;
  const { format } = type;
  const { test } = FORMATS[format];
  code.push(`if (${withinLength(type, x, code)}!${code.ref(test)}(${x})) {`);
  record(state, issue(state, 'format', `${quote(format)}, ${keyOf(key)}`));
  code.push('}');
};

// The decimals of a number, by the tolerance of rules.js.
const emitDecimals = (type, x, key, state) => {
  const { code } = state;
  const { decimals } = type;
  const scaled = code.name('d');
  code.push(`const ${scaled} = ${x} * ${10 ** decimals};`);
  const near = `${code.value(NEAR)} * Math.max(1, Math.abs(${scaled}))`;
  code.push(`if (Math.abs(Math.round(${scaled}) - ${scaled}) > ${near} || !Number.isFinite(${x})) {`);
  record(state, issue(state, 'decimals', `${decimals}, ${keyOf(key)}`));
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

const RULES = Object.assign(Object.create(null), {
  length: emitLength,
  pattern: emitPattern,
  format: emitFormat,
  decimals: emitDecimals,
  range: emitRange,
});

// The rules of a field in the order the closure backend runs them.
const rulesOf = (type) => {
  const names = ruleNames(type);
  const list = [];
  for (let index = 0; index < names.length; index += 1) list.push(RULES[names[index]]);
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
  const fails = `!(${isDateCode(x)} && !Number.isNaN(${x}.getTime()))`;
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
  const { length } = values;
  let fails;
  if (length > ENUM_SET_SIZE) {
    fails = `!${code.ref(new Set(values))}.has(${x})`;
  } else {
    // A chain of comparisons with the literals, unless a value has none
    // (NaN, an object): then the list itself, as the closure backend scans it.
    let chain = '';
    for (let index = 0; index < length; index += 1) {
      const text = literal(values[index]);
      if (text === undefined) {
        chain = null;
        break;
      }
      chain += `${index === 0 ? '' : ' && '}${x} !== ${text}`;
    }
    fails = chain === null ? `!${code.ref(values)}.includes(${x})` : chain;
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
  typed(type, x, key, state, `!(${isIterableCode(x, 'Map')})`, failure, () => {
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
  const fails = set ? `!(${isIterableCode(x, 'Set')})` : `!Array.isArray(${x})`;
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
    if (entry.aliases.length > 0) {
      // A field with aliases, when the value has nothing under its own key:
      // the first alias the value carries, and the key the check reports
      // under, as `aliasOf` in struct.js finds them.
      const alias = code.name('k');
      const inherited = own ? ` || !Object.hasOwn(${x}, ${name})` : '';
      code.push(`let ${item} = ${prop(x, entry.key)}, ${alias} = ${name};`);
      code.push(`if (${item} === undefined${inherited}) { ${item} = undefined;`);
      // The first alias the value carries: once one is taken the rest are
      // skipped, as the chain of the closure backend stops at it, and the
      // context learns that a field was read from an alias, as there.
      for (const other of entry.aliases) {
        const taken = `${alias} = ${quote(other)}; ${item} = ${prop(x, other)}; c.renamed = true;`;
        code.push(`if (${alias} === ${name} && Object.hasOwn(${x}, ${quote(other)})) { ${taken} }`);
      }
      code.push('}');
      if (required) {
        code.push(`if (${item} === undefined && !Object.hasOwn(${x}, ${alias})) {`);
        record(children, issue(state, 'required', name));
        code.push('} else {');
      } else {
        code.push(`if (${item} !== undefined) {`);
      }
      code.push(`${found} += 1;`);
      emitField(entry.type, item, alias, children);
      code.push('}');
      continue;
    }
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
  let cases = '';
  for (const field in known) cases += `case ${quote(field)}: `;
  code.push(`let ${unexpected} = null;`);
  code.push(`for (const ${name} in ${x}) {`);
  if (cases !== '') code.push(`switch (${name}) { ${cases}continue; }`);
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
      code.push(`if (c.async !== null) ${code.ref(release)}(c.async, ${pending});`);
    }
    const names = [];
    for (let index = 0; index < branches.length; index += 1) names.push(nameOf(branches[index]));
    record(state, issue(state, 'union', `${code.ref(names)}, void 0, ${keyOf(key)}`));
    code.push('}');
    if (!type.validate) return;
    code.push(`if (c.count === ${before}) {`);
    emitTail(type, x, key, state, []);
    code.push('}');
    return;
  }
  const fails = `${x} === null || typeof ${x} !== "object"`;
  typed(type, x, key, state, fails, typeIssue(state, 'object', x, key), () => {
    // The literals of the discriminator values, by branch; a value with no
    // literal (NaN, an object) selects its branch through the table of value
    // to branch index the closure backend uses.
    const expected = [];
    const cases = [];
    let direct = true;
    for (let index = 0; index < branches.length; index += 1) {
      const values = branches[index].schema[discriminator].enum;
      const texts = [];
      for (let at = 0; at < values.length; at += 1) {
        const text = literal(values[at]);
        if (text === undefined) direct = false;
        expected.push(values[at]);
        texts.push(text);
      }
      cases.push(texts);
    }
    const subject = prop(x, discriminator);
    code.push(`switch (${direct ? subject : `${code.ref(tableOf(type))}.get(${subject})`}) {`);
    for (let index = 0; index < branches.length; index += 1) {
      if (direct) {
        const texts = cases[index];
        for (let at = 0; at < texts.length; at += 1) code.push(`case ${texts[at]}:`);
      } else {
        code.push(`case ${index}:`);
      }
      code.push('{');
      emitField(branches[index], x, key, state);
      code.push('break;');
      code.push('}');
    }
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
