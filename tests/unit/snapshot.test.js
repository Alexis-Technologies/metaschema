const { test } = require('node:test');
const assert = require('node:assert');

const { Schema, Model } = require('../../index.js');
const fixture = require('../fixtures/schemas/index.js');
const committed = require('../fixtures/snapshot.json');

const { database, types: customTypes, ...schemas } = fixture;

const fixtureModel = () =>
  new Model(
    {
      string: { metadata: { pg: 'varchar' } },
      datetime: { js: 'string', metadata: { pg: 'timestamp with time zone' } },
      ...customTypes,
    },
    Object.entries(schemas),
    database,
    { registry: 'isolated' },
  );

const json = (value) => JSON.parse(JSON.stringify(value));

test('Snapshot: the fixture model writes the committed snapshot', () => {
  const model = fixtureModel();
  assert.deepStrictEqual(json(model), committed);
  // The same text, not only the same values: the key order at every depth
  // is the contract (`require` keeps the order of the file).
  assert.strictEqual(JSON.stringify(json(model)), JSON.stringify(committed));
  assert.strictEqual(JSON.stringify(model), JSON.stringify(model.toJSON()));
  assert.deepStrictEqual(Object.keys(committed), ['format', 'database', 'types', 'entities']);
  assert.strictEqual(committed.format, 1);
  // The entities in dependency order, the types the entities use, sorted.
  assert.deepStrictEqual(Object.keys(committed.entities), [...model.order]);
  assert.deepStrictEqual(Object.keys(committed.types), ['datetime', 'string']);
  // Two builds of the same definitions give the same text.
  assert.strictEqual(JSON.stringify(fixtureModel()), JSON.stringify(model));
});

test('Snapshot: an entity carries its metadata, fields, indexes and relations', () => {
  const { Address, Account, Signin } = committed.entities;
  assert.deepStrictEqual(Object.keys(Address), [
    'kind',
    'scope',
    'store',
    'allow',
    'parent',
    'unknown',
    'custom',
    'fields',
    'indexes',
    'relations',
  ]);
  assert.deepStrictEqual(Address.indexes, {
    naturalKey: { unique: ['city', 'street', 'building'] },
  });
  assert.deepStrictEqual(Address.fields.addressId, { type: 'string', required: false });
  // A many field is a field, not an index.
  assert.deepStrictEqual(Account.indexes, {});
  assert.deepStrictEqual(Account.fields.addresses, {
    type: 'Address',
    required: true,
    many: 'Address',
  });
  assert.deepStrictEqual(Account.relations, [
    { to: 'Company', type: 'many-to-one' },
    { to: 'Address', type: 'one-to-many' },
  ]);
  assert.deepStrictEqual(Account.fields.fullName, {
    type: 'schema',
    required: true,
    schema: {
      given: { type: 'string', required: false },
      middle: { type: 'string', required: false },
      surname: { type: 'string', required: false },
    },
  });
  assert.strictEqual(Signin.kind, 'projection');
  assert.strictEqual(Signin.parent, 'Account');
  assert.deepStrictEqual(Signin.custom, { schema: 'Account', fields: ['login', 'password'] });
  assert.deepStrictEqual(Object.keys(Signin.fields), ['login', 'password']);
});

test('Snapshot: a field is written with a fixed key order, whatever the definition order', () => {
  const a = new Model({}, [['A', { Struct: {}, x: { type: 'string', unique: true, length: 8 } }]]);
  const b = new Model({}, [['A', { Struct: {}, x: { type: 'string', length: 8, unique: true } }]]);
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
  assert.deepStrictEqual(Object.keys(json(a).entities.A.fields.x), [
    'type',
    'required',
    'length',
    'unique',
  ]);
  // The fields keep their order: it is the order of the check.
  const c = new Model({}, [['A', { Struct: {}, b: 'string', a: 'string' }]]);
  assert.deepStrictEqual(Object.keys(json(c).entities.A.fields), ['b', 'a']);
});

test('Snapshot: every form of the language has a JSON form', () => {
  const model = new Model({}, [
    ['Tag', { Struct: {}, label: 'string' }],
    [
      'Doc',
      {
        Entity: { unknown: 'ignore', table: 'docs' },
        name: { type: 'string', length: { min: 1, max: 8 }, pattern: /^[a-z]+$/i, unicode: true },
        slug: { type: 'string', pattern: '^[a-z]+$', length: 8 },
        count: { type: 'integer', min: 0, max: 10 },
        big: { type: 'bigint', min: 1n, max: 10n },
        role: { enum: ['a', 'b'] },
        ids: { set: 'bigint' },
        byId: { map: { number: 'boolean' } },
        scores: { object: { string: 'number' } },
        point: [{ x: 'number' }, { 'y?': 'string' }],
        shape: { union: [{ Struct: {}, kind: { enum: ['a'] } }], discriminator: 'kind' },
        owner: { type: 'Tag', embed: false },
        tags: { many: 'Tag' },
        'note?': { type: 'string', nullable: true, aliases: ['comment'], deprecated: 'use text' },
        when: { type: 'date', default: () => new Date() },
        at: { type: 'date', default: new Date('2026-10-11T00:00:00.000Z') },
        inner: { a: 'string', validate: () => true, parse: (value) => value },
        ratio: (value) => value.count / 2,
        validate: () => true,
        serialize: (value) => value,
        byName: { index: ['name'] },
      },
    ],
  ]);
  const { Doc } = json(model).entities;
  assert.deepStrictEqual(Doc.custom, { table: 'docs' });
  assert.strictEqual(Doc.unknown, 'ignore');
  assert.deepStrictEqual(Doc.fields.name, {
    type: 'string',
    required: true,
    length: { min: 1, max: 8 },
    pattern: { source: '^[a-z]+$', flags: 'iu' },
    unicode: true,
  });
  assert.deepStrictEqual(Doc.fields.slug.pattern, '^[a-z]+$');
  assert.deepStrictEqual(Doc.fields.slug.length, { max: 8 });
  assert.deepStrictEqual(Doc.fields.big, {
    type: 'bigint',
    required: true,
    max: { $bigint: '10' },
    min: { $bigint: '1' },
  });
  assert.deepStrictEqual(Doc.fields.ids, {
    type: 'set',
    required: true,
    value: { type: 'bigint', required: true },
  });
  assert.deepStrictEqual(Doc.fields.byId, {
    type: 'map',
    required: true,
    key: 'number',
    value: { type: 'boolean', required: true },
  });
  assert.deepStrictEqual(Doc.fields.point, {
    type: 'tuple',
    required: true,
    value: [
      { type: 'number', required: true, name: 'x' },
      { type: 'string', required: false, name: 'y' },
    ],
  });
  assert.deepStrictEqual(Doc.fields.shape, {
    type: 'union',
    required: true,
    discriminator: 'kind',
    union: [
      {
        type: 'schema',
        required: true,
        schema: { kind: { type: 'enum', required: true, enum: ['a'] } },
      },
    ],
  });
  assert.deepStrictEqual(Doc.fields.owner, {
    type: 'Tag',
    required: true,
    embed: false,
    one: 'Tag',
  });
  assert.deepStrictEqual(Doc.fields.note, {
    type: 'string',
    required: false,
    aliases: ['comment'],
    deprecated: 'use text',
    nullable: true,
  });
  // A function is `{ $function: true }` wherever it stands; a Date is tagged.
  assert.deepStrictEqual(Doc.fields.when, {
    type: 'date',
    required: true,
    default: { $function: true },
  });
  assert.deepStrictEqual(Doc.fields.at.default, { $date: '2026-10-11T00:00:00.000Z' });
  assert.deepStrictEqual(Doc.fields.inner, {
    type: 'schema',
    required: true,
    parse: { $function: true },
    schema: {
      a: { type: 'string', required: true },
      validate: { $function: true },
      parse: { $function: true },
    },
    validate: { $function: true },
  });
  assert.deepStrictEqual(Doc.fields.ratio, { $function: true });
  // The functions of the schema itself are written among its fields.
  assert.deepStrictEqual(Doc.fields.validate, { $function: true });
  assert.deepStrictEqual(Doc.fields.serialize, { $function: true });
  assert.strictEqual(Doc.fields.byName, undefined);
  assert.deepStrictEqual(Doc.indexes, { byName: { index: ['name'] } });
  assert.deepStrictEqual(Doc.relations, [
    { to: 'Tag', type: 'many-to-one' },
    { to: 'Tag', type: 'one-to-many' },
  ]);
  assert.deepStrictEqual(json(model).types, {});
});

test('Snapshot: every tag of the format is written and read back', () => {
  const { fromJSON } = require('../../src/model/index.js');
  const factory = () => 'a';
  const model = new Model(
    {},
    [
      [
        'Tags',
        {
          Struct: {},
          a: { type: 'string', default: factory },
          b: { type: 'bigint', min: 10n },
          c: { type: 'date', default: new Date(0) },
          d: { type: 'string', pattern: /x/i },
          e: { type: 'string', pattern: /x/u },
        },
      ],
    ],
    null,
    { registry: 'isolated' },
  );
  // The tags, as snapshot.js writes them.
  const { fields } = json(model).entities.Tags;
  assert.deepStrictEqual(fields.a.default, { $function: true });
  assert.deepStrictEqual(fields.b.min, { $bigint: '10' });
  assert.deepStrictEqual(fields.c.default, { $date: '1970-01-01T00:00:00.000Z' });
  assert.deepStrictEqual(fields.d.pattern, { source: 'x', flags: 'iu' });
  assert.strictEqual(fields.e.pattern, 'x');
  // The values, as restore.js reads them back.
  const restored = fromJSON(json(model)).entities.get('Tags').fields;
  assert.strictEqual(typeof restored.a.default, 'function');
  assert.strictEqual(restored.b.min, 10n);
  assert.strictEqual(restored.c.default.getTime(), 0);
  assert.strictEqual(restored.d.pattern.flags, 'iu');
  assert.strictEqual(restored.e.pattern.flags, 'u');
});

test('Snapshot: a schema of one type, custom types and metadata', () => {
  const types = {
    number: { metadata: { pg: 'integer' } },
    money: { js: 'number', metadata: { pg: 'money' } },
    hex: { kind: 'scalar', rules: ['length'], construct() {}, checkType: () => null },
    unused: { js: 'string', metadata: { pg: 'text' } },
  };
  const model = new Model(
    types,
    [
      ['Id', 'string'],
      ['Wallet', { Struct: {}, total: 'money', color: { type: 'hex', length: 6 } }],
    ],
    null,
    { registry: 'isolated' },
  );
  const snapshot = json(model);
  assert.strictEqual(snapshot.database, null);
  assert.deepStrictEqual(snapshot.entities.Id, {
    kind: 'scalar',
    scope: 'local',
    store: 'memory',
    allow: 'write',
    parent: '',
    unknown: 'reject',
    custom: {},
    type: { type: 'string', required: true },
    indexes: {},
    relations: [],
  });
  // The types the entities use: an alias as its `js`, a type with a check of
  // its own as `check: true`, a built-in only with metadata, an unused one not.
  assert.deepStrictEqual(snapshot.types, {
    hex: { kind: 'scalar', check: true, metadata: {} },
    money: { js: 'number', metadata: { pg: 'money' } },
  });
  const withNumber = new Model(types, [['N', { Struct: {}, n: 'number' }]], null, {
    registry: 'isolated',
  });
  assert.deepStrictEqual(json(withNumber).types, { number: { metadata: { pg: 'integer' } } });
});

test('Snapshot: a Schema instance as a field and as an entity', () => {
  const name = Schema.from({ first: 'string', last: 'string' });
  const model = new Model({}, [
    ['Person', { Entity: {}, name, 'nick?': name }],
    ['Name', name],
  ]);
  const { Person, Name } = json(model).entities;
  assert.deepStrictEqual(Person.fields.name.schema, {
    first: { type: 'string', required: true },
    last: { type: 'string', required: true },
  });
  assert.strictEqual(Person.fields.nick.required, false);
  assert.deepStrictEqual(Object.keys(Name.fields), ['first', 'last']);
});

test('Snapshot: an index named __proto__ is written as a key', () => {
  const definition = JSON.parse('{"Entity":{},"a":"string","__proto__":{"index":["a"]}}');
  const model = new Model({}, [['A', definition]]);
  const { indexes } = model.toJSON().entities.A;
  assert.strictEqual(Object.hasOwn(indexes, '__proto__'), true);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(model)).entities.A.indexes, {
    ['__proto__']: { index: ['a'] },
  });
});
