const { isFirstUpper, toLowerCamel, firstKey } = require('./metautil.js');

const { hasBrand, formatters } = require('./util.js');
const { SchemaDefinitionError } = require('./errors.js');

// The first key of an object decides what it is: a Schema or a built field is
// used as it is, a capitalized key is a kind, `type` is the long form, a type
// name is that type's shorthand, and anything else is a nested struct.
const PARSERS = {
  string: ['stringShorthand'],
  object: [
    'schemaInstance',
    'typeInstance',
    'schemaWithKind',
    'typeLongForm',
    'typeShorthand',
    'kindlessSchema',
  ],
  function: ['functionField'],
  array: ['tupleShorthand'],
};

const sourceType = (src) => {
  if (src === null) return 'null';
  if (Array.isArray(src)) return 'array';
  return typeof src;
};

const invalid = (source, srcType = sourceType(source)) =>
  new SchemaDefinitionError(
    'ERR_INVALID_DEFINITION',
    `Invalid definition: "${source}" of type ${srcType}`,
  );

class Preprocessor {
  constructor(root) {
    this.Schema = root.constructor;
    this.root = root;
    this.types = root.types;
  }

  parse(source) {
    const srcType = sourceType(source);
    const parsers = PARSERS[srcType];
    if (parsers) {
      for (const name of parsers) {
        const result = this[name](source);
        if (result) return result;
      }
    }
    throw invalid(source, srcType);
  }

  // A Schema instance as a field: `{ schema: instance }` and the long form go
  // through the type parsers, and the schema type accepts the instance there.
  schemaInstance(source) {
    if (!hasBrand(source, 'Schema')) return null;
    const defs = { schema: source };
    return { Type: this.types.schema, defs };
  }

  // A field already built (a projection copies the fields of its parent) is
  // parsed again from its own definition, so the copy belongs to the schema
  // that holds it.
  typeInstance(source) {
    if (!hasBrand(source, 'Type')) return null;
    return this.typeLongForm({ type: source.type, ...source.toJSON() });
  }

  stringShorthand(source) {
    return this.typeLongForm({ type: source });
  }

  typeLongForm(source) {
    if (firstKey(source) !== 'type') return null;
    if (typeof source.type !== 'string') throw invalid(source.type);
    const { types } = this;
    const parsed = formatters.type(source.type, source.required);
    const { type, required } = parsed;
    if (isFirstUpper(type)) {
      const defs = { one: type, required, ...source };
      return { Type: types.reference, defs };
    }
    if (!types[type]) {
      throw new SchemaDefinitionError('ERR_UNKNOWN_TYPE', `Unknown type "${type}"`);
    }
    const defs = { required, ...source };
    return { Type: types[type], defs };
  }

  typeShorthand(source) {
    const { types } = this;
    const first = firstKey(source);
    const parsed = formatters.key(first, source.required);
    const type = parsed.field;
    const required = parsed.required;
    if (!types[type]) return null;
    const { [first]: def, ...rest } = source;
    const defs = { type, [type]: def, required, ...rest };
    return { Type: types[type], defs };
  }

  schemaWithKind(source) {
    const { types, root } = this;
    const first = firstKey(source);
    if (!isFirstUpper(first)) return null;
    const { [first]: meta, ...fields } = source;
    const kind = toLowerCamel(first);
    const kindMeta = { kind, meta, root };
    const defs = { schema: fields };
    return { Type: types.schema, defs, kindMeta };
  }

  kindlessSchema(source) {
    const { types } = this;
    const kindMeta = { kind: 'struct' };
    const defs = { schema: source };
    return { Type: types.schema, defs, kindMeta };
  }

  tupleShorthand(source) {
    const { types } = this;
    const defs = { value: source, required: true };
    return { Type: types.tuple, defs };
  }

  functionField() {
    return {};
  }
}

module.exports = { Preprocessor };
