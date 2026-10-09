const { test } = require('node:test');
const assert = require('node:assert');

const { Schema } = require('../../index.js');

test('Values: date is a Date instance with a valid time', () => {
  const schema = Schema.from({ at: 'date', 'until?': 'date' });
  assert.strictEqual(Schema.from('date').kind, 'scalar');
  assert.strictEqual(schema.check({ at: new Date() }).valid, true);
  assert.strictEqual(schema.check({ at: new Date(0), until: null }).valid, true);
  for (const at of [new Date('nope'), Date.now(), '2026-10-09', {}, null]) {
    assert.deepStrictEqual(schema.check({ at }).errors, ['Field "at" not of expected type: date']);
  }
  assert.deepStrictEqual(schema.check({ at: new Date(NaN) }).issues[0].params, {
    expected: 'date',
    received: 'object',
  });
  assert.strictEqual(schema.check({ at: new Date(), until: 5 }).valid, false);
  assert.strictEqual(
    new Schema('Event', { at: 'date' }).toInterface(),
    'interface Event {\n  at: Date;\n}',
  );
});

test('Values: null accepts null only', () => {
  const schema = Schema.from({ nothing: 'null', 'maybe?': 'null' });
  assert.strictEqual(schema.check({ nothing: null }).valid, true);
  assert.strictEqual(schema.check({ nothing: null, maybe: null }).valid, true);
  for (const nothing of [undefined, 0, '', false, {}]) {
    assert.deepStrictEqual(schema.check({ nothing }).errors, [
      'Field "nothing" not of expected type: null',
    ]);
  }
  assert.deepStrictEqual(schema.check({}).errors, ['Field "nothing" is required']);
  assert.deepStrictEqual(schema.check({ nothing: null, maybe: 1 }).errors, [
    'Field "maybe" not of expected type: null',
  ]);
  assert.strictEqual(Schema.from('null').check(null).valid, true);
  assert.strictEqual(Schema.from('null').check(undefined).valid, false);
  assert.strictEqual(Schema.from({ n: 'null' }).toInterface(), 'interface  {\n  n: null;\n}');
});

test('Values: any and unknown accept every value, required keys included', () => {
  const schema = Schema.from({ a: 'any', u: 'unknown', 'o?': 'any' });
  for (const value of [null, undefined, 0, '', false, {}, [], new Map(), () => {}, Symbol('s')]) {
    assert.strictEqual(schema.check({ a: value, u: value }).valid, true);
  }
  assert.deepStrictEqual(schema.check({ u: 1 }).errors, ['Field "a" is required']);
  assert.strictEqual(schema.check({ a: undefined, u: undefined }).valid, true);
  assert.strictEqual(Schema.from('any').check(undefined).valid, true);
  assert.strictEqual(Schema.from('any').kind, 'scalar');
  assert.strictEqual(
    new Schema('Bag', { a: 'any', u: 'unknown', 'o?': 'unknown' }).toInterface(),
    'interface Bag {\n  a: any;\n  u: unknown;\n  o?: unknown;\n}',
  );
  assert.strictEqual(
    Schema.from({ list: { array: 'any' } }).check({ list: [1, 'two', null] }).valid,
    true,
  );
});
