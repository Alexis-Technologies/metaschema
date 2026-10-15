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
          f: { type: 'bytes', default: new Uint8Array([1, 2, 255]), examples: [Buffer.from('A')] },
          g: { set: 'string', default: new Set(['a', 'b']) },
          h: { map: { string: 'date' }, default: new Map([['x', new Date(0)]]) },
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
  assert.deepStrictEqual(fields.f.default, { $bytes: 'AQL/' });
  assert.deepStrictEqual(fields.f.examples, [{ $bytes: 'QQ==' }]);
  assert.deepStrictEqual(fields.g.default, { $set: ['a', 'b'] });
  assert.deepStrictEqual(fields.h.default, {
    $map: [['x', { $date: '1970-01-01T00:00:00.000Z' }]],
  });
  // The values, as restore.js reads them back.
  const restored = fromJSON(json(model)).entities.get('Tags').fields;
  assert.strictEqual(typeof restored.a.default, 'function');
  assert.strictEqual(restored.b.min, 10n);
  assert.strictEqual(restored.c.default.getTime(), 0);
  assert.strictEqual(restored.d.pattern.flags, 'iu');
  assert.strictEqual(restored.e.pattern.flags, 'u');
  assert.deepStrictEqual(restored.f.default, new Uint8Array([1, 2, 255]));
  assert.deepStrictEqual(restored.f.examples, [new Uint8Array([65])]);
  assert.deepStrictEqual(restored.g.default, new Set(['a', 'b']));
  assert.deepStrictEqual(restored.h.default, new Map([['x', new Date(0)]]));
  // The defaults restored are values of their fields again (the factory of
  // `a` is a placeholder that gives nothing).
  const restoredModel = fromJSON(json(model));
  const parsed = restoredModel.entities.get('Tags').parse({ a: 'a', b: 10n, d: 'x', e: 'x' });
  assert.deepStrictEqual(parsed.issues, []);
  assert.strictEqual(JSON.stringify(restoredModel), JSON.stringify(model));
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
  // An alias of an alias brings the type it names, which restoring needs.
  const { fromJSON } = require('../../src/model/index.js');
  const chain = new Model(
    { ...types, cents: { js: 'money' } },
    [['C', { Struct: {}, c: 'cents' }]],
    null,
    { registry: 'isolated' },
  );
  assert.deepStrictEqual(json(chain).types, {
    cents: { js: 'money', metadata: {} },
    money: { js: 'number', metadata: { pg: 'money' } },
  });
  const restored = fromJSON(json(chain)).entities.get('C');
  assert.strictEqual(restored.check({ c: 1 }).valid, true);
  assert.strictEqual(restored.check({ c: '1' }).valid, false);
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

test('Snapshot: a schema writes itself and the entities it reaches, its name as root', () => {
  const { fromJSON } = require('../../src/model/index.js');
  const model = fixtureModel();
  const full = json(model);
  for (const name of model.order) {
    const schema = model.entities.get(name);
    const snapshot = json(schema.toSnapshot());
    assert.deepStrictEqual(Object.keys(snapshot), [
      'format',
      'root',
      'database',
      'types',
      'entities',
    ]);
    assert.strictEqual(snapshot.format, 1);
    assert.strictEqual(snapshot.root, name);
    assert.strictEqual(snapshot.database, null);
    // Every entity as the model writes it, each after the ones it
    // references (a cycle cut where it closes), the schema last.
    const names = Object.keys(snapshot.entities);
    assert.strictEqual(names.at(-1), name);
    for (const entity of names) {
      assert.deepStrictEqual(snapshot.entities[entity], full.entities[entity]);
      for (const ref of model.entities.get(entity).references) {
        const after = names.indexOf(ref) > names.indexOf(entity);
        const cycle = model.entities.get(ref)?.references.has(entity);
        if (after && ref !== 'Identifier') assert.strictEqual(cycle, true, `${entity} → ${ref}`);
      }
    }
    for (const type of Object.keys(snapshot.types)) {
      assert.deepStrictEqual(snapshot.types[type], full.types[type]);
    }
    // Restored, the schema writes the same text again and checks as before.
    const restored = fromJSON(snapshot, { types: customTypes });
    assert.strictEqual(
      JSON.stringify(restored.entities.get(name).toSnapshot()),
      JSON.stringify(snapshot),
    );
  }
  // What each entity reaches, in the order a walk from it meets them.
  const reached = (name) => Object.keys(model.entities.get(name).toSnapshot().entities);
  assert.deepStrictEqual(reached('Identifier'), ['Identifier']);
  assert.deepStrictEqual(reached('Account'), ['Company', 'Address', 'Account']);
  assert.deepStrictEqual(reached('Signin'), ['Company', 'Address', 'Account', 'Signin']);
});

test('Snapshot: references of a schema, its own name, a namespace and a projection', () => {
  const { fromJSON } = require('../../src/model/index.js');
  const roundTrip = (schema, values) => {
    const snapshot = json(schema.toSnapshot());
    const restored = fromJSON(snapshot).entities.get(snapshot.root);
    assert.strictEqual(JSON.stringify(restored.toSnapshot()), JSON.stringify(snapshot));
    for (const value of values) {
      assert.deepStrictEqual(restored.check(value).errors, schema.check(value).errors);
    }
    return snapshot;
  };
  // Its own name, without a model.
  const category = new Schema('Category', { name: 'string', parent: '?Category' });
  const own = roundTrip(category, [
    { name: 'a', parent: { name: 'b' } },
    { name: 'a', parent: { name: 1 } },
  ]);
  assert.deepStrictEqual(Object.keys(own.entities), ['Category']);
  // Two entities that reference each other: the cycle is cut where it
  // closes, as the model orders it.
  const model = new Model({}, [
    ['Person', { Struct: {}, name: 'string', 'friend?': 'Person', 'employer?': 'Company' }],
    ['Company', { Struct: {}, title: 'string', 'boss?': 'Person' }],
  ]);
  const person = roundTrip(model.entities.get('Person'), [
    { name: 'a', employer: { title: 't', boss: { name: 'b' } } },
    { name: 'a', employer: { title: 1 } },
  ]);
  assert.deepStrictEqual(Object.keys(person.entities), ['Company', 'Person']);
  assert.deepStrictEqual(Object.keys(json(model.entities.get('Company').toSnapshot()).entities), [
    'Person',
    'Company',
  ]);
  // A schema of its own that references the entities of a model it attaches.
  const order = new Schema('Order', { buyer: 'Person', note: 'string' }, [model]);
  assert.deepStrictEqual(
    Object.keys(roundTrip(order, [{ buyer: { name: 'x' }, note: '' }]).entities),
    ['Company', 'Person', 'Order'],
  );
  // A projection takes its parent along: restoring it needs the parent.
  const accounts = new Model({}, [
    ['Account', { Registry: {}, login: 'string', password: 'string' }],
    ['Signin', { Projection: { schema: 'Account', fields: ['login'] } }],
  ]);
  const signin = roundTrip(accounts.entities.get('Signin'), [{ login: 'a' }, { login: 1 }]);
  assert.deepStrictEqual(Object.keys(signin.entities), ['Account', 'Signin']);
  // A reference that does not resolve is left out, as the model leaves it.
  assert.deepStrictEqual(Object.keys(json(Schema.from({ who: 'Ghost' }).toSnapshot()).entities), [
    '',
  ]);
  // One entity per name: a schema that shares the name of the entity it
  // references cannot be written.
  const copy = new Schema('Person', { Struct: {}, name: 'string', boss: 'Person' }, [model]);
  assert.throws(() => copy.toSnapshot(), {
    name: 'SchemaDefinitionError',
    code: 'ERR_UNREPRESENTABLE',
    message: 'Two schemas named "Person" cannot be represented in one snapshot',
  });
  // Identifier comes first, as in a model.
  const ids = new Model({}, [
    ['Item', { Struct: {}, tag: 'Identifier' }],
    ['Identifier', { Struct: {}, value: 'string' }],
  ]);
  assert.deepStrictEqual(Object.keys(json(ids.entities.get('Item').toSnapshot()).entities), [
    'Identifier',
    'Item',
  ]);
});

test('Snapshot: a schema of every form, anonymous ones and alias types', () => {
  const { fromJSON } = require('../../src/model/index.js');
  const model = new Model(
    { money: { js: 'number', metadata: { pg: 'numeric' } }, cents: { js: 'money' } },
    [
      ['Tag', { Struct: {}, label: 'string' }],
      [
        'Doc',
        {
          Entity: { unknown: 'ignore' },
          name: { type: 'string', length: { min: 1, max: 8 }, pattern: /^[a-z]+$/i },
          price: { type: 'number', decimals: 2, min: 0 },
          total: { type: 'cents', decimals: 0 },
          data: '?bytes',
          perms: { flags: ['read', 'write'] },
          role: { enum: ['a', 'b'] },
          ids: { set: 'bigint' },
          byId: { map: { number: 'boolean' } },
          point: [{ x: 'number' }, { 'y?': 'string' }],
          shape: { union: [{ Struct: {}, kind: { enum: ['a'] } }], discriminator: 'kind' },
          tags: { many: 'Tag' },
          inner: { a: 'string' },
        },
      ],
    ],
  );
  const snapshot = json(model.entities.get('Doc').toSnapshot());
  assert.deepStrictEqual(Object.keys(snapshot.entities), ['Tag', 'Doc']);
  assert.deepStrictEqual(snapshot.types, {
    cents: { js: 'money', metadata: {} },
    money: { js: 'number', metadata: { pg: 'numeric' } },
  });
  const { fields } = snapshot.entities.Doc;
  assert.deepStrictEqual(fields.price, { type: 'number', required: true, decimals: 2, min: 0 });
  assert.deepStrictEqual(fields.total, { type: 'cents', required: true, decimals: 0 });
  assert.deepStrictEqual(fields.data, { type: 'bytes', required: false });
  assert.deepStrictEqual(fields.perms, { type: 'flags', required: true, flags: ['read', 'write'] });
  // The fields in the order of the definition, the id of the stored kind
  // after them.
  assert.deepStrictEqual(Object.keys(fields), [
    'name',
    'price',
    'total',
    'data',
    'perms',
    'role',
    'ids',
    'byId',
    'point',
    'shape',
    'tags',
    'inner',
    'docId',
  ]);
  const restored = fromJSON(snapshot).entities.get('Doc');
  assert.strictEqual(JSON.stringify(restored.toSnapshot()), JSON.stringify(snapshot));
  const value = {
    name: 'abc',
    price: 0.1 + 0.2,
    total: 3,
    data: new Uint8Array(1),
    perms: { read: true },
    role: 'a',
    ids: new Set([1n]),
    byId: new Map([[1, true]]),
    point: [1],
    shape: { kind: 'a' },
    tags: [{ label: 'x' }],
    inner: { a: 'x' },
  };
  assert.strictEqual(restored.check(value).valid, true);
  const wrong = { ...value, price: 0.123, total: 1.5, data: [1], perms: { read: 1 } };
  assert.deepStrictEqual(
    restored.check(wrong).errors,
    model.entities.get('Doc').check(wrong).errors,
  );
  // An anonymous schema is the entity '', of a struct or of one type.
  for (const source of [{ a: 'string', 'b?': 'bytes' }, { array: 'number' }, 'string']) {
    const schema = Schema.from(source);
    const own = json(schema.toSnapshot());
    assert.strictEqual(own.root, '');
    assert.deepStrictEqual(Object.keys(own.entities), ['']);
    const back = fromJSON(own).entities.get('');
    assert.strictEqual(JSON.stringify(back.toSnapshot()), JSON.stringify(own));
  }
  const stored = json(Schema.from({ Entity: {}, a: 'string' }).toSnapshot());
  assert.deepStrictEqual(Object.keys(stored.entities[''].fields), ['a', 'id']);
});

test('Snapshot: the root of a snapshot is read and checked, other keys are ignored', () => {
  const { fromJSON, diff } = require('../../src/model/index.js');
  const snapshot = json(new Schema('Note', { text: 'string' }).toSnapshot());
  const restored = fromJSON(snapshot);
  assert.strictEqual(restored.entities.get(snapshot.root).name, 'Note');
  assert.deepStrictEqual(json(restored), json({ ...snapshot, root: undefined }));
  for (const root of [5, null, 'Ghost', 'toString', '__proto__']) {
    const broken = { ...snapshot, root };
    assert.throws(() => fromJSON(broken), {
      code: 'ERR_INVALID_SNAPSHOT',
      message: 'The root of a snapshot must name one of its entities',
    });
    assert.throws(() => diff(broken, broken), { code: 'ERR_INVALID_SNAPSHOT' });
  }
  // A key format 1 does not have is no instruction: it changes nothing.
  const extra = JSON.parse(
    JSON.stringify(snapshot).replace(
      '{"format":1,',
      '{"format":1,"__proto__":{"x":1},"later":true,',
    ),
  );
  assert.strictEqual(Object.hasOwn(extra, '__proto__'), true);
  const model = fromJSON(extra);
  assert.strictEqual(model.x, undefined);
  assert.strictEqual(model.entities.get('Note').check({ text: 'a' }).valid, true);
  assert.deepStrictEqual(diff(snapshot, extra), []);
});

test('Snapshot: a Schema reused as a field resolves its references through itself', () => {
  const { fromJSON } = require('../../src/model/index.js');
  const restore = (schema) => {
    const snapshot = json(schema.toSnapshot());
    const restored = fromJSON(snapshot).entities.get(snapshot.root);
    assert.strictEqual(JSON.stringify(restored.toSnapshot()), JSON.stringify(snapshot));
    return { snapshot, restored };
  };
  // A schema that names itself, reused by another without a model: its
  // fields resolve the name through it, and so does the snapshot.
  const inner = new Schema('Inner', { x: 'string', 'parent?': 'Inner' });
  const outer = new Schema('Outer', { inner });
  assert.deepStrictEqual(outer.checkConsistency(), []);
  const own = restore(outer);
  assert.deepStrictEqual(Object.keys(own.snapshot.entities), ['Inner', 'Outer']);
  const value = { inner: { x: 'a', parent: { x: 1 } } };
  assert.deepStrictEqual(
    own.restored.check(value, { references: 'embed' }).errors,
    outer.check(value, { references: 'embed' }).errors,
  );
  // An entity of a model with a registry of its own, reused by a schema of
  // none: its types and the entities it references come along.
  const shop = new Model(
    { money: { js: 'number' } },
    [
      ['Tag', { Struct: {}, label: 'string' }],
      ['Item', { Struct: {}, price: 'money', tag: 'Tag' }],
    ],
    null,
    { registry: 'isolated' },
  );
  const cart = new Schema('Cart', { item: shop.entities.get('Item') });
  assert.deepStrictEqual(cart.checkConsistency(), []);
  const borrowed = restore(cart);
  assert.deepStrictEqual(Object.keys(borrowed.snapshot.entities), ['Tag', 'Cart']);
  assert.deepStrictEqual(borrowed.snapshot.types, { money: { js: 'number', metadata: {} } });
  const wrong = { item: { price: 'x', tag: { label: 1 } } };
  assert.deepStrictEqual(borrowed.restored.check(wrong).errors, cart.check(wrong).errors);
  // An anonymous schema a model names is the entity of that name.
  const name = Schema.from({ first: 'string' });
  const people = new Model({}, [
    ['Person', { Struct: {}, owner: { type: 'Name', embed: true } }],
    ['Name', name],
  ]);
  const named = restore(people.entities.get('Person'));
  assert.deepStrictEqual(Object.keys(named.snapshot.entities), ['Name', 'Person']);
  assert.deepStrictEqual(named.restored.check({ owner: { first: 1 } }).errors, [
    'Field "Person.owner.first" not of expected type: string',
  ]);
  const anonymous = Schema.from({ x: { type: 'Name', embed: true } }, [people]);
  assert.deepStrictEqual(Object.keys(json(anonymous.toSnapshot()).entities), ['Name', '']);
});

test('Snapshot: one schema writes the entities in the order a walk from it meets them', () => {
  const { fromJSON } = require('../../src/model/index.js');
  // Not the order of the model: the text of a schema is the schema's.
  const model = new Model({}, [
    ['A', { Struct: {}, x: 'string' }],
    ['B', { Struct: {}, y: 'string' }],
    ['C', { Struct: {}, b: 'B', a: 'A' }],
  ]);
  assert.deepStrictEqual([...model.order], ['A', 'B', 'C']);
  const snapshot = json(model.entities.get('C').toSnapshot());
  assert.deepStrictEqual(Object.keys(snapshot.entities), ['B', 'A', 'C']);
  const restored = fromJSON(snapshot).entities.get('C');
  assert.strictEqual(JSON.stringify(restored.toSnapshot()), JSON.stringify(snapshot));
});

test('Snapshot: a chain of ten thousand entities orders, writes and restores', () => {
  const { fromJSON } = require('../../src/model/index.js');
  const size = 10_000;
  const entities = [];
  for (let index = 0; index < size; index += 1) {
    const next = index + 1 < size ? { 'next?': `E${index + 1}` } : {};
    entities.push([`E${index}`, { Struct: {}, n: 'number', ...next }]);
  }
  const model = new Model({}, entities);
  assert.strictEqual(model.order.size, size);
  assert.strictEqual([...model.order][0], `E${size - 1}`);
  const snapshot = json(model.entities.get('E0').toSnapshot());
  assert.strictEqual(Object.keys(snapshot.entities).length, size);
  const restored = fromJSON(json(model));
  assert.deepStrictEqual([...restored.order], [...model.order]);
});

test('Snapshot: two types of one name from two registries cannot be one snapshot', () => {
  const registry = { registry: 'isolated' };
  const a = new Model(
    { amount: { js: 'number' } },
    [['A', { Struct: {}, m: 'amount' }]],
    null,
    registry,
  );
  const b = new Model(
    { amount: { js: 'string' } },
    [['B', { Struct: {}, m: 'amount' }]],
    null,
    registry,
  );
  const both = new Schema('R', { a: 'A', b: 'B' }, [a, b]);
  assert.throws(() => both.toSnapshot(), {
    name: 'SchemaDefinitionError',
    code: 'ERR_UNREPRESENTABLE',
    message: 'Two types named "amount" cannot be represented in one snapshot',
  });
  // The same definition in two registries is one type.
  const c = new Model(
    { amount: { js: 'number' } },
    [['C', { Struct: {}, m: 'amount' }]],
    null,
    registry,
  );
  const same = new Schema('S', { a: 'A', c: 'C' }, [a, c]);
  assert.deepStrictEqual(json(same.toSnapshot()).types, { amount: { js: 'number', metadata: {} } });
});

test('Snapshot: what a consumer reads back checks as the schema did, on both backends', () => {
  const { fromJSON } = require('../../src/model/index.js');
  const { compile, canEval } = require('../../src/compile/index.js');
  // A stored entity, a memory struct, a schema that names itself, two that
  // name each other, a union, bytes, flags and decimals.
  const model = new Model({}, [
    ['Owner', { Entity: {}, name: 'string', 'best?': 'Pet' }],
    [
      'Pet',
      { Struct: {}, name: 'string', 'owner?': { type: 'Owner', embed: true }, 'mate?': 'Pet' },
    ],
    [
      'Listing',
      {
        Entity: {},
        title: { type: 'string', length: { max: 40 } },
        price: { type: 'number', decimals: 2, min: 0 },
        photo: '?bytes',
        flags: { flags: ['featured', 'sold'] },
        pet: 'Pet',
        seller: 'Owner',
        offer: {
          union: [
            { Struct: {}, kind: { enum: ['fixed'] }, amount: 'number' },
            { Struct: {}, kind: { enum: ['auction'] }, ends: 'date' },
          ],
          discriminator: 'kind',
        },
        'related?': { many: 'Listing' },
      },
    ],
  ]);
  const listing = model.entities.get('Listing');
  const text = JSON.stringify(listing.toSnapshot());
  const snapshot = JSON.parse(text);
  assert.strictEqual(snapshot.root, 'Listing');
  assert.deepStrictEqual(Object.keys(snapshot.entities), ['Owner', 'Pet', 'Listing']);
  const restored = fromJSON(snapshot);
  assert.deepStrictEqual(restored.placeholders, []);
  assert.strictEqual(JSON.stringify(restored.entities.get('Listing').toSnapshot()), text);
  const values = [
    {
      title: 'a',
      price: 19.99,
      photo: new Uint8Array(2),
      flags: { featured: true },
      pet: { name: 'Rex', owner: { name: 'Ann', best: { name: 'Bo' } }, mate: { name: 'Lia' } },
      seller: 'owner-1',
      offer: { kind: 'fixed', amount: 10 },
      related: ['listing-2'],
    },
    {
      title: 'x'.repeat(41),
      price: 0.123,
      photo: [1],
      flags: { sold: 'no', hot: true },
      pet: { name: 1, owner: 'owner-1' },
      seller: { name: 'Ann' },
      offer: { kind: 'swap' },
      related: [{}],
    },
  ];
  const original = values.map((value) => listing.check(value).issues);
  assert.strictEqual(original[0].length, 0);
  assert.strictEqual(original[1].length > 5, true);
  const copy = restored.entities.get('Listing');
  assert.deepStrictEqual(
    values.map((value) => copy.check(value).issues),
    original,
  );
  assert.deepStrictEqual(
    compile(restored, { jit: canEval() ? true : 'auto' }).accelerated,
    canEval(),
  );
  assert.deepStrictEqual(
    values.map((value) => copy.check(value).issues),
    original,
  );
});
