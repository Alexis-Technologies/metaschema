const { test } = require('node:test');
const assert = require('node:assert');

const { Model } = require('../../index.js');

const database = {
  name: 'example',
  description: 'Example database schema',
  version: 3,
  driver: 'pg',
};

const types = {
  string: { metadata: { pg: 'varchar' } },
  number: { metadata: { pg: 'integer' } },
  boolean: { metadata: { pg: 'boolean' } },
  datetime: { js: 'string', metadata: { pg: 'timestamp with time zone' } },
  text: { js: 'string', metadata: { pg: 'text' } },
  customObject: { js: 'object', metadata: { pg: 'jsonb' } },
};

test('Model: from struct', () => {
  const entities = new Map();

  entities.set('Company', {
    Dictionary: { store: 'persistent', scope: 'application' },
    name: { type: 'string', unique: true },
    addresses: { many: 'Address' },
  });

  const model = new Model(types, entities, database);

  assert.deepStrictEqual(model.database, {
    name: 'example',
    description: 'Example database schema',
    version: 3,
    driver: 'pg',
  });

  const { string, number, boolean } = model.types;
  assert.strictEqual(string.metadata.pg, types.string.metadata.pg);
  assert.strictEqual(number.metadata.pg, types.number.metadata.pg);
  assert.strictEqual(boolean.metadata.pg, types.boolean.metadata.pg);

  const { datetime, text, customObject } = model.types;
  assert.strictEqual(datetime.metadata.pg, types.datetime.metadata.pg);
  assert.strictEqual(text.metadata.pg, types.text.metadata.pg);
  assert.strictEqual(customObject.metadata.pg, types.customObject.metadata.pg);

  assert.deepStrictEqual(model.order, new Set(['Company']));

  const company = model.entities.get('Company');

  assert.strictEqual(company.name, 'Company');
  assert.strictEqual(company.kind, 'dictionary');
  assert.strictEqual(company.store, 'persistent');
  assert.strictEqual(company.scope, 'application');

  const { name } = company.fields;
  assert.strictEqual(name.type, 'string');
  assert.strictEqual(name.required, true);
  assert.strictEqual(name.unique, true);

  const warn = model.warnings[0];
  assert.strictEqual(warn, 'Warning: "Address" referenced by "Company" is not found');
});

test('Model: many relation Schema for validation', () => {
  const entities = new Map();

  entities.set('Company', {
    Dictionary: {},
    name: { type: 'string', unique: true },
    addresses: { many: 'Address' },
  });

  entities.set('Address', {
    Entity: {},
    city: { type: 'string', unique: true },
  });

  const model = new Model(types, entities, database);

  const company = model.entities.get('Company');

  const obj = {
    name: 'Galeere',
    addresses: [{ city: 'Berlin' }, { city: 'Kiev' }],
  };

  const obj1 = { name: 'Leere' };
  assert.strictEqual(company.check(obj).valid, true);
  assert.strictEqual(company.check(obj1).valid, false);
});

test('Model: custom types with nested schema and relation', () => {
  const entities = new Map();
  entities.set('Identifier', { Entity: {}, creation: 'datetime' });
  entities.set('Tester', {
    Registry: {},
    access: {
      last: { type: 'datetime', default: 'now' },
      count: { type: 'number', default: 0 },
      identifiers: { many: 'Identifier' },
      id: { type: 'Identifier', required: false },
    },
  });
  const model = new Model(types, entities, database);
  const identifier = model.entities.get('Identifier');
  assert.strictEqual(identifier.check({ creation: Date.now().toLocaleString() }).valid, true);
  const tester = model.entities.get('Tester');
  assert.strictEqual(
    tester.check({
      access: {
        last: Date.now().toLocaleString(),
        count: 2,
        identifiers: [
          { creation: Date.now().toLocaleString() },
          { creation: Date.now().toLocaleString() },
        ],
        id: { creation: Date.now().toLocaleString() },
      },
    }).valid,
    true,
  );
  assert.strictEqual(
    tester.check({
      access: {
        last: Date.now().toLocaleString(),
        count: 2,
      },
    }).valid,
    false,
  );
});

test('Model: custom type correct name using js type', () => {
  const entities = new Map();
  entities.set('CustomSchema', {
    Struct: {},

    data: { customObject: { string: 'string' } },
  });
  const model = new Model(types, entities, database);
  const schema = model.entities.get('CustomSchema');
  assert.strictEqual(schema.fields.data.type, 'customObject');
  assert.strictEqual(schema.check({ data: { a: 'b' } }).valid, true);
});

const systemTypes = {
  string: { metadata: { pg: 'varchar' } },
  number: { metadata: { pg: 'integer' } },
  boolean: { metadata: { pg: 'boolean' } },
  datetime: { js: 'string', metadata: { pg: 'timestamp with time zone' } },
  text: { js: 'string', metadata: { pg: 'text' } },
  json: { js: 'schema', metadata: { pg: 'jsonb' } },
};

test('Model: from fixture schemas, projection', () => {
  const fixture = require('../fixtures/schemas/index.js');
  const { database, types: customTypes, ...schemas } = fixture;
  const types = Object.assign(Object.create(null), systemTypes, customTypes);
  const model = new Model(types, new Map(Object.entries(schemas)), database);
  assert.strictEqual(model.entities.size, 6);
  const Account = model.entities.get('Account');
  assert.strictEqual(Account.fields.fullName.constructor.type, 'schema');
  assert.strictEqual(model.order.size, 6);
  assert.strictEqual(typeof model.types, 'object');
  assert.strictEqual(typeof model.database, 'object');
  const Projection = model.entities.get('Signin');
  assert.strictEqual(Projection.fields.login.type, Account.fields.login.type);
  assert.strictEqual(Projection.fields.login.required, Account.fields.login.required);
  assert.strictEqual(Projection.fields.login.unique, Account.fields.login.unique);
  assert.strictEqual(Projection.fields.password.type, Account.fields.password.type);
  assert.strictEqual(Projection.fields.password.required, Account.fields.password.required);
  const EarlyProjection = model.entities.get('Aaa');
  assert.strictEqual(Projection.fields.login.type, EarlyProjection.fields.login.type);
  assert.strictEqual(Projection.fields.login.required, EarlyProjection.fields.login.required);
  assert.strictEqual(Projection.fields.login.unique, EarlyProjection.fields.login.unique);
  assert.strictEqual(Projection.fields.password.type, EarlyProjection.fields.password.type);
  assert.strictEqual(Projection.fields.password.required, EarlyProjection.fields.password.required);
});

test('Model: an alias of the schema type needs a schema definition', () => {
  const types = { address: { js: 'schema', metadata: { pg: 'jsonb' } } };
  const message = `Type "address" needs a schema definition: { type: 'address', schema: { ... } }`;
  for (const field of [
    'address',
    '?address',
    { address: { city: 'string' } },
    { array: 'address' },
  ]) {
    const entities = new Map([['Order', { Struct: {}, delivery: field }]]);
    assert.throws(() => new Model(types, entities), {
      name: 'SchemaDefinitionError',
      code: 'ERR_MISSING_SCHEMA',
      schema: 'Order',
      field: 'delivery',
      message: `${message} in "Order.delivery"`,
    });
  }
  const entities = new Map([
    ['Order', { Struct: {}, delivery: { type: 'address', schema: { city: 'string' } } }],
  ]);
  const order = new Model(types, entities).entities.get('Order');
  assert.deepStrictEqual(order.check({ delivery: { city: 1 } }).errors, [
    'Field "Order.delivery.city" not of expected type: string',
  ]);
});

test('Model: a two-entity cycle is a warning, not a crash', () => {
  const entities = new Map([
    ['A', { Entity: {}, b: 'B' }],
    ['B', { Entity: {}, a: 'A' }],
  ]);
  const model = new Model({}, entities);
  assert.deepStrictEqual([...model.order], ['B', 'A']);
  assert.deepStrictEqual(model.warnings, ['Recursive dependency: B.A']);
});

test('Model: a cycle that does not pass through the first entity is a warning', () => {
  const definitions = {
    A: { Entity: {}, b: 'B' },
    B: { Entity: {}, c: 'C' },
    C: { Entity: {}, b: 'B' },
  };
  for (const names of [
    ['A', 'B', 'C'],
    ['B', 'C', 'A'],
    ['C', 'A', 'B'],
  ]) {
    const entities = names.map((name) => [name, definitions[name]]);
    const model = new Model({}, entities);
    const order = [...model.order];
    assert.deepStrictEqual([...order].sort(), ['A', 'B', 'C'], names.join());
    // A -> B is not part of the cycle, so A always comes after B. Which edge of
    // the B <-> C cycle is reported depends on where the walk entered it.
    assert.ok(order.indexOf('A') > order.indexOf('B'), names.join());
    assert.strictEqual(model.warnings.length, 1, names.join());
    assert.match(model.warnings[0], /^Recursive dependency: (C\.B|B\.C)$/, names.join());
  }
});

test('Model: a self-reference is neither a cycle nor a warning', () => {
  const entities = new Map([['Category', { Entity: {}, parent: '?Category' }]]);
  const model = new Model({}, entities);
  assert.deepStrictEqual([...model.order], ['Category']);
  assert.deepStrictEqual(model.warnings, []);
});

test('Model: Identifier comes first, dependencies before dependents', () => {
  const entities = new Map([
    ['Order', { Entity: {}, buyer: 'Customer', id: 'Identifier' }],
    ['Customer', { Entity: {}, name: 'string' }],
    ['Identifier', { Entity: {}, value: 'string' }],
  ]);
  const model = new Model({}, entities);
  assert.deepStrictEqual([...model.order], ['Identifier', 'Customer', 'Order']);
  assert.deepStrictEqual(model.warnings, []);
});
