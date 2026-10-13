const { test } = require('node:test');
const assert = require('node:assert');

const { Model } = require('../../index.js');
const { types, register } = require('../../src/mongodb/index.js');
const { COERCIONS } = require('../../src/coerce/index.js');

// A module of bson without Decimal128 or Binary (a slim build, or a driver
// that renamed them): the driver is kept for one process, so this runs in a
// file of its own.
class ObjectId {
  constructor(hex) {
    this.hex = hex;
  }

  get _bsontype() {
    return 'ObjectId';
  }

  toHexString() {
    return this.hex;
  }
}

test('Mongodb: register() installs the converters of the types the module can build', () => {
  register({ bson: { ObjectId } });
  assert.strictEqual(typeof COERCIONS.objectId, 'function');
  assert.strictEqual(COERCIONS.decimal128, undefined);
  assert.strictEqual(COERCIONS.binary, undefined);
  const model = new Model({ ...types }, [
    ['Doc', { Struct: {}, id: 'objectId', 'd?': 'decimal128', 'b?': 'binary' }],
  ]);
  const schema = model.entities.get('Doc');
  const hex = 'a'.repeat(24);
  const converted = schema.parse({ id: hex }, { coerce: true });
  assert.strictEqual(converted.valid, true, JSON.stringify(converted.issues));
  assert.strictEqual(converted.value.id.toHexString(), hex);
  // A value of a type the module cannot build is reported, not lost.
  const kept = schema.parse({ id: hex, d: '1.5', b: 'aGk=' }, { coerce: true });
  assert.deepStrictEqual(
    kept.issues.map((issue) => `${issue.path[0]} ${issue.code}`),
    ['d type', 'b type'],
  );
});
