// The other direction of the JSON Schema generator: a definition (or a
// Schema) from a JSON Schema document, for the subset a validation schema is
// made of: types, properties and required, enum and const, items and tuples,
// anyOf/oneOf as a union, `$ref` into the definitions, the rules (`minLength`,
// `maximum`, `minItems`, ...), null as nullable or optional, and the
// annotations. A keyword outside it (`allOf` with several schemas, `not`,
// `if`, `patternProperties`, `exclusiveMinimum`, ...) is ERR_UNSUPPORTED_SCHEMA
// with its place in the document, or dropped with `unsupported: 'ignore'`.
// The document is untrusted input: a pointer reads own keys only, a `$ref` is
// converted once per pointer, and the nesting is bounded.
const { isFirstUpper } = require('../metautil.js');
const { define, shorten } = require('../util.js');
const { Schema } = require('../schema.js');
const { readsAsStruct } = require('../types.js');
const { FORMATS } = require('../rules.js');
const { SchemaDefinitionError, invalidTarget } = require('../errors.js');

const invalidOptions = (reason) => new SchemaDefinitionError('ERR_INVALID_OPTIONS', reason);

// The keys of a JSON object are strings, so a number key is this pattern.
const NUMBER_KEY = '^-?\\d+(\\.\\d+)?$';

// Keywords that say nothing about the value: identifiers, comments and the
// annotations with no counterpart (`format` is an annotation in JSON Schema
// unless the dialect asserts it, and metaschema has `pattern` for that).
const IGNORED = new Set([
  '$schema',
  '$id',
  '$comment',
  '$defs',
  'definitions',
  'components',
  'format',
  'readOnly',
  'writeOnly',
  'contentMediaType',
  'contentEncoding',
  'additionalProperties',
  'nullable',
]);

const ANNOTATIONS = ['title', 'description', 'default', 'examples', 'deprecated'];

// The types a node may name: those of JSON Schema, and the two the keywords
// of a node without a `type` are read as.
const KNOWN = new Set([
  'string',
  'number',
  'integer',
  'boolean',
  'null',
  'object',
  'array',
  'any',
  'json',
]);

// How deep a document may nest: past it the conversion stops whatever the
// mode, since a lenient conversion must not recurse without end either.
const MAX_DEPTH = 128;

const option = (options, name, allowed) => {
  const value = options[name];
  if (value === undefined) return allowed[0];
  if (!allowed.includes(value)) {
    let list = '';
    for (let index = 0; index < allowed.length; index += 1) {
      list += `${index === 0 ? '' : ', '}${JSON.stringify(allowed[index])}`;
    }
    throw invalidOptions(`Option "${name}" must be one of ${list}, got ${JSON.stringify(value)}`);
  }
  return value;
};

const createContext = (document, options) => {
  if (options === null || typeof options !== 'object') {
    throw invalidOptions('Options must be an object');
  }
  const { name = '', onUnsupported } = options;
  if (typeof name !== 'string') throw invalidOptions('Option "name" must be a string');
  if (onUnsupported !== undefined && typeof onUnsupported !== 'function') {
    throw invalidOptions('Option "onUnsupported" must be a function');
  }
  return {
    document,
    name,
    as: option(options, 'as', ['definition', 'schema']),
    references: option(options, 'references', ['inline', 'name']),
    lenient: option(options, 'unsupported', ['throw', 'ignore']) === 'ignore',
    onUnsupported,
    // The place in the document, as the segments of a JSON pointer.
    path: [],
    // How many nodes the conversion is inside.
    depth: 0,
    // The pointers of the definitions being inlined, so that a cycle is found.
    stack: new Set(),
    // The definitions inlined so far, by pointer: a `$ref` met again is the
    // same definition, not a second walk of the document.
    cache: new Map(),
  };
};

// The place in the document as a JSON pointer (RFC 6901); a key of the
// document may be huge, a message must not be.
const pointerOf = (path) => {
  let pointer = '';
  for (const segment of path) {
    pointer += `/${shorten(segment).replace(/~/g, '~0').replace(/\//g, '~1')}`;
  }
  return pointer;
};

// A node outside the subset: the error with its place, or a drop that
// `onUnsupported` is told of (in the throw mode the error carries both).
const unsupported = (context, what) => {
  const where = pointerOf(context.path);
  if (context.lenient) {
    if (context.onUnsupported !== undefined) context.onUnsupported(what, where);
    return;
  }
  const reason = `${what} is not supported in a JSON Schema at "${where}"`;
  throw new SchemaDefinitionError('ERR_UNSUPPORTED_SCHEMA', reason);
};

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// A JSON Schema pattern is ECMA-262 without the `u` flag, and the rule of a
// field compiles with it, so a pattern that does not compile under the flag
// has no form here.
const compilesWithU = (pattern) => {
  try {
    RegExp(pattern, 'u');
    return true;
  } catch {
    return false;
  }
};

// A definition of a type with no other key is its name.
const compact = (def, required) => {
  const keys = Object.keys(def);
  if (keys.length === 1 && typeof def.type === 'string') {
    return required ? def.type : `?${def.type}`;
  }
  if (!required) def.required = false;
  return def;
};

const annotate = (def, node) => {
  for (const name of ANNOTATIONS) if (node[name] !== undefined) def[name] = node[name];
  if (node.example !== undefined && def.examples === undefined) def.examples = [node.example];
  return def;
};

// A JSON pointer into the document (RFC 6901 as a URI fragment): `#`, or
// `#/$defs/Name` and the like, read through own keys only, so that
// `#/__proto__` or `#/constructor` finds nothing. The target is known by its
// decoded pointer, under which `A` and `%41` are one name, and two pointers
// that end alike are two.
const resolve = (context, ref) => {
  if (typeof ref !== 'string' || (ref !== '#' && !ref.startsWith('#/'))) {
    unsupported(context, `The reference ${JSON.stringify(ref)}`);
    return null;
  }
  if (ref === '#') return { pointer: '', name: context.name, node: context.document };
  const segments = ref.slice(2).split('/');
  const keys = [];
  let node = context.document;
  for (const segment of segments) {
    let key;
    try {
      key = decodeURIComponent(segment);
    } catch {
      unsupported(context, `The reference ${JSON.stringify(ref)} (a bad escape)`);
      return null;
    }
    key = key.replace(/~1/g, '/').replace(/~0/g, '~');
    keys.push(key);
    node = isObject(node) && Object.hasOwn(node, key) ? node[key] : undefined;
  }
  if (node === undefined) {
    unsupported(context, `The reference ${JSON.stringify(ref)} (nothing there)`);
    return null;
  }
  return { pointer: pointerOf(keys), name: keys[keys.length - 1], node };
};

// A `$ref` inlined is converted once per pointer: the places that inline it
// share the converted subtree and get a copy of its top-level object, which
// is the one the annotations, `nullable` and `required` of the place are
// written to. A copy of the subtree would be as large as the output, which a
// diamond of definitions makes exponential.
const reference = (context, node) => {
  const target = resolve(context, node.$ref);
  if (target === null) return 'any';
  const { pointer, name } = target;
  if (context.references === 'name' || target.node === context.document) {
    if (!isFirstUpper(name)) {
      unsupported(context, `The reference ${JSON.stringify(node.$ref)} (not an entity name)`);
      return 'any';
    }
    return name;
  }
  let def = context.cache.get(pointer);
  if (def === undefined) {
    if (context.stack.has(pointer)) {
      unsupported(context, `The recursive reference ${JSON.stringify(node.$ref)}`);
      return 'any';
    }
    context.stack.add(pointer);
    def = longOf(context, target.node);
    context.stack.delete(pointer);
    context.cache.set(pointer, def);
  }
  return { ...def };
};

const structOf = (context, node, used) => {
  const { properties, required = [] } = node;
  used.add('properties');
  used.add('required');
  if (!Array.isArray(required)) unsupported(context, 'A "required" that is not a list');
  const fields = {};
  context.path.push('properties');
  for (const key of Object.keys(properties)) {
    context.path.push(key);
    const def = convert(
      context,
      properties[key],
      Array.isArray(required) && required.includes(key),
    );
    context.path.pop();
    define(fields, key, def);
  }
  context.path.pop();
  return fields;
};

// A JSON Schema type as a definition: the rules of the type, then the rest.
const typed = (context, node, type, used) => {
  const def = { type };
  const take = (name) => {
    used.add(name);
    return node[name];
  };
  if (type === 'string') {
    const min = take('minLength');
    const max = take('maxLength');
    if (min !== undefined || max !== undefined) def.length = { min, max };
    const pattern = take('pattern');
    if (pattern !== undefined) {
      if (typeof pattern !== 'string') unsupported(context, 'A "pattern" that is not a string');
      else if (compilesWithU(pattern)) def.pattern = pattern;
      else {
        const shown = JSON.stringify(pattern);
        unsupported(context, `The pattern ${shown} (not a valid pattern under the u flag)`);
      }
    }
    // A format the formats subpath registered is the rule; any other stays
    // the annotation JSON Schema says it is. OpenAPI's `byte` is base64, and
    // the shape the export writes beside a format is the format's own.
    const format = take('format');
    const name = format === 'byte' && FORMATS.byte === undefined ? 'base64' : format;
    if (typeof name === 'string' && FORMATS[name] !== undefined) {
      def.format = name;
      if (def.pattern === FORMATS[name].pattern) delete def.pattern;
    }
    return def;
  }
  if (type === 'number' || type === 'integer') {
    const min = take('minimum');
    const max = take('maximum');
    if (min !== undefined) def.min = min;
    if (max !== undefined) def.max = max;
    return def;
  }
  if (type === 'array') {
    const items = take('items');
    const prefix = take('prefixItems');
    const min = take('minItems');
    const max = take('maxItems');
    const elements = Array.isArray(prefix) ? prefix : Array.isArray(items) ? items : null;
    if (elements !== null) {
      // A tuple: the elements up to minItems are required, the rest optional.
      take('additionalItems');
      if (items !== false && !Array.isArray(items) && items !== undefined) {
        unsupported(context, 'A tuple with more items');
      }
      def.type = 'tuple';
      def.value = [];
      const key = Array.isArray(prefix) ? 'prefixItems' : 'items';
      context.path.push(key);
      for (let index = 0; index < elements.length; index += 1) {
        context.path.push(index);
        def.value.push(convert(context, elements[index], min === undefined || index < min));
        context.path.pop();
      }
      context.path.pop();
      return def;
    }
    def.type = take('uniqueItems') === true ? 'set' : 'array';
    context.path.push('items');
    def.value = items === undefined ? 'any' : convert(context, items);
    context.path.pop();
    if (min !== undefined || max !== undefined) def.length = { min, max };
    return def;
  }
  if (type === 'object') {
    const min = take('minProperties');
    const max = take('maxProperties');
    if (isObject(node.properties)) {
      def.type = 'schema';
      def.schema = structOf(context, node, used);
      if (min !== undefined || max !== undefined) {
        unsupported(context, 'A struct with minProperties or maxProperties');
      }
      return def;
    }
    const { additionalProperties: values } = node;
    if (values === undefined || values === true) return { type: 'json' };
    if (values === false) unsupported(context, 'An object with no properties');
    def.type = 'object';
    def.key = 'string';
    const names = take('propertyNames');
    if (names !== undefined) {
      if (isObject(names) && names.pattern === NUMBER_KEY) def.key = 'number';
      else unsupported(context, 'A "propertyNames" other than the number key pattern');
    }
    context.path.push('additionalProperties');
    def.value = convert(context, values);
    context.path.pop();
    if (min !== undefined || max !== undefined) def.length = { min, max };
    return def;
  }
  return def;
};

// The branches of an anyOf or oneOf: null among them makes the value
// nullable, one branch is that branch, more are a union (with OpenAPI's
// discriminator when the node has one).
const branches = (context, node, key, used) => {
  used.add(key);
  const list = node[key];
  const defs = [];
  let nullable = false;
  context.path.push(key);
  for (let index = 0; index < list.length; index += 1) {
    const branch = list[index];
    if (isObject(branch) && branch.type === 'null' && Object.keys(branch).length === 1) {
      nullable = true;
      continue;
    }
    context.path.push(index);
    defs.push(longOf(context, branch));
    context.path.pop();
  }
  context.path.pop();
  if (defs.length === 0) return { def: { type: 'null' }, nullable: false };
  if (defs.length === 1) return { def: defs[0], nullable };
  const def = { type: 'union', union: [] };
  for (const branch of defs) def.union.push(compactDef(branch, true));
  const { discriminator } = node;
  if (discriminator !== undefined) {
    used.add('discriminator');
    if (isObject(discriminator) && typeof discriminator.propertyName === 'string') {
      def.discriminator = discriminator.propertyName;
    } else unsupported(context, 'A discriminator without a propertyName');
  }
  return { def, nullable };
};

// A node of the document as a definition object `{ type, ... }`.
const nodeOf = (context, node, used) => {
  if (node.$ref !== undefined) {
    used.add('$ref');
    const def = reference(context, node);
    return typeof def === 'string' ? { type: def } : def;
  }
  if (Array.isArray(node.allOf)) {
    used.add('allOf');
    if (node.allOf.length !== 1) {
      unsupported(context, 'An "allOf" of several schemas');
      return { type: 'any' };
    }
    context.path.push('allOf', 0);
    const def = longOf(context, node.allOf[0]);
    context.path.splice(-2, 2);
    return def;
  }
  if (Array.isArray(node.anyOf) || Array.isArray(node.oneOf)) {
    const key = Array.isArray(node.anyOf) ? 'anyOf' : 'oneOf';
    const { def, nullable } = branches(context, node, key, used);
    if (nullable) def.nullable = true;
    return def;
  }
  if (node.enum !== undefined || node.const !== undefined) {
    used.add('enum');
    used.add('const');
    const values = node.enum === undefined ? [node.const] : node.enum;
    if (!Array.isArray(values)) {
      unsupported(context, 'An "enum" that is not a list');
      return { type: 'any' };
    }
    const def = { type: 'enum', enum: [] };
    for (const value of values) {
      if (value === null) def.nullable = true;
      else def.enum.push(value);
    }
    if (def.enum.length === 0) return { type: 'null' };
    return def;
  }
  used.add('type');
  let { type } = node;
  let nullable = false;
  if (Array.isArray(type)) {
    const rest = [];
    for (const name of type) if (name !== 'null') rest.push(name);
    nullable = rest.length !== type.length;
    for (const name of rest) {
      if (!KNOWN.has(name)) {
        unsupported(context, `The type ${JSON.stringify(name)}`);
        return { type: 'any' };
      }
    }
    if (rest.length === 2 && rest.includes('object') && rest.includes('array')) type = 'json';
    else if (rest.length === 1) type = rest[0];
    else if (rest.length === 0) type = 'null';
    else {
      const def = { type: 'union', union: [] };
      for (const name of rest) def.union.push(typed(context, node, name, used));
      if (nullable) def.nullable = true;
      return def;
    }
  }
  if (type === undefined) {
    if (isObject(node.properties)) type = 'object';
    else if (node.items !== undefined || node.prefixItems !== undefined) type = 'array';
    else if (
      node.pattern !== undefined ||
      node.minLength !== undefined ||
      node.maxLength !== undefined
    ) {
      type = 'string';
    } else if (node.minimum !== undefined || node.maximum !== undefined) type = 'number';
    else type = 'any';
  }
  if (!KNOWN.has(type)) {
    unsupported(context, `The type ${JSON.stringify(type)}`);
    return { type: 'any' };
  }
  const def = type === 'json' ? { type: 'json' } : typed(context, node, type, used);
  if (nullable) def.nullable = true;
  return def;
};

// A node as a definition in the long form `{ type, ... }`: the type and its
// rules, null as `nullable`, the annotations, and the keywords left over
// reported. Every nested node comes through here, so this is where the
// nesting is counted.
const longOf = (context, node) => {
  if (context.depth > MAX_DEPTH) {
    const where = pointerOf(context.path);
    const reason = `Nesting deeper than ${MAX_DEPTH} levels at "${where}"`;
    throw new SchemaDefinitionError('ERR_UNSUPPORTED_SCHEMA', reason);
  }
  if (node === true || (isObject(node) && Object.keys(node).length === 0)) return { type: 'any' };
  if (node === false) {
    unsupported(context, 'The schema false');
    return { type: 'any' };
  }
  if (!isObject(node)) {
    unsupported(context, `A schema that is ${JSON.stringify(node)}`);
    return { type: 'any' };
  }
  const used = new Set(ANNOTATIONS);
  used.add('example');
  context.depth += 1;
  const def = nodeOf(context, node, used);
  context.depth -= 1;
  for (const key of Object.keys(node)) {
    if (!used.has(key) && !IGNORED.has(key)) unsupported(context, `The keyword "${key}"`);
  }
  if (node.nullable === true) def.nullable = true;
  return annotate(def, node);
};

// A definition as a field holds it: a nested struct as its fields (unless
// its first key would read as something else), a type with no other key as
// its name, an optional field as `?name` or `required: false`; an optional
// field accepts null anyway, so `nullable` is dropped from it.
const compactDef = (def, required) => {
  if (def.nullable === true && !required) delete def.nullable;
  if (def.type === 'schema' && Object.keys(def).length === 2) {
    const { schema } = def;
    if (readsAsStruct(schema)) return required ? schema : { schema, required: false };
    return required ? { schema } : { schema, required: false };
  }
  return compact(def, required);
};

const convert = (context, node, required = true) => compactDef(longOf(context, node), required);

// The root: a struct with its kind, the unknown-keys policy
// (`additionalProperties: false` closes it, as the generator writes it) and
// its annotations as the metadata of the kind, or the definition of one type.
const fromJSONSchema = (document, options = {}) => {
  const context = createContext(document, options);
  if (!isObject(document) && document !== true) {
    throw invalidTarget('A JSON Schema document (an object) is expected');
  }
  const def = longOf(context, document);
  let definition;
  if (def.type === 'schema') {
    const { schema, type, nullable, ...rest } = def;
    const meta = document.additionalProperties === false ? rest : { unknown: 'ignore', ...rest };
    definition = { Struct: meta };
    for (const key of Object.keys(schema)) define(definition, key, schema[key]);
  } else definition = compact(def, true);
  return context.as === 'schema' ? new Schema(context.name, definition) : definition;
};

module.exports = { fromJSONSchema };
