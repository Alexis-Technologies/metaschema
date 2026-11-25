const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { Schema } = require('../../index.js');
const { register } = require('../../src/generators/index.js');

register();

describe('Tuple', () => {
  it('should build and check a tuple in each of its forms', () => {
    const short1 = ['string', 'number', '?number'];
    const schema1 = Schema.from(short1);
    assert.equal(schema1.kind, 'struct');
    assert.equal(schema1.fields.value.length, short1.length);
    assert.equal(schema1.fields.value[0].type, 'string');
    assert.equal(schema1.fields.value[0].required, true);
    assert.equal(schema1.fields.value[1].type, 'number');
    assert.equal(schema1.fields.value[1].required, true);
    assert.equal(schema1.fields.value[2].type, 'number');
    assert.equal(schema1.fields.value[2].required, false);
    assert.equal(schema1.check(['abc', 1]).valid, true);
    assert.equal(schema1.check(['abc', 1, 2]).valid, true);
    assert.deepEqual(schema1.check(['abc', 'ab', 2]).errors, [
      'Field "[1]" not of expected type: number',
    ]);
    const overflow = schema1.check(['abc', 2, 2, 123]);
    assert.deepEqual(overflow.errors, ['Field "" exceeds the maximum length']);
    assert.deepEqual(overflow.issues[0].params, { min: undefined, max: 3, actual: 4 });

    const short2 = { tuple: ['bigint', 'boolean'] };
    const schema2 = Schema.from(short2);
    assert.equal(schema2.fields.value[0].type, 'bigint');
    assert.equal(schema2.fields.value[0].required, true);
    assert.equal(schema2.fields.value[1].type, 'boolean');
    assert.equal(schema2.fields.value[1].required, true);
    const bigIntValue = BigInt(9007199254740991);
    assert.equal(schema2.check([bigIntValue, true]).valid, true);
    assert.deepEqual(schema2.check(['abc', 1]).errors, [
      'Field "[0]" not of expected type: bigint',
      'Field "[1]" not of expected type: boolean',
    ]);
    assert.deepEqual(schema2.check([bigIntValue, false, 123]).errors, [
      'Field "" exceeds the maximum length',
    ]);

    const long = { type: 'tuple', value: ['string'] };
    const schema3 = Schema.from(long);
    assert.equal(schema3.fields.value[0].type, 'string');
    assert.equal(schema3.fields.value[0].required, true);
  });

  it('should build a tuple with field names', () => {
    const defs1 = [{ sum: 'number' }, { length: 'string' }];
    const schema1 = Schema.from(defs1);
    assert.equal(schema1.fields.value[0].type, 'number');
    assert.equal(schema1.fields.value[0].required, true);
    assert.equal(schema1.fields.value[0].name, 'sum');
    assert.equal(schema1.fields.value[1].type, 'string');
    assert.equal(schema1.fields.value[1].required, true);
    assert.equal(schema1.fields.value[1].name, 'length');
    assert.equal(schema1.check([1, '123']).valid, true);
    assert.deepEqual(schema1.check([1]).errors, ['Field "[1]" not of expected type: string']);
  });

  it('should check a tuple used in a schema', () => {
    const defs = { field: ['boolean', { count: 'number' }] };
    const schema = Schema.from(defs);
    assert.equal(schema.fields.field.value[0].type, 'boolean');
    assert.equal(schema.fields.field.value[0].required, true);
    assert.equal(schema.fields.field.value[1].type, 'number');
    assert.equal(schema.fields.field.value[1].required, true);
    assert.equal(schema.fields.field.value[1].name, 'count');
    assert.equal(schema.check({ field: [true, 123] }).valid, true);
    assert.deepEqual(schema.check({ field: [false, { some: 'wrong data' }] }).errors, [
      'Field "field[1]" not of expected type: number',
    ]);
  });

  it('should require a tuple field unless it is marked optional', () => {
    const schema = Schema.from({ point: ['number', 'number'], name: 'string' });
    assert.equal(schema.fields.point.required, true);
    assert.deepEqual(schema.check({ name: 'x' }).errors, ['Field "point" is required']);
    assert.equal(schema.check({ name: 'x', point: [1, 2] }).valid, true);

    const optional = Schema.from({ 'point?': ['number', 'number'] });
    assert.equal(optional.fields.point.required, false);
    assert.deepEqual(optional.check({}).errors, []);
    assert.deepEqual(optional.check({ point: null }).errors, []);

    const long = Schema.from({ point: { type: 'tuple', value: ['number'], required: false } });
    assert.equal(long.fields.point.required, false);
  });

  it('should report a value that is not an array as a type error', () => {
    const schema = Schema.from({ point: ['number', 'number'] });
    assert.deepEqual(schema.check({ point: 5 }).issues, [
      {
        code: 'type',
        path: ['point'],
        message: 'not of expected type: tuple',
        params: { expected: 'tuple', received: 'number' },
      },
    ]);
    assert.deepEqual(schema.check({ point: null }).errors, [
      'Field "point" not of expected type: tuple',
    ]);
    assert.equal(schema.check({ point: [1, 'x', 3] }, { maxErrors: 1 }).errors.length, 1);
    assert.deepEqual(Schema.from(['number', 'string']).check([1, 2], { maxErrors: 1 }).errors, [
      'Field "[1]" not of expected type: string',
    ]);
  });

  it('should accept any definition as an element and keep named elements scalars', () => {
    const schema = Schema.from({
      row: ['string', { array: 'number' }, { x: 'number', y: 'number' }, ['boolean'], 'json'],
    });
    const row = schema.fields.row.value;
    assert.deepEqual(
      row.map((element) => element.type),
      ['string', 'array', 'schema', 'tuple', 'json'],
    );
    assert.equal(
      schema.check({ row: ['a', [1, 2], { x: 1, y: 2 }, [true], { any: 'thing' }] }).valid,
      true,
    );
    assert.deepEqual(schema.check({ row: ['a', [1, 'b'], { x: 1 }, [1], 5] }).errors, [
      'Field "row[1][1]" not of expected type: number',
      'Field "row[2].y" is required',
      'Field "row[3][0]" not of expected type: boolean',
      'Field "row[4]" not of expected type: object',
    ]);
    assert.equal(
      Schema.from({
        row: ['string', { array: 'number' }, { x: 'number', y: 'number' }],
      }).toInterface(),
      'interface  {\n  row: [string, number[], { x: number; y: number }];\n}',
    );
    // One key holding a type name is a named element; a kind or a type name as
    // the key is read as what it says.
    const named = Schema.from({ p: [{ x: 'number' }, { 'y?': 'number' }, { array: 'string' }] });
    assert.equal(named.fields.p.value[0].name, 'x');
    assert.equal(named.fields.p.value[1].name, 'y');
    assert.equal(named.fields.p.value[1].required, false);
    assert.equal(named.fields.p.value[2].type, 'array');
    assert.equal(named.check({ p: [1, null, ['a']] }).valid, true);
    assert.equal(named.check({ p: [1] }).valid, false);
  });

  it('should read a capitalized key holding a type name as a named element', () => {
    // A string is no metadata of a kind; until 3.4.1 `{ X: 'number' }` was the
    // kind `x` over an empty struct.
    const point = Schema.from([{ X: 'number' }, { 'Y?': 'number' }, { LABEL: 'string' }]);
    const elements = point.fields.value;
    assert.deepEqual(
      elements.map((element) => [element.type, element.name, element.required]),
      [
        ['number', 'X', true],
        ['number', 'Y', false],
        ['string', 'LABEL', true],
      ],
    );
    assert.equal(point.check([1, null, 'a']).valid, true);
    assert.deepEqual(point.check([{}, 2, 'a']).errors, [
      'Field "[0]" not of expected type: number',
    ]);
    assert.deepEqual(point.warnings, []);
    // An object under the key is a definition of its own, a kind where it is one.
    const structs = Schema.from([{ Struct: {}, X: 'number' }, { Point: { x: 'number' } }]);
    assert.deepEqual(Object.keys(structs.fields.value[0].schema), ['X']);
    assert.deepEqual(Object.keys(structs.fields.value[1].schema), []);
  });
});
