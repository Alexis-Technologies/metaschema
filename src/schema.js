const { isFirstUpper } = require('./metautil.js');

const { BRAND, hasBrand, ancestors } = require('./util.js');
const { TYPES } = require('./types.js');
const { Preprocessor } = require('./preprocessor.js');
const { SchemaMetadata, ValidationResult } = require('./metadata.js');
const { SchemaDefinitionError } = require('./errors.js');
const { createStruct, checkStruct } = require('./struct.js');

const ES_TYPES = ['number', 'string', 'boolean'];

class Schema extends SchemaMetadata {
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
    const types = Array.from(this.namespaces).map((ns) => ns.types);
    return Object.assign(Object.create(null), ...types);
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

  check(source, path = this.name) {
    const result = new ValidationResult(path);
    const { fields } = this;
    const isStruct = hasBrand(fields, 'Struct');
    // The root of a struct joins the path too, unless a field check already put
    // it there (a reference checks its target through this method). A schema
    // of any other type delegates to that type's check, which tracks itself.
    const isObject = typeof source === 'object' && source !== null;
    const track = isStruct && isObject && !ancestors.has(source);
    if (track) ancestors.add(source);
    try {
      const custom = this.validate(source, path);
      const nested = isStruct ? checkStruct(fields, source, path) : fields.check(source, path);
      result.add(custom);
      return result.add(nested);
    } finally {
      if (track) ancestors.delete(source);
    }
  }

  toInterface() {
    const { name, fields } = this;
    const lines = [`interface ${name} {`];
    for (const pair of Object.entries(fields)) {
      const fieldKey = pair[0];
      const def = pair[1];
      const { type } = def;
      if (!type) continue;
      const optional = def.required ? '' : '?';
      const isEntity = isFirstUpper(type);
      const isBuiltin = ES_TYPES.includes(type);
      const fieldName = isEntity ? `${fieldKey}Id` : fieldKey;
      let tsType = type;
      if (isEntity) tsType = def.many ? 'string[]' : 'string';
      else if (!isBuiltin) tsType = 'string';
      lines.push(`  ${fieldName}${optional}: ${tsType};`);
    }
    lines.push('}');
    return lines.join('\n');
  }

  attach(...namespaces) {
    for (const ns of namespaces) this.namespaces.add(ns);
  }

  detach(...namespaces) {
    for (const ns of namespaces) this.namespaces.delete(ns);
  }

  toString() {
    return JSON.stringify(this);
  }

  toJSON() {
    const { fields } = this;
    return hasBrand(fields, 'Struct') ? { ...fields } : fields.toJSON();
  }
}

Schema.prototype[BRAND] = 'Schema';

module.exports = { Schema };
