// The TypeScript generator of the `./generators` subpath: an interface per
// struct (a type alias for a schema of one type), the description of a
// field as JSDoc and, when asked, a type of its own for every enum and
// nested struct.
const { isFirstUpper } = require('../metautil.js');
const { hasBrand, IDENTIFIER } = require('../util.js');
const { SchemaDefinitionError } = require('../errors.js');
const { embeds } = require('../prototypes/reference.js');

const TS_SCALARS = Object.assign(Object.create(null), {
  string: 'string',
  number: 'number',
  boolean: 'boolean',
  bigint: 'bigint',
  date: 'Date',
  bytes: 'Uint8Array',
  null: 'null',
  any: 'any',
  unknown: 'unknown',
});

const unrepresentable = (what) =>
  new SchemaDefinitionError('ERR_UNREPRESENTABLE', `${what} cannot be represented in TypeScript`);

// The name of an interface or a type is an identifier; a declaration has no
// place for anything else.
const identifier = (name, what) => {
  if (!IDENTIFIER.test(name)) throw unrepresentable(`${what} "${name}" (not an identifier)`);
  return name;
};

// A key of an interface: bare when it is an identifier, quoted otherwise.
const tsKey = (key) => (IDENTIFIER.test(key) ? key : JSON.stringify(key));

// The literal type of an enum value; a value with no literal form (NaN, a
// symbol, an object) is its type.
const tsLiteral = (value) => {
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'number':
      return Number.isFinite(value) ? String(value) : 'number';
    case 'bigint':
      return `${value}n`;
    case 'boolean':
      return String(value);
    case 'undefined':
      return 'undefined';
    default:
      return value === null ? 'null' : 'unknown';
  }
};

const listOf = (element) => (element.includes(' | ') ? `(${element})[]` : `${element}[]`);

// The name of a nested type: the prefix and the key, capitalized, with what
// is not an identifier character replaced.
const typeName = (prefix, key) => {
  const clean = key.replace(/[^\w$]+/g, '_');
  return `${prefix}${clean.charAt(0).toUpperCase()}${clean.slice(1)}`;
};

// Whether a reference field renders as its id (`companyId: string`) or as
// the referenced type (`company: Company`): the same rule as `check`, with
// a target that cannot be resolved taken as stored.
const asId = (def, target) => {
  if (target === null) return def.embed !== true;
  return !embeds(target, def.embed, 'kind');
};

// The rendering of one dts: whether a nested struct and an enum get a type
// of their own, the names given so far (no two types share one), and the
// blocks rendered, a named type before the one that uses it.
const uniqueName = (ts, name) => {
  let unique = name;
  for (let n = 2; ts.names.has(unique); n += 1) unique = `${name}${n}`;
  ts.names.add(unique);
  return unique;
};

const tsStruct = (fields, ts, name) => `{ ${tsFields(fields, ts, name).join('; ')} }`;

const tsObject = (fields, ts, name) =>
  hasBrand(fields, 'Struct') ? tsStruct(fields, ts, name) : tsType(fields, ts, name);

// The referenced type: its interface by name, inline when it has none, the
// name of the reference when it cannot be resolved.
const tsReference = (def, target, ts, name) => {
  if (target === null || target.name) return identifier(def.type, 'Reference');
  return tsObject(target.fields, ts, name);
};

// The TypeScript type of a field. A reference to a stored kind is held as
// an id, so it renders as a string (an array of them for `many`), a
// reference to a memory kind as the type itself; a custom scalar with its
// own check has no known shape and renders as a string. `name` is the name
// the type gets when the rendering names nested types; `target` is the
// referenced entity when the caller resolved it already; `top` says the
// node is the root of a schema of one type, whose alias is its name already.
const tsType = (def, ts, name, target, top = false) => {
  const type = tsBase(def, ts, name, target, top);
  return def.nullable === true ? `${type} | null` : type;
};

const tsBase = (def, ts, name, target, top) => {
  if (isFirstUpper(def.type)) {
    const resolved = target === undefined ? def.root.findReference(def.type) : target;
    const element = asId(def, resolved) ? 'string' : tsReference(def, resolved, ts, name);
    return def.many ? listOf(element) : element;
  }
  if (def.enum) {
    const values = [];
    for (let index = 0; index < def.enum.length; index += 1) {
      values.push(tsLiteral(def.enum[index]));
    }
    const text = values.join(' | ');
    if (!ts.named || top) return text;
    const named = uniqueName(ts, name);
    ts.blocks.push(`type ${named} = ${text};`);
    return named;
  }
  if (def.flags) {
    const names = [];
    for (let index = 0; index < def.flags.length; index += 1) {
      names.push(`${tsKey(def.flags[index])}?: boolean`);
    }
    return `{ ${names.join('; ')} }`;
  }
  if (def.union) {
    const branches = [];
    for (let index = 0; index < def.union.length; index += 1) {
      branches.push(tsType(def.union[index], ts, `${name}${index}`));
    }
    return branches.join(' | ');
  }
  if (def.scalar) return TS_SCALARS[def.scalar] || 'string';
  if (def.schema) {
    if (ts.named && !top && hasBrand(def.schema, 'Struct')) {
      const named = uniqueName(ts, name);
      ts.blocks.push(tsInterface(named, def.schema, ts));
      return named;
    }
    return tsObject(def.schema, ts, name);
  }
  if (Array.isArray(def.value)) {
    const elements = [];
    for (let index = 0; index < def.value.length; index += 1) {
      elements.push(tsType(def.value[index], ts, `${name}${index}`));
    }
    return `[${elements.join(', ')}]`;
  }
  if (def.key !== undefined && def.value) {
    const entries = `${def.key}, ${tsType(def.value, ts, name)}`;
    return def.isInstance({}) ? `Record<${entries}>` : `Map<${entries}>`;
  }
  if (def.value) {
    const element = tsType(def.value, ts, name);
    return def.isInstance([]) ? listOf(element) : `Set<${element}>`;
  }
  if (def.kind === 'struct') return 'unknown';
  return 'string';
};

const tsField = (key, def, ts, prefix) => {
  const optional = def.required ? '' : '?';
  const reference = isFirstUpper(def.type);
  const target = reference ? def.root.findReference(def.type) : undefined;
  const name = reference && asId(def, target) ? `${key}Id` : key;
  return `${tsKey(name)}${optional}: ${tsType(def, ts, typeName(prefix, key), target)}`;
};

// The validated fields of a struct, in order: a struct is a null-prototype
// dictionary, so its keys are its own.
const tsFields = (fields, ts, prefix) => {
  const lines = [];
  for (const key in fields) {
    const def = fields[key];
    if (!hasBrand(def, 'Type')) continue;
    lines.push(tsField(key, def, ts, prefix));
  }
  return lines;
};

// Text inside a comment: `*/` would close it.
const tsComment = (text) => String(text).replace(/\*\//g, '*\\/');

// The JSDoc of a field: its description, line by line, and `@deprecated`
// (with the note when the field gives one) when it says so.
const tsDoc = (def) => {
  const { description, deprecated } = def;
  const lines = description === undefined ? [] : tsComment(description).split('\n');
  if (deprecated === true) lines.push('@deprecated');
  else if (typeof deprecated === 'string') lines.push(`@deprecated ${tsComment(deprecated)}`);
  if (lines.length === 0) return lines;
  if (lines.length === 1) return [`/** ${lines[0]} */`];
  const block = ['/**'];
  for (let index = 0; index < lines.length; index += 1) block.push(` * ${lines[index]}`);
  block.push(' */');
  return block;
};

const tsInterface = (name, fields, ts) => {
  const lines = [`interface ${name} {`];
  for (const key in fields) {
    const def = fields[key];
    if (!hasBrand(def, 'Type')) continue;
    const doc = tsDoc(def);
    for (let index = 0; index < doc.length; index += 1) lines.push(`  ${doc[index]}`);
    lines.push(`  ${tsField(key, def, ts, name)};`);
  }
  lines.push('}');
  return lines.join('\n');
};

// The schema as a TypeScript interface (a type alias for a schema of one
// type), with the description of a field as JSDoc. With `{ named: true }`
// a nested struct and an enum get a type of their own, named after the
// entity and the field, rendered before the interface that uses them.
// `names` holds the names given so far when several schemas share one
// rendering (a model), so that a nested type never takes an entity's name.
const toInterface = (schema, options = {}, names = new Set()) => {
  const { name, fields } = schema;
  if (name !== '') identifier(name, 'Entity name');
  names.add(name);
  const ts = { named: options.named === true, names, blocks: [] };
  const struct = hasBrand(fields, 'Struct');
  ts.blocks.push(
    struct
      ? tsInterface(name, fields, ts)
      : `type ${name} = ${tsType(fields, ts, name, undefined, true)};`,
  );
  return ts.blocks.join('\n\n');
};

// Every entity of a model as an interface, in dependency order.
const modelToTypeScript = (model, options) => {
  const { entities, order } = model;
  const names = new Set();
  for (const name of order) names.add(name);
  const dts = [];
  for (const name of order) dts.push(toInterface(entities.get(name), options, names));
  return `${dts.join('\n\n')}\n`;
};

module.exports = { toInterface, modelToTypeScript };
