// The subpath against the real bson (a devDependency, the one the mongodb
// driver re-exports), where mongodb.test.js has fakes: the driver is kept
// for one process, so this runs in a file of its own.
const { test } = require('node:test');
const assert = require('node:assert');

const bson = require('bson');

const { Schema, Model } = require('../../index.js');
const { types, register, toDocument, fromDocument } = require('../../src/mongodb/index.js');
const { COERCIONS } = require('../../src/coerce/index.js');

const A = 'a'.repeat(24);
const B = 'b'.repeat(24);

// The key of a document.
const ID = '_id';

const model = new Model({ ...types }, [
  ['Company', { Registry: {}, name: 'string' }],
  [
    'Account',
    {
      Entity: {},
      login: 'string',
      company: 'Company',
      'balance?': 'decimal128',
      'avatar?': 'binary',
      'owner?': 'objectId',
    },
  ],
]);
const Account = model.entities.get('Account');

test('Mongodb: the real bson is recognised by its tag and read by its methods', () => {
  register({ bson });
  register({ bson });
  assert.strictEqual(typeof COERCIONS.objectId, 'function');
  assert.strictEqual(typeof COERCIONS.decimal128, 'function');
  assert.strictEqual(typeof COERCIONS.binary, 'function');
  const value = {
    accountId: A,
    login: 'ann',
    company: B,
    balance: '12.50',
    avatar: 'aGk=',
    owner: B,
  };
  const parsed = Account.parse(value, { coerce: true });
  assert.strictEqual(parsed.valid, true, JSON.stringify(parsed.issues));
  assert.ok(parsed.value.owner instanceof bson.ObjectId);
  assert.ok(parsed.value.balance instanceof bson.Decimal128);
  assert.strictEqual(parsed.value.balance.toString(), '12.50');
  assert.ok(parsed.value.avatar instanceof bson.Binary);
  assert.deepStrictEqual(Array.from(parsed.value.avatar.buffer), [104, 105]);
  // A value of bson given as it is passes the check without coercion.
  assert.strictEqual(Account.check(parsed.value).valid, true);
  assert.strictEqual(Account.check({ ...parsed.value, owner: new bson.ObjectId(B) }).valid, true);
});

test('Mongodb: the converters of the BSON types are strict with the real driver', () => {
  register({ bson });
  const schema = Schema.from({ 'd?': 'decimal128', 'b?': 'binary', 'o?': 'objectId' }, [model]);
  // `Decimal128.fromString` reads NaN, inf and an exponent; the converter
  // takes a decimal written as one, or a finite number.
  for (const d of ['NaN', 'inf', 'Infinity', '1e3', '1E+3', ' 1', '', 'abc', NaN, Infinity]) {
    const result = schema.parse({ d }, { coerce: true });
    assert.strictEqual(result.valid, false, String(d));
    assert.strictEqual(result.issues[0].path[0], 'd');
  }
  for (const [d, text] of [
    ['12.50', '12.50'],
    ['-0.5', '-0.5'],
    ['.5', '0.5'],
    ['1.', '1'],
    [12, '12'],
    [1e21, '1E+21'],
  ]) {
    const result = schema.parse({ d }, { coerce: true });
    assert.strictEqual(result.valid, true, String(d));
    assert.strictEqual(result.value.d.toString(), text);
  }
  // Text of the base64 shape only: the decoder reads anything.
  for (const b of ['', 'not base64 !!!', 'aGk', 'aGk=x']) {
    assert.strictEqual(schema.parse({ b }, { coerce: true }).valid, false, b);
  }
  assert.deepStrictEqual(
    Array.from(schema.parse({ b: 'aGk=' }, { coerce: true }).value.b.buffer),
    [104, 105],
  );
  // 24 hex digits only.
  assert.strictEqual(schema.parse({ o: 'x'.repeat(24) }, { coerce: true }).valid, false);
  assert.strictEqual(schema.parse({ o: A }, { coerce: true }).value.o.toHexString(), A);
});

test('Mongodb: bytes go out as a Uint8Array and come back from a Binary', () => {
  register({ bson });
  const files = new Model({}, [
    [
      'File',
      { Entity: {}, data: 'bytes', 'thumb?': 'bytes', parts: { array: 'bytes' }, tag: 'string' },
    ],
  ]);
  const File = files.entities.get('File');
  const value = {
    fileId: A,
    data: new Uint8Array([1, 2, 3]),
    parts: [Buffer.from('ab'), new Uint8Array(0)],
    tag: 'x',
  };
  const document = toDocument(File, value);
  assert.strictEqual(document.data, value.data);
  // The driver writes a Uint8Array as binData and reads it back as a Binary.
  const stored = bson.deserialize(bson.serialize(document));
  assert.strictEqual(stored.data instanceof bson.Binary, true);
  const result = fromDocument(File, stored);
  assert.strictEqual(result.valid, true);
  assert.deepStrictEqual(Array.from(result.value.data), [1, 2, 3]);
  assert.deepStrictEqual(Array.from(result.value.parts[0]), [97, 98]);
  assert.strictEqual(result.value.parts[1].length, 0);
  assert.strictEqual(result.value.fileId, A);
  // A Binary where the field is no bytes is left for the check.
  const wrong = fromDocument(File, { ...stored, tag: stored.data });
  assert.deepStrictEqual(
    wrong.issues.map((issue) => issue.path),
    [['tag']],
  );
  const { toJSONSchema } = require('../../src/generators/index.js');
  assert.deepStrictEqual(toJSONSchema(File, { target: 'mongodb' }).properties.data, {
    bsonType: 'binData',
  });
});

test('Mongodb: a document with real ObjectIds round-trips', () => {
  register({ bson });
  const value = { accountId: A, login: 'ann', company: B };
  const document = toDocument(Account, value);
  assert.ok(document[ID] instanceof bson.ObjectId);
  assert.strictEqual(document[ID].toHexString(), A);
  assert.ok(document.company instanceof bson.ObjectId);
  assert.deepStrictEqual(Object.keys(document), [ID, 'login', 'company']);
  // What the driver would give back: the same values, deserialized by bson.
  const stored = bson.deserialize(bson.serialize(document));
  const back = fromDocument(Account, stored);
  assert.strictEqual(back.valid, true, JSON.stringify(back.issues));
  assert.deepStrictEqual(back.value, value);
});
