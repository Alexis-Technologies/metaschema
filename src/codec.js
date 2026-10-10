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
const { NONE, issues, isThenable, toDotPath } = require('./issues.js');
const { createContext } = require('./context.js');
const { STRUCT, isStruct } = require('./struct.js');
const { asyncReturn } = require('./errors.js');
const collections = require('./prototypes/collections.js');
const { schema: struct } = require('./prototypes/schema.js');
const { tuple } = require('./prototypes/tuple.js');
const { union } = require('./prototypes/union.js');
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
  const own = shape === SCHEMA ? node.options : shape === FIELDS ? {} : node;
  const decode = own.parse || undefined;
  const encode = own.serialize || undefined;
  let bits = decode === undefined ? 0 : DECODERS;
  if (encode !== undefined) bits |= ENCODERS;
  if ([own.validate, decode, own.checkType].some(isAsyncFunction)) bits |= ASYNC;
  let children = [];
  let plan = null;
  let extra = null;
  let table = null;
  const refs = [];
  if (shape === SCHEMA) children = [node.fields];
  else if (shape === FIELDS) {
    const compiled = node[STRUCT];
    plan = compiled.plan;
    const typed = new Set();
    for (const entry of plan) typed.add(entry.key);
    extra = Object.keys(compiled.known).filter((key) => !typed.has(key));
    children = plan.map((entry) => entry.type);
    bits |= STRUCTS;
  } else if (shape === NESTED) children = [node.schema];
  else if (shape === LIST || shape === KEYED) children = [node.value];
  else if (shape === TUPLE) children = node.value;
  else if (shape === UNION) {
    children = node.union;
    const { discriminator } = node;
    if (discriminator !== undefined) {
      table = new Map();
      children.forEach((branch, index) => {
        for (const value of branch.schema[discriminator].enum) table.set(value, index);
      });
    }
  } else if (shape === REFERENCE) {
    bits |= DEFAULTS | DECODERS | ENCODERS | STRUCTS;
    refs.push(node);
  }
  const infos = children.map(infoOf);
  for (const sub of infos) {
    bits |= sub.bits;
    refs.push(...sub.refs);
  }
  const parts = { [DEFAULTS]: [], [DECODERS]: [], [ENCODERS]: [], [STRUCTS]: [] };
  if (plan !== null) {
    plan.forEach((entry, index) => {
      const sub = infos[index];
      if (entry.type.default !== undefined) bits |= DEFAULTS;
      for (const phase of [DEFAULTS, DECODERS, ENCODERS]) {
        if ((sub.bits & phase) !== 0 || (phase === DEFAULTS && entry.type.default !== undefined)) {
          parts[phase].push(index);
        }
      }
      parts[STRUCTS].push(index);
    });
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

const take = (state, key, result, phase) => {
  if (state.out === null) state.out = state.clone(state.value);
  state.put(state.out, key, result);
  if (phase === DECODERS && isThenable(result)) {
    if (state.pending === null) state.pending = [];
    state.pending.push(key, result);
  }
};

const leave = (state, wrap) => {
  const { context, key, out, pending, put } = state;
  if (key !== undefined) context.path.pop();
  if (out === null) return state.value;
  let built = out;
  if (pending !== null) {
    const promises = [];
    for (let index = 1; index < pending.length; index += 2) promises.push(pending[index]);
    built = Promise.all(promises).then((values) => {
      for (let index = 0; index < values.length; index += 1) {
        put(out, pending[index * 2], values[index]);
      }
      return out;
    });
  }
  if (wrap === undefined) return built;
  return isThenable(built) ? built.then(wrap) : wrap(built);
};

const pathOf = (context, key) =>
  key === undefined ? context.path.slice() : [...context.path, key];

// Runs `fn` with the path of the context set to where a value was met: a
// promise settles after the walk has unwound.
const at = (context, path, fn) => {
  const saved = context.path;
  context.path = path;
  const out = fn();
  context.path = saved;
  return out;
};

// The decoder of a node over a value whose parts decoded: its exception is an
// issue at the field, and the result is gone; a promise is awaited where
// parseAsync allows it and an error in a synchronous parse. Once a decoder
// failed, none runs: the result is invalid already.
const decode = (info, node, value, context, key) => {
  const fn = info.decode;
  if (fn === undefined || context.count > 0) return value;
  if (isThenable(value)) {
    const where = pathOf(context, key);
    return value.then((settled) => at(context, where, () => decode(info, node, settled, context)));
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
    throw asyncReturn('decoder', toDotPath(where, context.root), 'parseAsync');
  }
  return out.then(undefined, (error) => at(context, where, () => issues.exception(context, error)));
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
    for (const name of extra) {
      if (Object.hasOwn(value, name)) putKey(state.out, name, value[name]);
    }
  }
  return leave(state);
};

// The elements of an array, a Set or a tuple, by position; a Set comes back
// as a Set.
const walkItems = (children, infos, fixed, value, context, key, phase) => {
  const set = !Array.isArray(value);
  if (set && (fixed || value.constructor?.name !== 'Set')) return value;
  const state = enter(context, key, value, Array.from, putIndex);
  let index = 0;
  for (const item of value) {
    const slot = fixed ? index : 0;
    if (slot >= children.length) break;
    const result = apply(infos[slot], children[slot], item, context, index, phase);
    if (result !== item) take(state, index, result, phase);
    index += 1;
  }
  return leave(state, set ? toSet : undefined);
};

const walkList = (info, node, value, context, key, phase) =>
  walkItems(info.children, info.infos, info.shape === TUPLE, value, context, key, phase);

// The values of an object or a Map, by key.
const walkKeyed = (info, node, value, context, key, phase) => {
  const map = value.constructor?.name === 'Map';
  if (!map && (typeof value !== 'object' || Array.isArray(value))) return value;
  const child = info.children[0];
  const sub = info.infos[0];
  const state = enter(context, key, value, map ? toMap : copy, map ? putEntry : putKey);
  for (const pair of map ? value : Object.entries(value)) {
    const name = pair[0];
    const item = pair[1];
    const result = apply(sub, child, item, context, name, phase);
    if (result !== item) take(state, name, result, phase);
  }
  return leave(state);
};

// A context for trying the branches of a plain union: the policies of the
// parse, one issue at most, and the promises of an async parse set aside as
// the check sets them aside, so the branch is the one the check picks.
const accepts = (branch, value, scratch, async) => {
  scratch.issues = NONE;
  scratch.count = 0;
  scratch.async = async ? [] : null;
  branch.check(value, scratch);
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
  const scratch = createContext(undefined, '', context.unknown);
  scratch.references = context.references;
  scratch.limit = 1;
  const async = context.async !== null;
  for (let index = 0; index < children.length; index += 1) {
    const branch = children[index];
    const sub = infos[index];
    const prepared = phase === DEFAULTS ? apply(sub, branch, value, context, key, phase) : value;
    if (!accepts(branch, prepared, scratch, async)) continue;
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
  return walkItems([target], [sub], false, value, context, key, phase);
};

const WALKERS = [
  walkLeaf,
  walkSchema,
  walkFields,
  walkInner,
  walkList,
  walkKeyed,
  walkList,
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
