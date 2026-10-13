// What parse and serialize do beyond the check: the coercion of the input,
// the defaults, the decoders, the serializers and the stripping of unknown
// keys, as passes over the built types. `parse` is the check of the schema
// (whichever backend installed it) between two passes, coercion and defaults
// before and decoders after; `serialize` is one
// pass the other way. The passes read the same plan the closures walk and
// validate nothing themselves, so the JIT needs no second generator. A node
// whose subtree carries nothing for a phase is returned as it is, and a
// container is copied only when one of its parts changed: the value given is
// never written to.
const { hasBrand, define, isMap, isSet } = require('./util.js');
const {
  EMPTY,
  NONE,
  issues,
  isThenable,
  abandon,
  release,
  pathOf,
  toDotPath,
} = require('./issues.js');
const { createContext } = require('./context.js');
const { STRUCT, isStruct, aliasOf } = require('./struct.js');
const { asyncReturn, notRegistered } = require('./errors.js');
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
// A field with aliases below: the pass after the check visits it only when
// the check read a field from an alias (`context.renamed`).
const ALIASES = 32;
// On every info: a pass before the check that coerces enters every subtree,
// since any value of the input may need a conversion.
const COERCE = 64;
// A field with `coerce: true` of its own below: the pass before the check
// converts there whatever the policy of the call.
const POLICY = 128;

// The converters of coercion, by type name, are the `./coerce` subpath's:
// its register() installs `convert` here and says so. Until then a pass
// that coerces is a call that cannot work, and says so as it enters the
// schema (`walkSchema`), whatever the value holds.
const COERCION = {
  installed: false,
  convert() {
    throw notRegistered('coerce', 'coerce');
  },
};

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
// serializer, its own coercion policy (a field's `coerce` key, which turns
// coercion on or off for its subtree), its children with their infos, the
// fields of a struct a phase
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
  // A field that coerces makes the pass before the check enter its subtree
  // whatever the policy of the call. An own key only: a `coerce` set on
  // Object.prototype elsewhere must not turn every schema's on.
  const policy = Object.hasOwn(own, 'coerce') ? own.coerce : undefined;
  const coerce = policy === true ? true : policy === false ? false : undefined;
  let bits = decode === undefined ? COERCE : COERCE | DECODERS;
  if (encode !== undefined) bits |= ENCODERS;
  if (coerce === true) bits |= DEFAULTS | POLICY;
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
      // A field with aliases, or with one below, is visited by the pass
      // that decodes, which renames; whether that pass enters the subtree
      // is decided by the bits and the context at the field.
      const aliased = plan[index].aliases.length > 0;
      if (aliased) bits |= ALIASES;
      if (aliased || (sub.bits & (DECODERS | ALIASES)) !== 0) parts[DECODERS].push(index);
      if ((sub.bits & ENCODERS) !== 0) parts[ENCODERS].push(index);
      parts[STRUCTS].push(index);
    }
  }
  // The walker of the node: the one of its shape, or for a field with a
  // coercion policy of its own the one that applies the policy first.
  const walk = coerce === undefined ? WALKERS[shape] : walkPolicy;
  info = {
    shape,
    walk,
    bits,
    decode,
    encode,
    coerce,
    children,
    infos,
    plan,
    parts,
    extra,
    table,
    refs,
  };
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
  if (key === '__proto__') define(out, key, value);
  else out[key] = value;
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

// The output of a container under construction, kept in the locals of its
// walker (no state object per container): null until a part changes, then a
// copy of the container (`clone`) the parts are written into (`put`).
const written = (out, value, clone, put, key, result) => {
  const target = out === null ? clone(value) : out;
  put(target, key, result);
  return target;
};

// A part that is still decoding: only a decoder makes a promise (a thenable
// it returns is adopted as one, below), and only in an async parse; a value
// of the data with a `then` of its own is data, never awaited.
const isPending = (context, value) => context.async !== null && value instanceof Promise;

// The parts of a container still decoding, as key, promise, key, promise.
const queued = (pending, key, result) => {
  const list = pending === null ? [] : pending;
  list.push(key, result);
  return list;
};

// What a promise of the passes resolves to: a box around the value, never
// the value itself, because a promise adopts a value with a `then` of its
// own and the value of a program may well have one.
const boxed = (value) => ({ value });

// What a container comes back as: the value when no part changed, its copy,
// or a promise of a box when parts are still decoding, written in once they
// settle (a decoder that failed resolved to nothing and recorded its issue).
const settled = (value, out, pending, put, wrap) => {
  if (out === null) return value;
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

// Under coercion a leaf, a list, a tuple or a dictionary asks for a
// conversion of its value before anything else looks at it (a struct, a
// union or a reference has none of its own: their parts convert; a tuple
// and an `object` have no built-in converter, and get the value back). Done
// by the walkers so that apply stays as small as parse needs it to be
// inlined.
const convert = (want, value, node) =>
  (want & COERCE) === 0 ? value : COERCION.convert(value, node);

const walkLeaf = (info, node, value, context, key, phase, want) => convert(want, value, node);

const walkInner = (info, node, value, context, key, phase, want) =>
  apply(info.infos[0], info.children[0], value, context, key, phase, want);

// Before the check (the defaults, a serialization) a graph may loop through
// its references; the records on the way down are kept in `seen`, which the
// caller clears before the check. A loop is marked there: the copies the
// defaults make cannot close it, so parse checks such a value as it was
// given, and the check reports the loop. After the check a loop cannot be
// there.
const LOOP = Symbol('loop');

const looped = (context) => context.seen !== null && context.seen.has(LOOP);

const walkSchema = (info, node, value, context, key, phase, want) => {
  // A pass that converts somewhere below (the policy of the call, or a
  // field's own) needs the converters, whatever the value holds.
  if (phase === DEFAULTS && !COERCION.installed && ((want & COERCE) | (info.bits & POLICY)) !== 0) {
    throw notRegistered('coerce', 'coerce');
  }
  if (phase === DECODERS || info.refs.length === 0 || typeof value !== 'object') {
    return walkInner(info, node, value, context, key, phase, want);
  }
  if (context.seen === null) context.seen = new Set();
  const { seen } = context;
  if (seen.has(value)) {
    seen.add(LOOP);
    return value;
  }
  seen.add(value);
  const out = walkInner(info, node, value, context, key, phase, want);
  seen.delete(value);
  return out;
};

// The copy of a struct with every renamed field in the place of its alias:
// `take` appended the field's key, and a key deleted from the copy would
// leave the copy in dictionary mode. `renames` is alias, field, alias, ...
const renameKeys = (out, renames) => {
  const result = {};
  for (const key in out) {
    const found = renames.indexOf(key);
    if (found === -1) putKey(result, key, out[key]);
    else if (found % 2 === 0) putKey(result, renames[found + 1], out[renames[found + 1]]);
  }
  return result;
};

// The fields of a struct: before the check a present value is coerced and a
// default fills a missing key (coerced too: it is validated like any
// value), a decoder replaces the value after it. Stripping rebuilds the object from
// the known keys; otherwise the object is copied when a field changed. A
// value under an alias of a field is read from there (no default fills the
// field, and the check sees it there), and the pass after the check writes
// it under the field's own key, where the alias was; serialize reads the
// value of the program, which carries the field keys, and never looks.
const walkFields = (info, fields, value, context, key, phase, want) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const { plan, infos, extra } = info;
  const strip = (want & STRUCTS) !== 0;
  // Every field under strip, and under coercion: any of them may convert.
  const parts = info.parts[(want & (STRUCTS | COERCE)) !== 0 ? STRUCTS : phase];
  const nested = key !== undefined;
  if (nested) context.path.push(key);
  let out = strip ? {} : null;
  let pending = null;
  let renames = null;
  for (let position = 0; position < parts.length; position += 1) {
    const index = parts[position];
    const entry = plan[index];
    const name = entry.key;
    let from = name;
    let item = entry.own && !Object.hasOwn(value, name) ? undefined : value[name];
    if (item === undefined && phase !== ENCODERS) {
      from = aliasOf(value, entry.aliases, name);
      if (from !== name) item = value[from];
    }
    if (phase === DEFAULTS) {
      let result = item;
      if (item !== undefined) {
        result = apply(infos[index], entry.type, item, context, from, phase, want);
      }
      const fallback = entry.type.default;
      if (result === undefined && fallback !== undefined) {
        const filled = typeof fallback === 'function' ? fallback() : fallback;
        out = written(out, value, copy, putKey, from, filled);
        result = apply(infos[index], entry.type, filled, context, from, phase, want);
        if (result !== filled) out = written(out, value, copy, putKey, from, result);
      } else if (result !== item) out = written(out, value, copy, putKey, from, result);
      continue;
    }
    const result = apply(infos[index], entry.type, item, context, from, phase, want);
    const renamed = from !== name;
    if (strip ? result !== undefined : renamed || result !== item) {
      out = written(out, value, copy, putKey, name, result);
      if (phase === DECODERS && isPending(context, result)) pending = queued(pending, name, result);
    }
    if (renamed && !strip) {
      if (renames === null) renames = [];
      renames.push(from, name);
    }
  }
  if (strip) {
    for (let index = 0; index < extra.length; index += 1) {
      const name = extra[index];
      if (Object.hasOwn(value, name)) putKey(out, name, value[name]);
    }
  } else if (renames !== null) out = renameKeys(out, renames);
  if (nested) context.path.pop();
  return settled(value, out, pending, putKey, undefined);
};

// The elements of an array, a Set or a tuple, by position; a Set comes back
// as a Set.
const walkItems = (children, infos, fixed, value, context, key, phase, want) => {
  const set = !Array.isArray(value);
  if (set && (fixed || !isSet(value))) return value;
  const nested = key !== undefined;
  if (nested) context.path.push(key);
  let out = null;
  let pending = null;
  let index = 0;
  for (const item of value) {
    const slot = fixed ? index : 0;
    if (slot >= children.length) break;
    const result = apply(infos[slot], children[slot], item, context, index, phase, want);
    if (result !== item) {
      out = written(out, value, Array.from, putIndex, index, result);
      if (phase === DECODERS && isPending(context, result)) {
        pending = queued(pending, index, result);
      }
    }
    index += 1;
  }
  if (nested) context.path.pop();
  return settled(value, out, pending, putIndex, set ? toSet : undefined);
};

const walkList = (info, node, value, context, key, phase, want) => {
  const input = convert(want, value, node);
  if (input == null) return input;
  return walkItems(
    info.children,
    info.infos,
    info.shape === TUPLE,
    input,
    context,
    key,
    phase,
    want,
  );
};

// The values of an object or a Map, by key.
const walkKeyed = (info, node, given, context, key, phase, want) => {
  const value = convert(want, given, node);
  if (value == null) return value;
  const map = isMap(value);
  if (!map && (typeof value !== 'object' || Array.isArray(value))) return value;
  const child = info.children[0];
  const sub = info.infos[0];
  const clone = map ? toMap : copy;
  const put = map ? putEntry : putKey;
  const nested = key !== undefined;
  if (nested) context.path.push(key);
  let out = null;
  let pending = null;
  if (map) {
    for (const pair of value) {
      const name = pair[0];
      const item = pair[1];
      const result = apply(sub, child, item, context, name, phase, want);
      if (result !== item) {
        out = written(out, value, clone, put, name, result);
        if (phase === DECODERS && isPending(context, result)) {
          pending = queued(pending, name, result);
        }
      }
    }
  } else {
    // The own keys of the object, in order, as the check iterates them.
    for (const name in value) {
      if (!Object.hasOwn(value, name)) continue;
      const item = value[name];
      const result = apply(sub, child, item, context, name, phase, want);
      if (result !== item) {
        out = written(out, value, clone, put, name, result);
        if (phase === DECODERS && isPending(context, result)) {
          pending = queued(pending, name, result);
        }
      }
    }
  }
  if (nested) context.path.pop();
  return settled(value, out, pending, put, undefined);
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
  branch.check(value, scratch, key);
  release(scratch.async, 0);
  return scratch.count === 0;
};

// The branch of a union a value belongs to: by the discriminator, or the
// first branch whose check records nothing, as the check picks it. Before
// the check a branch is tried with its own defaults in place, and the value
// with those defaults is what parse goes on with. Under coercion a value
// some branch accepts as given is not converted: the branches are tried as
// given first, then converted.
const walkUnion = (info, node, value, context, key, phase, want) => {
  const { children, infos, table } = info;
  if (table !== null) {
    if (typeof value !== 'object') return value;
    const index = table.get(value[node.discriminator]);
    if (index === undefined) return value;
    return apply(infos[index], children[index], value, context, key, phase, want);
  }
  const scratch = scratchOf(context);
  for (let round = want & ~COERCE; ; round = want) {
    for (let index = 0; index < children.length; index += 1) {
      const branch = children[index];
      const sub = infos[index];
      const prepared =
        phase === DEFAULTS ? apply(sub, branch, value, context, key, phase, round) : value;
      if (!accepts(branch, prepared, scratch, context.path, key)) continue;
      return phase === DEFAULTS ? prepared : apply(sub, branch, value, context, key, phase, round);
    }
    if (round === want) return value;
  }
};

// A reference resolved at parse time, as the check resolves it: an id stays
// an id, a record goes through its entity, and a record deeper than the
// check allows is left as it is for the check to report.
const walkReference = (info, node, value, context, key, phase, want) => {
  const { one, many, root, embed } = node;
  const target = root.findReference(one || many);
  if (target === null || !embeds(target, embed, context.references)) return value;
  if (context.depth >= context.maxDepth) return value;
  const sub = infoOf(target);
  context.depth += 1;
  let out = value;
  if (one) out = apply(sub, target, value, context, key, phase, want);
  else if (Array.isArray(value)) {
    // The target as the one child of the list, kept on the info from one
    // visit to the next (it changes only when the namespaces do).
    if (info.children[0] !== target) {
      info.children[0] = target;
      info.infos[0] = sub;
    }
    out = walkItems(info.children, info.infos, false, value, context, key, phase, want);
  }
  context.depth -= 1;
  return out;
};

// A field's own `coerce` turns coercion on or off for its subtree, in the
// pass before the check.
const walkPolicy = (info, node, value, context, key, phase, want) => {
  let mode = want;
  if (phase === DEFAULTS) mode = info.coerce ? want | COERCE : want & ~COERCE;
  return WALKERS[info.shape](info, node, value, context, key, phase, mode);
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

// The bits a pass wants of a subtree, decided once per pass: its own, and
// for the pass after the check the structs (under `strip`) and the fields
// with aliases (after a check that read one); a parse that coerces adds
// COERCE to the pass before it.
const wantOf = (phase, context) => {
  let want = phase;
  if (phase === DECODERS) {
    if (context.unknown === 'strip') want |= STRUCTS;
    if (context.renamed) want |= ALIASES;
  }
  return want;
};

// One pass over a value from a node whose info is known, by the shape of
// each node. A serializer runs before the parts of its value, a decoder
// after them, a conversion before them (in the walkers); a subtree without
// the bits the pass wants is returned as it is, which is the one test a
// value nothing applies to costs.
const apply = (info, node, value, context, key, phase, want) => {
  if (value == null) return value;
  if ((info.bits & want) === 0) return value;
  let input = value;
  if (phase === ENCODERS && info.encode !== undefined) {
    input = info.encode.call(node, value);
    if (input == null) return input;
  }
  const out = info.walk(info, node, input, context, key, phase, want);
  return phase === DECODERS ? decode(info, node, out, context, key) : out;
};

module.exports = {
  PREPARE: DEFAULTS,
  FINISH: DECODERS,
  SERIALIZE: ENCODERS,
  COERCE,
  COERCION,
  infoOf,
  apply,
  wantOf,
  looped,
  hasAsync,
};
