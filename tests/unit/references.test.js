const { test } = require('node:test');
const assert = require('node:assert');

const { Schema, Model } = require('../../index.js');

const build = (kinds) =>
  new Model({}, [
    ...Object.entries(kinds).map(([name, meta]) => [name, { [meta]: {}, label: 'string' }]),
    [
      'Holder',
      {
        Entity: {},
        ...Object.fromEntries(Object.keys(kinds).map((name) => [name.toLowerCase(), name])),
      },
    ],
  ]);

test('References: a stored kind is held as an id, a memory kind as the record', () => {
  const stored = ['Entity', 'Registry', 'Dictionary', 'Journal', 'Details', 'Relation', 'View'];
  const memory = ['Struct', 'Form', 'Projection', 'Custom'];
  const kinds = Object.fromEntries([...stored, ...memory].map((kind) => [`${kind}Ref`, kind]));
  delete kinds.ProjectionRef;
  const model = build(kinds);
  const holder = model.entities.get('Holder');
  const ids = Object.fromEntries(stored.map((kind) => [`${kind.toLowerCase()}ref`, 'id-1']));
  const records = Object.fromEntries(
    memory
      .filter((kind) => kind !== 'Projection')
      .map((kind) => [`${kind.toLowerCase()}ref`, { label: 'x' }]),
  );
  assert.strictEqual(holder.check({ ...ids, ...records }).valid, true);
  const swapped = holder.check({
    ...Object.fromEntries(Object.keys(ids).map((key) => [key, { label: 'x' }])),
    ...Object.fromEntries(Object.keys(records).map((key) => [key, 'id-1'])),
  });
  assert.deepStrictEqual(swapped.errors, [
    ...stored.map((kind) => `Field "Holder.${kind.toLowerCase()}ref" not of expected type: string`),
    ...memory
      .filter((kind) => kind !== 'Projection')
      .map((kind) => `Field "Holder.${kind.toLowerCase()}ref" not of expected type: object`),
  ]);
  assert.deepStrictEqual(swapped.issues[0].params, { expected: 'string', received: 'object' });
  // The store of the kind decides, so a persistent struct is held as an id.
  const persisted = new Model({}, [
    ['Note', { Struct: { store: 'persistent' }, text: 'string' }],
    ['Page', { Entity: {}, note: 'Note' }],
  ]).entities.get('Page');
  assert.strictEqual(persisted.check({ note: 'n1' }).valid, true);
  assert.strictEqual(persisted.check({ note: { text: 'x' } }).valid, false);
  // A projection is a memory kind.
  const projected = new Model({}, [
    ['Account', { Registry: {}, login: 'string', password: 'string' }],
    ['Signin', { Projection: { schema: 'Account', fields: ['login'] } }],
    ['Session', { Struct: {}, who: 'Signin' }],
  ]).entities.get('Session');
  assert.strictEqual(projected.check({ who: { login: 'a' } }).valid, true);
  assert.deepStrictEqual(projected.check({ who: 's1' }).errors, [
    'Field "Session.who" not of expected type: object',
  ]);
});

test('References: many holds ids or records the same way', () => {
  const model = new Model({}, [
    ['Address', { Entity: {}, city: 'string' }],
    ['Tag', { Struct: {}, name: 'string' }],
    ['Company', { Entity: {}, addresses: { many: 'Address' }, tags: { many: 'Tag' } }],
  ]);
  const company = model.entities.get('Company');
  assert.strictEqual(company.check({ addresses: ['a1', 'a2'], tags: [{ name: 't' }] }).valid, true);
  assert.strictEqual(company.check({ addresses: [], tags: [] }).valid, true);
  assert.deepStrictEqual(company.check({ addresses: [{ city: 'Kyiv' }, 5], tags: ['t1'] }).errors, [
    'Field "Company.addresses[0]" not of expected type: string',
    'Field "Company.addresses[1]" not of expected type: string',
    'Field "Company.tags[0]" not of expected type: object',
  ]);
  assert.deepStrictEqual(company.check({ addresses: 'a1', tags: [] }).errors, [
    'Field "Company.addresses" not of expected type: array of Address',
  ]);
  assert.strictEqual(
    company.check({ addresses: [{}, {}, {}], tags: [] }, { maxErrors: 2 }).errors.length,
    2,
  );
});

test('References: embed on the field, references on the call', () => {
  const model = new Model({}, [
    ['Company', { Entity: {}, name: 'string' }],
    ['Tag', { Struct: {}, name: 'string' }],
    [
      'Person',
      {
        Entity: {},
        employer: 'Company',
        former: { many: 'Company', embed: true },
        label: { type: 'Tag', embed: false },
        tags: { many: 'Tag' },
      },
    ],
  ]);
  const person = model.entities.get('Person');
  assert.strictEqual(person.fields.former.embed, true);
  assert.strictEqual(person.fields.label.embed, false);
  const byKind = { employer: 'c1', former: [{ name: 'Old' }], label: 't1', tags: [{ name: 'x' }] };
  const allIds = { employer: 'c1', former: ['c0'], label: 't1', tags: ['t2'] };
  const allRecords = {
    employer: { name: 'Acme' },
    former: [{ name: 'Old' }],
    label: { name: 'l' },
    tags: [{ name: 'x' }],
  };
  assert.strictEqual(person.check(byKind).valid, true);
  assert.strictEqual(person.check(byKind, { references: 'kind' }).valid, true);
  assert.strictEqual(person.check(allIds, { references: 'id' }).valid, true);
  assert.strictEqual(person.check(allRecords, { references: 'embed' }).valid, true);
  assert.deepStrictEqual(person.check(allIds).errors, [
    'Field "Person.former[0]" not of expected type: object',
    'Field "Person.tags[0]" not of expected type: object',
  ]);
  assert.deepStrictEqual(person.check(byKind, { references: 'id' }).errors, [
    'Field "Person.former[0]" not of expected type: string',
    'Field "Person.tags[0]" not of expected type: string',
  ]);
  assert.deepStrictEqual(person.check(byKind, { references: 'embed' }).errors, [
    'Field "Person.employer" not of expected type: object',
    'Field "Person.label" not of expected type: object',
  ]);
  assert.deepStrictEqual(
    person.check(allRecords, { references: 'embed', maxErrors: 1 }).errors,
    [],
  );
  assert.deepStrictEqual(
    person.check({ ...allRecords, employer: { name: 1 } }, { references: 'embed' }).errors,
    ['Field "Person.employer.name" not of expected type: string'],
  );
  for (const references of ['inline', null, true, 'Embed']) {
    assert.throws(() => person.check(byKind, { references }), {
      name: 'TypeError',
      message: `references must be "kind", "embed" or "id", got ${JSON.stringify(references)}`,
    });
  }
  for (const embed of ['yes', 1, null]) {
    assert.throws(() => Schema.from({ c: { type: 'Company', embed } }), {
      name: 'SchemaDefinitionError',
      code: 'ERR_INVALID_DEFINITION',
      message: 'Option "embed" needs a boolean in "c"',
    });
  }
  // An unresolved reference is reported whatever the mode.
  const ghost = new Model({}, [['Thing', { Entity: {}, owner: 'Nobody' }]]).entities.get('Thing');
  for (const references of ['kind', 'embed', 'id']) {
    assert.deepStrictEqual(ghost.check({ owner: 'x' }, { references }).errors, [
      'Field "Thing.owner" Entity "Nobody" is not found',
    ]);
  }
});

test('References: an id never recurses, a record is tracked for cycles', () => {
  const model = new Model({}, [
    ['Category', { Entity: {}, name: 'string', parent: '?Category' }],
    ['Node', { Struct: {}, name: 'string', next: '?Node' }],
  ]);
  const category = model.entities.get('Category');
  const node = model.entities.get('Node');
  const loop = { name: 'root' };
  loop.parent = loop;
  assert.deepStrictEqual(category.check(loop).errors, [
    'Field "Category.parent" not of expected type: string',
  ]);
  assert.deepStrictEqual(category.check(loop, { references: 'embed' }).errors, [
    'Field "Category.parent" is a circular reference',
  ]);
  const ring = { name: 'a' };
  ring.next = ring;
  assert.deepStrictEqual(node.check(ring).errors, ['Field "Node.next" is a circular reference']);
  assert.deepStrictEqual(node.check(ring, { references: 'id' }).errors, [
    'Field "Node.next" not of expected type: string',
  ]);
  assert.strictEqual(node.check({ name: 'a', next: { name: 'b' } }).valid, true);
});

test('References: the generated TypeScript follows the same rule', () => {
  const model = new Model({}, [
    ['Company', { Entity: {}, name: 'string' }],
    ['Tag', { Struct: {}, name: 'string' }],
    [
      'Person',
      {
        Entity: {},
        employer: 'Company',
        'mentor?': 'Person',
        former: { many: 'Company' },
        label: 'Tag',
        tags: { many: 'Tag' },
        inlined: { type: 'Company', embed: true },
        pinned: { many: 'Company', embed: true },
        labelled: { type: 'Tag', embed: false },
        tagged: { many: 'Tag', embed: false },
        ghost: 'Nobody',
        'spirit?': { type: 'Nobody', embed: true },
        marked: { type: 'Tag', nullable: true },
        listed: { array: 'Tag' },
        keyed: { object: { string: 'Company' } },
      },
    ],
  ]);
  assert.strictEqual(
    model.entities.get('Person').toInterface(),
    `interface Person {
  employerId: string;
  mentorId?: string;
  formerId: string[];
  label: Tag;
  tags: Tag[];
  inlined: Company;
  pinned: Company[];
  labelledId: string;
  taggedId: string[];
  ghostId: string;
  spirit?: Nobody;
  marked: Tag | null;
  listed: Tag[];
  keyed: Record<string, string>;
  personId?: string;
}`,
  );
  assert.ok(model.dts.startsWith('interface Company {'));
  // An entity given as an anonymous Schema instance keeps no name to render
  // by, so it is inlined.
  const anonymous = new Model({}, [
    ['Tag', Schema.from({ name: 'string' })],
    ['Post', { Entity: {}, tag: 'Tag', tags: { many: 'Tag' } }],
  ]);
  assert.strictEqual(
    anonymous.entities.get('Post').toInterface(),
    'interface Post {\n  tag: { name: string };\n  tags: { name: string }[];\n  postId?: string;\n}',
  );
  // Outside a model nothing resolves, and a reference is an id.
  assert.strictEqual(
    new Schema('Person', { employer: 'Company', tags: { many: 'Tag' } }).toInterface(),
    'interface Person {\n  employerId: string;\n  tagsId: string[];\n}',
  );
});
