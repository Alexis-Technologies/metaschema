const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

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

describe('Snapshot', () => {
  it('should write the committed snapshot of the fixture model', () => {
    const model = fixtureModel();
    assert.deepEqual(json(model), committed);
    // The same text, not only the same values: the key order at every depth
    // is the contract (`require` keeps the order of the file).
    assert.equal(JSON.stringify(json(model)), JSON.stringify(committed));
    assert.equal(JSON.stringify(model), JSON.stringify(model.toJSON()));
    assert.deepEqual(Object.keys(committed), ['format', 'database', 'types', 'entities']);
    assert.equal(committed.format, 1);
    // The entities in dependency order, the types the entities use, sorted.
    assert.deepEqual(Object.keys(committed.entities), [...model.order]);
    assert.deepEqual(Object.keys(committed.types), ['datetime', 'string']);
    // Two builds of the same definitions give the same text.
    assert.equal(JSON.stringify(fixtureModel()), JSON.stringify(model));
  });

  it('should carry the metadata, fields, indexes and relations of an entity', () => {
    const { Address, Account, Signin } = committed.entities;
    assert.deepEqual(Object.keys(Address), [
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
    assert.deepEqual(Address.indexes, {
      naturalKey: { unique: ['city', 'street', 'building'] },
    });
    assert.deepEqual(Address.fields.addressId, { type: 'string', required: false });
    // A many field is a field, not an index.
    assert.deepEqual(Account.indexes, {});
    assert.deepEqual(Account.fields.addresses, {
      type: 'Address',
      required: true,
      many: 'Address',
    });
    assert.deepEqual(Account.relations, [
      { to: 'Company', type: 'many-to-one' },
      { to: 'Address', type: 'one-to-many' },
    ]);
    assert.deepEqual(Account.fields.fullName, {
      type: 'schema',
      required: true,
      schema: {
        given: { type: 'string', required: false },
        middle: { type: 'string', required: false },
        surname: { type: 'string', required: false },
      },
    });
    assert.equal(Signin.kind, 'projection');
    assert.equal(Signin.parent, 'Account');
    assert.deepEqual(Signin.custom, { schema: 'Account', fields: ['login', 'password'] });
    assert.deepEqual(Object.keys(Signin.fields), ['login', 'password']);
  });

  it('should write the committed text for the snapshots of one schema', () => {
    const { fromJSON } = require('../../src/model/index.js');
    const { snapshots } = require('../fixtures/forms-snapshot.js');
    const forms = require('../fixtures/schema-snapshot.json');
    // The text, not only the values: the key order at every depth is the
    // contract a program that reads one schema builds on.
    assert.equal(JSON.stringify(snapshots()), JSON.stringify(forms));
    for (const key of Object.keys(forms)) {
      const snapshot = forms[key];
      const restored = fromJSON(snapshot).entities.get(snapshot.root);
      assert.equal(JSON.stringify(restored.toSnapshot()), JSON.stringify(snapshot), key);
    }
  });

  it('should write a field with a fixed key order, whatever the definition order', () => {
    const a = new Model({}, [
      ['A', { Struct: {}, x: { type: 'string', unique: true, length: 8 } }],
    ]);
    const b = new Model({}, [
      ['A', { Struct: {}, x: { type: 'string', length: 8, unique: true } }],
    ]);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.deepEqual(Object.keys(json(a).entities.A.fields.x), [
      'type',
      'required',
      'length',
      'unique',
    ]);
    // The fields keep their order: it is the order of the check.
    const c = new Model({}, [['A', { Struct: {}, b: 'string', a: 'string' }]]);
    assert.deepEqual(Object.keys(json(c).entities.A.fields), ['b', 'a']);
  });

  it('should give every form of the language a JSON form', () => {
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
    assert.deepEqual(Doc.custom, { table: 'docs' });
    assert.equal(Doc.unknown, 'ignore');
    assert.deepEqual(Doc.fields.name, {
      type: 'string',
      required: true,
      length: { min: 1, max: 8 },
      pattern: { source: '^[a-z]+$', flags: 'iu' },
      unicode: true,
    });
    assert.deepEqual(Doc.fields.slug.pattern, '^[a-z]+$');
    assert.deepEqual(Doc.fields.slug.length, { max: 8 });
    assert.deepEqual(Doc.fields.big, {
      type: 'bigint',
      required: true,
      max: { $bigint: '10' },
      min: { $bigint: '1' },
    });
    assert.deepEqual(Doc.fields.ids, {
      type: 'set',
      required: true,
      value: { type: 'bigint', required: true },
    });
    assert.deepEqual(Doc.fields.byId, {
      type: 'map',
      required: true,
      key: 'number',
      value: { type: 'boolean', required: true },
    });
    assert.deepEqual(Doc.fields.point, {
      type: 'tuple',
      required: true,
      value: [
        { type: 'number', required: true, name: 'x' },
        { type: 'string', required: false, name: 'y' },
      ],
    });
    assert.deepEqual(Doc.fields.shape, {
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
    assert.deepEqual(Doc.fields.owner, {
      type: 'Tag',
      required: true,
      embed: false,
      one: 'Tag',
    });
    assert.deepEqual(Doc.fields.note, {
      type: 'string',
      required: false,
      aliases: ['comment'],
      deprecated: 'use text',
      nullable: true,
    });
    // A function is `{ $function: true }` wherever it stands; a Date is tagged.
    assert.deepEqual(Doc.fields.when, {
      type: 'date',
      required: true,
      default: { $function: true },
    });
    assert.deepEqual(Doc.fields.at.default, { $date: '2026-10-11T00:00:00.000Z' });
    assert.deepEqual(Doc.fields.inner, {
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
    assert.deepEqual(Doc.fields.ratio, { $function: true });
    // The functions of the schema itself are written among its fields.
    assert.deepEqual(Doc.fields.validate, { $function: true });
    assert.deepEqual(Doc.fields.serialize, { $function: true });
    assert.equal(Doc.fields.byName, undefined);
    assert.deepEqual(Doc.indexes, { byName: { index: ['name'] } });
    assert.deepEqual(Doc.relations, [
      { to: 'Tag', type: 'many-to-one' },
      { to: 'Tag', type: 'one-to-many' },
    ]);
    assert.deepEqual(json(model).types, {});
  });

  it('should write and read back every tag of the format', () => {
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
            f: {
              type: 'bytes',
              default: new Uint8Array([1, 2, 255]),
              examples: [Buffer.from('A')],
            },
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
    assert.deepEqual(fields.a.default, { $function: true });
    assert.deepEqual(fields.b.min, { $bigint: '10' });
    assert.deepEqual(fields.c.default, { $date: '1970-01-01T00:00:00.000Z' });
    assert.deepEqual(fields.d.pattern, { source: 'x', flags: 'iu' });
    assert.equal(fields.e.pattern, 'x');
    assert.deepEqual(fields.f.default, { $bytes: 'AQL/' });
    assert.deepEqual(fields.f.examples, [{ $bytes: 'QQ==' }]);
    assert.deepEqual(fields.g.default, { $set: ['a', 'b'] });
    assert.deepEqual(fields.h.default, {
      $map: [['x', { $date: '1970-01-01T00:00:00.000Z' }]],
    });
    // The values, as restore.js reads them back.
    const restored = fromJSON(json(model)).entities.get('Tags').fields;
    assert.equal(typeof restored.a.default, 'function');
    assert.equal(restored.b.min, 10n);
    assert.equal(restored.c.default.getTime(), 0);
    assert.equal(restored.d.pattern.flags, 'iu');
    assert.equal(restored.e.pattern.flags, 'u');
    assert.deepEqual(restored.f.default, new Uint8Array([1, 2, 255]));
    assert.deepEqual(restored.f.examples, [new Uint8Array([65])]);
    assert.deepEqual(restored.g.default, new Set(['a', 'b']));
    assert.deepEqual(restored.h.default, new Map([['x', new Date(0)]]));
    // The defaults restored are values of their fields again (the factory of
    // `a` is a placeholder that gives nothing).
    const restoredModel = fromJSON(json(model));
    const parsed = restoredModel.entities.get('Tags').parse({ a: 'a', b: 10n, d: 'x', e: 'x' });
    assert.deepEqual(parsed.issues, []);
    assert.equal(JSON.stringify(restoredModel), JSON.stringify(model));
  });

  it('should write a schema of one type, custom types and metadata', () => {
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
    assert.equal(snapshot.database, null);
    assert.deepEqual(snapshot.entities.Id, {
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
    assert.deepEqual(snapshot.types, {
      hex: { kind: 'scalar', check: true, metadata: {} },
      money: { js: 'number', metadata: { pg: 'money' } },
    });
    const withNumber = new Model(types, [['N', { Struct: {}, n: 'number' }]], null, {
      registry: 'isolated',
    });
    assert.deepEqual(json(withNumber).types, { number: { metadata: { pg: 'integer' } } });
    // An alias of an alias brings the type it names, which restoring needs.
    const { fromJSON } = require('../../src/model/index.js');
    const chain = new Model(
      { ...types, cents: { js: 'money' } },
      [['C', { Struct: {}, c: 'cents' }]],
      null,
      { registry: 'isolated' },
    );
    assert.deepEqual(json(chain).types, {
      cents: { js: 'money', metadata: {} },
      money: { js: 'number', metadata: { pg: 'money' } },
    });
    const restored = fromJSON(json(chain)).entities.get('C');
    assert.equal(restored.check({ c: 1 }).valid, true);
    assert.equal(restored.check({ c: '1' }).valid, false);
  });

  it('should write a Schema instance as a field and as an entity', () => {
    const name = Schema.from({ first: 'string', last: 'string' });
    const model = new Model({}, [
      ['Person', { Entity: {}, name, 'nick?': name }],
      ['Name', name],
    ]);
    const { Person, Name } = json(model).entities;
    assert.deepEqual(Person.fields.name.schema, {
      first: { type: 'string', required: true },
      last: { type: 'string', required: true },
    });
    assert.equal(Person.fields.nick.required, false);
    assert.deepEqual(Object.keys(Name.fields), ['first', 'last']);
  });

  it('should write an index named __proto__ as a key', () => {
    const definition = JSON.parse('{"Entity":{},"a":"string","__proto__":{"index":["a"]}}');
    const model = new Model({}, [['A', definition]]);
    const { indexes } = model.toJSON().entities.A;
    assert.equal(Object.hasOwn(indexes, '__proto__'), true);
    assert.deepEqual(JSON.parse(JSON.stringify(model)).entities.A.indexes, {
      ['__proto__']: { index: ['a'] },
    });
  });

  it('should write a schema and the entities it reaches, its name as root', () => {
    const { fromJSON } = require('../../src/model/index.js');
    const model = fixtureModel();
    const full = json(model);
    for (const name of model.order) {
      const schema = model.entities.get(name);
      const snapshot = json(schema.toSnapshot());
      assert.deepEqual(Object.keys(snapshot), ['format', 'root', 'database', 'types', 'entities']);
      assert.equal(snapshot.format, 1);
      assert.equal(snapshot.root, name);
      assert.equal(snapshot.database, null);
      // Every entity as the model writes it, each after the ones it
      // references (a cycle cut where it closes), the schema last.
      const names = Object.keys(snapshot.entities);
      assert.equal(names.at(-1), name);
      for (const entity of names) {
        assert.deepEqual(snapshot.entities[entity], full.entities[entity]);
        for (const ref of model.entities.get(entity).references) {
          const after = names.indexOf(ref) > names.indexOf(entity);
          const cycle = model.entities.get(ref)?.references.has(entity);
          if (after && ref !== 'Identifier') assert.equal(cycle, true, `${entity} → ${ref}`);
        }
      }
      for (const type of Object.keys(snapshot.types)) {
        assert.deepEqual(snapshot.types[type], full.types[type]);
      }
      // Restored, the schema writes the same text again and checks as before.
      const restored = fromJSON(snapshot, { types: customTypes });
      assert.equal(
        JSON.stringify(restored.entities.get(name).toSnapshot()),
        JSON.stringify(snapshot),
      );
    }
    // What each entity reaches, in the order a walk from it meets them.
    const reached = (name) => Object.keys(model.entities.get(name).toSnapshot().entities);
    assert.deepEqual(reached('Identifier'), ['Identifier']);
    assert.deepEqual(reached('Account'), ['Company', 'Address', 'Account']);
    assert.deepEqual(reached('Signin'), ['Company', 'Address', 'Account', 'Signin']);
  });

  it('should round-trip references of a schema, its own name, a namespace and a projection', () => {
    const { fromJSON } = require('../../src/model/index.js');
    const roundTrip = (schema, values) => {
      const snapshot = json(schema.toSnapshot());
      const restored = fromJSON(snapshot).entities.get(snapshot.root);
      assert.equal(JSON.stringify(restored.toSnapshot()), JSON.stringify(snapshot));
      for (const value of values) {
        assert.deepEqual(restored.check(value).errors, schema.check(value).errors);
      }
      return snapshot;
    };
    // Its own name, without a model.
    const category = new Schema('Category', { name: 'string', parent: '?Category' });
    const own = roundTrip(category, [
      { name: 'a', parent: { name: 'b' } },
      { name: 'a', parent: { name: 1 } },
    ]);
    assert.deepEqual(Object.keys(own.entities), ['Category']);
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
    assert.deepEqual(Object.keys(person.entities), ['Company', 'Person']);
    assert.deepEqual(Object.keys(json(model.entities.get('Company').toSnapshot()).entities), [
      'Person',
      'Company',
    ]);
    // A schema of its own that references the entities of a model it attaches.
    const order = new Schema('Order', { buyer: 'Person', note: 'string' }, [model]);
    assert.deepEqual(Object.keys(roundTrip(order, [{ buyer: { name: 'x' }, note: '' }]).entities), [
      'Company',
      'Person',
      'Order',
    ]);
    // A projection takes its parent along: restoring it needs the parent.
    const accounts = new Model({}, [
      ['Account', { Registry: {}, login: 'string', password: 'string' }],
      ['Signin', { Projection: { schema: 'Account', fields: ['login'] } }],
    ]);
    const signin = roundTrip(accounts.entities.get('Signin'), [{ login: 'a' }, { login: 1 }]);
    assert.deepEqual(Object.keys(signin.entities), ['Account', 'Signin']);
    // A reference that does not resolve is left out, as the model leaves it.
    assert.deepEqual(Object.keys(json(Schema.from({ who: 'Ghost' }).toSnapshot()).entities), ['']);
    // One entity per name: a schema that shares the name of the entity it
    // references cannot be written.
    const copy = new Schema('Person', { Struct: {}, name: 'string', boss: 'Person' }, [model]);
    assert.throws(() => copy.toSnapshot(), {
      name: 'SchemaDefinitionError',
      code: 'ALX_ERR_UNREPRESENTABLE',
      message: 'Two schemas named "Person" cannot be represented in one snapshot',
    });
    // Identifier comes first, as in a model.
    const ids = new Model({}, [
      ['Item', { Struct: {}, tag: 'Identifier' }],
      ['Identifier', { Struct: {}, value: 'string' }],
    ]);
    assert.deepEqual(Object.keys(json(ids.entities.get('Item').toSnapshot()).entities), [
      'Identifier',
      'Item',
    ]);
  });

  it('should write a schema of every form, anonymous ones and alias types', () => {
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
    assert.deepEqual(Object.keys(snapshot.entities), ['Tag', 'Doc']);
    assert.deepEqual(snapshot.types, {
      cents: { js: 'money', metadata: {} },
      money: { js: 'number', metadata: { pg: 'numeric' } },
    });
    const { fields } = snapshot.entities.Doc;
    assert.deepEqual(fields.price, { type: 'number', required: true, decimals: 2, min: 0 });
    assert.deepEqual(fields.total, { type: 'cents', required: true, decimals: 0 });
    assert.deepEqual(fields.data, { type: 'bytes', required: false });
    assert.deepEqual(fields.perms, { type: 'flags', required: true, flags: ['read', 'write'] });
    // The fields in the order of the definition, the id of the stored kind
    // after them.
    assert.deepEqual(Object.keys(fields), [
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
    assert.equal(JSON.stringify(restored.toSnapshot()), JSON.stringify(snapshot));
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
    assert.equal(restored.check(value).valid, true);
    const wrong = { ...value, price: 0.123, total: 1.5, data: [1], perms: { read: 1 } };
    assert.deepEqual(restored.check(wrong).errors, model.entities.get('Doc').check(wrong).errors);
    // An anonymous schema is the entity '', of a struct or of one type.
    for (const source of [{ a: 'string', 'b?': 'bytes' }, { array: 'number' }, 'string']) {
      const schema = Schema.from(source);
      const own = json(schema.toSnapshot());
      assert.equal(own.root, '');
      assert.deepEqual(Object.keys(own.entities), ['']);
      const back = fromJSON(own).entities.get('');
      assert.equal(JSON.stringify(back.toSnapshot()), JSON.stringify(own));
    }
    const stored = json(Schema.from({ Entity: {}, a: 'string' }).toSnapshot());
    assert.deepEqual(Object.keys(stored.entities[''].fields), ['a', 'id']);
  });

  it('should read and check the root of a snapshot and ignore other keys', () => {
    const { fromJSON, diff } = require('../../src/model/index.js');
    const snapshot = json(new Schema('Note', { text: 'string' }).toSnapshot());
    const restored = fromJSON(snapshot);
    assert.equal(restored.entities.get(snapshot.root).name, 'Note');
    assert.deepEqual(json(restored), json({ ...snapshot, root: undefined }));
    for (const root of [5, null, 'Ghost', 'toString', '__proto__']) {
      const broken = { ...snapshot, root };
      assert.throws(() => fromJSON(broken), {
        code: 'ALX_ERR_INVALID_SNAPSHOT',
        message: 'The root of a snapshot must name one of its entities',
      });
      assert.throws(() => diff(broken, broken), { code: 'ALX_ERR_INVALID_SNAPSHOT' });
    }
    // A key format 1 does not have is no instruction: it changes nothing.
    const extra = JSON.parse(
      JSON.stringify(snapshot).replace(
        '{"format":1,',
        '{"format":1,"__proto__":{"x":1},"later":true,',
      ),
    );
    assert.equal(Object.hasOwn(extra, '__proto__'), true);
    const model = fromJSON(extra);
    assert.equal(model.x, undefined);
    assert.equal(model.entities.get('Note').check({ text: 'a' }).valid, true);
    assert.deepEqual(diff(snapshot, extra), []);
  });

  it('should resolve the references of a Schema reused as a field through itself', () => {
    const { fromJSON } = require('../../src/model/index.js');
    const restore = (schema) => {
      const snapshot = json(schema.toSnapshot());
      const restored = fromJSON(snapshot).entities.get(snapshot.root);
      assert.equal(JSON.stringify(restored.toSnapshot()), JSON.stringify(snapshot));
      return { snapshot, restored };
    };
    // A schema that names itself, reused by another without a model: its
    // fields resolve the name through it, and so does the snapshot.
    const inner = new Schema('Inner', { x: 'string', 'parent?': 'Inner' });
    const outer = new Schema('Outer', { inner });
    assert.deepEqual(outer.checkConsistency(), []);
    const own = restore(outer);
    assert.deepEqual(Object.keys(own.snapshot.entities), ['Inner', 'Outer']);
    const value = { inner: { x: 'a', parent: { x: 1 } } };
    assert.deepEqual(
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
    assert.deepEqual(cart.checkConsistency(), []);
    const borrowed = restore(cart);
    assert.deepEqual(Object.keys(borrowed.snapshot.entities), ['Tag', 'Cart']);
    assert.deepEqual(borrowed.snapshot.types, { money: { js: 'number', metadata: {} } });
    const wrong = { item: { price: 'x', tag: { label: 1 } } };
    assert.deepEqual(borrowed.restored.check(wrong).errors, cart.check(wrong).errors);
    // An anonymous schema a model names is the entity of that name.
    const name = Schema.from({ first: 'string' });
    const people = new Model({}, [
      ['Person', { Struct: {}, owner: { type: 'Name', embed: true } }],
      ['Name', name],
    ]);
    const named = restore(people.entities.get('Person'));
    assert.deepEqual(Object.keys(named.snapshot.entities), ['Name', 'Person']);
    assert.deepEqual(named.restored.check({ owner: { first: 1 } }).errors, [
      'Field "Person.owner.first" not of expected type: string',
    ]);
    const anonymous = Schema.from({ x: { type: 'Name', embed: true } }, [people]);
    assert.deepEqual(Object.keys(json(anonymous.toSnapshot()).entities), ['Name', '']);
  });

  it('should write the entities of one schema in the order a walk from it meets them', () => {
    const { fromJSON } = require('../../src/model/index.js');
    // Not the order of the model: the text of a schema is the schema's.
    const model = new Model({}, [
      ['A', { Struct: {}, x: 'string' }],
      ['B', { Struct: {}, y: 'string' }],
      ['C', { Struct: {}, b: 'B', a: 'A' }],
    ]);
    assert.deepEqual([...model.order], ['A', 'B', 'C']);
    const snapshot = json(model.entities.get('C').toSnapshot());
    assert.deepEqual(Object.keys(snapshot.entities), ['B', 'A', 'C']);
    const restored = fromJSON(snapshot).entities.get('C');
    assert.equal(JSON.stringify(restored.toSnapshot()), JSON.stringify(snapshot));
  });

  it('should order, write and restore a chain of ten thousand entities', () => {
    const { fromJSON } = require('../../src/model/index.js');
    const size = 10_000;
    const entities = [];
    for (let index = 0; index < size; index += 1) {
      const next = index + 1 < size ? { 'next?': `E${index + 1}` } : {};
      entities.push([`E${index}`, { Struct: {}, n: 'number', ...next }]);
    }
    const model = new Model({}, entities);
    assert.equal(model.order.size, size);
    assert.equal([...model.order][0], `E${size - 1}`);
    const snapshot = json(model.entities.get('E0').toSnapshot());
    assert.equal(Object.keys(snapshot.entities).length, size);
    const restored = fromJSON(json(model));
    assert.deepEqual([...restored.order], [...model.order]);
  });

  it('should copy the metadata of the program and tag its values', () => {
    const hook = () => {};
    const schema = new Schema('X', {
      Struct: { hook, size: 10n, since: new Date(0), tags: ['a'] },
      a: 'string',
      byA: { index: ['a'] },
    });
    const model = new Model({}, [['X', schema]], { pool: { max: 4 } });
    for (const snapshot of [schema.toSnapshot(), model.toJSON()]) {
      const entity = snapshot.entities.X;
      assert.deepEqual(entity.custom, {
        hook: { $function: true },
        size: { $bigint: '10' },
        since: { $date: '1970-01-01T00:00:00.000Z' },
        tags: ['a'],
      });
      // What the snapshot holds is a copy: a consumer may change it.
      entity.custom.tags.push('b');
      entity.indexes.byA.index.push('ghost');
      assert.deepEqual(schema.custom.tags, ['a']);
      assert.deepEqual(schema.indexes.byA.index, ['a']);
      assert.doesNotThrow(() => JSON.stringify(snapshot));
    }
    const written = model.toJSON().database;
    written.pool.max = 1;
    assert.equal(model.database.pool.max, 4);
  });

  it('should refuse two types of one name from two registries in one snapshot', () => {
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
      code: 'ALX_ERR_UNREPRESENTABLE',
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
    assert.deepEqual(json(same.toSnapshot()).types, { amount: { js: 'number', metadata: {} } });
  });

  it('should check what a consumer reads back as the schema did, on both backends', () => {
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
    assert.equal(snapshot.root, 'Listing');
    assert.deepEqual(Object.keys(snapshot.entities), ['Owner', 'Pet', 'Listing']);
    const restored = fromJSON(snapshot);
    assert.deepEqual(restored.placeholders, []);
    assert.equal(JSON.stringify(restored.entities.get('Listing').toSnapshot()), text);
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
    assert.equal(original[0].length, 0);
    assert.equal(original[1].length > 5, true);
    const copy = restored.entities.get('Listing');
    assert.deepEqual(
      values.map((value) => copy.check(value).issues),
      original,
    );
    assert.deepEqual(compile(restored, { jit: canEval() ? true : 'auto' }).accelerated, canEval());
    assert.deepEqual(
      values.map((value) => copy.check(value).issues),
      original,
    );
  });

  it('should write every field of a schema of upper-case keys', () => {
    // Until 3.4.1 the first of them was the kind and its definition the
    // metadata, a string spread into `custom`.
    const env = new Schema('Env', { DATABASE_URL: 'string', PORT: { type: 'number', min: 1 } });
    const snapshot = env.toSnapshot();
    assert.equal(snapshot.root, 'Env');
    assert.deepEqual(snapshot.entities.Env, {
      kind: 'struct',
      scope: 'local',
      store: 'memory',
      allow: 'write',
      parent: '',
      unknown: 'reject',
      custom: {},
      fields: {
        DATABASE_URL: { type: 'string', required: true },
        PORT: { type: 'number', required: true, min: 1 },
      },
      indexes: {},
      relations: [],
    });
  });
});
