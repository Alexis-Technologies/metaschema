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
