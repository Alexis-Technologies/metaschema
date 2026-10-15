// The checks of the types: the validation half of what a field is (its
// prototype in prototypes/ is the definition half). The type check of each
// built-in (`COMPILE`), the check of a field around it (its rules, its
// validate, null), of a custom type through its checkType, of a struct over
// its plan, and of the rules. validation.js installs them into the classes;
// the closures are built from a field on the first use of its `check`.
const { RUN, ENUM_SET_SIZE, isDate, isBytes, isMap, isSet } = require('./util.js');
const { issues, release, runValidate, runCheckType } = require('./issues.js');
const { formatOf } = require('./rules.js');
const { STRUCT, isStruct } = require('./struct.js');
const { embeds } = require('./prototypes/reference.js');

// The rules of a field (`rules.js` reads and normalizes them when the field
// is built): one closure per rule over the field's bounds, run after the type
// check in the order the type lists them.

// Code points of a string: a surrogate pair counts once, a lone surrogate
// once too.
const codePoints = (text) => {
  const { length } = text;
  let count = 0;
  for (let index = 0; index < length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) index += 1;
    }
    count += 1;
  }
  return count;
};

// The own keys of an object, counted without a list of them.
const keyCount = (value) => {
  let count = 0;
  for (const name in value) if (Object.hasOwn(value, name)) count += 1;
  return count;
};

// The length of a value, by what the value is rather than by what it carries
// (an object with a `size` key is an object): the units of a string, the
// length of an array, the size of a Set or a Map, the own keys of an object.
const lengthOf = (value) => {
  if (typeof value === 'string' || Array.isArray(value)) return value.length;
  return isMap(value) || isSet(value) ? value.size : keyCount(value);
};

// A string field measures its units, or its code points when it asks for
// them, a bytes field its bytes; anything else is measured by what it is.
// One closure per case, each calling its measure directly: a measure held in
// a variable is a call site shared by every length rule of the process,
// which V8 then cannot inline.
const compileLength = (type) => {
  const { min, max } = type.length;
  const { scalar } = type;
  if (scalar === 'string' && type.unicode === true) {
    return (value, context, key) => {
      const actual = codePoints(value);
      const short = min !== undefined && actual < min;
      const long = max !== undefined && actual > max;
      if (short || long) issues.length(context, min, max, actual, key);
    };
  }
  if (scalar === 'string' || scalar === 'bytes') {
    return (value, context, key) => {
      const actual = value.length;
      const short = min !== undefined && actual < min;
      const long = max !== undefined && actual > max;
      if (short || long) issues.length(context, min, max, actual, key);
    };
  }
  return (value, context, key) => {
    const actual = lengthOf(value);
    const short = min !== undefined && actual < min;
    const long = max !== undefined && actual > max;
    if (short || long) issues.length(context, min, max, actual, key);
  };
};

// One closure for both bounds when a field has both.
const compileRange = (type) => {
  const { min, max } = type;
  if (min === undefined) {
    return (value, context, key) => {
      if (value > max) issues.range(context, min, max, value, key);
    };
  }
  if (max === undefined) {
    return (value, context, key) => {
      if (value < min) issues.range(context, min, max, value, key);
    };
  }
  return (value, context, key) => {
    if (value < min || value > max) issues.range(context, min, max, value, key);
  };
};

// The units a pattern may be run over: `length.max` (twice it when the
// length counts code points, each at most two units), so that a string past
// the bound, reported for its length already, never reaches a pattern that
// backtracks over it; no limit without the bound.
const patternLimit = (type) => {
  const max = type.length?.max;
  if (max === undefined) return Infinity;
  return type.unicode === true ? 2 * max : max;
};

const compilePattern = (type) => {
  const { pattern } = type;
  const { source } = pattern;
  const limit = patternLimit(type);
  return (value, context, key) => {
    if (value.length <= limit && !pattern.test(value)) issues.pattern(context, source, key);
  };
};

// A format is the test the subpath registered under its name, run after the
// pattern and under the same bound.
const compileFormat = (type) => {
  const { format } = type;
  const { test } = formatOf(type);
  const limit = patternLimit(type);
  return (value, context, key) => {
    if (value.length <= limit && !test(value)) issues.format(context, format, key);
  };
};

// A number of `n` decimals is a whole number times 10ⁿ, to within the error
// the arithmetic of doubles leaves on the way (0.1 + 0.2 has two decimals):
// ULPS units in the last place of the scaled value. A few units is what a
// sum or a product of decimals leaves; 256 is room for a chain of them, and
// still tells a decimal too many apart below 2⁴³ units of the last decimal
// (ten billion at two), where a bound of 1e-9 of the value would let
// 12345678.123 pass as two decimals. Above it every double passes. NaN and
// the infinities have no decimals to count.
const ULPS = 256;
const NEAR = ULPS * Number.EPSILON;

// Whether a number has more decimals than `scale` (10ⁿ) allows: the one test
// of both backends (the JIT calls it through the scope).
const decimalsOff = (value, scale) => {
  const scaled = value * scale;
  const off = Math.abs(Math.round(scaled) - scaled) > NEAR * Math.max(1, Math.abs(scaled));
  return off || !Number.isFinite(value);
};

const compileDecimals = (type) => {
  const { decimals } = type;
  const scale = 10 ** decimals;
  return (value, context, key) => {
    if (decimalsOff(value, scale)) issues.decimals(context, decimals, key);
  };
};

// The rules a field carries, by name, in the order its type lists them, min
// and max as the one `range`: the order the closures run them in and the JIT
// emits them in.
const ruleNames = (type) => {
  const names = [];
  let range = false;
  for (const name of type.constructor.rules) {
    if (type[name] === undefined) continue;
    if (name === 'min' || name === 'max') range = true;
    else names.push(name);
  }
  if (range) names.push('range');
  return names;
};

const COMPILERS = Object.assign(Object.create(null), {
  length: compileLength,
  pattern: compilePattern,
  format: compileFormat,
  decimals: compileDecimals,
  range: compileRange,
});

// The checks of the rules a field carries.
const compileRules = (type) => {
  const names = ruleNames(type);
  const checks = [];
  for (let index = 0; index < names.length; index += 1) checks.push(COMPILERS[names[index]](type));
  return checks;
};

// A nullable field accepts null in place of a value of its type, whatever
// its rules; `required` still says whether the key must be there.
const nullable = (inner) => (value, context, key) => {
  if (value === null) return;
  inner(value, context, key);
};

// The check of a field with rules or a validate function: the type check,
// then the rules, then the validate function. A type failure cancels the
// rest (a length or a validator makes no sense for a value of another type),
// and validate runs only on a value that passed everything before it, so it
// can rely on the type and the rules. A field with neither is its type check
// alone.
const withRules = (type, inner, rules) => {
  const { required, validate } = type;
  return (value, context, key) => {
    if (value == null && !required) return;
    const before = context.count;
    inner(value, context, key);
    if (context.count !== before) return;
    for (let index = 0; index < rules.length; index += 1) {
      if (context.count >= context.limit) break;
      rules[index](value, context, key);
    }
    if (validate && context.count === before) {
      const nested = key !== undefined;
      if (nested) context.path.push(key);
      runValidate(type, validate, value, context);
      if (nested) context.path.pop();
    }
  };
};

// The check of a field: the type check, wrapped in the rules and the
// validate function when it has any, and in the null test when nullable. A
// field without rules is its type check alone, and check is the hot path.
const compileField = (type) => {
  const checks = compileRules(type);
  const inner = type.compile();
  const plain = checks.length === 0 && !type.validate;
  const check = plain ? inner : withRules(type, inner, checks);
  return type.nullable === true ? nullable(check) : check;
};

// The type check of a custom type: a `checkType(value, path)` that returns
// messages, run through the validator contract (the `compile` of
// AbstractType). A built-in prototype compiles its own.
const custom = {
  compile() {
    const type = this;
    const { required } = this;
    return (value, context, key) => {
      if (value == null && !required) return;
      const nested = key !== undefined;
      if (nested) context.path.push(key);
      runCheckType(type, value, context);
      if (nested) context.path.pop();
    };
  },
};

// The key a value carries for a field that has nothing under its own key: a
// field renamed with `aliases: ['old']` is still read from its old key, and
// the field's own key when the value has none of them.
const aliasOf = (value, aliases, name) => {
  for (const alias of aliases) if (Object.hasOwn(value, alias)) return alias;
  return name;
};

// A field is read with a keyed load, and `Object.hasOwn` is consulted only
// when the value is undefined, to tell a missing key from one set to
// undefined. A field named after a member of Object.prototype (`toString`,
// `constructor`, ...) would read the inherited function from a plain object,
// so such a field (`own`) always asks `Object.hasOwn` first.
const scanUnknown = (value, known, context) => {
  let unexpected = null;
  for (const name in value) {
    if (name in known || !Object.hasOwn(value, name)) continue;
    if (unexpected === null) unexpected = [];
    unexpected.push(name);
  }
  if (unexpected !== null) issues.unexpected(context, unexpected);
};

// The check of a struct, as a closure over its plan: an index loop with no
// lookups in the raw definition, no brand checks and no path strings. Every
// plan entry has the same shape and every field check is a function chosen
// when the field was built, called with the key of the field so that a leaf
// never touches the path. Unknown keys are looked for only when the value has
// more keys than the plan found, so a value with exactly the expected keys is
// never scanned twice.
// A field with nothing under its own key (absent, inherited, or own and set
// to undefined): an alias may hold the value, and the check reports it under
// the key it found it under. Then the same for an optional field, a required
// one asks which (own and undefined is a type error). Kept out of the loop
// of the struct check, whose body is the fast path of a present field; the
// return is what the field adds to the keys found.
const checkAbsent = (entry, value, context, name) => {
  const under = aliasOf(value, entry.aliases, name);
  let item;
  if (under !== name) {
    item = value[under];
    context.renamed = true;
  }
  if (item === undefined) {
    if (!entry.required) return 0;
    if (!Object.hasOwn(value, under)) {
      issues.required(context, name);
      return 0;
    }
  }
  entry.check(item, context, under);
  return 1;
};

// The checks of the fields are taken from them when the struct's check is
// compiled, on its first use, into entries of the shape the loop reads (the
// entry of the plan and the check of its field in one object: a load from
// it is what the loop did when the plan held the checks).
const compileStruct = (entries, known) => {
  const plan = [];
  for (const entry of entries) {
    const { key, type, required, own, aliases } = entry;
    plan.push({ key, type, required, own, aliases, check: type.check });
  }
  Object.freeze(plan);
  return (value, context, key) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      issues.type(context, 'object', value, key);
      return;
    }
    const nested = key !== undefined;
    if (nested) context.path.push(key);
    let found = 0;
    for (let index = 0; index < plan.length; index += 1) {
      if (context.count >= context.limit) break;
      const entry = plan[index];
      const name = entry.key;
      const item = value[name];
      if (item !== undefined && (!entry.own || Object.hasOwn(value, name))) {
        found += 1;
        entry.check(item, context, name);
      } else found += checkAbsent(entry, value, context, name);
    }
    if (context.unknown === 'reject' && context.count < context.limit) {
      let total = 0;
      // oxlint-disable-next-line no-unused-vars
      for (const name in value) total += 1;
      if (total !== found) scanUnknown(value, known, context);
    }
    if (nested) context.path.pop();
  };
};

// The check of a struct, compiled on its first use: kept apart from the
// frozen plan, whose creation is the cost of building a struct.
const CHECKS = new WeakMap();

const checkOf = (fields) => {
  let check = CHECKS.get(fields);
  if (check === undefined) {
    const { plan, known } = fields[STRUCT];
    check = compileStruct(plan, known);
    CHECKS.set(fields, check);
  }
  return check;
};

// A single comparison on the way through for a valid value; the optional
// case is looked at only when it fails.
const scalarCheck = (scalar, required) => (value, context, key) => {
  // oxlint-disable-next-line valid-typeof
  if (typeof value === scalar) return;
  if (!required && value == null) return;
  issues.type(context, scalar, value, key);
};

// Any value at all, null and undefined included; `required` still says
// whether the key must be there.
const accept = () => {};

// An array and a Set are walked the same way, by position; only the type
// test differs (`isInstance` of their prototypes).
const compileList = (type, isList) => {
  const { required } = type;
  const { check } = type.value;
  const name = type.type;
  return (value, context, key) => {
    if (!isList(value)) {
      if (!required && value == null) return;
      issues.type(context, name, value, key);
      return;
    }
    const nested = key !== undefined;
    if (nested) context.path.push(key);
    let index = 0;
    for (const item of value) {
      if (context.count >= context.limit) break;
      check(item, context, index);
      index += 1;
    }
    if (nested) context.path.pop();
  };
};

// A reference is the one place a schema can recurse (Category.parent is a
// Category), so it is where a value met again while it is still being
// checked is a cycle, reported instead of recursed into, and where a graph
// nested deeper than the check allows is reported instead of overflowing the
// stack.
const runReferenced = (schema, value, context, key) => {
  if (value === null || typeof value !== 'object') {
    schema[RUN](value, context, key);
    return;
  }
  if (context.depth >= context.maxDepth) {
    issues.depth(context, context.maxDepth, key);
    return;
  }
  let { seen } = context;
  if (seen === null) {
    // The first embedded record creates the set, and the value the check
    // started from joins it then, so a check that embeds nothing pays nothing.
    seen = new Set();
    if (context.source !== null) seen.add(context.source);
    context.seen = seen;
  }
  if (seen.has(value)) {
    issues.circular(context, key);
    return;
  }
  seen.add(value);
  context.depth += 1;
  schema[RUN](value, context, key);
  context.depth -= 1;
  seen.delete(value);
};

// What a branch is called in the message of a value that matched none.
const nameOf = (branch) => (branch.type === 'schema' ? 'object' : branch.type);

// The branch of a discriminated union by the value of its discriminator, as
// a Map of value to branch index: built once per field, on first use, and
// shared by the check, the passes of parse and the JIT.
const TABLES = new WeakMap();

const tableOf = (field) => {
  let table = TABLES.get(field);
  if (table === undefined) {
    table = new Map();
    const { union: branches, discriminator } = field;
    for (let index = 0; index < branches.length; index += 1) {
      const values = branches[index].schema[discriminator].enum;
      for (let at = 0; at < values.length; at += 1) table.set(values[at], index);
    }
    TABLES.set(field, table);
  }
  return table;
};

// A plain union: the branches in order, the first that records nothing
// wins, and what a failed branch recorded is dropped.
const compilePlain = (type, required) => {
  const checks = [];
  const expected = [];
  for (let index = 0; index < type.union.length; index += 1) {
    const branch = type.union[index];
    checks.push(branch.check);
    expected.push(nameOf(branch));
  }
  const { length } = checks;
  return (value, context, key) => {
    if (!required && value == null) return;
    const { count } = context;
    // The validators a failed branch set aside in an async check go with
    // its issues: they belong to a branch the value does not match.
    const pending = context.async === null ? 0 : context.async.length;
    for (let index = 0; index < length; index += 1) {
      checks[index](value, context, key);
      if (context.count === count) return;
      context.issues.length = count;
      context.count = count;
      if (context.async !== null) release(context.async, pending);
    }
    issues.union(context, expected, undefined, key);
  };
};

// The type check of each built-in prototype by the name of its type, a
// closure built once from the field: the `compile` validation.js installs on
// the prototype objects, and the identity codec.js and the JIT of
// `./compile` tell the shape of a node by. A string, a number, a bigint and
// a boolean share one (by `typeof`), so do any and unknown, an array and a
// Set (by `isInstance`).
const COMPILE = {
  // A string, a number, a bigint or a boolean: one `typeof`.
  string() {
    return scalarCheck(this.scalar, this.required);
  },
  // A number without a fraction.
  integer() {
    const { required } = this;
    return (value, context, key) => {
      if (Number.isInteger(value)) return;
      if (!required && value == null) return;
      issues.type(context, 'integer', value, key);
    };
  },
  // A Date instance with a time: an invalid Date is a type error.
  date() {
    const { required } = this;
    return (value, context, key) => {
      if (isDate(value) && !Number.isNaN(value.getTime())) return;
      if (!required && value == null) return;
      issues.type(context, 'date', value, key);
    };
  },
  // A Uint8Array of any realm, a Buffer included.
  bytes() {
    const { required } = this;
    return (value, context, key) => {
      if (isBytes(value)) return;
      if (!required && value == null) return;
      issues.type(context, 'bytes', value, key);
    };
  },
  null() {
    const { required } = this;
    return (value, context, key) => {
      if (value === null) return;
      if (value === undefined && !required) return;
      issues.type(context, 'null', value, key);
    };
  },
  any() {
    return accept;
  },
  // One of the values: a Set past ENUM_SET_SIZE of them.
  enum() {
    const values = this.enum;
    const { required } = this;
    if (values.length > ENUM_SET_SIZE) {
      const set = new Set(values);
      return (value, context, key) => {
        if (set.has(value)) return;
        if (!required && value == null) return;
        issues.enum(context, values, key);
      };
    }
    return (value, context, key) => {
      if (values.includes(value)) return;
      if (!required && value == null) return;
      issues.enum(context, values, key);
    };
  },
  // Collections iterate their source directly: an object with for...in
  // over its own keys, a Map and a Set through their iterators, an array by
  // index. A collection pushes its own key on the path before its elements
  // and pops it after them; an element is checked with its key or index.
  object() {
    const { required, type, key: keyType } = this;
    const { check } = this.value;
    return (value, context, key) => {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        if (!required && value == null) return;
        issues.type(context, type, value, key);
        return;
      }
      const nested = key !== undefined;
      if (nested) context.path.push(key);
      let count = 0;
      for (const name in value) {
        if (!Object.hasOwn(value, name)) continue;
        if (context.count >= context.limit) break;
        count += 1;
        // oxlint-disable-next-line valid-typeof
        if (typeof name !== keyType) {
          issues.key(context, keyType, name);
          break;
        }
        check(value[name], context, name);
      }
      if (count === 0 && required) issues.required(context);
      if (nested) context.path.pop();
    };
  },
  map() {
    const { required, type, key: keyType } = this;
    const { check } = this.value;
    return (value, context, key) => {
      if (!isMap(value)) {
        if (!required && value == null) return;
        issues.type(context, type, value, key);
        return;
      }
      if (value.size === 0) {
        if (required) issues.required(context, key);
        return;
      }
      const nested = key !== undefined;
      if (nested) context.path.push(key);
      for (const pair of value) {
        if (context.count >= context.limit) break;
        const name = pair[0];
        // oxlint-disable-next-line valid-typeof
        if (typeof name !== keyType) {
          issues.key(context, keyType, name);
          break;
        }
        check(pair[1], context, name);
      }
      if (nested) context.path.pop();
    };
  },
  array() {
    return compileList(this, this.isInstance);
  },
  // The target is looked up at check time: entities of a model are built
  // in any order and a namespace may be attached later.
  reference() {
    const { one, many, root, required, embed } = this;
    if (one) {
      return (value, context, key) => {
        if (!required && value == null) return;
        const schema = root.findReference(one);
        if (!schema) {
          issues.reference(context, one, key);
          return;
        }
        if (embeds(schema, embed, context.references)) runReferenced(schema, value, context, key);
        else if (typeof value !== 'string') issues.type(context, 'string', value, key);
      };
    }
    const expected = `array of ${many}`;
    return (value, context, key) => {
      if (!required && value == null) return;
      const schema = root.findReference(many);
      if (!schema) {
        issues.reference(context, many, key);
        return;
      }
      if (!Array.isArray(value)) {
        issues.type(context, expected, value, key);
        return;
      }
      const nested = key !== undefined;
      if (nested) context.path.push(key);
      const embedded = embeds(schema, embed, context.references);
      for (let index = 0; index < value.length; index += 1) {
        if (context.count >= context.limit) break;
        const item = value[index];
        if (embedded) runReferenced(schema, item, context, index);
        else if (typeof item !== 'string') issues.type(context, 'string', item, index);
      }
      if (nested) context.path.pop();
    };
  },
  // A nested struct: the check of its fields, or of the one type of a
  // Schema held as a field.
  schema() {
    const { required } = this;
    const check = isStruct(this.schema) ? checkOf(this.schema) : this.schema.check;
    return (value, context, key) => {
      if (!required && value == null) return;
      check(value, context, key);
    };
  },
  // The elements by index, no more of them than the tuple has.
  tuple() {
    const { required, type } = this;
    const checks = [];
    for (let index = 0; index < this.value.length; index += 1) checks.push(this.value[index].check);
    const { length } = checks;
    return (value, context, key) => {
      if (!Array.isArray(value)) {
        if (!required && value == null) return;
        issues.type(context, type, value, key);
        return;
      }
      if (value.length > length) {
        issues.length(context, undefined, length, value.length, key);
        return;
      }
      const nested = key !== undefined;
      if (nested) context.path.push(key);
      for (let index = 0; index < length; index += 1) {
        if (context.count >= context.limit) break;
        checks[index](value[index], context, index);
      }
      if (nested) context.path.pop();
    };
  },
  // Without a discriminator the branches are tried in order; with one, the
  // branch is picked by the value of that field in one Map lookup.
  union() {
    const { required, discriminator } = this;
    if (discriminator === undefined) return compilePlain(this, required);
    const checks = [];
    for (let index = 0; index < this.union.length; index += 1) checks.push(this.union[index].check);
    const table = tableOf(this);
    const expected = [];
    for (const value of table.keys()) expected.push(value);
    return (value, context, key) => {
      if (value === null || typeof value !== 'object') {
        if (!required && value == null) return;
        issues.type(context, 'object', value, key);
        return;
      }
      const index = table.get(value[discriminator]);
      if (index !== undefined) {
        checks[index](value, context, key);
        return;
      }
      const nested = key !== undefined;
      if (nested) context.path.push(key);
      issues.union(context, expected, discriminator, discriminator);
      if (nested) context.path.pop();
    };
  },
  // An object or an array.
  json() {
    const { required } = this;
    return (value, context, key) => {
      if (value !== null && typeof value === 'object') return;
      if (!required && value == null) return;
      issues.type(context, 'object', value, key);
    };
  },
  // The own keys of an object, each a name of the list holding a boolean;
  // another key is unexpected under the reject policy, as a struct's is.
  flags() {
    const { required, type } = this;
    // A null-prototype dictionary: a key such as `constructor` is not a name.
    const known = Object.create(null);
    for (const name of this.flags) known[name] = true;
    return (value, context, key) => {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        if (!required && value == null) return;
        issues.type(context, type, value, key);
        return;
      }
      const nested = key !== undefined;
      if (nested) context.path.push(key);
      let unexpected = null;
      for (const name in value) {
        if (!Object.hasOwn(value, name)) continue;
        if (context.count >= context.limit) break;
        if (known[name] === true) {
          const item = value[name];
          if (typeof item !== 'boolean') issues.type(context, 'boolean', item, name);
        } else if (context.unknown === 'reject') {
          if (unexpected === null) unexpected = [];
          unexpected.push(name);
        }
      }
      if (unexpected !== null && context.count < context.limit) {
        issues.unexpected(context, unexpected);
      }
      if (nested) context.path.pop();
    };
  },
};

COMPILE.number = COMPILE.string;
COMPILE.bigint = COMPILE.string;
COMPILE.boolean = COMPILE.string;
COMPILE.unknown = COMPILE.any;
COMPILE.set = COMPILE.array;

module.exports = {
  COMPILE,
  custom,
  compileField,
  checkOf,
  aliasOf,
  ruleNames,
  compileRules,
  patternLimit,
  decimalsOff,
  codePoints,
  lengthOf,
  nameOf,
  tableOf,
};
