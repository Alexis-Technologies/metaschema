const { toLowerCamel } = require('./metautil.js');
const { SchemaDefinitionError } = require('./errors.js');

const projectionError = (name, reason) =>
  new SchemaDefinitionError('ERR_PROJECTION', `Projection "${name}" ${reason}`);

const KIND_ENT = ['entity', 'registry', 'dictionary'];
const KIND_AUX = ['journal', 'details', 'relation', 'view'];
const KIND_STORED = [...KIND_ENT, ...KIND_AUX];
const KIND_MEMORY = ['struct', 'scalar', 'form', 'projection'];
const KIND = [...KIND_MEMORY, ...KIND_STORED];

const SCOPE = ['application', 'global', 'local'];
const STORE = ['persistent', 'memory'];
const ALLOW = ['write', 'append', 'read'];

const projection = (kind, meta, root) => {
  const { scope = 'local', store = 'memory', allow = 'write' } = meta;
  const { schema, fields } = meta;
  if (typeof schema !== 'string' || !Array.isArray(fields)) {
    throw projectionError(root.name, 'needs { schema, fields }');
  }
  const parent = schema;
  const metadata = { ...meta, kind, scope, store, allow, parent };
  // The projection itself is not built yet, so its own name is no parent.
  const entity = root.findReference(schema);
  if (!entity || entity === root) {
    throw projectionError(root.name, `parent "${schema}" is not found`);
  }
  const defs = Object.create(null);
  for (const key of fields) {
    const field = entity.fields[key];
    if (!field) throw projectionError(root.name, `field "${key}" is not in "${schema}"`);
    defs[key] = field;
  }
  return { defs, metadata };
};

// The key of the id field a stored kind adds: named after the entity
// (`orderId`), `id` for an anonymous schema.
const idKeyOf = (name) => (name ? `${toLowerCamel(name)}Id` : 'id');

// The id field of a built schema: the key above for a stored kind, null for
// a memory kind. The one rule, read by the derive, mongodb and generators
// subpaths (which each add what `_id` means to them).
const idFieldOf = (schema) => (KIND_STORED.includes(schema.kind) ? idKeyOf(schema.name) : null);

// The metadata of a kind over the defaults of its scope and store; a stored
// kind adds the optional id field named after the entity.
const kindOf = (defaultScope, defaultStore, stored) => (kind, meta, root) => {
  const { scope = defaultScope, store = defaultStore, allow = 'write' } = meta;
  const defs = Object.create(null);
  if (stored) defs[idKeyOf(root.name)] = '?string';
  return { defs, metadata: { ...meta, kind, scope, store, allow } };
};

const kindStored = kindOf('application', 'persistent', true);

const kindMemory = kindOf('local', 'memory', false);

const KIND_METADATA = Object.create(null);
for (const kind of KIND_MEMORY) {
  KIND_METADATA[kind] = kindMemory;
}
for (const kind of KIND_STORED) {
  KIND_METADATA[kind] = kindStored;
}
KIND_METADATA.projection = projection;

const getKindMetadata = (kind, meta = {}, root) => {
  const handler = KIND_METADATA[kind] || kindMemory;
  return handler(kind, meta, root);
};

const constants = { KIND, KIND_STORED, KIND_MEMORY, SCOPE, STORE, ALLOW };

module.exports = { constants, getKindMetadata, idFieldOf };
