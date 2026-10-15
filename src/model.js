const { firstKey, isFirstLower } = require('./metautil.js');

const { BRAND, INSPECT, CYCLES } = require('./util.js');
const { Schema } = require('./schema.js');
const { TYPES, createRegistry, typeFactory } = require('./types.js');
const { SchemaDefinitionError, noValidation } = require('./errors.js');
const { snapshotOf, orderOf } = require('./snapshot.js');

const invalidOption = (name, expected, value) => {
  const reason = `Model option "${name}" must be ${expected}, got ${JSON.stringify(value)}`;
  return new SchemaDefinitionError('ERR_INVALID_OPTIONS', reason);
};

const registryFor = (options) => {
  const { registry = 'shared' } = options;
  if (registry !== 'shared' && registry !== 'isolated') {
    throw invalidOption('registry', '"shared" or "isolated"', registry);
  }
  return registry === 'isolated' ? createRegistry() : TYPES;
};

// The converters of coercion the model gives for its own type names, read
// by the `./coerce` subpath before the process-wide table for the fields
// of its entities (and of a schema that attaches the model): what an
// isolated registry is to the types. Frozen, with no prototype.
const coercionsFor = (options) => {
  const { coercions = null } = options;
  if (coercions === null) return null;
  const expected = 'an object of functions by type name';
  if (typeof coercions !== 'object' || Array.isArray(coercions)) {
    throw invalidOption('coercions', expected, coercions);
  }
  const table = Object.create(null);
  for (const name of Object.keys(coercions)) {
    if (!isFirstLower(name) || typeof coercions[name] !== 'function') {
      throw invalidOption('coercions', expected, name);
    }
    table[name] = coercions[name];
  }
  return Object.freeze(table);
};

class Model {
  constructor(types, entities, database = null, options = {}) {
    this.types = typeFactory(types, registryFor(options));
    this.coercions = coercionsFor(options);
    this.entities = new Map();
    this.database = database;
    this.order = new Set();
    this[CYCLES] = [];
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

  // The model as plain JSON: `{ format, database, types, entities }`, the
  // entities in dependency order with their metadata, fields, indexes and
  // relations, and the types they use. What JSON.stringify(model) writes.
  toJSON() {
    return snapshotOf(this);
  }

  [INSPECT](depth, options, inspect) {
    return `Model ${inspect(this.toJSON(), options)}`;
  }

  // Depth-first ordering (`orderOf`): an entity after everything it
  // references among the entities, `Identifier` first; a reference back into
  // the path of the walk is a cycle of any length, recorded.
  #preprocess() {
    const { entities, order } = this;
    if (entities.has('Identifier')) order.add('Identifier');
    const starts = [];
    for (const pair of entities) if (!pair[0].startsWith('.')) starts.push(pair);
    const edgesOf = (entity) => {
      const edges = [];
      for (const ref of entity.references) {
        const target = entities.get(ref);
        if (target !== undefined) edges.push([ref, target]);
      }
      return edges;
    };
    orderOf(starts, edgesOf, (name, ref) => this[CYCLES].push([name, ref]), order);
  }
}

// The warnings of a model are the validation half's, as a schema's are.
Object.defineProperty(Model.prototype, 'warnings', {
  get() {
    throw noValidation('warnings');
  },
  configurable: true,
});

Model.prototype[BRAND] = 'Model';

module.exports = { Model };
