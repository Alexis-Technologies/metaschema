const { firstKey } = require('./metautil.js');

const { Schema } = require('./schema.js');
const { TYPES, createRegistry, typeFactory } = require('./types.js');
const { SchemaDefinitionError } = require('./errors.js');
const { warning } = require('./lint.js');
const { modelToJSONSchema } = require('./jsonschema.js');

const REGISTRIES = ['shared', 'isolated'];

const registryFor = (options) => {
  const { registry = 'shared' } = options;
  if (!REGISTRIES.includes(registry)) {
    const reason = `Model option "registry" must be "shared" or "isolated", got ${JSON.stringify(registry)}`;
    throw new SchemaDefinitionError('ERR_INVALID_OPTIONS', reason);
  }
  return registry === 'isolated' ? createRegistry() : TYPES;
};

class Model {
  // The model's own warnings (the cycles met while ordering), found while
  // building; the rest comes from the entities on first use.
  #cycles = [];
  #warnings = null;

  constructor(types, entities, database = null, options = {}) {
    this.types = typeFactory(types, registryFor(options));
    this.entities = new Map();
    this.database = database;
    this.order = new Set();
    const projections = [];
    for (const pair of entities) {
      const name = pair[0];
      const entity = pair[1];
      const first = firstKey(entity);
      const isProjection = first === 'Projection';
      if (isProjection) {
        projections.push({ name, entity });
        continue;
      }
      const schema = new Schema(name, entity, [this]);
      this.entities.set(name, schema);
    }
    for (const projection of projections) {
      const { name, entity } = projection;
      const schema = new Schema(name, entity, [this]);
      this.entities.set(name, schema);
    }
    this.#preprocess();
  }

  // The lint warnings of every entity, the references and types they cannot
  // resolve, and the recursive dependencies, as `Warning [code]: text`.
  get warnings() {
    if (this.#warnings !== null) return this.#warnings;
    const warnings = [];
    for (const pair of this.entities) {
      const name = pair[0];
      const entity = pair[1];
      if (name.startsWith('.')) continue;
      warnings.push(...entity.warnings, ...entity.checkConsistency());
    }
    warnings.push(...this.#cycles);
    this.#warnings = warnings;
    return warnings;
  }

  #preprocess() {
    const { entities, order } = this;
    if (entities.has('Identifier')) order.add('Identifier');
    for (const name of entities.keys()) {
      const isMeta = name.startsWith('.');
      if (!isMeta) this.#reorderEntity(name, new Set());
    }
  }

  // Depth-first ordering: an entity is added after everything it references.
  // `visiting` holds the current path, so a reference back into it is a cycle
  // of any length, not only one through the entity the walk started from.
  #reorderEntity(name, visiting) {
    const entity = this.entities.get(name);
    if (!entity || this.order.has(name)) return;
    visiting.add(name);
    for (const ref of entity.references) {
      if (ref === name) continue;
      if (visiting.has(ref)) {
        this.#cycles.push(
          warning('recursive-reference', `"${name}" depends on "${ref}" recursively`),
        );
        continue;
      }
      this.#reorderEntity(ref, visiting);
    }
    visiting.delete(name);
    this.order.add(name);
  }

  // Every entity as a JSON Schema definition, or the document of the entity
  // `options.root`; see src/jsonschema.js.
  toJSONSchema(options) {
    return modelToJSONSchema(this, options);
  }

  // Every entity as a TypeScript interface, in dependency order; `options`
  // are those of `schema.toInterface` (`named`).
  toTypeScript(options) {
    const { entities, order } = this;
    const dts = [];
    for (const name of order) {
      const schema = entities.get(name);
      dts.push(schema.toInterface(options));
    }
    return `${dts.join('\n\n')}\n`;
  }

  get dts() {
    return this.toTypeScript();
  }
}

module.exports = { Model };
