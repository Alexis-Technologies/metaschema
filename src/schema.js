const { isFirstUpper } = require('./metautil.js');

const { BRAND, INSPECT, RUN, HOOK, hasBrand } = require('./util.js');
const { createContext } = require('./context.js');
const { TYPES } = require('./types.js');
const { Preprocessor } = require('./preprocessor.js');
const { SchemaMetadata } = require('./metadata.js');
const { ValidationResult } = require('./result.js');
const { finalize, runValidate, settle } = require('./issues.js');
const { SchemaDefinitionError } = require('./errors.js');
const { createStruct, isStruct, checkOf } = require('./struct.js');
const { warning, lintSchema } = require('./lint.js');
const {
  PREPARE,
  FINISH,
  SERIALIZE,
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
// as Schema[RUN].
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

class Schema extends SchemaMetadata {
  // The merged type table of the attached namespaces, rebuilt only when they
  // change.
  #types = null;

  // Whether the root value joins the cycle detection (`context.source`):
  // only a struct with references can reach it again.
  #tracked = false;

  // The lint of the definition, run on first use: a schema built in a hot
  // path never pays for it.
  #warnings = null;

  // The Standard Schema props, built on first use.
  #standard = null;

  // What the passes of parse and serialize know about the schema, on first use.
  #codec = null;

  static from(source, namespaces) {
    return new Schema('', source, namespaces);
  }

  static extractSchema(def) {
    if (hasBrand(def, 'Schema')) return def;
    if (hasBrand(def.schema, 'Schema')) return def.schema;
    return null;
  }

  constructor(name, raw, namespaces = []) {
    // A Schema instance is reused, not copied: it keeps its own name, and the
    // namespaces it is given here are attached so a model can resolve its
    // references through it.
    if (hasBrand(raw, 'Schema')) {
      if (name && raw.name && raw.name !== name) {
        const reason = `Schema "${raw.name}" cannot be used as "${name}"`;
        throw new SchemaDefinitionError('ERR_INVALID_DEFINITION', reason);
      }
      raw.attach(...namespaces);
      return raw;
    }
    super();
    this.name = name;
    this.namespaces = new Set(namespaces);
    const preprocessor = new Preprocessor(this);
    const { Type, defs, kindMeta } = preprocessor.parse(raw);
    const isSchemaType = Type.type === 'schema';
    if (!isSchemaType) {
      this.kind = Type.kind;
      this.fields = new Type(defs, preprocessor);
    } else {
      const fields = this.extractMetadata(defs.schema);
      let extras = Object.create(null);
      if (kindMeta) extras = this.updateFromKind(kindMeta);
      const combined = { ...fields, ...extras };
      this.fields = createStruct(combined, preprocessor);
    }
    this.#tracked = isSchemaType && this.relations.size > 0;
    this[RUN] = compileSchema(this);
    const hook = Schema[HOOK];
    if (hook !== undefined) hook(this);
  }

  // What is not wrong enough to throw: `Warning [code]: text` strings.
  get warnings() {
    if (this.#warnings === null) this.#warnings = lintSchema(this);
    return this.#warnings;
  }

  // Standard Schema v1 (https://standardschema.dev): the interface tRPC,
  // TanStack Form, Hono and the other consumers of the specification validate
  // through. `validate` is `parse` with the policies of the schema: the value
  // that comes back has the defaults and the decoders applied (the value
  // itself when there was nothing to apply), and the issues of an invalid one
  // are the result's own (a message and a path of keys each). A schema with
  // an async validator or decoder validates through parseAsync, as the
  // specification allows. The vendor-specific `libraryOptions` of a call are
  // the options of `parse`. An accessor of the prototype stays out of toJSON,
  // inspect and Object.keys, and `validate` closes over the schema because a
  // consumer calls it unbound. The `./generators` subpath adds the
  // `jsonSchema` converter of Standard JSON Schema to the props.
  get '~standard'() {
    if (this.#standard === null) {
      const async = hasAsync(this);
      const validate = (value, options) => {
        const libraryOptions = options == null ? undefined : options.libraryOptions;
        if (async) return this.parseAsync(value, libraryOptions).then(standardize);
        return standardize(this.parse(value, libraryOptions));
      };
      this.#standard = { version: 1, vendor: 'alexify.metaschema', validate };
    }
    return this.#standard;
  }

  get types() {
    if (this.namespaces.size === 0) return TYPES;
    if (this.#types === null) {
      const types = Object.create(null);
      for (const ns of this.namespaces) Object.assign(types, ns.types);
      this.#types = types;
    }
    return this.#types;
  }

  // The warnings that need the namespaces: references and types that do
  // not resolve.
  checkConsistency() {
    const warn = [];
    const { name, references } = this;
    for (const ref of references) {
      if (isFirstUpper(ref)) {
        const entity = this.findReference(ref);
        if (!entity) {
          warn.push(warning('missing-reference', `"${ref}" referenced by "${name}" is not found`));
        }
      } else if (!this.types[ref]) {
        warn.push(warning('missing-type', `type "${ref}" is not found in "${name}"`));
      }
    }
    return warn;
  }

  findReference(name) {
    for (const ns of this.namespaces) {
      const entity = ns.entities.get(name);
      if (entity) return entity;
    }
    return null;
  }

  // Validates a value: every problem is collected as an issue, and the result
  // never throws because of the value. `options`: root (the label of the
  // error lines, the schema name by default), maxErrors, unknown ('reject'
  // or 'ignore' keys the schema does not have), references, messages (a
  // locale). A validator that returns a promise is an error here.
  // `createContext` is called directly in every method here, never through a
  // helper: V8 inlines the allocation into `check` that way (the context is
  // the one allocation of a valid check), and a method in between cost 7%.
  check(source, options) {
    const context = createContext(options, this.name, this.unknown);
    if (this.#tracked) context.source = source;
    this[RUN](source, context);
    return resultOf(context);
  }

  // The same check, with the validators that return a promise settled after
  // the walk, in field order.
  async checkAsync(source, options) {
    const context = createContext(options, this.name, this.unknown);
    context.async = [];
    if (this.#tracked) context.source = source;
    this[RUN](source, context);
    if (context.async.length > 0) await settle(context);
    return resultOf(context);
  }

  #pass(phase, source, context) {
    if (this.#codec === null) this.#codec = infoOf(this);
    return apply(this.#codec, this, source, context, undefined, phase, wantOf(phase, context));
  }

  // The defaults of the schema over a value, before its check; the objects
  // met on the way down are not the check's, and a value that loops through
  // its references is checked as it was given.
  #prepare(source, context) {
    const prepared = this.#pass(PREPARE, source, context);
    const value = looped(context) ? source : prepared;
    context.seen = null;
    if (this.#tracked) context.source = value;
    return value;
  }

  // Validates a value and builds the value of the program from it: the
  // defaults fill the missing keys, the check runs, and a valid value goes
  // through `unknown: 'strip'`, the decoders of its fields (the parts of a
  // value before the value) and the schema's own `parse`. `{ valid, value,
  // issues }`: the value is undefined when invalid, and the value given when
  // there was nothing to apply; the value given is never written to.
  parse(source, options) {
    const context = createContext(options, this.name, this.unknown, true);
    const value = this.#prepare(source, context);
    this[RUN](value, context);
    const output = context.count === 0 ? this.#pass(FINISH, value, context) : undefined;
    return parsed(context, output);
  }

  async parseAsync(source, options) {
    const context = createContext(options, this.name, this.unknown, true);
    context.async = [];
    const value = this.#prepare(source, context);
    this[RUN](value, context);
    if (context.async.length > 0) await settle(context);
    let output;
    if (context.count === 0) {
      // Only a promise of the pass is awaited: a thenable in the value is data.
      output = this.#pass(FINISH, value, context);
      if (output instanceof Promise) output = (await output).value;
    }
    return parsed(context, output);
  }

  // The other direction: the schema's own `serialize`, then the serializers
  // of the fields, from the value down to its parts. `{ value }`, or with
  // `options.check` the verdict of `check` over the result as well.
  serialize(source, options) {
    const context = createContext(options, this.name, this.unknown);
    const value = this.#pass(SERIALIZE, source, context);
    if (options === undefined || options.check !== true) return { value };
    context.seen = null;
    if (this.#tracked) context.source = value;
    this[RUN](value, context);
    finalize(context.issues, context.messages);
    return { valid: context.count === 0, value, issues: context.issues };
  }

  // The types and the Standard Schema props depend on the namespaces (the
  // latter through the entities an async validator may be in), so both are
  // rebuilt on the next use.
  attach(...namespaces) {
    for (const ns of namespaces) this.namespaces.add(ns);
    this.#types = null;
    this.#standard = null;
  }

  detach(...namespaces) {
    for (const ns of namespaces) this.namespaces.delete(ns);
    this.#types = null;
    this.#standard = null;
  }

  toString() {
    return JSON.stringify(this);
  }

  toJSON() {
    const { fields } = this;
    return hasBrand(fields, 'Struct') ? { ...fields } : fields.toJSON();
  }

  [INSPECT](depth, options, inspect) {
    const label = this.name ? `Schema(${this.name})` : 'Schema';
    return `${label} ${inspect(this.toJSON(), options)}`;
  }
}

Schema.prototype[BRAND] = 'Schema';

module.exports = { Schema };
