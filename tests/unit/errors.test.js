const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { Schema, Model, SchemaDefinitionError, SchemaUsageError } = require('../../index.js');

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
        assert.equal(error.code, 'ALX_ERR_UNKNOWN_TYPE');
        assert.equal(error.schema, 'Order');
        assert.equal(error.field, 'total');
        assert.equal(error.message, 'Unknown type "strng" in "Order.total"');
        return true;
      },
    );
  });

  it('should report the field path in nested structs and collections', () => {
    assert.throws(() => new Schema('Order', { address: { city: 'strng' } }), {
      code: 'ALX_ERR_UNKNOWN_TYPE',
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
      code: 'ALX_ERR_INVALID_DEFINITION',
      message: 'Invalid definition: "42" of type number in "a"',
    });
    assert.throws(() => Schema.from({ a: null }), {
      code: 'ALX_ERR_INVALID_DEFINITION',
      message: 'Invalid definition: "null" of type null in "a"',
    });
    assert.throws(() => Schema.from(42), {
      code: 'ALX_ERR_INVALID_DEFINITION',
      schema: '',
      field: '',
      message: 'Invalid definition: "42" of type number',
    });
  });

  it('should carry the error that caused it as the standard cause', () => {
    // A pattern that does not compile: the SyntaxError of the engine is the
    // cause, set by the option of the Error constructor (not enumerable, so
    // JSON and the own keys of the error do not carry it).
    assert.throws(
      () => Schema.from({ s: { type: 'string', pattern: '(' } }),
      (error) =>
        error.code === 'ALX_ERR_INVALID_RULE' &&
        error.cause instanceof SyntaxError &&
        !Object.keys(error).includes('cause'),
    );
    const caused = new SchemaDefinitionError('x', { code: 'ALX_ERR_INVALID_RULE', cause: 1 });
    assert.equal(caused.cause, 1);
    // No own `cause` unless one is given: `options` goes to Error whole.
    assert.equal(Object.hasOwn(new SchemaDefinitionError('x'), 'cause'), false);
  });

  it('should take (message, options = {}) as Error does, with the code and the fields in options', () => {
    const plain = new SchemaDefinitionError('Broken');
    assert.equal(plain.message, 'Broken');
    assert.equal(plain.code, 'ALX_ERR_INVALID_DEFINITION');
    assert.deepEqual([plain.schema, plain.field], ['', '']);
    assert.equal(Object.hasOwn(plain, 'seed'), false);
    const drawn = new SchemaDefinitionError('No value', { code: 'ALX_ERR_UNSATISFIABLE', seed: 7 });
    assert.deepEqual([drawn.code, drawn.seed], ['ALX_ERR_UNSATISFIABLE', 7]);
    const placed = new SchemaDefinitionError('Bad', { code: 'ALX_ERR_MERGE_CONFLICT', field: 'a' });
    assert.equal(placed.locate('Order', '').message, 'Bad in "Order.a"');
    const usage = new SchemaUsageError('Not a Schema');
    assert.equal(usage.code, 'ALX_ERR_INVALID_TARGET');
    assert.equal(usage.name, 'SchemaUsageError');
    const record = { a: 1 };
    const options = { code: 'ALX_ERR_INVALID_RECORD', index: 2, record, method: 'check' };
    const invalid = new SchemaUsageError('Record 2 is invalid', options);
    assert.deepEqual([invalid.index, invalid.record, invalid.method], [2, record, 'check']);
    assert.equal(Object.hasOwn(invalid, 'result'), false);
    // A key of the options that is no field of the class stays out.
    assert.equal(Object.hasOwn(new SchemaUsageError('x', { seed: 1 }), 'seed'), false);
  });

  it('should give every definition error its code', () => {
    const cases = [
      [() => Schema.from({ data: 'schema' }), 'ALX_ERR_MISSING_SCHEMA'],
      [() => Schema.from({ point: { type: 'tuple', value: 'number' } }), 'ALX_ERR_INVALID_TUPLE'],
      [() => Schema.from({ point: [() => 1] }), 'ALX_ERR_INVALID_TUPLE'],
      [() => Schema.from({ shape: { union: [] } }), 'ALX_ERR_INVALID_UNION'],
      [() => new Model({}, [['P', { Projection: {} }]]), 'ALX_ERR_PROJECTION'],
      [
        () => new Model({}, [['P', { Projection: { schema: 'Nope', fields: ['a'] } }]]),
        'ALX_ERR_PROJECTION',
      ],
      [() => new Model({ bad: null }, []), 'ALX_ERR_INVALID_CUSTOM_TYPE'],
      [() => new Model({ bad: {} }, []), 'ALX_ERR_INVALID_CUSTOM_TYPE'],
      [() => new Model({ bad: { construct: 1, checkType: 2 } }, []), 'ALX_ERR_INVALID_CUSTOM_TYPE'],
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
        code: 'ALX_ERR_RESERVED_KEY',
        message: `Key "${key}" is reserved in a field definition in "a"`,
      });
    }
    assert.throws(() => Schema.from({ a: JSON.parse('{"type":"string","__proto__":{"x":1}}') }), {
      code: 'ALX_ERR_RESERVED_KEY',
      message: 'Key "__proto__" is reserved in a field definition in "a"',
    });
    assert.throws(() => Schema.from({ tags: { array: 'string', isInstance: 1 } }), {
      code: 'ALX_ERR_RESERVED_KEY',
      message: 'Key "isInstance" is reserved in a field definition in "tags"',
    });
    assert.throws(() => Schema.from({ byKey: { object: { string: 'number' }, compile: 1 } }), {
      code: 'ALX_ERR_RESERVED_KEY',
      message: 'Key "compile" is reserved in a field definition in "byKey"',
    });
    const allowed = Schema.from({
      a: { type: 'string', validate: () => true, default: 'x', unique: true, note: 'free' },
    });
    assert.equal(allowed.fields.a.note, 'free');
    assert.equal(allowed.check({ a: 'y' }).valid, true);
  });
});
