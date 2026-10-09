const { test } = require('node:test');
const assert = require('node:assert');

const { Schema } = require('../../index.js');

test('Tuple: basic implementation', () => {
  const short1 = ['string', 'number', '?number'];
  const schema1 = Schema.from(short1);
  assert.strictEqual(schema1.kind, 'struct');
  assert.strictEqual(schema1.fields.value.length, short1.length);
  assert.strictEqual(schema1.fields.value[0].type, 'string');
  assert.strictEqual(schema1.fields.value[0].required, true);
  assert.strictEqual(schema1.fields.value[1].type, 'number');
  assert.strictEqual(schema1.fields.value[1].required, true);
  assert.strictEqual(schema1.fields.value[2].type, 'number');
  assert.strictEqual(schema1.fields.value[2].required, false);
  assert.strictEqual(schema1.check(['abc', 1]).valid, true);
  assert.strictEqual(schema1.check(['abc', 1, 2]).valid, true);
  assert.deepStrictEqual(schema1.check(['abc', 'ab', 2]).errors, [
    'Field "[1]" not of expected type: number',
  ]);
  const overflow = schema1.check(['abc', 2, 2, 123]);
  assert.deepStrictEqual(overflow.errors, ['Field "" exceeds the maximum length']);
  assert.deepStrictEqual(overflow.issues[0].params, { min: undefined, max: 3, actual: 4 });

  const short2 = { tuple: ['bigint', 'boolean'] };
  const schema2 = Schema.from(short2);
  assert.strictEqual(schema2.fields.value[0].type, 'bigint');
  assert.strictEqual(schema2.fields.value[0].required, true);
  assert.strictEqual(schema2.fields.value[1].type, 'boolean');
  assert.strictEqual(schema2.fields.value[1].required, true);
  const bigIntValue = BigInt(9007199254740991);
  assert.strictEqual(schema2.check([bigIntValue, true]).valid, true);
  assert.deepStrictEqual(schema2.check(['abc', 1]).errors, [
    'Field "[0]" not of expected type: bigint',
    'Field "[1]" not of expected type: boolean',
  ]);
  assert.deepStrictEqual(schema2.check([bigIntValue, false, 123]).errors, [
    'Field "" exceeds the maximum length',
  ]);

  const long = { type: 'tuple', value: ['string'] };
  const schema3 = Schema.from(long);
  assert.strictEqual(schema3.fields.value[0].type, 'string');
  assert.strictEqual(schema3.fields.value[0].required, true);
});

test('Tuple: with field names', () => {
  const defs1 = [{ sum: 'number' }, { length: 'string' }];
  const schema1 = Schema.from(defs1);
  assert.strictEqual(schema1.fields.value[0].type, 'number');
  assert.strictEqual(schema1.fields.value[0].required, true);
  assert.strictEqual(schema1.fields.value[0].name, 'sum');
  assert.strictEqual(schema1.fields.value[1].type, 'string');
  assert.strictEqual(schema1.fields.value[1].required, true);
  assert.strictEqual(schema1.fields.value[1].name, 'length');
  assert.strictEqual(schema1.check([1, '123']).valid, true);
  assert.deepStrictEqual(schema1.check([1]).errors, ['Field "[1]" not of expected type: string']);
});

test('Tuple: usage with schema', () => {
  const defs = { field: ['boolean', { count: 'number' }] };
  const schema = Schema.from(defs);
  assert.strictEqual(schema.fields.field.value[0].type, 'boolean');
  assert.strictEqual(schema.fields.field.value[0].required, true);
  assert.strictEqual(schema.fields.field.value[1].type, 'number');
  assert.strictEqual(schema.fields.field.value[1].required, true);
  assert.strictEqual(schema.fields.field.value[1].name, 'count');
  assert.strictEqual(schema.check({ field: [true, 123] }).valid, true);
  assert.deepStrictEqual(schema.check({ field: [false, { some: 'wrong data' }] }).errors, [
    'Field "field[1]" not of expected type: number',
  ]);
});

test('Tuple: a tuple field is required unless marked optional', () => {
  const schema = Schema.from({ point: ['number', 'number'], name: 'string' });
  assert.strictEqual(schema.fields.point.required, true);
  assert.deepStrictEqual(schema.check({ name: 'x' }).errors, ['Field "point" is required']);
  assert.strictEqual(schema.check({ name: 'x', point: [1, 2] }).valid, true);

  const optional = Schema.from({ 'point?': ['number', 'number'] });
  assert.strictEqual(optional.fields.point.required, false);
  assert.deepStrictEqual(optional.check({}).errors, []);
  assert.deepStrictEqual(optional.check({ point: null }).errors, []);

  const long = Schema.from({ point: { type: 'tuple', value: ['number'], required: false } });
  assert.strictEqual(long.fields.point.required, false);
});

test('Tuple: a value that is not an array is a type error', () => {
  const schema = Schema.from({ point: ['number', 'number'] });
  assert.deepStrictEqual(schema.check({ point: 5 }).issues, [
    {
      code: 'type',
      path: ['point'],
      message: 'not of expected type: tuple',
      params: { expected: 'tuple', received: 'number' },
    },
  ]);
  assert.deepStrictEqual(schema.check({ point: null }).errors, [
    'Field "point" not of expected type: tuple',
  ]);
  assert.strictEqual(schema.check({ point: [1, 'x', 3] }, { maxErrors: 1 }).errors.length, 1);
  assert.deepStrictEqual(Schema.from(['number', 'string']).check([1, 2], { maxErrors: 1 }).errors, [
    'Field "[1]" not of expected type: string',
  ]);
});
