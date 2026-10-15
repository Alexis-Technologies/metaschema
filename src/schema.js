const {
  BRAND,
  INSPECT,
  RUN,
  HOOK,
  TRACKED,
  COERCES,
  CODEC,
  STANDARD,
  hasBrand,
} = require('./util.js');
const { TYPES } = require('./types.js');
const { Preprocessor } = require('./preprocessor.js');
const { SchemaMetadata } = require('./metadata.js');
const { SchemaDefinitionError, noValidation } = require('./errors.js');
const { createStruct } = require('./struct.js');
const { BUILD } = require('./prototypes/abstract.js');
const { schemaSnapshotOf } = require('./snapshot.js');

// The check of a schema until it is first used: it builds the closures
// (`BUILD.schema`, the validation half's), takes their place and runs them.
// A schema built to be read (rendered, written as a snapshot) never builds
// them; one the JIT replaced before its first use (`register()` of
// `./compile`) is not touched.
const lazyRun = (schema) => {
  const run = (value, context, key) => {
    const check = BUILD.schema(schema);
    if (schema[RUN] === run) schema[RUN] = check;
    return check(value, context, key);
  };
  return run;
};

// The half of the core that builds a schema and reads it: its fields and
// metadata, its JSON and its snapshot. The validation half (`validation.js`,
// which the core entry loads) installs `check`, `parse`, `serialize` and
// their kin, `~standard` and the warnings of the lint on this class; until
// then they say so (`./definition` alone).
class Schema extends SchemaMetadata {
  // The merged type table of the attached namespaces, rebuilt only when they
  // change.
  #types = null;

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
    // What the validation half reads (util.js): whether the root value joins
    // the cycle detection (only a struct with references can reach it
    // again), whether parse coerces unless the call says otherwise (the
    // `coerce` of the kind metadata, read once: an own property would shadow
    // the method the `./coerce` subpath installs), and its caches.
    this[TRACKED] = isSchemaType && this.relations.size > 0;
    this[COERCES] = Object.hasOwn(this.custom, 'coerce') && this.custom.coerce === true;
    this[CODEC] = null;
    this[STANDARD] = null;
    this[RUN] = lazyRun(this);
    const hook = Schema[HOOK];
    if (hook !== undefined) hook(this);
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

  // An entity of the attached models, else the schema itself: a schema that
  // names itself (`parent: '?Category'`) needs no model. The models come
  // first, so a schema with the name of one of their entities (a schema
  // derived from it keeps the name) still reaches that entity.
  findReference(name) {
    for (const ns of this.namespaces) {
      const entity = ns.entities.get(name);
      if (entity) return entity;
    }
    return name === this.name && name !== '' ? this : null;
  }

  // The types and the Standard Schema props depend on the namespaces (the
  // latter through the entities an async validator may be in), so both are
  // rebuilt on the next use.
  attach(...namespaces) {
    for (const ns of namespaces) this.namespaces.add(ns);
    this.#types = null;
    this[STANDARD] = null;
  }

  detach(...namespaces) {
    for (const ns of namespaces) this.namespaces.delete(ns);
    this.#types = null;
    this[STANDARD] = null;
  }

  toString() {
    return JSON.stringify(this);
  }

  toJSON() {
    const { fields } = this;
    return hasBrand(fields, 'Struct') ? { ...fields } : fields.toJSON();
  }

  // The schema as plain JSON: the snapshot of a model (format 1) holding the
  // schema and every entity it reaches through its references, in
  // dependency order, with the name of the schema as `root`.
  toSnapshot() {
    return schemaSnapshotOf(this);
  }

  [INSPECT](depth, options, inspect) {
    const label = this.name ? `Schema(${this.name})` : 'Schema';
    return `${label} ${inspect(this.toJSON(), options)}`;
  }
}

// Until the validation half is installed, a schema builds and reads, and a
// call that validates says what is missing. A stub looks the method up when
// it is called, so one a program took before the core was loaded (`const {
// check } = schema`, `check.bind(schema)`) calls the method installed since.
// Named as the methods are, for the stack.
const STUBS = {
  checkConsistency(...args) {
    return late(this, 'checkConsistency', args);
  },
  check(...args) {
    return late(this, 'check', args);
  },
  async checkAsync(...args) {
    return late(this, 'checkAsync', args);
  },
  parse(...args) {
    return late(this, 'parse', args);
  },
  async parseAsync(...args) {
    return late(this, 'parseAsync', args);
  },
  serialize(...args) {
    return late(this, 'serialize', args);
  },
  validate(...args) {
    return late(this, 'validate', args);
  },
};

const late = (schema, name, args) => {
  const method = Schema.prototype[name];
  if (method === STUBS[name]) throw noValidation(name);
  return method.apply(schema, args);
};

for (const name of Object.keys(STUBS)) {
  Object.defineProperty(Schema.prototype, name, {
    value: STUBS[name],
    writable: true,
    configurable: true,
  });
}
Object.defineProperty(Schema.prototype, 'warnings', {
  get() {
    throw noValidation('warnings');
  },
  configurable: true,
});

Schema.prototype[BRAND] = 'Schema';

module.exports = { Schema };
