// The validation half of the core: what checks a value against a schema
// and builds the value of the program from it (the checks of the types, the
// passes of parse and serialize, the issues and the result), installed into
// the classes the definition half builds, when the core entry loads it.
// `./definition` is the other half alone: a schema it builds validates as
// soon as the program loads the core, since both halves share these
// classes. Installed once, on the first require of this module.
const { isFirstUpper } = require('./metautil.js');
const { RUN, TRACKED, COERCES, CODEC, STANDARD, CYCLES, safeString } = require('./util.js');
const { Schema } = require('./schema.js');
const { usesOf } = require('./snapshot.js');
const { Model } = require('./model.js');
const { warning, lintSchema } = require('./lint.js');
const { AbstractType, BUILD } = require('./prototypes/abstract.js');
const { PROTOTYPES } = require('./types.js');
const { COMPILE, custom, compileField, checkOf } = require('./checks.js');
const { isStruct } = require('./struct.js');
const { createContext } = require('./context.js');
const { ValidationResult } = require('./result.js');
const { finalize, runValidate, settle, release, isThenable } = require('./issues.js');
const { asyncReturn, VALIDATION } = require('./errors.js');
const {
  PREPARE,
  FINISH,
  SERIALIZE,
  COERCE,
  infoOf,
  apply,
  looped,
  hasAsync,
  wantOf,
} = require('./codec.js');

// The validation of a schema inside an existing context: `check` starts one,
// and a reference field checks its target entity within the context of the
// outer check, so the error limit and the cycle detection span the whole
// value. The schema-level validate runs last, and only on a value whose
// fields all passed, so it can rely on their shape. Built once per schema,
// on its first use, as Schema[RUN].
const compileSchema = (schema) => {
  const { fields, options } = schema;
  const run = isStruct(fields) ? checkOf(fields) : fields.check;
  return (value, context, key) => {
    const before = context.count;
    run(value, context, key);
    const { validate } = options;
    if (validate && context.count === before) {
      const nested = key !== undefined;
      if (nested) context.path.push(key);
      runValidate(schema, validate, value, context);
      if (nested) context.path.pop();
    }
  };
};

const resultOf = (context) => {
  finalize(context.issues, context.messages);
  return new ValidationResult(context);
};

// What parse returns: the output only for a valid value, the issues always.
const parsed = (context, output) => {
  finalize(context.issues, context.messages);
  const valid = context.count === 0;
  return { valid, value: valid ? output : undefined, issues: context.issues };
};

// The result of parse read as Standard Schema does.
const standardize = (result) =>
  result.valid ? { value: result.value } : { issues: result.issues };

// The walk of an async check: a throw out of it (a getter of the value that
// throws, the engine's limit on a pattern) leaves the promises the walk
// queued observed, so that none of them rejects unhandled.
const walkAsync = (schema, value, context) => {
  try {
    schema[RUN](value, context);
  } catch (error) {
    release(context.async, 0);
    throw error;
  }
};

// One pass of codec.js over a value, from the info of the schema, kept on
// the schema on first use.
const pass = (schema, phase, source, context, extra) => {
  let info = schema[CODEC];
  if (info === null) {
    info = infoOf(schema);
    schema[CODEC] = info;
  }
  const want = wantOf(phase, context) | extra;
  return apply(info, schema, source, context, undefined, phase, want);
};

// The warnings of a schema and of a model, computed on first use: a schema
// built in a hot path never pays for the lint.
const LINTED = new WeakMap();

const linted = (target, lint) => {
  let warnings = LINTED.get(target);
  if (warnings === undefined) {
    warnings = lint(target);
    LINTED.set(target, warnings);
  }
  return warnings;
};

// The lint warnings of every entity of a model, the references and types
// they cannot resolve, and the recursive dependencies met while ordering.
const lintModel = (model) => {
  const warnings = [];
  const add = (list) => {
    for (let index = 0; index < list.length; index += 1) warnings.push(list[index]);
  };
  for (const pair of model.entities) {
    if (pair[0].startsWith('.')) continue;
    add(pair[1].warnings);
    add(pair[1].checkConsistency());
  }
  for (const pair of model[CYCLES]) {
    warnings.push(
      warning('recursive-reference', `"${pair[0]}" depends on "${pair[1]}" recursively`),
    );
  }
  return warnings;
};

const members = {
  // What is not wrong enough to throw: `Warning [code]: text` strings.
  get warnings() {
    return linted(this, lintSchema);
  },

  // The warnings that need the namespaces: references and types that do
  // not resolve, each through the schema whose fields use it (a schema
  // reused as a field resolves its own), once per name.
  checkConsistency() {
    const warn = [];
    const { name } = this;
    const missing = new Set();
    const uses = usesOf(this);
    for (let index = 0; index < uses.length; index += 1) {
      const ref = uses[index][0];
      const root = uses[index][1];
      if (missing.has(ref)) continue;
      const upper = isFirstUpper(ref);
      if (upper ? root.findReference(ref) !== null : root.types[ref] !== undefined) continue;
      missing.add(ref);
      if (upper) {
        warn.push(warning('missing-reference', `"${ref}" referenced by "${name}" is not found`));
      } else warn.push(warning('missing-type', `type "${ref}" is not found in "${name}"`));
    }
    return warn;
  },

  // Validates a value: every problem is collected as an issue, and the
  // result never throws because of the value. `options`: root (the label of
  // the error lines, the schema name by default), maxErrors, unknown
  // ('reject' or 'ignore' keys the schema does not have), references,
  // messages (a locale). A validator that returns a promise is an error
  // here. `createContext` is called directly in every method here, never
  // through a helper: V8 inlines the allocation into `check` that way (the
  // context is the one allocation of a valid check), and a method in
  // between cost 7%.
  check(source, options) {
    const context = createContext(options, this.name, this.unknown);
    if (this[TRACKED]) context.source = source;
    this[RUN](source, context);
    return resultOf(context);
  },

  // The same check, with the validators that return a promise in flight
  // together and settled after the walk, in field order.
  async checkAsync(source, options) {
    const context = createContext(options, this.name, this.unknown);
    context.async = [];
    if (this[TRACKED]) context.source = source;
    walkAsync(this, source, context);
    if (context.async.length > 0) await settle(context);
    return resultOf(context);
  },

  // Validates a value and builds the value of the program from it: the
  // input coerced (when the call, else the schema, asks for it) and the
  // defaults filled in, the check, and on a valid value `unknown: 'strip'`,
  // the decoders of its fields (the parts of a value before the value) and
  // the schema's own `parse`. `{ valid, value, issues }`: the value is
  // undefined when invalid, and the value given when there was nothing to
  // apply; the value given is never written to. The objects met before the
  // check are not the check's, and a value that loops through its
  // references is checked as it was given. The pass before the check is
  // written out here and in parseAsync, not in a function of its own: with
  // coercion such a method no longer fit the bytecode V8 inlines into
  // parse, and the call cost the JIT backend 13%.
  parse(source, options) {
    const context = createContext(options, this.name, this.unknown, true);
    const own = options === undefined ? undefined : options.coerce;
    const coerce = own === undefined ? this[COERCES] : own;
    const prepared = pass(this, PREPARE, source, context, coerce === true ? COERCE : 0);
    const value = looped(context) ? source : prepared;
    context.seen = null;
    if (this[TRACKED]) context.source = value;
    this[RUN](value, context);
    const output = context.count === 0 ? pass(this, FINISH, value, context, 0) : undefined;
    return parsed(context, output);
  },

  async parseAsync(source, options) {
    const context = createContext(options, this.name, this.unknown, true);
    context.async = [];
    const own = options === undefined ? undefined : options.coerce;
    const coerce = own === undefined ? this[COERCES] : own;
    const prepared = pass(this, PREPARE, source, context, coerce === true ? COERCE : 0);
    const value = looped(context) ? source : prepared;
    context.seen = null;
    if (this[TRACKED]) context.source = value;
    walkAsync(this, value, context);
    if (context.async.length > 0) await settle(context);
    let output;
    if (context.count === 0) {
      // Only a promise of the pass is awaited: a thenable in the value is data.
      output = pass(this, FINISH, value, context, 0);
      if (output instanceof Promise) output = (await output).value;
    }
    return parsed(context, output);
  },

  // The other direction: the schema's own `serialize`, then the serializers
  // of the fields, from the value down to its parts. `{ value }`, or with
  // `options.check` the verdict of `check` over the result as well.
  serialize(source, options) {
    const context = createContext(options, this.name, this.unknown);
    const value = pass(this, SERIALIZE, source, context, 0);
    if (options === undefined || options.check !== true) return { value };
    context.seen = null;
    if (this[TRACKED]) context.source = value;
    this[RUN](value, context);
    finalize(context.issues, context.messages);
    return { valid: context.count === 0, value, issues: context.issues };
  },

  // Runs only the schema-level validate function, as a result of its own; a
  // function that returns a promise is an error here, as in check.
  validate(value, path = '') {
    if (!this.options.validate) return null;
    const result = new ValidationResult();
    try {
      const output = this.options.validate.call(this, value, path);
      if (isThenable(output)) throw asyncReturn('validator', path, 'checkAsync');
      return result.add(output);
    } catch (error) {
      if (error?.code === 'ERR_ASYNC_VALIDATOR') throw error;
      return result.add({
        code: 'exception',
        message: `validation failed ${safeString(error)}`,
        params: { error },
      });
    }
  },

  // Standard Schema v1 (https://standardschema.dev): the interface tRPC,
  // TanStack Form, Hono and the other consumers of the specification
  // validate through. `validate` is `parse` with the policies of the schema:
  // the value that comes back has the defaults and the decoders applied (the
  // value itself when there was nothing to apply), and the issues of an
  // invalid one are the result's own (a message and a path of keys each). A
  // schema with an async validator or decoder validates through parseAsync,
  // as the specification allows. The vendor-specific `libraryOptions` of a
  // call are the options of `parse`. An accessor of the prototype stays out
  // of toJSON, inspect and Object.keys, and `validate` closes over the
  // schema because a consumer calls it unbound. The `./generators` subpath
  // adds the `jsonSchema` converter of Standard JSON Schema to the props.
  get '~standard'() {
    if (this[STANDARD] === null) {
      const async = hasAsync(this);
      const validate = (value, options) => {
        const libraryOptions = options == null ? undefined : options.libraryOptions;
        if (async) return this.parseAsync(value, libraryOptions).then(standardize);
        return standardize(this.parse(value, libraryOptions));
      };
      this[STANDARD] = { version: 1, vendor: 'alexify.metaschema', validate };
    }
    return this[STANDARD];
  },
};

// Installed like class members: not enumerable. A copy per subpath rather
// than a helper of the core: the halves are measured apart.
const install = (target, entries) => {
  const descriptors = Object.getOwnPropertyDescriptors(entries);
  for (const name in descriptors) {
    descriptors[name].enumerable = false;
    Object.defineProperty(target, name, descriptors[name]);
  }
};

for (const name of Object.keys(COMPILE)) PROTOTYPES[name].compile = COMPILE[name];
install(AbstractType.prototype, { compile: custom.compile });
BUILD.field = compileField;
BUILD.schema = compileSchema;
install(Schema.prototype, members);
install(Model.prototype, {
  // The warnings of every entity, the references and types they cannot
  // resolve, and the recursive dependencies, as `Warning [code]: text`.
  get warnings() {
    return linted(this, lintModel);
  },
});
// A schema of another copy of the package says so (`noValidation`).
globalThis[VALIDATION] = true;

module.exports = { Schema, ValidationResult };
