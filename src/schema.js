const { isFirstUpper } = require('./metautil.js');

const { BRAND, INSPECT, hasBrand, ancestors, limits } = require('./util.js');
const { TYPES } = require('./types.js');
const { Preprocessor } = require('./preprocessor.js');
const { SchemaMetadata, ValidationResult } = require('./metadata.js');
const { SchemaDefinitionError } = require('./errors.js');
const { createStruct, checkStruct } = require('./struct.js');

const TS_SCALARS = { string: 'string', number: 'number', boolean: 'boolean', bigint: 'bigint' };

const maxErrorsOf = ({ maxErrors }) => {
  const valid = typeof maxErrors === 'number' && maxErrors >= 1;
  if (!valid) throw new TypeError(`maxErrors must be a number of at least 1, got ${maxErrors}`);
  return maxErrors;
};

const listOf = (element) => (element.includes(' | ') ? `(${element})[]` : `${element}[]`);

// The TypeScript type of a field. A reference is stored as an id, so it
// renders as a string (an array of them for `many`); a custom scalar with its
// own check has no known shape and renders as a string too.
const tsType = (def) => {
  if (isFirstUpper(def.type)) return def.many ? 'string[]' : 'string';
  if (def.enum) return def.enum.map((value) => JSON.stringify(value)).join(' | ');
  if (def.scalar) return TS_SCALARS[def.scalar] || 'string';
  if (def.schema) return `{ ${tsFields(def.schema).join('; ')} }`;
  if (Array.isArray(def.value)) return `[${def.value.map(tsType).join(', ')}]`;
  if (def.key !== undefined && def.value) {
    const entries = `${def.key}, ${tsType(def.value)}`;
    return def.isInstance({}) ? `Record<${entries}>` : `Map<${entries}>`;
  }
  if (def.value) return listOf(tsType(def.value));
  if (def.kind === 'struct') return 'unknown';
  return 'string';
};

const tsFields = (fields) => {
  const lines = [];
  for (const pair of Object.entries(fields)) {
    const key = pair[0];
    const def = pair[1];
    if (!hasBrand(def, 'Type')) continue;
    const optional = def.required ? '' : '?';
    const name = isFirstUpper(def.type) ? `${key}Id` : key;
    lines.push(`${name}${optional}: ${tsType(def)}`);
  }
  return lines;
};

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
  }

  get types() {
    if (this.namespaces.size === 0) return TYPES;
    if (this.#types === null) {
      const types = Array.from(this.namespaces).map((ns) => ns.types);
      this.#types = Object.assign(Object.create(null), ...types);
    }
    return this.#types;
  }

  checkConsistency() {
    const warn = [];
    const { name, references } = this;
    for (const ref of references) {
      if (isFirstUpper(ref)) {
        const entity = this.findReference(ref);
        if (!entity) {
          warn.push(`Warning: "${ref}" referenced by "${name}" is not found`);
        }
      } else if (!this.types[ref]) {
        warn.push(`Warning: type "${ref}" is not found in "${name}"`);
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

  check(source, path = this.name, options = {}) {
    const result = new ValidationResult(path);
    const { fields } = this;
    const isStruct = hasBrand(fields, 'Struct');
    // The root of a struct joins the path too, unless a field check already put
    // it there (a reference checks its target through this method). A schema
    // of any other type delegates to that type's check, which tracks itself.
    const isObject = typeof source === 'object' && source !== null;
    const track = isStruct && isObject && !ancestors.has(source);
    if (track) ancestors.add(source);
    const previous = limits.maxErrors;
    if (options.maxErrors !== undefined) limits.maxErrors = maxErrorsOf(options);
    try {
      const custom = this.validate(source, path);
      result.add(custom);
      if (result.full) return result;
      const nested = isStruct ? checkStruct(fields, source, path) : fields.check(source, path);
      return result.add(nested);
    } finally {
      limits.maxErrors = previous;
      if (track) ancestors.delete(source);
    }
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
