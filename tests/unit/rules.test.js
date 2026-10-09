const { test } = require('node:test');
const assert = require('node:assert');

const { Schema } = require('../../index.js');

test('Rules: length, required', () => {
  const definition = {
    field1: 'string',
    field2: { type: 'number' },
    field3: { type: 'string', length: 30 },
    field4: { type: 'string', length: { min: 10 } },
    field5: { type: 'string', length: [5, 60] },
  };
  const schema = Schema.from(definition);
  assert.strictEqual(schema.fields.field1.type, 'string');
  assert.strictEqual(schema.fields.field2.required, true);
  assert.strictEqual(schema.fields.field3.length.max, 30);
  assert.strictEqual(schema.fields.field4.length.min, 10);
  assert.strictEqual(schema.fields.field5.length.max, 60);
  assert.strictEqual(schema.fields.field5.length.min, 5);
});

test('Rules: check', () => {
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
  assert.strictEqual(schema.check(obj).valid, true);
});

test('Rules: length negative check', () => {
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
  assert.strictEqual(schema.check(obj1).valid, false);

  const obj2 = {
    field1: 'value',
    field2: 'value',
    field3: 'value',
  };
  assert.strictEqual(schema.check(obj2).valid, false);

  const obj3 = {
    field1: 'value',
    field2: 100,
    field3: 'valuevaluevaluevaluevaluevaluevaluevalue',
  };
  assert.strictEqual(schema.check(obj3).valid, false);

  const obj4 = {
    field1: 'value',
    field2: 100,
    field3: 'val',
  };
  assert.strictEqual(schema.check(obj4).valid, false);

  const obj5 = {
    field1: 'value',
    field2: 100,
  };
  assert.strictEqual(schema.check(obj5).valid, false);
});

test('Rules: length must be a number, [min, max] or { min, max }', () => {
  const message = 'Rule "length" needs a number, [min, max] or { min, max } in "s"';
  const invalid = ['abc', null, true, { min: 'a' }, { max: null }, ['1', 2]];
  for (const length of invalid) {
    assert.throws(() => Schema.from({ s: { type: 'string', length } }), {
      name: 'SchemaDefinitionError',
      code: 'ERR_INVALID_LENGTH',
      message,
    });
  }
  assert.throws(() => Schema.from({ tags: { array: { type: 'string', length: 'x' } } }), {
    code: 'ERR_INVALID_LENGTH',
    field: 'tags',
  });
  for (const length of [3, [1, 3], { min: 1, max: 3 }, { max: 3 }, { min: 1 }, [1]]) {
    assert.strictEqual(
      Schema.from({ s: { type: 'string', length } }).check({ s: 'ab' }).valid,
      true,
    );
  }
});

test('Rules: a zero bound is a bound', () => {
  const empty = Schema.from({ s: { type: 'string', length: { max: 0 } } });
  assert.deepStrictEqual(empty.check({ s: 'abc' }).errors, [
    'Field "s" exceeds the maximum length',
  ]);
  assert.strictEqual(empty.check({ s: '' }).valid, true);
  assert.strictEqual(
    Schema.from({ s: { type: 'string', length: 0 } }).check({ s: 'a' }).valid,
    false,
  );
  const list = Schema.from({ items: { array: 'number', length: [0, 2] } });
  assert.strictEqual(list.check({ items: [] }).valid, true);
  assert.strictEqual(list.check({ items: [1, 2, 3] }).valid, false);
});

test('Rules: an optional field with rules accepts a missing or null value', () => {
  const schema = Schema.from({
    'code?': { type: 'string', length: { min: 2, max: 4 }, validate: (value) => value !== 'bad' },
  });
  assert.strictEqual(schema.check({}).valid, true);
  assert.strictEqual(schema.check({ code: null }).valid, true);
  assert.strictEqual(schema.check({ code: 'okay' }).valid, true);
  assert.deepStrictEqual(schema.check({ code: 'toolong' }).errors, [
    'Field "code" exceeds the maximum length',
  ]);
  assert.deepStrictEqual(schema.check({ code: 'bad' }).errors, ['Field "code" validation error']);
  assert.deepStrictEqual(schema.check({ code: 'x' }, '', { maxErrors: 1 }).errors, [
    'Field "code" value is too short',
  ]);
  const sized = Schema.from({
    ids: { set: 'number', length: { min: 1 } },
    byId: { map: { string: 'number' }, length: [1, 1] },
    big: { type: 'bigint', length: { max: 10 } },
  });
  assert.strictEqual(
    sized.check({ ids: new Set([1]), byId: new Map([['a', 1]]), big: 10n }).valid,
    true,
  );
  assert.deepStrictEqual(
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
      'Field "big" exceeds the maximum length',
    ],
  );
});

test('Rules: a type failure cancels the rules and validate of the field', () => {
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
  assert.deepStrictEqual(schema.check({ code: 42, list: 'x' }).errors, [
    'Field "code" not of expected type: string',
    'Field "list" not of expected type: array',
  ]);
  assert.deepStrictEqual(calls, []);
  // Rules run before validate, and validate only when they passed.
  assert.deepStrictEqual(schema.check({ code: 'bcdef', list: [1, 2, 3] }).errors, [
    'Field "code" exceeds the maximum length',
    'Field "list" exceeds the maximum length',
  ]);
  assert.deepStrictEqual(calls, []);
  assert.deepStrictEqual(schema.check({ code: 'bcd', list: [] }).errors, [
    'Field "code" must start with a',
  ]);
  assert.deepStrictEqual(calls, ['bcd']);
  assert.strictEqual(schema.check({ code: 'abc', list: [1] }).valid, true);
  const custom = {
    kind: 'scalar',
    rules: ['length'],
    construct() {},
    checkType: (value) => typeof value === 'string' || 'not text',
  };
  const { Model } = require('../../index.js');
  const text = new Model({ text6: custom }, [
    ['Note', { Struct: {}, body: { type: 'text6', length: { max: 6 }, validate: () => 'never' } }],
  ]).entities.get('Note');
  assert.deepStrictEqual(text.check({ body: 1 }).errors, ['Field "Note.body" not text']);
  assert.deepStrictEqual(text.check({ body: 'toolongtext' }).errors, [
    'Field "Note.body" exceeds the maximum length',
  ]);
  assert.deepStrictEqual(text.check({ body: 'short' }).errors, ['Field "Note.body" never']);
});
