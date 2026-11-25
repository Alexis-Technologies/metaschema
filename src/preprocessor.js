const { isFirstUpper, toLowerCamel, firstKey } = require('./metautil.js');

const { hasBrand, formatters, typeOf } = require('./util.js');
const { constants, isKindKey } = require('./kinds.js');
const { SchemaDefinitionError } = require('./errors.js');

const BUILT_IN_KINDS = new Set(constants.KIND);

// The first key of an object decides what it is: a Schema or a built field is
// used as it is, a kind key (`isKindKey` of kinds.js: a name like `Entity`
// holding the metadata object) is a kind, `type` is the long form, a type
// name is that type's shorthand, and anything else is a nested struct, a
// capitalized key that is no kind (`PORT`, `Name: 'string'`) included.
const PARSERS = {
  __proto__: null,
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

const invalid = (source, sourceType = typeOf(source)) =>
  new SchemaDefinitionError(
    'ALX_ERR_INVALID_DEFINITION',
    `Invalid definition: "${source}" of type ${sourceType}`,
  );

class Preprocessor {
  constructor(root) {
    this.Schema = root.constructor;
    this.root = root;
    this.types = root.types;
    this.kinds = null;
  }

  // The first key of an object is read once here and handed to the parsers
  // that look at it.
  parse(source) {
    const sourceType = typeOf(source);
    const parsers = PARSERS[sourceType];
    if (parsers) {
      const first = sourceType === 'object' ? firstKey(source) : undefined;
      for (const name of parsers) {
        const result = this[name](source, first);
        if (result) return result;
      }
    }
    throw invalid(source, sourceType);
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
    return this.typeLongForm({ type: source.type, ...source.toJSON() }, 'type');
  }

  stringShorthand(source) {
    return this.typeLongForm({ type: source }, 'type');
  }

  typeLongForm(source, first) {
    if (first !== 'type') return null;
    if (typeof source.type !== 'string') throw invalid(source.type);
    const { types } = this;
    const parsed = formatters.type(source.type, source.required);
    const { type, required } = parsed;
    if (isFirstUpper(type)) {
      // A built `many` field re-parsed from its own definition keeps its end
      // of the relation; anything else is a single reference.
      const defs =
        source.many === undefined ? { one: type, required, ...source } : { required, ...source };
      return { Type: types.reference, defs };
    }
    if (!types[type]) {
      throw new SchemaDefinitionError('ALX_ERR_UNKNOWN_TYPE', `Unknown type "${type}"`);
    }
    const defs = { required, ...source };
    return { Type: types[type], defs };
  }

  typeShorthand(source, first) {
    if (first === undefined) return null;
    const { types } = this;
    const parsed = formatters.key(first, source.required);
    const type = parsed.field;
    const required = parsed.required;
    if (!types[type]) return null;
    const { [first]: def, ...rest } = source;
    const defs = { type, [type]: def, required, ...rest };
    return { Type: types[type], defs };
  }

  schemaWithKind(source, first) {
    const { types, root } = this;
    if (!isKindKey(first, source[first])) return null;
    const { [first]: meta, ...fields } = source;
    const kind = toLowerCamel(first);
    // A kind of the program's own is kept for the lint: metadata that reads
    // as field definitions is most likely a field that was read as a kind.
    if (!BUILT_IN_KINDS.has(kind)) {
      if (this.kinds === null) this.kinds = [];
      this.kinds.push([first, meta]);
    }
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
