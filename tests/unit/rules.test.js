const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { Schema } = require('../../index.js');

describe('Rules', () => {
  it('should read length and required from a definition', () => {
    const definition = {
      field1: 'string',
      field2: { type: 'number' },
      field3: { type: 'string', length: 30 },
      field4: { type: 'string', length: { min: 10 } },
      field5: { type: 'string', length: [5, 60] },
    };
    const schema = Schema.from(definition);
    assert.equal(schema.fields.field1.type, 'string');
    assert.equal(schema.fields.field2.required, true);
    assert.equal(schema.fields.field3.length.max, 30);
    assert.equal(schema.fields.field4.length.min, 10);
    assert.equal(schema.fields.field5.length.max, 60);
    assert.equal(schema.fields.field5.length.min, 5);
  });

  it('should check a valid value with length and optional fields', () => {
    const definition = {
      field1: 'string',
      field2: { type: 'number' },
      field3: { type: 'string', length: 30 },
      field4: { type: 'string', required: false },
      field5: {
        subfield1: 'number',
        subfield2: { type: 'string', required: false },
      },
    };
    const obj = {
      field1: 'value',
      field2: 100,
      field3: 'value',
      field5: {
        subfield1: 500,
        subfield2: 'value',
      },
    };
    const schema = Schema.from(definition);
    assert.equal(schema.check(obj).valid, true);
  });

  it('should reject a wrong length, a wrong type and a missing field', () => {
    const definition = {
      field1: 'string',
      field2: { type: 'number' },
      field3: { type: 'string', length: { min: 5, max: 30 } },
    };
    const schema = Schema.from(definition);

    const obj1 = {
      field1: 1,
      field2: 100,
      field3: 'value',
    };
    assert.equal(schema.check(obj1).valid, false);

    const obj2 = {
      field1: 'value',
      field2: 'value',
      field3: 'value',
    };
    assert.equal(schema.check(obj2).valid, false);

    const obj3 = {
      field1: 'value',
      field2: 100,
      field3: 'valuevaluevaluevaluevaluevaluevaluevalue',
    };
    assert.equal(schema.check(obj3).valid, false);

    const obj4 = {
      field1: 'value',
      field2: 100,
      field3: 'val',
    };
    assert.equal(schema.check(obj4).valid, false);

    const obj5 = {
      field1: 'value',
      field2: 100,
    };
    assert.equal(schema.check(obj5).valid, false);
  });

  it('should require length to be a number, [min, max] or { min, max }', () => {
    const message = 'Rule "length" needs a number, [min, max] or { min, max } in "s"';
    const invalid = ['abc', null, true, { min: 'a' }, { max: null }, ['1', 2]];
    for (const length of invalid) {
      assert.throws(() => Schema.from({ s: { type: 'string', length } }), {
        name: 'SchemaDefinitionError',
        code: 'ALX_ERR_INVALID_LENGTH',
        message,
      });
    }
    assert.throws(() => Schema.from({ tags: { array: { type: 'string', length: 'x' } } }), {
      code: 'ALX_ERR_INVALID_LENGTH',
      field: 'tags',
    });
    for (const length of [3, [1, 3], { min: 1, max: 3 }, { max: 3 }, { min: 1 }, [1]]) {
      assert.equal(Schema.from({ s: { type: 'string', length } }).check({ s: 'ab' }).valid, true);
    }
  });

  it('should treat a zero bound as a bound', () => {
    const empty = Schema.from({ s: { type: 'string', length: { max: 0 } } });
    assert.deepEqual(empty.check({ s: 'abc' }).errors, ['Field "s" exceeds the maximum length']);
    assert.equal(empty.check({ s: '' }).valid, true);
    assert.equal(Schema.from({ s: { type: 'string', length: 0 } }).check({ s: 'a' }).valid, false);
    const list = Schema.from({ items: { array: 'number', length: [0, 2] } });
    assert.equal(list.check({ items: [] }).valid, true);
    assert.equal(list.check({ items: [1, 2, 3] }).valid, false);
  });

  it('should accept a missing or null value of an optional field with rules', () => {
    const schema = Schema.from({
      'code?': { type: 'string', length: { min: 2, max: 4 }, validate: (value) => value !== 'bad' },
    });
    assert.equal(schema.check({}).valid, true);
    assert.equal(schema.check({ code: null }).valid, true);
    assert.equal(schema.check({ code: 'okay' }).valid, true);
    assert.deepEqual(schema.check({ code: 'toolong' }).errors, [
      'Field "code" exceeds the maximum length',
    ]);
    assert.deepEqual(schema.check({ code: 'bad' }).errors, ['Field "code" validation error']);
    assert.deepEqual(schema.check({ code: 'x' }, { maxErrors: 1 }).errors, [
      'Field "code" value is too short',
    ]);
    const sized = Schema.from({
      ids: { set: 'number', length: { min: 1 } },
      byId: { map: { string: 'number' }, length: [1, 1] },
      big: { type: 'bigint', max: 10 },
    });
    assert.equal(
      sized.check({ ids: new Set([1]), byId: new Map([['a', 1]]), big: 10n }).valid,
      true,
    );
    assert.deepEqual(
      sized.check({
        ids: new Set(),
        byId: new Map([
          ['a', 1],
          ['b', 2],
        ]),
        big: 11n,
      }).errors,
      [
        'Field "ids" value is too short',
        'Field "byId" exceeds the maximum length',
        'Field "big" is greater than 10',
      ],
    );
  });

  it('should cancel the rules and validate of the field on a type failure', () => {
    const calls = [];
    const schema = Schema.from({
      code: {
        type: 'string',
        length: { min: 2, max: 4 },
        validate: (value) => {
          calls.push(value);
          return value.startsWith('a') || 'must start with a';
        },
      },
      list: { array: 'number', length: { max: 2 } },
    });
    assert.deepEqual(schema.check({ code: 42, list: 'x' }).errors, [
      'Field "code" not of expected type: string',
      'Field "list" not of expected type: array',
    ]);
    assert.deepEqual(calls, []);
    // Rules run before validate, and validate only when they passed.
    assert.deepEqual(schema.check({ code: 'bcdef', list: [1, 2, 3] }).errors, [
      'Field "code" exceeds the maximum length',
      'Field "list" exceeds the maximum length',
    ]);
    assert.deepEqual(calls, []);
    assert.deepEqual(schema.check({ code: 'bcd', list: [] }).errors, [
      'Field "code" must start with a',
    ]);
    assert.deepEqual(calls, ['bcd']);
    assert.equal(schema.check({ code: 'abc', list: [1] }).valid, true);
    const custom = {
      kind: 'scalar',
      rules: ['length'],
      construct() {},
      checkType: (value) => typeof value === 'string' || 'not text',
    };
    const { Model } = require('../../index.js');
    const text = new Model({ text6: custom }, [
      [
        'Note',
        { Struct: {}, body: { type: 'text6', length: { max: 6 }, validate: () => 'never' } },
      ],
    ]).entities.get('Note');
    assert.deepEqual(text.check({ body: 1 }).errors, ['Field "Note.body" not text']);
    assert.deepEqual(text.check({ body: 'toolongtext' }).errors, [
      'Field "Note.body" exceeds the maximum length',
    ]);
    assert.deepEqual(text.check({ body: 'short' }).errors, ['Field "Note.body" never']);
  });

  it('should count the own keys of an object as its length, whatever they are called', () => {
    const sized = Schema.from({
      dict: { object: { string: 'any' }, length: { max: 2 } },
      list: { array: 'any', length: { max: 2 } },
    });
    // A key called `size` or `length` is a key like any other.
    assert.equal(sized.check({ dict: { size: 10, a: 1 }, list: [1] }).valid, true);
    assert.equal(sized.check({ dict: { length: 99 }, list: [1, 2] }).valid, true);
    assert.deepEqual(sized.check({ dict: { a: 1, b: 2, c: 3 }, list: [1, 2, 3] }).errors, [
      'Field "dict" exceeds the maximum length',
      'Field "list" exceeds the maximum length',
    ]);
    // An inherited key does not count, as it is not checked.
    const inherited = Object.create({ hidden: 1 });
    inherited.a = 1;
    assert.equal(sized.check({ dict: inherited, list: [] }).valid, true);
  });
});
