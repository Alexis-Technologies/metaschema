// What parse and serialize do beyond the check: the defaults, the decoders,
// the serializers and the stripping of unknown keys, as passes over the built
// types. `parse` is the check of the schema (whichever backend installed it)
// between two passes, defaults before and decoders after; `serialize` is one
// pass the other way. The passes read the same plan the closures walk and
// validate nothing themselves, so the JIT needs no second generator. A node
// whose subtree carries nothing for a phase is returned as it is, and a
// container is copied only when one of its parts changed: the value given is
// never written to.
const { hasBrand } = require('./util.js');
const { EMPTY, NONE, issues, isThenable, abandon, pathOf, toDotPath } = require('./issues.js');
const { createContext } = require('./context.js');
const { STRUCT, isStruct } = require('./struct.js');
const { asyncReturn } = require('./errors.js');
const collections = require('./prototypes/collections.js');
const { schema: struct } = require('./prototypes/schema.js');
const { tuple } = require('./prototypes/tuple.js');
const { union, tableOf } = require('./prototypes/union.js');
const { reference, embeds } = require('./prototypes/reference.js');

// What a subtree carries, as bits; a phase is the bit it applies.
const DEFAULTS = 1;
const DECODERS = 2;
const ENCODERS = 4;
const STRUCTS = 8;
const ASYNC = 16;

// The shape of a node: a Schema, a struct (the dictionary of its fields), or
// a field by the identity of its prototype's compile, as the JIT tells them
// apart; anything else (a scalar, a custom type) is a leaf.
const LEAF = 0;
const SCHEMA = 1;
const FIELDS = 2;
const NESTED = 3;
const LIST = 4;
const KEYED = 5;
const TUPLE = 6;
const UNION = 7;
const REFERENCE = 8;

const SHAPES = new Map([
  [struct.compile, NESTED],
  [collections.array.compile, LIST],
  [collections.object.compile, KEYED],
  [collections.map.compile, KEYED],
  [tuple.compile, TUPLE],
  [union.compile, UNION],
  [reference.compile, REFERENCE],
]);

const shapeOf = (node) => {
  if (hasBrand(node, 'Schema')) return SCHEMA;
  if (isStruct(node)) return FIELDS;
  const shape = SHAPES.get(node.compile);
  return shape === undefined ? LEAF : shape;
};

const isAsyncFunction = (fn) => typeof fn === 'function' && fn.constructor.name === 'AsyncFunction';

// What the passes know about a node, computed on first use and kept apart
// from the node: its shape, the bits of its subtree, its own decoder and
// serializer, its children with their infos, the fields of a struct a phase
// has to visit (`parts`, by phase bit; every field under `strip`), and the
// reference fields beneath it (their targets are resolved at parse time, so a
// reference counts as carrying everything).
const INFO = new WeakMap();

const infoOf = (node) => {
  let info = INFO.get(node);
  if (info !== undefined) return info;
  const shape = shapeOf(node);
  // A struct's own functions belong to the node that holds it.
  const own = shape === SCHEMA ? node.options : shape === FIELDS ? EMPTY : node;
  const decode = own.parse || undefined;
  const encode = own.serialize || undefined;
  let bits = decode === undefined ? 0 : DECODERS;
  if (encode !== undefined) bits |= ENCODERS;
  if (isAsyncFunction(own.validate) || isAsyncFunction(decode) || isAsyncFunction(own.checkType)) {
    bits |= ASYNC;
  }
  const children = [];
  const infos = [];
  const refs = [];
  let plan = null;
  let extra = null;
  let table = null;
  let parts = null;
  if (shape === SCHEMA) children.push(node.fields);
  else if (shape === FIELDS) {
    const compiled = node[STRUCT];
    plan = compiled.plan;
    extra = compiled.calculated;
    bits |= STRUCTS;
  } else if (shape === NESTED) children.push(node.schema);
  else if (shape === LIST || shape === KEYED) children.push(node.value);
  else if (shape === TUPLE) {
    for (let index = 0; index < node.value.length; index += 1) children.push(node.value[index]);
  } else if (shape === UNION) {
    const branches = node.union;
    if (node.discriminator !== undefined) table = tableOf(node);
    for (let index = 0; index < branches.length; index += 1) children.push(branches[index]);
  } else if (shape === REFERENCE) {
    bits |= DEFAULTS | DECODERS | ENCODERS | STRUCTS;
    refs.push(node);
  }
  if (plan === null) {
    for (let index = 0; index < children.length; index += 1) {
      const sub = infoOf(children[index]);
      infos.push(sub);
      bits |= sub.bits;
      for (let at = 0; at < sub.refs.length; at += 1) refs.push(sub.refs[at]);
    }
  } else {
    // One pass over the plan: the child and its info, and the fields each
    // phase has to visit (every field under strip).
    parts = { [DEFAULTS]: [], [DECODERS]: [], [ENCODERS]: [], [STRUCTS]: [] };
    for (let index = 0; index < plan.length; index += 1) {
      const { type } = plan[index];
      const sub = infoOf(type);
      children.push(type);
      infos.push(sub);
      bits |= sub.bits;
      for (let at = 0; at < sub.refs.length; at += 1) refs.push(sub.refs[at]);
      const defaulted = type.default !== undefined;
      if (defaulted) bits |= DEFAULTS;
      if (defaulted || (sub.bits & DEFAULTS) !== 0) parts[DEFAULTS].push(index);
      if ((sub.bits & DECODERS) !== 0) parts[DECODERS].push(index);
      if ((sub.bits & ENCODERS) !== 0) parts[ENCODERS].push(index);
      parts[STRUCTS].push(index);
    }
  }
  info = { shape, bits, decode, encode, children, infos, plan, parts, extra, table, refs };
  INFO.set(node, info);
  return info;
};
// Whether a schema has an async function among its validators, decoders and
// custom checkTypes, the entities it references included: `~standard` then
// validates through parseAsync.
const hasAsync = (schema, visited = new Set()) => {
  const info = infoOf(schema);
  if ((info.bits & ASYNC) !== 0) return true;
  visited.add(schema);
  for (const ref of info.refs) {
    const target = ref.root.findReference(ref.one || ref.many);
    if (target !== null && !visited.has(target) && hasAsync(target, visited)) return true;
  }
  return false;
};

// Writes into an object of the output: a key of the plan or of the value is
// data, so `__proto__` lands as an own property.
const putKey = (out, key, value) => {
  if (key === '__proto__') {
    Object.defineProperty(out, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  } else {
    out[key] = value;
  }
};

const putIndex = (out, index, value) => {
  out[index] = value;
};

const putEntry = (out, key, value) => {
  out.set(key, value);
};

const copy = (value) => ({ ...value });

const toMap = (value) => new Map(value);

const toSet = (list) => new Set(list);

// The output of a container under construction: the container is copied at
// the first part that changed (`clone`), a part is written with `put`, and
// the parts that decoded asynchronously are written in once they settle (a
// decoder that failed resolved to nothing and recorded its issue). A
// container pushes its key on the path for its parts.
const enter = (context, key, value, clone, put) => {
  if (key !== undefined) context.path.push(key);
  return { context, key, value, clone, put, out: null, pending: null };
};

// A part that is still decoding: only a decoder makes a promise (a thenable
// it returns is adopted as one, below), and only in an async parse; a value
// of the data with a `then` of its own is data, never awaited.
const isPending = (context, value) => context.async !== null && value instanceof Promise;

const take = (state, key, result, phase) => {
  if (state.out === null) state.out = state.clone(state.value);
  state.put(state.out, key, result);
  if (phase === DECODERS && isPending(state.context, result)) {
    if (state.pending === null) state.pending = [];
    state.pending.push(key, result);
  }
};

// What a promise of the passes resolves to: a box around the value, never
// the value itself, because a promise adopts a value with a `then` of its
// own and the value of a program may well have one.
const boxed = (value) => ({ value });

const leave = (state, wrap) => {
  const { context, key, out, pending, put } = state;
  if (key !== undefined) context.path.pop();
  if (out === null) return state.value;
  if (pending === null) return wrap === undefined ? out : wrap(out);
  const promises = [];
  for (let index = 1; index < pending.length; index += 2) promises.push(pending[index]);
  return Promise.all(promises).then((boxes) => {
    for (let index = 0; index < boxes.length; index += 1) {
      put(out, pending[index * 2], boxes[index].value);
    }
    return boxed(wrap === undefined ? out : wrap(out));
  });
};

// Runs `fn` with the path of the context set to where a value was met: a
// promise settles after the walk has unwound.
const at = (context, path, fn) => {
  const saved = context.path;
  context.path = path;
  try {
    return fn();
  } finally {
    context.path = saved;
  }
};

// The decoder of a node over a value whose parts decoded: its exception is an
// issue at the field, and the result is gone; a promise is awaited where
// parseAsync allows it and an error in a synchronous parse. Once a decoder
// failed, none runs: the result is invalid already.
const decode = (info, node, value, context, key) => {
  const fn = info.decode;
  if (fn === undefined || context.count > 0) return value;
  if (isPending(context, value)) {
    const where = pathOf(context, key);
    return value.then((box) => {
      const out = at(context, where, () => decode(info, node, box.value, context));
      return out instanceof Promise ? out : boxed(out);
    });
  }
  let out;
  try {
    out = fn.call(node, value);
  } catch (error) {
    issues.exception(context, error, key);
    return undefined;
  }
  if (!isThenable(out)) return out;
  const where = pathOf(context, key);
  if (context.async === null) {
    abandon(out);
    throw asyncReturn('decoder', toDotPath(where, context.root), 'parseAsync');
  }
  // A real Promise of a box from here on, whatever the decoder returned; a
  // decoder that failed resolves to nothing and records its issue.
  return Promise.resolve(out).then(boxed, (error) => {
    if (context.count < context.limit) at(context, where, () => issues.exception(context, error));
    return boxed(undefined);
  });
};

const walkLeaf = (info, node, value) => value;

const walkInner = (info, node, value, context, key, phase) =>
  apply(info.infos[0], info.children[0], value, context, key, phase);

// Before the check (the defaults, a serialization) a graph may loop through
// its references; the records on the way down are kept in `seen`, which the
// caller clears before the check. A loop is marked there: the copies the
// defaults make cannot close it, so parse checks such a value as it was
// given, and the check reports the loop. After the check a loop cannot be
// there.
const LOOP = Symbol('loop');

const looped = (context) => context.seen !== null && context.seen.has(LOOP);

const walkSchema = (info, node, value, context, key, phase) => {
  if (phase === DECODERS || info.refs.length === 0 || typeof value !== 'object') {
    return walkInner(info, node, value, context, key, phase);
  }
  if (context.seen === null) context.seen = new Set();
  const { seen } = context;
  if (seen.has(value)) {
    seen.add(LOOP);
    return value;
  }
  seen.add(value);
  const out = walkInner(info, node, value, context, key, phase);
  seen.delete(value);
  return out;
};

// The fields of a struct: a default fills a missing key before the check, a
// decoder replaces the value after it. Stripping rebuilds the object from
// the known keys; otherwise the object is copied when a field changed.
const walkFields = (info, fields, value, context, key, phase, want) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const { plan, infos, extra } = info;
  const strip = (want & STRUCTS) !== 0;
  const parts = info.parts[strip ? STRUCTS : phase];
  const state = enter(context, key, value, copy, putKey);
  if (strip) state.out = {};
  for (let position = 0; position < parts.length; position += 1) {
    const index = parts[position];
    const entry = plan[index];
    const name = entry.key;
    let item = entry.own && !Object.hasOwn(value, name) ? undefined : value[name];
    if (item === undefined && phase === DEFAULTS) {
      const fallback = entry.type.default;
      if (fallback === undefined) continue;
      item = typeof fallback === 'function' ? fallback() : fallback;
      take(state, name, item, phase);
    }
    const result = apply(infos[index], entry.type, item, context, name, phase);
    if (strip ? result !== undefined : result !== item) take(state, name, result, phase);
  }
  if (strip) {
    for (let index = 0; index < extra.length; index += 1) {
      const name = extra[index];
      if (Object.hasOwn(value, name)) putKey(state.out, name, value[name]);
    }
  }
  return leave(state);
};

// The elements of an array or a Set, each through the one child; a Set comes
// back as a Set.
const walkElements = (child, sub, value, context, key, phase) => {
  const set = !Array.isArray(value);
  if (set && value.constructor?.name !== 'Set') return value;
  const state = enter(context, key, value, Array.from, putIndex);
  let index = 0;
  for (const item of value) {
    const result = apply(sub, child, item, context, index, phase);
    if (result !== item) take(state, index, result, phase);
    index += 1;
  }
  return leave(state, set ? toSet : undefined);
};

const walkList = (info, node, value, context, key, phase) =>
  walkElements(info.children[0], info.infos[0], value, context, key, phase);

// The elements of a tuple, each through the child at its position.
const walkTuple = (info, node, value, context, key, phase) => {
  if (!Array.isArray(value)) return value;
  const { children, infos } = info;
  const length = Math.min(value.length, children.length);
  const state = enter(context, key, value, Array.from, putIndex);
  for (let index = 0; index < length; index += 1) {
    const item = value[index];
    const result = apply(infos[index], children[index], item, context, index, phase);
    if (result !== item) take(state, index, result, phase);
  }
  return leave(state);
};

// The values of an object or a Map, by key.
const walkKeyed = (info, node, value, context, key, phase) => {
  const map = value.constructor?.name === 'Map';
  if (!map && (typeof value !== 'object' || Array.isArray(value))) return value;
  const child = info.children[0];
  const sub = info.infos[0];
  const state = enter(context, key, value, map ? toMap : copy, map ? putEntry : putKey);
  if (map) {
    for (const pair of value) {
      const name = pair[0];
      const item = pair[1];
      const result = apply(sub, child, item, context, name, phase);
      if (result !== item) take(state, name, result, phase);
    }
  } else {
    // The own keys of the object, in order, as the check iterates them.
    for (const name in value) {
      if (!Object.hasOwn(value, name)) continue;
      const item = value[name];
      const result = apply(sub, child, item, context, name, phase);
      if (result !== item) take(state, name, result, phase);
    }
  }
  return leave(state);
};

// The context for trying the branches of a plain union, one per parse, made
// at the first plain union met: the policies and the root of the parse, one
// issue at most, and a list for the promises so that a validator is set aside
// as the check sets it aside instead of failing the trial.
const scratchOf = (context) => {
  let scratch = context.scratch;
  if (scratch === null) {
    scratch = createContext(undefined, context.root, context.unknown);
    scratch.references = context.references;
    scratch.limit = 1;
    scratch.async = [];
    context.scratch = scratch;
  }
  return scratch;
};

// Whether a branch accepts the value, as the check decides it: under the
// path of the parse (the branch pushes the key as the union's check does).
// The validators the trial set aside are not run: the check of the value
// picks the branch and runs them for real.
const accepts = (branch, value, scratch, path, key) => {
  scratch.issues = NONE;
  scratch.count = 0;
  scratch.path = path;
  const list = scratch.async;
  list.length = 0;
  branch.check(value, scratch, key);
  for (let index = 0; index < list.length; index += 1) {
    if (list[index].promise !== null) abandon(list[index].promise);
  }
  return scratch.count === 0;
};

// The branch of a union a value belongs to: by the discriminator, or the
// first branch whose check records nothing, as the check picks it. Before
// the check a branch is tried with its own defaults in place, and the value
// with those defaults is what parse goes on with.
const walkUnion = (info, node, value, context, key, phase) => {
  const { children, infos, table } = info;
  if (table !== null) {
    if (typeof value !== 'object') return value;
    const index = table.get(value[node.discriminator]);
    if (index === undefined) return value;
    return apply(infos[index], children[index], value, context, key, phase);
  }
  const scratch = scratchOf(context);
  for (let index = 0; index < children.length; index += 1) {
    const branch = children[index];
    const sub = infos[index];
    const prepared = phase === DEFAULTS ? apply(sub, branch, value, context, key, phase) : value;
    if (!accepts(branch, prepared, scratch, context.path, key)) continue;
    return phase === DEFAULTS ? prepared : apply(sub, branch, value, context, key, phase);
  }
  return value;
};

// A reference resolved at parse time, as the check resolves it: an id stays
// an id, a record goes through its entity.
const walkReference = (info, node, value, context, key, phase) => {
  const { one, many, root, embed } = node;
  const target = root.findReference(one || many);
  if (target === null || !embeds(target, embed, context.references)) return value;
  const sub = infoOf(target);
  if (one) return apply(sub, target, value, context, key, phase);
  if (!Array.isArray(value)) return value;
  return walkElements(target, sub, value, context, key, phase);
};

const WALKERS = [
  walkLeaf,
  walkSchema,
  walkFields,
  walkInner,
  walkList,
  walkKeyed,
  walkTuple,
  walkUnion,
  walkReference,
];

// One pass over a value from a node whose info is known, by the shape of
// each node. A serializer runs before the parts of its value, a decoder
// after them; stripping concerns every struct, so under `strip` the pass
// enters any subtree with one.
const apply = (info, node, value, context, key, phase) => {
  if (value == null) return value;
  const want = phase === DECODERS && context.unknown === 'strip' ? DECODERS | STRUCTS : phase;
  if ((info.bits & want) === 0) return value;
  let input = value;
  if (phase === ENCODERS && info.encode !== undefined) {
    input = info.encode.call(node, value);
    if (input == null) return input;
  }
  const out = WALKERS[info.shape](info, node, input, context, key, phase, want);
  return phase === DECODERS ? decode(info, node, out, context, key) : out;
};

module.exports = {
  PREPARE: DEFAULTS,
  FINISH: DECODERS,
  SERIALIZE: ENCODERS,
  infoOf,
  apply,
  looped,
  hasAsync,
};
