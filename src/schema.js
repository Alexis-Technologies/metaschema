const { isFirstUpper } = require('./metautil.js');

const { BRAND, INSPECT, RUN, HOOK, hasBrand } = require('./util.js');
const { createContext } = require('./context.js');
const { TYPES } = require('./types.js');
const { Preprocessor } = require('./preprocessor.js');
const { SchemaMetadata } = require('./metadata.js');
const { ValidationResult } = require('./result.js');
const { finalize, runValidate } = require('./issues.js');
const { SchemaDefinitionError } = require('./errors.js');
const { createStruct, isStruct, checkOf } = require('./struct.js');
const { warning, lintSchema } = require('./lint.js');

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

class Schema extends SchemaMetadata {
  // The merged type table of the attached namespaces, rebuilt only when they
  // change.
  #types = null;

  // Whether the root value joins the cycle detection: only a struct with
  // references can reach it again.
  #tracked = false;

  // The lint of the definition, run on first use: a schema built in a hot
  // path never pays for it.
  #warnings = null;

  // The Standard Schema props, built on first use.
  #standard = null;

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
  // through. A verdict only: a valid value comes back as it is, and the
  // issues of an invalid one are the result's own (a message and a path of
  // keys each). The vendor-specific `libraryOptions` of a call are the
  // options of `check`. An accessor of the prototype stays out of toJSON,
  // inspect and Object.keys, and `validate` closes over the schema because a
  // consumer calls it unbound. The `./generators` subpath adds the
  // `jsonSchema` converter of Standard JSON Schema to the props.
  get '~standard'() {
    if (this.#standard === null) {
      const validate = (value, options) => {
        const result = this.check(value, options == null ? undefined : options.libraryOptions);
        return result.valid ? { value } : { issues: result.issues };
      };
      this.#standard = { version: 1, vendor: 'alexify.metaschema', validate };
    }
    return this.#standard;
  }

  get types() {
    if (this.namespaces.size === 0) return TYPES;
    if (this.#types === null) {
      const types = Array.from(this.namespaces).map((ns) => ns.types);
      this.#types = Object.assign(Object.create(null), ...types);
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
  // or 'ignore' keys the schema does not have), messages (a locale).
  check(source, options) {
    const context = createContext(options, this.name, this.unknown);
    if (this.#tracked && source !== null && typeof source === 'object') {
      context.seen = new Set();
      context.seen.add(source);
    }
    this[RUN](source, context);
    finalize(context.issues, context.messages);
    return new ValidationResult(context);
  }

  attach(...namespaces) {
    for (const ns of namespaces) this.namespaces.add(ns);
    this.#types = null;
  }

  detach(...namespaces) {
    for (const ns of namespaces) this.namespaces.delete(ns);
    this.#types = null;
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
