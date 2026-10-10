// The TypeScript generator of the `./generators` subpath: an interface per
// struct (a type alias for a schema of one type), the description of a
// field as JSDoc and, when asked, a type of its own for every enum and
// nested struct.
const { isFirstUpper } = require('../metautil.js');
const { hasBrand } = require('../util.js');
const { embeds } = require('../prototypes/reference.js');

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

const capitalize = (key) => key.charAt(0).toUpperCase() + key.slice(1);

// Whether a reference field renders as its id (`companyId: string`) or as
// the referenced type (`company: Company`): the same rule as `check`, with
// a target that cannot be resolved taken as stored.
const asId = (def) => {
  const target = def.root.findReference(def.type);
  if (target === null) return def.embed !== true;
  return !embeds(target, def.embed, 'kind');
};

// The rendering of one dts: whether a nested struct and an enum get a type
// of their own (`interface AccountFullName`, `type IdentifierStorage`), and
// the blocks rendered so far, a named type before the one that uses it.
const tsNamed = (ts, name, block) => {
  ts.blocks.push(block);
  return name;
};

const tsStruct = (fields, ts, name) => `{ ${tsFields(fields, ts, name).join('; ')} }`;

const tsObject = (fields, ts, name) =>
  hasBrand(fields, 'Struct') ? tsStruct(fields, ts, name) : tsType(fields, ts, name);

// The referenced type: its interface by name, inline when it has none, the
// name of the reference when it cannot be resolved.
const tsReference = (def, ts, name) => {
  const target = def.root.findReference(def.type);
  if (target === null || target.name) return def.type;
  return tsObject(target.fields, ts, name);
};

// The TypeScript type of a field. A reference to a stored kind is held as
// an id, so it renders as a string (an array of them for `many`), a
// reference to a memory kind as the type itself; a custom scalar with its
// own check has no known shape and renders as a string. `name` is the name
// the type gets when the rendering names nested types.
const tsType = (def, ts, name) => {
  const type = tsBase(def, ts, name);
  return def.nullable === true ? `${type} | null` : type;
};

const tsBase = (def, ts, name) => {
  if (isFirstUpper(def.type)) {
    const element = asId(def) ? 'string' : tsReference(def, ts, name);
    return def.many ? listOf(element) : element;
  }
  if (def.enum) {
    const values = def.enum.map((value) => JSON.stringify(value)).join(' | ');
    return ts.named ? tsNamed(ts, name, `type ${name} = ${values};`) : values;
  }
  if (def.union) {
    return def.union.map((branch, index) => tsType(branch, ts, `${name}${index}`)).join(' | ');
  }
  if (def.scalar) return TS_SCALARS[def.scalar] || 'string';
  if (def.schema) {
    const named = ts.named && hasBrand(def.schema, 'Struct');
    if (named) return tsNamed(ts, name, tsInterface(name, def.schema, ts));
    return tsObject(def.schema, ts, name);
  }
  if (Array.isArray(def.value)) {
    const elements = def.value.map((element, index) => tsType(element, ts, `${name}${index}`));
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
  const name = isFirstUpper(def.type) && asId(def) ? `${key}Id` : key;
  return `${name}${optional}: ${tsType(def, ts, `${prefix}${capitalize(key)}`)}`;
};

const tsFields = (fields, ts, prefix) => {
  const lines = [];
  for (const pair of Object.entries(fields)) {
    const def = pair[1];
    if (!hasBrand(def, 'Type')) continue;
    lines.push(tsField(pair[0], def, ts, prefix));
  }
  return lines;
};

// The JSDoc of a field: its description, and `@deprecated` when it says so.
const tsDoc = (def) => {
  const { description, deprecated } = def;
  if (deprecated !== true) return description === undefined ? [] : [`/** ${description} */`];
  if (description === undefined) return ['/** @deprecated */'];
  return ['/**', ` * ${description}`, ' * @deprecated', ' */'];
};

const tsInterface = (name, fields, ts) => {
  const lines = [`interface ${name} {`];
  for (const pair of Object.entries(fields)) {
    const def = pair[1];
    if (!hasBrand(def, 'Type')) continue;
    for (const line of tsDoc(def)) lines.push(`  ${line}`);
    lines.push(`  ${tsField(pair[0], def, ts, name)};`);
  }
  lines.push('}');
  return lines.join('\n');
};

// The schema as a TypeScript interface (a type alias for a schema of one
// type), with the description of a field as JSDoc. With `{ named: true }`
// a nested struct and an enum get a type of their own, named after the
// entity and the field, rendered before the interface.
const toInterface = (schema, options = {}) => {
  const { name, fields } = schema;
  const ts = { named: options.named === true, blocks: [] };
  const struct = hasBrand(fields, 'Struct');
  ts.blocks.push(
    struct ? tsInterface(name, fields, ts) : `type ${name} = ${tsType(fields, ts, name)};`,
  );
  return ts.blocks.join('\n\n');
};

// Every entity of a model as an interface, in dependency order.
const modelToTypeScript = (model, options) => {
  const { entities, order } = model;
  const dts = [];
  for (const name of order) dts.push(toInterface(entities.get(name), options));
  return `${dts.join('\n\n')}\n`;
};

module.exports = { toInterface, modelToTypeScript };
