const { test } = require('node:test');
const assert = require('node:assert');

const { Schema, Model } = require('../../index.js');

test('Lint: an option a type does not know is a warning, an annotation is not', () => {
  const schema = new Schema('Order', {
    code: { type: 'string', length: 8, unicode: true, pattern: '^a', shorthand: true },
    total: { type: 'number', min: 0, precision: 2 },
    tags: { array: 'string', count: 'number' },
    byId: { map: { string: 'number' }, sorted: true },
    status: { enum: ['open'], values: [] },
    'meta?': { type: 'json', shape: {} },
    address: { city: { type: 'string', zip: true } },
    items: { array: { n: { type: 'number', step: 1 } } },
    point: ['number', { type: 'string', trim: true }],
    shape: { union: ['string', { type: 'number', step: 1 }], discriminator: undefined },
    owner: { type: 'Owner', embed: true, lazy: true },
    note: {
      type: 'string',
      required: true,
      nullable: true,
      validate: () => true,
      default: '',
      unique: true,
      index: true,
      primary: true,
      title: 'Note',
      description: 'free text',
      examples: ['x'],
      deprecated: true,
    },
  });
  assert.deepStrictEqual(schema.warnings, [
    'Warning [unknown-option]: option "shorthand" of "Order.code" is not known to type "string"',
    'Warning [unknown-option]: option "precision" of "Order.total" is not known to type "number"',
    'Warning [unknown-option]: option "count" of "Order.tags" is not known to type "array"',
    'Warning [unknown-option]: option "sorted" of "Order.byId" is not known to type "map"',
    'Warning [unknown-option]: option "values" of "Order.status" is not known to type "enum"',
    'Warning [unknown-option]: option "shape" of "Order.meta" is not known to type "json"',
    'Warning [unknown-option]: option "zip" of "Order.address.city" is not known to type "string"',
    'Warning [unknown-option]: option "step" of "Order.items[].n" is not known to type "number"',
    'Warning [unknown-option]: option "trim" of "Order.point[1]" is not known to type "string"',
    'Warning [unknown-option]: option "step" of "Order.shape|1" is not known to type "number"',
    'Warning [unknown-option]: option "lazy" of "Order.owner" is not known to type "Owner"',
  ]);
  assert.deepStrictEqual(Schema.from({ a: 'string', b: { array: 'number' } }).warnings, []);
  // The name of a named tuple element is the tuple's, not an option.
  assert.deepStrictEqual(Schema.from({ p: [{ x: 'number' }, { 'y?': 'string' }] }).warnings, []);
  assert.deepStrictEqual(Schema.from({ p: [{ x: { type: 'number', step: 1 } }] }).warnings, [
    'Warning [unknown-option]: option "step" of "p[0].x" is not known to type "number"',
  ]);
  // A nested struct whose first field is named like a type is read as that
  // type, and the lint is what catches it.
  const birth = Schema.from({ birth: { date: '?string', place: '?string' } });
  assert.strictEqual(birth.fields.birth.type, 'date');
  assert.deepStrictEqual(birth.warnings, [
    'Warning [unknown-option]: option "place" of "birth" is not known to type "date"',
  ]);
  const marked = Schema.from({ birth: { Struct: {}, date: '?string', place: '?string' } });
  assert.strictEqual(marked.fields.birth.type, 'schema');
  assert.deepStrictEqual(marked.warnings, []);
  assert.deepStrictEqual(Schema.from({ a: { type: 'string', typo: 1 } }).warnings, [
    'Warning [unknown-option]: option "typo" of "a" is not known to type "string"',
  ]);
  assert.deepStrictEqual(Schema.from('string').warnings, []);
  assert.deepStrictEqual(Schema.from({ type: 'string', typo: 1 }).warnings, [
    'Warning [unknown-option]: option "typo" of "" is not known to type "string"',
  ]);
});

test('Lint: custom types own their options, aliases take those of their base', () => {
  const types = {
    money: { js: 'number', metadata: { pg: 'money' } },
    hex: { kind: 'scalar', construct() {}, checkType: () => null },
  };
  const model = new Model(types, [
    [
      'Wallet',
      {
        Struct: {},
        total: { type: 'money', min: 0, currency: 'UAH' },
        color: { type: 'hex', digits: 6 },
      },
    ],
  ]);
  assert.deepStrictEqual(model.warnings, [
    'Warning [unknown-option]: option "currency" of "Wallet.total" is not known to type "money"',
  ]);
});

test('Lint: a pattern without length.max and an index over a missing field', () => {
  const schema = new Schema('Address', {
    Entity: {},
    slug: { type: 'string', pattern: '^[a-z]+$' },
    code: { type: 'string', pattern: '^[a-z]+$', length: { min: 1 } },
    zip: { type: 'string', pattern: '^\\d+$', length: 10 },
    street: 'string',
    naturalKey: { primary: ['street', 'building'] },
    byZip: { index: ['zip'] },
    alt: { unique: ['street', 'nope', 'addressId'] },
  });
  assert.deepStrictEqual(schema.warnings, [
    'Warning [unbounded-pattern]: "Address.slug" has a pattern without length.max (see the note on ReDoS)',
    'Warning [unbounded-pattern]: "Address.code" has a pattern without length.max (see the note on ReDoS)',
    'Warning [missing-index-field]: index "naturalKey" of "Address" names a field "building" it does not have',
    'Warning [missing-index-field]: index "alt" of "Address" names a field "nope" it does not have',
  ]);
});

test('Lint: decimals the check cannot tell apart at the bounds of the field', () => {
  const schema = Schema.from({
    fine: { type: 'number', decimals: 15 },
    price: { type: 'number', decimals: 2 },
    huge: { type: 'number', decimals: 2, min: 0, max: 1e12 },
    near: { type: 'number', decimals: 12, max: 8 },
    far: { type: 'number', decimals: 12, min: -9 },
  });
  assert.deepStrictEqual(schema.warnings, [
    'Warning [unenforceable-decimals]: "fine" has 15 decimals, which the check tells apart only below 0.0088',
    'Warning [unenforceable-decimals]: "huge" has 2 decimals, which the check tells apart only below 88000000000',
    'Warning [unenforceable-decimals]: "far" has 12 decimals, which the check tells apart only below 8.8',
  ]);
});

test('Lint: aliases anywhere but on a field of a struct are dead', () => {
  const schema = new Schema('Dead', {
    tags: { array: { type: 'string', aliases: ['tag'] } },
    pair: [{ type: 'string', aliases: ['x'] }, 'number'],
    id: { union: [{ type: 'string', aliases: ['key'] }, 'number'] },
    name: { type: 'string', aliases: ['title'] },
    addr: { schema: { city: { type: 'string', aliases: ['town'] } }, aliases: ['address'] },
  });
  const dead = (path) =>
    `Warning [dead-aliases]: "${path}" has aliases, but only a field of a struct is read from them`;
  assert.deepStrictEqual(schema.warnings, [
    dead('Dead.tags[]'),
    dead('Dead.pair[0]'),
    dead('Dead.id|0'),
  ]);
  assert.deepStrictEqual(Schema.from({ type: 'string', aliases: ['x'] }).warnings, [dead('')]);
  assert.deepStrictEqual(Schema.from({ name: { type: 'string', aliases: ['x'] } }).warnings, []);
});

test('Lint: coerce where no conversion can happen is dead', () => {
  const model = new Model({}, [
    ['Company', { Registry: {}, name: 'string' }],
    ['Tag', { Struct: {}, label: 'string' }],
    [
      'Order',
      {
        Struct: {},
        company: { type: 'Company', coerce: true },
        seller: { type: 'Company', coerce: true, embed: true },
        tag: { type: 'Tag', coerce: false },
        meta: { type: 'json', coerce: true },
        raw: { type: 'any', coerce: true },
        perms: { flags: ['read'], coerce: true },
        qty: { type: 'integer', coerce: true },
        items: { array: { type: 'integer', coerce: true } },
      },
    ],
  ]);
  const dead = (path, what) =>
    `Warning [dead-coerce]: "${path}" has coerce, but ${what} is never converted`;
  assert.deepStrictEqual(model.entities.get('Order').warnings, [
    dead('Order.company', 'a reference checked as an id'),
    dead('Order.meta', 'a value of type "json"'),
    dead('Order.raw', 'a value of type "any"'),
    dead('Order.perms', 'a value of type "flags"'),
  ]);
  // A reference that cannot be resolved is checked as an id too.
  assert.deepStrictEqual(Schema.from({ owner: { type: 'Owner', coerce: true } }).warnings, [
    dead('owner', 'a reference checked as an id'),
  ]);
});

test('Lint: a model collects the warnings of its entities and its own', () => {
  const model = new Model({}, [
    ['A', { Entity: {}, b: 'B', name: { type: 'string', typo: 1 } }],
    ['B', { Entity: {}, a: 'A', c: 'C' }],
  ]);
  assert.deepStrictEqual(model.warnings, [
    'Warning [unknown-option]: option "typo" of "A.name" is not known to type "string"',
    'Warning [missing-reference]: "C" referenced by "B" is not found',
    'Warning [recursive-reference]: "B" depends on "A" recursively',
  ]);
  const fixture = require('../fixtures/schemas/index.js');
  const { database, types: customTypes, ...schemas } = fixture;
  const types = { datetime: { js: 'string' }, ...customTypes };
  const clean = new Model(types, Object.entries(schemas), database);
  assert.deepStrictEqual(clean.warnings, []);
  // A detached schema still reports a type it cannot resolve.
  const isolated = new Model({ coin: { js: 'number' } }, [], null, { registry: 'isolated' });
  const item = new Schema('Item', { amount: 'coin' }, [isolated]);
  assert.deepStrictEqual(item.checkConsistency(), []);
  item.detach(isolated);
  assert.deepStrictEqual(item.checkConsistency(), [
    'Warning [missing-type]: type "coin" is not found in "Item"',
  ]);
});
