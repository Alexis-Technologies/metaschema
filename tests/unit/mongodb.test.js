const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');

const { Schema, Model } = require('../../index.js');
const mongo = require('../../src/mongodb/index.js');
const { COERCIONS } = require('../../src/coerce/index.js');
const { compile, canEval } = require('../../src/compile/index.js');
const { toJSONSchema } = require('../../src/generators/index.js');

const { types, register, toDocument, fromDocument, fromDocumentAsync } = mongo;
const { indexesOf, checkUpdate, toUpdate } = mongo;

// The classes of bson as the subpath reads them: a getter of `_bsontype`
// (bson 5 and 6), and the methods JSON cannot give a value.
class ObjectId {
  constructor(hex) {
    if (!/^[0-9a-f]{24}$/i.test(hex)) throw new TypeError('not an ObjectId');
    this.hex = hex.toLowerCase();
  }

  get _bsontype() {
    return 'ObjectId';
  }

  toHexString() {
    return this.hex;
  }
}

class Decimal128 {
  constructor(text) {
    this.text = text;
  }

  static fromString(text) {
    if (!/^-?\d+(\.\d+)?$/.test(text)) throw new TypeError('not a decimal');
    return new Decimal128(text);
  }

  get _bsontype() {
    return 'Decimal128';
  }

  toJSON() {
    return { $numberDecimal: this.text };
  }
}

class Binary {
  constructor(bytes) {
    this.bytes = bytes;
  }

  static createFromBase64(text) {
    return new Binary(Uint8Array.from(Buffer.from(text, 'base64')));
  }

  get _bsontype() {
    return 'Binary';
  }

  toJSON() {
    return Buffer.from(this.bytes).toString('base64');
  }
}

const bson = { ObjectId, Decimal128, Binary };

// The key of a document.
const ID = '_id';

const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const C = 'cccccccccccccccccccccccc';

const fixture = () => {
  const { database, types: own, ...entities } = require('../fixtures/schemas/index.js');
  return new Model(
    { datetime: { js: 'string' }, ...own, ...types },
    new Map(Object.entries(entities)),
    database,
  );
};

const model = new Model({ ...types }, [
  ['Company', { Registry: {}, name: { type: 'string', unique: true } }],
  ['Tag', { Struct: {}, label: 'string', weight: '?number' }],
  [
    'Account',
    {
      Entity: {},
      login: { type: 'string', unique: true, length: { max: 20 } },
      company: 'Company',
      'partners?': { many: 'Company' },
      tags: { array: 'Tag' },
      address: { city: 'string', 'zip?': { type: 'string', index: true } },
      visits: { type: 'integer', default: 0 },
      balance: '?decimal128',
      avatar: '?binary',
      owner: '?objectId',
      joined: { type: 'date', serialize: (date) => date, default: () => new Date(0) },
      pair: ['string', 'Company'],
      shape: {
        union: [
          { schema: { kind: { enum: ['link'] }, to: 'Company' } },
          { schema: { kind: { enum: ['note'] }, text: 'string' } },
        ],
        discriminator: 'kind',
      },
      notes: { object: { string: 'Tag' } },
      meta: 'json',
      byLogin: { unique: ['login', 'company'] },
      display: (account) => account.login,
    },
  ],
]);
const Account = model.entities.get('Account');

const account = {
  accountId: A,
  login: 'ann',
  company: B,
  partners: [B, C],
  tags: [{ label: 'x' }],
  address: { city: 'Kyiv' },
  visits: 3,
  joined: new Date(1000),
  pair: ['p', C],
  shape: { kind: 'link', to: C },
  notes: { a: { label: 'y' } },
  meta: { any: 'thing' },
};

test('Mongodb: before register() a document cannot be made, the types are data', () => {
  assert.throws(() => toDocument(Account, account), {
    name: 'TypeError',
    code: 'ERR_NOT_REGISTERED',
    message: 'An ObjectId needs register() of @alexify/metaschema/mongodb first',
  });
  // Reading needs no driver (an ObjectId is read by its method); the parse
  // that follows coerces, which is the other table nothing registered yet.
  assert.throws(() => fromDocument(Account, {}), {
    code: 'ERR_NOT_REGISTERED',
    message: 'coerce needs register() of @alexify/metaschema/coerce first',
  });
  assert.throws(() => toUpdate(Account, { $set: {} }), { code: 'ERR_NOT_REGISTERED' });
  // Ids kept as strings need no driver either.
  const strings = toDocument(Account, account, { ids: 'string' });
  assert.strictEqual(strings[ID], A);
  assert.strictEqual(strings.company, B);
  assert.deepStrictEqual(toUpdate(Account, { $set: { company: B } }, { ids: 'string' }), {
    $set: { company: B },
  });
  // The types, the indexes and the check of an update need no driver.
  assert.strictEqual(Object.isFrozen(types), true);
  assert.deepStrictEqual(Object.keys(types), ['objectId', 'decimal128', 'binary']);
  assert.strictEqual(checkUpdate(Account, { $set: { login: 'b' } }).valid, true);
  assert.ok(indexesOf(Account).length > 0);
  for (const options of [undefined, null, {}, { bson: null }, { bson: {} }, { bson: 'mongodb' }]) {
    assert.throws(() => register(options), {
      name: 'TypeError',
      message: /^bson must be the module of the mongodb driver or of bson/,
    });
  }
});

test('Mongodb: register() keeps the driver and teaches coercion the BSON types', () => {
  register({ bson });
  register({ bson });
  assert.throws(() => register({ bson: { ObjectId } }), {
    message: 'bson must be the module registered before, got "another one"',
  });
  assert.strictEqual(typeof COERCIONS.objectId, 'function');
  const schema = model.entities.get('Account');
  const parsed = schema.parse(
    { ...account, owner: A, balance: '12.50', avatar: 'aGk=' },
    { coerce: true },
  );
  assert.strictEqual(parsed.valid, true, JSON.stringify(parsed.issues));
  assert.ok(parsed.value.owner instanceof ObjectId);
  assert.strictEqual(parsed.value.owner.toHexString(), A);
  assert.ok(parsed.value.balance instanceof Decimal128);
  assert.deepStrictEqual(Array.from(parsed.value.avatar.bytes), [104, 105]);
  // What a converter cannot read stays, for the check to report.
  const bad = schema.parse({ ...account, owner: 'x', balance: '1e3' }, { coerce: true });
  assert.deepStrictEqual(
    bad.issues.map((issue) => `${issue.path.join('.')} ${issue.code}`),
    ['balance type', 'owner type'].sort((a, b) => (a < b ? -1 : 1)),
  );
});

test('Mongodb: a value of bson is one by its tag and a method, in any realm', () => {
  register({ bson });
  const owner = Schema.from({ id: 'objectId' }, [model]);
  assert.strictEqual(owner.check({ id: new ObjectId(A) }).valid, true);
  // bson 4 named it ObjectID, as a property of its prototype.
  class Old {
    toHexString() {
      return A;
    }
  }
  Object.defineProperty(Old.prototype, '_bsontype', { value: 'ObjectID' });
  assert.strictEqual(owner.check({ id: new Old() }).valid, true);
  // A body of a request that claims to be one is data.
  assert.strictEqual(
    owner.check({ id: JSON.parse(`{"_bsontype":"ObjectId","id":"${A}"}`) }).valid,
    false,
  );
  // An ObjectId of another realm is one.
  const foreign = vm.runInNewContext(
    `({ get _bsontype() { return 'ObjectId'; }, toHexString() { return '${A}'; } })`,
  );
  assert.strictEqual(owner.check({ id: foreign }).valid, true);
  const binary = Schema.from({ b: 'binary' }, [model]);
  assert.strictEqual(binary.check({ b: new Uint8Array(2) }).valid, true);
  assert.strictEqual(binary.check({ b: [1, 2] }).valid, false);
  // The mongodb target renders them by their BSON types, JSON Schema by the wire form.
  const json = toJSONSchema(Schema.from({ o: 'objectId', d: 'decimal128', b: 'binary' }, [model]), {
    target: 'mongodb',
  });
  assert.deepStrictEqual(json.properties.o, { bsonType: 'objectId' });
  assert.deepStrictEqual(json.properties.d, { bsonType: 'decimal' });
  assert.deepStrictEqual(json.properties.b, { bsonType: 'binData' });
  const wire = toJSONSchema(Schema.from({ o: 'objectId' }, [model]));
  assert.deepStrictEqual(wire.properties.o, { type: 'string', pattern: '^[0-9a-fA-F]{24}$' });
  // Two models take the same table, and a model of its own registry too.
  assert.ok(new Model({ ...types }, []));
  assert.ok(new Model({ ...types }, [], null, { registry: 'isolated' }));
  assert.throws(() => new Model({ objectId: { js: 'string' } }, []), {
    code: 'ERR_TYPE_REGISTERED',
  });
});

test('Mongodb: a record to a document and back', () => {
  register({ bson });
  for (const schema of [
    Account,
    (() => {
      const copy = model.entities.get('Account');
      return copy;
    })(),
  ]) {
    const document = toDocument(schema, account);
    assert.deepStrictEqual(Object.keys(document), [
      '_id',
      'login',
      'company',
      'partners',
      'tags',
      'address',
      'visits',
      'joined',
      'pair',
      'shape',
      'notes',
      'meta',
    ]);
    const hex = (id) => id.toHexString();
    assert.strictEqual(hex(document[ID]), A);
    assert.strictEqual(hex(document.company), B);
    assert.deepStrictEqual(document.partners.map(hex), [B, C]);
    assert.strictEqual(hex(document.pair[1]), C);
    assert.strictEqual(hex(document.shape.to), C);
    assert.deepStrictEqual(document.tags, [{ label: 'x' }]);
    assert.deepStrictEqual(document.notes, { a: { label: 'y' } });
    assert.deepStrictEqual(document.meta, { any: 'thing' });
    // Back: the id field again, the ids strings, parse run.
    const back = fromDocument(schema, document);
    assert.strictEqual(back.valid, true, JSON.stringify(back.issues));
    assert.deepStrictEqual(back.value, schema.parse(account).value);
  }
  // The value given is not written to.
  const frozen = Object.freeze({ ...account, address: Object.freeze({ city: 'Kyiv' }) });
  assert.doesNotThrow(() => toDocument(Account, frozen));
  // No id yet: no _id, the database gives one; ids as strings on request.
  const fresh = toDocument(Account, { ...account, accountId: undefined });
  assert.strictEqual('_id' in fresh, false);
  const strings = toDocument(Account, account, { ids: 'string' });
  assert.strictEqual(strings[ID], A);
  assert.strictEqual(strings.company, B);
  // A string that is no ObjectId stays a string.
  assert.strictEqual(toDocument(Account, { ...account, company: 'c-1' }).company, 'c-1');
  // An _id the record has no field for is the database's, and goes.
  const tag = model.entities.get('Tag');
  assert.deepStrictEqual(fromDocument(tag, { _id: new ObjectId(A), label: 'x' }).value, {
    label: 'x',
  });
  assert.deepStrictEqual(toDocument(tag, { label: 'x', weight: 1 }), { label: 'x', weight: 1 });
});

test('Mongodb: embedded records, an own _id, an anonymous stored schema, loops', () => {
  register({ bson });
  const orders = new Model({}, [
    ['Company', { Registry: {}, name: 'string' }],
    ['Order', { Entity: {}, company: 'Company', 'seller?': { type: 'Company', embed: true } }],
  ]);
  const Order = orders.entities.get('Order');
  const company = { companyId: B, name: 'Acme' };
  const graph = toDocument(Order, { orderId: A, company }, { references: 'embed' });
  assert.strictEqual(graph.company[ID].toHexString(), B);
  assert.strictEqual(graph.company.name, 'Acme');
  const back = fromDocument(Order, graph, { references: 'embed' });
  assert.strictEqual(back.valid, true, JSON.stringify(back.issues));
  assert.deepStrictEqual(back.value, { orderId: A, company });
  // A field that embeds is a record whatever the call says.
  const sold = toDocument(Order, { company: B, seller: company });
  assert.strictEqual(sold.company.toHexString(), B);
  assert.strictEqual(sold.seller[ID].toHexString(), B);
  assert.deepStrictEqual(fromDocument(Order, sold).value, { company: B, seller: company });
  // A schema with an _id of its own keeps it as a field.
  const own = new Schema('Own', { Entity: {}, _id: 'string', name: 'string' });
  assert.deepStrictEqual(toDocument(own, { _id: 'x', name: 'n' }), { _id: 'x', name: 'n' });
  assert.deepStrictEqual(fromDocument(own, { _id: 'x', name: 'n' }).value, { _id: 'x', name: 'n' });
  // An `_id` beside the id field of a record (a body checked with `unknown:
  // 'ignore'`, or not checked) is not the record's id and is left out.
  const injected = toDocument(Order, { orderId: A, company: B, _id: { $gt: '' } });
  assert.strictEqual(injected[ID].toHexString(), A);
  assert.deepStrictEqual(Object.keys(injected), [ID, 'company']);
  assert.deepStrictEqual(Object.keys(toDocument(Order, { company: B, _id: 'x' })), ['company']);
  // What `findOne` gives for nothing is reported by the check, not thrown.
  assert.deepStrictEqual(fromDocument(Order, null).issues[0].code, 'type');
  assert.deepStrictEqual(toDocument(Order, null), null);
  assert.strictEqual(fromDocument(Order, undefined).valid, false);
  // An anonymous stored schema names its id `id`.
  const anonymous = Schema.from({ Entity: {}, name: 'string' });
  assert.strictEqual(toDocument(anonymous, { id: A, name: 'n' })[ID].toHexString(), A);
  assert.deepStrictEqual(fromDocument(anonymous, { _id: new ObjectId(A), name: 'n' }).value, {
    id: A,
    name: 'n',
  });
  // A record met again on its own path comes as it is.
  const loop = { companyId: B, name: 'Acme' };
  loop.self = loop;
  const looped = new Model({}, [['Node', { Struct: {}, name: 'string', 'next?': 'Node' }]]);
  const node = { name: 'a' };
  node.next = node;
  assert.strictEqual(
    toDocument(looped.entities.get('Node'), node, { references: 'embed' }).next,
    node,
  );
});

test('Mongodb: fromDocument coerces, takes the options of parse, and has an async twin', async () => {
  register({ bson });
  const document = toDocument(Account, account);
  const stored = { ...document, visits: '7', __v: 0 };
  assert.strictEqual(fromDocument(Account, stored).valid, false);
  const stripped = fromDocument(Account, stored, { unknown: 'strip' });
  assert.strictEqual(stripped.valid, true, JSON.stringify(stripped.issues));
  assert.strictEqual(stripped.value.visits, 7);
  assert.strictEqual(
    fromDocument(Account, stored, { unknown: 'strip', coerce: false }).valid,
    false,
  );
  const promised = await fromDocumentAsync(Account, document);
  assert.strictEqual(promised.valid, true);
  await assert.rejects(() => fromDocumentAsync(null, {}), { code: 'ERR_INVALID_TARGET' });
  // A number where an id is: coerced to the string of the id field, or
  // reported without coercion.
  assert.strictEqual(fromDocument(Account, { ...document, _id: 5 }).value.accountId, '5');
  assert.strictEqual(
    fromDocument(Account, { ...document, _id: 5 }, { coerce: false }).valid,
    false,
  );
  // Both backends.
  const copy = new Model({ ...types }, [
    ['Company', { Registry: {}, name: 'string' }],
    ['Item', { Entity: {}, company: 'Company', qty: 'integer' }],
  ]).entities.get('Item');
  compile(copy, { jit: canEval() ? true : 'auto' });
  assert.deepStrictEqual(
    fromDocument(copy, { _id: new ObjectId(A), company: new ObjectId(B), qty: '2' }).value,
    { itemId: A, company: B, qty: 2 },
  );
});

test('Mongodb: what is not a schema of a struct, or options that are not, throws', () => {
  register({ bson });
  for (const target of [null, {}, Schema.from('string')]) {
    assert.throws(() => toDocument(target, {}), { code: 'ERR_INVALID_TARGET' });
    assert.throws(() => checkUpdate(target, {}), { code: 'ERR_INVALID_TARGET' });
    assert.throws(() => toUpdate(target, {}), { code: 'ERR_INVALID_TARGET' });
  }
  assert.throws(() => indexesOf(Schema.from('string')), { code: 'ERR_INVALID_TARGET' });
  assert.throws(() => checkUpdate(Account, [{ $set: {} }]), {
    code: 'ERR_INVALID_TARGET',
    message: 'An update is an object of operators',
  });
  assert.throws(() => toDocument(Account, account, { ids: 'uuid' }), {
    name: 'TypeError',
    message: 'ids must be "objectId" or "string", got "uuid"',
  });
  assert.throws(() => toDocument(Account, account, { references: 'all' }), { name: 'TypeError' });
  // A value of a class has no document: it is not passed through with its
  // id left a string and no `_id`.
  class Row {}
  for (const root of [new Row(), new Map(), new ObjectId(A)]) {
    assert.throws(() => toDocument(Account, root), {
      code: 'ERR_INVALID_TARGET',
      message: 'A plain object is expected',
    });
    assert.throws(() => fromDocument(Account, root), { code: 'ERR_INVALID_TARGET' });
  }
  assert.strictEqual(toDocument(Account, Object.create(null)) !== null, true);
});

test('Mongodb: the indexes of a schema and of a model', () => {
  assert.deepStrictEqual(indexesOf(Account), [
    { key: { login: 1, company: 1 }, name: 'byLogin', unique: true },
    { key: { login: 1 }, unique: true },
    { key: { 'address.zip': 1 } },
  ]);
  const fixtureModel = fixture();
  assert.deepStrictEqual(indexesOf(fixtureModel), {
    Identifier: [{ key: { storage: 1 } }, { key: { status: 1 } }],
    Address: [{ key: { city: 1, street: 1, building: 1 }, name: 'naturalKey', unique: true }],
    Company: [{ key: { name: 1 }, unique: true }],
    Account: [{ key: { login: 1 }, unique: true }],
  });
  // A unique field that may be missing is sparse; the structs of a list
  // are indexed by their paths; a primary field is unique.
  const people = new Schema('People', {
    Entity: {},
    'email?': { type: 'string', unique: true },
    code: { type: 'string', primary: true },
    items: { array: { schema: { sku: { type: 'string', index: true } } } },
  });
  assert.deepStrictEqual(indexesOf(people), [
    { key: { email: 1 }, unique: true, sparse: true },
    { key: { code: 1 }, unique: true },
    { key: { 'items.sku': 1 } },
  ]);
  // A memory kind and a projection are no collection.
  const kinds = new Model({}, [
    ['User', { Entity: {}, login: { type: 'string', unique: true } }],
    ['Form', { Form: {}, login: { type: 'string', unique: true } }],
    ['Signin', { Projection: { schema: 'User', fields: ['login'] } }],
  ]);
  assert.deepStrictEqual(Object.keys(indexesOf(kinds)), ['User']);
  assert.throws(() => indexesOf({}), { code: 'ERR_INVALID_TARGET' });
});

test('Mongodb: checkUpdate checks what each operator does to the field of each path', () => {
  const issuesOf = (update, options) =>
    checkUpdate(Account, update, options).issues.map(
      (issue) => `${issue.path.join('.')} ${issue.code}`,
    );
  assert.deepStrictEqual(
    issuesOf({
      $set: { login: 'b', 'address.city': 'Lviv', 'tags.0.label': 'z', 'tags.$.weight': 1 },
      $setOnInsert: { accountId: A, visits: 0 },
      $unset: { 'address.zip': '' },
      $inc: { visits: 1 },
      $mul: { visits: 2 },
      $min: { visits: 0 },
      $currentDate: { joined: true },
      $push: { tags: { $each: [{ label: 'a' }, { label: 'b' }] } },
      $addToSet: { partners: C },
      $pull: { partners: C },
      $pullAll: { partners: [C] },
      $pop: { tags: 1 },
      $max: { 'notes.k.weight': 3 },
    }),
    [],
  );
  assert.deepStrictEqual(
    issuesOf({
      $set: { 'address.city': 1, login: 'x'.repeat(21), 'tags.0.label': 2, 'pair.1': 5 },
      $unset: { login: '' },
      $inc: { visits: 1.5, login: 1 },
      $currentDate: { login: true },
      $push: { tags: 'x', login: 'y', partners: 5 },
      $rename: { a: 'b' },
      set: { a: 1 },
      $max: 5,
    }),
    [
      'address.city type',
      'login length',
      'tags.0.label type',
      'pair.1 type',
      'login required',
      'visits type',
      'login type',
      'login type',
      'tags type',
      'login type',
      'partners type',
      ' unexpected',
    ],
  );
  // A path the schema does not have, and the id of the record.
  assert.deepStrictEqual(issuesOf({ $set: { nope: 1, 'address.nope': 1, 'login.x': 1 } }), [
    ' unexpected',
    'address unexpected',
    'login unexpected',
  ]);
  assert.deepStrictEqual(issuesOf({ $set: { nope: 1 } }, { unknown: 'ignore' }), []);
  assert.deepStrictEqual(issuesOf({ $set: { accountId: A } }, { unknown: 'ignore' }), [
    ' unexpected',
  ]);
  // Not entered: a union, json; a tuple by `$`.
  assert.deepStrictEqual(issuesOf({ $set: { 'shape.text': 5, 'meta.x': 1, 'pair.$': 1 } }), []);
  // __proto__ and constructor are keys like any other.
  assert.deepStrictEqual(issuesOf({ $set: JSON.parse('{"__proto__": 1, "constructor": 1}') }), [
    ' unexpected',
    ' unexpected',
  ]);
  // The options of check.
  assert.strictEqual(issuesOf({ $set: { login: 1, visits: 'x' } }, { maxErrors: 1 }).length, 1);
  assert.deepStrictEqual(checkUpdate(Account, { $set: { login: 1 } }, { root: 'Patch' }).errors, [
    'Field "Patch.login" not of expected type: string',
  ]);
  const uk = require('../../src/locales/uk.js');
  assert.notDeepStrictEqual(
    checkUpdate(Account, { $set: { login: 1 } }, { messages: uk }).errors,
    checkUpdate(Account, { $set: { login: 1 } }).errors,
  );
  // An embedded record through a reference.
  assert.deepStrictEqual(issuesOf({ $set: { 'company.name': 1 } }, { references: 'embed' }), [
    'company.name type',
  ]);
  // A path that names nothing whatever the policy says: an empty segment,
  // the `_id` of the document, a part a field cannot have (an element of a
  // string, a field of an id); a key a struct does not have is the policy's.
  const ignore = { unknown: 'ignore' };
  for (const path of ['', 'a..b', 'address.', '.login', '_id', 'login.x', 'login.$[x]']) {
    assert.deepStrictEqual(issuesOf({ $set: { [path]: 1 } }, ignore).length, 1, path);
    assert.strictEqual(issuesOf({ $set: { [path]: 1 } }, ignore)[0].endsWith('unexpected'), true);
  }
  assert.deepStrictEqual(issuesOf({ $set: { 'company.name': 1 } }, ignore), ['company unexpected']);
  assert.deepStrictEqual(issuesOf({ $setOnInsert: { _id: A } }, ignore), []);
  assert.deepStrictEqual(issuesOf({ $setOnInsert: { _id: A } }), [' unexpected']);
  const own = new Schema('Own', { Entity: {}, _id: 'string', name: 'string' });
  assert.strictEqual(checkUpdate(own, { $set: { _id: 'x' } }).valid, true);
  // The issue of an operand names what the operator takes.
  assert.deepStrictEqual(
    checkUpdate(Account, { $push: { login: 'y' }, $inc: { login: 1, visits: 1.5 } }).errors,
    [
      'Field "Account.login" not of expected type: array',
      'Field "Account.login" not of expected type: number',
      'Field "Account.visits" not of expected type: integer',
    ],
  );
  // A path through more embedded records than maxDepth.
  const chain = new Model({}, [['Node', { Struct: {}, name: 'string', 'next?': 'Node' }]]);
  const Node = chain.entities.get('Node');
  const deep = `${'next.'.repeat(200)}name`;
  assert.strictEqual(checkUpdate(Node, { $set: { [deep]: 'x' } }).issues[0].code, 'depth');
  assert.strictEqual(checkUpdate(Node, { $set: { [deep]: 'x' } }, { maxDepth: 300 }).valid, true);
  assert.deepStrictEqual(Object.keys(toUpdate(Node, { $set: { [deep]: 'x' } }).$set), [deep]);
});

test('Mongodb: the shapes of the walks are those of the passes of the core', () => {
  const { SHAPES } = require('../../src/mongodb/document.js');
  const { infoOf } = require('../../src/codec.js');
  const { fields } = Account;
  assert.strictEqual(infoOf(Account).shape, SHAPES.SCHEMA);
  assert.strictEqual(infoOf(fields).shape, SHAPES.FIELDS);
  assert.strictEqual(infoOf(fields.address).shape, SHAPES.NESTED);
  assert.strictEqual(infoOf(fields.tags).shape, SHAPES.LIST);
  assert.strictEqual(infoOf(fields.notes).shape, SHAPES.KEYED);
  assert.strictEqual(infoOf(fields.pair).shape, SHAPES.TUPLE);
  assert.strictEqual(infoOf(fields.shape).shape, SHAPES.UNION);
  assert.strictEqual(infoOf(fields.company).shape, SHAPES.REFERENCE);
  assert.strictEqual(infoOf(fields.partners).shape, SHAPES.REFERENCE);
  assert.strictEqual(infoOf(fields.login).shape, SHAPES.LEAF);
  assert.strictEqual(infoOf(fields.meta).shape, SHAPES.LEAF);
  assert.strictEqual(Object.isFrozen(SHAPES), true);
});

test('Mongodb: the walks of a document stop at maxDepth as the check does', () => {
  register({ bson });
  const chain = new Model({}, [['Node', { Struct: {}, name: 'string', 'next?': 'Node' }]]);
  const Node = chain.entities.get('Node');
  let graph = { name: 'leaf' };
  for (let index = 0; index < 20_000; index += 1) graph = { name: `n${index}`, next: graph };
  // No RangeError: the records past the limit are left as they are, and
  // the check reports the depth.
  const document = toDocument(Node, graph);
  assert.strictEqual(document.name, 'n19999');
  const read = fromDocument(Node, document);
  assert.strictEqual(read.valid, false);
  assert.strictEqual(read.issues[0].code, 'depth');
  let shallow = { name: 'leaf' };
  for (let index = 0; index < 150; index += 1) shallow = { name: `n${index}`, next: shallow };
  assert.strictEqual(fromDocument(Node, toDocument(Node, shallow)).valid, false);
  assert.strictEqual(
    fromDocument(Node, toDocument(Node, shallow, { maxDepth: 200 }), { maxDepth: 200 }).valid,
    true,
  );
  assert.throws(() => toDocument(Node, shallow, { maxDepth: 0 }), {
    name: 'TypeError',
    message: 'maxDepth must be a positive integer, got 0',
  });
});

test('Mongodb: toUpdate serializes the values and makes their ids ObjectIds', () => {
  register({ bson });
  const update = toUpdate(Account, {
    $set: { company: B, 'pair.1': C, login: 'b', joined: new Date(5) },
    $setOnInsert: { accountId: A },
    $push: { partners: { $each: [C], $position: 0 } },
    $addToSet: { partners: B },
    $pull: { partners: C },
    $pullAll: { partners: [B, C] },
    $inc: { visits: 1 },
    $currentDate: { joined: true },
    $unset: { nope: '' },
    $pop: 5,
  });
  const hex = (id) => id.toHexString();
  assert.strictEqual(hex(update.$set.company), B);
  assert.strictEqual(hex(update.$set['pair.1']), C);
  assert.strictEqual(update.$set.login, 'b');
  assert.strictEqual(hex(update.$setOnInsert[ID]), A);
  assert.deepStrictEqual(update.$push.partners.$each.map(hex), [C]);
  assert.strictEqual(update.$push.partners.$position, 0);
  assert.strictEqual(hex(update.$addToSet.partners), B);
  assert.strictEqual(hex(update.$pull.partners), C);
  assert.deepStrictEqual(update.$pullAll.partners.map(hex), [B, C]);
  assert.deepStrictEqual(update.$inc, { visits: 1 });
  assert.deepStrictEqual(update.$unset, { nope: '' });
  assert.strictEqual(update.$pop, 5);
  // A condition of $pull stays a condition; ids as strings on request.
  const condition = { $in: [B] };
  assert.strictEqual(
    toUpdate(Account, { $pull: { partners: condition } }).$pull.partners,
    condition,
  );
  assert.strictEqual(
    toUpdate(Account, { $set: { company: B } }, { ids: 'string' }).$set.company,
    B,
  );
});

test('Mongodb: the collection validator accepts the document toDocument writes', () => {
  register({ bson });
  const validator = toJSONSchema(model, { target: 'mongodb', ids: 'objectId' }).Account;
  assert.deepStrictEqual(validator.properties[ID], { bsonType: 'objectId' });
  assert.deepStrictEqual(validator.properties.company, { bsonType: 'objectId' });
  assert.strictEqual(validator.required[0], '_id');
  assert.strictEqual('accountId' in validator.properties, false);
  // Every property of the document is one the validator names.
  const document = toDocument(Account, account);
  for (const key of Object.keys(document)) assert.ok(key in validator.properties, key);
  assert.throws(() => toJSONSchema(Account, { ids: 'objectId' }), {
    code: 'ERR_INVALID_OPTIONS',
    message: 'JSON Schema option "ids" "objectId" needs target "mongodb", got "draft-2020-12"',
  });
  assert.throws(() => toJSONSchema(Account, { target: 'mongodb', ids: 'uuid' }), {
    code: 'ERR_INVALID_OPTIONS',
  });
  // Without the option the target describes the program's values, as in 3.2.
  const plain = toJSONSchema(model, { target: 'mongodb' }).Account;
  assert.deepStrictEqual(plain.properties.company, { bsonType: 'string' });
  assert.deepStrictEqual(plain.properties[ID], {});
});

test('Mongodb: maps, alias types and what the BSON converters leave', () => {
  register({ bson });
  const shelves = new Model({ money: { js: 'number' }, ...types }, [
    ['Company', { Registry: {}, name: 'string' }],
    ['Shelf', { Entity: {}, owners: { map: { string: 'Company' } }, price: 'money' }],
  ]);
  const Shelf = shelves.entities.get('Shelf');
  const document = toDocument(Shelf, { owners: new Map([['a', B]]), price: 1 });
  assert.ok(document.owners instanceof Map);
  assert.strictEqual(document.owners.get('a').toHexString(), B);
  // $inc through an alias of number.
  assert.strictEqual(checkUpdate(Shelf, { $inc: { price: 1.5 } }).valid, true);
  assert.strictEqual(checkUpdate(Shelf, { $inc: { price: '1' } }).valid, false);
  // The converters leave what they cannot read.
  const values = Schema.from({ d: '?decimal128', b: '?binary' }, [shelves]);
  const kept = values.parse({ d: true, b: 7 }, { coerce: true });
  assert.deepStrictEqual(
    kept.issues.map((issue) => issue.path[0]),
    ['d', 'b'],
  );
  assert.strictEqual(values.parse({ d: 12 }, { coerce: true }).value.d.text, '12');
  // The decoder of the driver reads any text as base64; the converter
  // takes text of the base64 shape only, and never the empty string.
  for (const b of ['', 'not base64 !!!', 'aGk', 'aGk=x']) {
    assert.strictEqual(values.parse({ b }, { coerce: true }).issues[0]?.path[0], 'b', b);
  }
  assert.deepStrictEqual(
    Array.from(values.parse({ b: 'aGk=' }, { coerce: true }).value.b.bytes),
    [104, 105],
  );
});
