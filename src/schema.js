const { isFirstUpper } = require('./metautil.js');

const { BRAND, INSPECT, RUN, hasBrand } = require('./util.js');
const { createContext } = require('./context.js');
const { TYPES } = require('./types.js');
const { Preprocessor } = require('./preprocessor.js');
const { SchemaMetadata } = require('./metadata.js');
const { ValidationResult } = require('./result.js');
const { finalize, runValidate } = require('./issues.js');
const { SchemaDefinitionError } = require('./errors.js');
const { createStruct, isStruct, checkOf } = require('./struct.js');
const { embeds } = require('./prototypes/reference.js');
const { warning, lintSchema } = require('./lint.js');

const TS_SCALARS = {
  string: 'string',
  number: 'number',
  boolean: 'boolean',
  bigint: 'bigint',
  date: 'Date',
  null: 'null',
  any: 'any',
  unknown: 'unknown',
};

const listOf = (element) => (element.includes(' | ') ? `(${element})[]` : `${element}[]`);

// Whether a reference field renders as its id (`companyId: string`) or as
// the referenced type (`company: Company`): the same rule as `check`, with
// a target that cannot be resolved taken as stored.
const asId = (def) => {
  const target = def.root.findReference(def.type);
  if (target === null) return def.embed !== true;
  return !embeds(target, def.embed, 'kind');
};

const tsStruct = (fields) => `{ ${tsFields(fields).join('; ')} }`;

// The referenced type: its interface by name, inline when it has none, the
// name of the reference when it cannot be resolved.
const tsReference = (def) => {
  const target = def.root.findReference(def.type);
  if (target === null || target.name) return def.type;
  const { fields } = target;
  return hasBrand(fields, 'Struct') ? tsStruct(fields) : tsType(fields);
};

// The TypeScript type of a field. A reference to a stored kind is held as
// an id, so it renders as a string (an array of them for `many`), a
// reference to a memory kind as the type itself; a custom scalar with its
// own check has no known shape and renders as a string.
const tsType = (def) => {
  const type = tsBase(def);
  return def.nullable === true ? `${type} | null` : type;
};

const tsBase = (def) => {
  if (isFirstUpper(def.type)) {
    const element = asId(def) ? 'string' : tsReference(def);
    return def.many ? listOf(element) : element;
  }
  if (def.enum) return def.enum.map((value) => JSON.stringify(value)).join(' | ');
  if (def.union) return def.union.map(tsType).join(' | ');
  if (def.scalar) return TS_SCALARS[def.scalar] || 'string';
  if (def.schema) return tsStruct(def.schema);
  if (Array.isArray(def.value)) return `[${def.value.map(tsType).join(', ')}]`;
  if (def.key !== undefined && def.value) {
    const entries = `${def.key}, ${tsType(def.value)}`;
    return def.isInstance({}) ? `Record<${entries}>` : `Map<${entries}>`;
  }
  if (def.value) {
    const element = tsType(def.value);
    return def.isInstance([]) ? listOf(element) : `Set<${element}>`;
  }
  if (def.kind === 'struct') return 'unknown';
  return 'string';
};

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

const tsFields = (fields) => {
  const lines = [];
  for (const pair of Object.entries(fields)) {
    const key = pair[0];
    const def = pair[1];
    if (!hasBrand(def, 'Type')) continue;
    const optional = def.required ? '' : '?';
    const name = isFirstUpper(def.type) && asId(def) ? `${key}Id` : key;
    lines.push(`${name}${optional}: ${tsType(def)}`);
  }
  return lines;
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
  }

  // What is not wrong enough to throw: `Warning [code]: text` strings.
  get warnings() {
    if (this.#warnings === null) this.#warnings = lintSchema(this);
    return this.#warnings;
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

  toInterface() {
    const { name, fields } = this;
    if (!hasBrand(fields, 'Struct')) return `type ${name} = ${tsType(fields)};`;
    const lines = tsFields(fields).map((line) => `  ${line};`);
    return [`interface ${name} {`, ...lines, '}'].join('\n');
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
