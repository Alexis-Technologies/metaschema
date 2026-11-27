// The subpath against the real bson (a devDependency, the one the mongodb
// driver re-exports), where mongodb.test.js has fakes: the driver is kept
// for one process, so this runs in a file of its own.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

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

describe('Mongodb', () => {
  it('should recognise the real bson by its tag and read it by its methods', () => {
    register({ bson });
    register({ bson });
    assert.equal(typeof COERCIONS.objectId, 'function');
    assert.equal(typeof COERCIONS.decimal128, 'function');
    assert.equal(typeof COERCIONS.binary, 'function');
    const value = {
      accountId: A,
      login: 'ann',
      company: B,
      balance: '12.50',
      avatar: 'aGk=',
      owner: B,
    };
    const parsed = Account.parse(value, { coerce: true });
    assert.equal(parsed.valid, true, JSON.stringify(parsed.issues));
    assert.ok(parsed.value.owner instanceof bson.ObjectId);
    assert.ok(parsed.value.balance instanceof bson.Decimal128);
    assert.equal(parsed.value.balance.toString(), '12.50');
    assert.ok(parsed.value.avatar instanceof bson.Binary);
    assert.deepEqual(Array.from(parsed.value.avatar.buffer), [104, 105]);
    // A value of bson given as it is passes the check without coercion.
    assert.equal(Account.check(parsed.value).valid, true);
    assert.equal(Account.check({ ...parsed.value, owner: new bson.ObjectId(B) }).valid, true);
  });

  it('should convert the BSON types strictly with the real driver', () => {
    register({ bson });
    const schema = Schema.from({ 'd?': 'decimal128', 'b?': 'binary', 'o?': 'objectId' }, [model]);
    // `Decimal128.fromString` reads NaN, inf and an exponent; the converter
    // takes a decimal written as one, or a finite number.
    for (const d of ['NaN', 'inf', 'Infinity', '1e3', '1E+3', ' 1', '', 'abc', NaN, Infinity]) {
      const result = schema.parse({ d }, { coerce: true });
      assert.equal(result.valid, false, String(d));
      assert.equal(result.issues[0].path[0], 'd');
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
      assert.equal(result.valid, true, String(d));
      assert.equal(result.value.d.toString(), text);
    }
    // Text of the base64 shape only: the decoder reads anything.
    for (const b of ['', 'not base64 !!!', 'aGk', 'aGk=x']) {
      assert.equal(schema.parse({ b }, { coerce: true }).valid, false, b);
    }
    assert.deepEqual(
      Array.from(schema.parse({ b: 'aGk=' }, { coerce: true }).value.b.buffer),
      [104, 105],
    );
    // 24 hex digits only.
    assert.equal(schema.parse({ o: 'x'.repeat(24) }, { coerce: true }).valid, false);
    assert.equal(schema.parse({ o: A }, { coerce: true }).value.o.toHexString(), A);
  });

  it('should write bytes out as a Uint8Array and read them back from a Binary', () => {
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
    assert.equal(document.data, value.data);
    // The driver writes a Uint8Array as binData and reads it back as a Binary.
    const stored = bson.deserialize(bson.serialize(document));
    assert.equal(stored.data instanceof bson.Binary, true);
    const result = fromDocument(File, stored);
    assert.equal(result.valid, true);
    assert.deepEqual(Array.from(result.value.data), [1, 2, 3]);
    assert.deepEqual(Array.from(result.value.parts[0]), [97, 98]);
    assert.equal(result.value.parts[1].length, 0);
    assert.equal(result.value.fileId, A);
    // A Binary where the field is no bytes is left for the check.
    const wrong = fromDocument(File, { ...stored, tag: stored.data });
    assert.deepEqual(
      wrong.issues.map((issue) => issue.path),
      [['tag']],
    );
    const { toJSONSchema } = require('../../src/generators/index.js');
    assert.deepEqual(toJSONSchema(File, { target: 'mongodb' }).properties.data, {
      bsonType: 'binData',
    });
    // The bytes are a copy, not a view of the memory the driver read into.
    assert.notEqual(result.value.data.buffer, stored.data.buffer.buffer);
    assert.equal(result.value.data.buffer.byteLength, 3);
    // The old generic subtype is bytes too; a UUID (subtype 4) is not, so that
    // it is never written back as generic binary data.
    const old = new bson.Binary(new Uint8Array([7, 8]), 2);
    const read = (data) =>
      fromDocument(File, bson.deserialize(bson.serialize({ ...document, data })));
    assert.deepEqual(Array.from(read(old).value.data), [7, 8]);
    const uuid = new bson.UUID();
    assert.deepEqual(
      read(uuid).issues.map((issue) => [issue.code, issue.path]),
      [['type', ['data']]],
    );
  });

  it('should round-trip a document with real ObjectIds', () => {
    register({ bson });
    const value = { accountId: A, login: 'ann', company: B };
    const document = toDocument(Account, value);
    assert.ok(document[ID] instanceof bson.ObjectId);
    assert.equal(document[ID].toHexString(), A);
    assert.ok(document.company instanceof bson.ObjectId);
    assert.deepEqual(Object.keys(document), [ID, 'login', 'company']);
    // What the driver would give back: the same values, deserialized by bson.
    const stored = bson.deserialize(bson.serialize(document));
    const back = fromDocument(Account, stored);
    assert.equal(back.valid, true, JSON.stringify(back.issues));
    assert.deepEqual(back.value, value);
  });
});
