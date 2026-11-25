const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

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

describe('Mongodb', () => {
  it('should install with register() the converters of the types the module can build', () => {
    register({ bson: { ObjectId } });
    assert.equal(typeof COERCIONS.objectId, 'function');
    assert.equal(COERCIONS.decimal128, undefined);
    assert.equal(COERCIONS.binary, undefined);
    const model = new Model({ ...types }, [
      ['Doc', { Struct: {}, id: 'objectId', 'd?': 'decimal128', 'b?': 'binary' }],
    ]);
    const schema = model.entities.get('Doc');
    const hex = 'a'.repeat(24);
    const converted = schema.parse({ id: hex }, { coerce: true });
    assert.equal(converted.valid, true, JSON.stringify(converted.issues));
    assert.equal(converted.value.id.toHexString(), hex);
    // A value of a type the module cannot build is reported, not lost.
    const kept = schema.parse({ id: hex, d: '1.5', b: 'aGk=' }, { coerce: true });
    assert.deepEqual(
      kept.issues.map((issue) => `${issue.path[0]} ${issue.code}`),
      ['d type', 'b type'],
    );
  });
});
