const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { Schema, Model, SchemaDefinitionError } = require('../../index.js');

describe('Errors', () => {
  it('should name the entity and the field of an unknown type', () => {
    const entities = new Map([
      ['Account', { Entity: {}, login: 'string' }],
      ['Order', { Entity: {}, total: 'strng' }],
    ]);
    assert.throws(
      () => new Model({}, entities),
      (error) => {
        assert.ok(error instanceof SchemaDefinitionError);
        assert.ok(error instanceof TypeError);
        assert.equal(error.name, 'SchemaDefinitionError');
        assert.equal(error.code, 'ERR_UNKNOWN_TYPE');
        assert.equal(error.schema, 'Order');
        assert.equal(error.field, 'total');
        assert.equal(error.message, 'Unknown type "strng" in "Order.total"');
        return true;
      },
    );
  });

  it('should report the field path in nested structs and collections', () => {
    assert.throws(() => new Schema('Order', { address: { city: 'strng' } }), {
      code: 'ERR_UNKNOWN_TYPE',
      schema: 'Order',
      field: 'address.city',
      message: 'Unknown type "strng" in "Order.address.city"',
    });
    assert.throws(() => new Schema('Order', { tags: { array: 'strng' } }), {
      field: 'tags',
      message: 'Unknown type "strng" in "Order.tags"',
    });
    assert.throws(() => Schema.from({ 'deep?': { list: { set: { n: 'strng' } } } }), {
      schema: '',
      field: 'deep.list.n',
      message: 'Unknown type "strng" in "deep.list.n"',
    });
  });

  it('should reject a definition that cannot be parsed', () => {
    assert.throws(() => Schema.from({ a: 42 }), {
      code: 'ERR_INVALID_DEFINITION',
      message: 'Invalid definition: "42" of type number in "a"',
    });
    assert.throws(() => Schema.from({ a: null }), {
      code: 'ERR_INVALID_DEFINITION',
      message: 'Invalid definition: "null" of type null in "a"',
    });
    assert.throws(() => Schema.from(42), {
      code: 'ERR_INVALID_DEFINITION',
      schema: '',
      field: '',
      message: 'Invalid definition: "42" of type number',
    });
  });

  it('should give every definition error its code', () => {
    const cases = [
      [() => Schema.from({ data: 'schema' }), 'ERR_MISSING_SCHEMA'],
      [() => Schema.from({ point: { type: 'tuple', value: 'number' } }), 'ERR_INVALID_TUPLE'],
      [() => Schema.from({ point: [() => 1] }), 'ERR_INVALID_TUPLE'],
      [() => Schema.from({ shape: { union: [] } }), 'ERR_INVALID_UNION'],
      [() => new Model({}, [['P', { Projection: {} }]]), 'ERR_PROJECTION'],
      [
        () => new Model({}, [['P', { Projection: { schema: 'Nope', fields: ['a'] } }]]),
        'ERR_PROJECTION',
      ],
      [() => new Model({ bad: null }, []), 'ERR_INVALID_CUSTOM_TYPE'],
      [() => new Model({ bad: {} }, []), 'ERR_INVALID_CUSTOM_TYPE'],
      [() => new Model({ bad: { construct: 1, checkType: 2 } }, []), 'ERR_INVALID_CUSTOM_TYPE'],
    ];
    for (const [build, code] of cases) {
      assert.throws(build, { name: 'SchemaDefinitionError', code }, code);
    }
    assert.throws(() => Schema.from({ point: { tuple: 'number' } }), {
      message: 'Tuple needs a list of element definitions in "point"',
    });
    assert.throws(() => Schema.from({ point: ['number', () => 1] }), {
      message: 'Tuple element 1 cannot be a function in "point"',
    });
    assert.throws(
      () => new Model({}, [['Signin', { Projection: { schema: 'Nope', fields: ['a'] } }]]),
      {
        message: 'Projection "Signin" parent "Nope" is not found',
      },
    );
    assert.throws(() => new Model({ bad: {} }, []), {
      message: 'Custom type "bad" must contain "construct" and "checkType" methods',
    });
  });

  it('should reserve the keys that would replace a method of the field', () => {
    const reserved = ['constructor', 'prototype', 'check', 'checkType', 'construct', 'toJSON'];
    for (const key of reserved) {
      assert.throws(() => Schema.from({ a: { type: 'string', [key]: 'x' } }), {
        name: 'SchemaDefinitionError',
        code: 'ERR_RESERVED_KEY',
        message: `Key "${key}" is reserved in a field definition in "a"`,
      });
    }
    assert.throws(() => Schema.from({ a: JSON.parse('{"type":"string","__proto__":{"x":1}}') }), {
      code: 'ERR_RESERVED_KEY',
      message: 'Key "__proto__" is reserved in a field definition in "a"',
    });
    assert.throws(() => Schema.from({ tags: { array: 'string', isInstance: 1 } }), {
      code: 'ERR_RESERVED_KEY',
      message: 'Key "isInstance" is reserved in a field definition in "tags"',
    });
    assert.throws(() => Schema.from({ byKey: { object: { string: 'number' }, compile: 1 } }), {
      code: 'ERR_RESERVED_KEY',
      message: 'Key "compile" is reserved in a field definition in "byKey"',
    });
    const allowed = Schema.from({
      a: { type: 'string', validate: () => true, default: 'x', unique: true, note: 'free' },
    });
    assert.equal(allowed.fields.a.note, 'free');
    assert.equal(allowed.check({ a: 'y' }).valid, true);
  });
});
