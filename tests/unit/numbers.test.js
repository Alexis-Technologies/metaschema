const { test } = require('node:test');
const assert = require('node:assert');

const { Schema, Model } = require('../../index.js');
const { codePoints } = require('../../src/rules.js');

test('Numbers: integer accepts whole numbers only', () => {
  const schema = Schema.from({ n: 'integer', 'm?': 'integer' });
  assert.strictEqual(Schema.from('integer').kind, 'scalar');
  for (const n of [0, 1, -5, 2 ** 53, -0]) {
    assert.strictEqual(schema.check({ n }).valid, true, String(n));
  }
  for (const n of [1.5, '1', NaN, Infinity, 1n, null, true]) {
    assert.deepStrictEqual(schema.check({ n }).errors, ['Field "n" not of expected type: integer']);
  }
  assert.deepStrictEqual(schema.check({ n: 1.5 }).issues[0].params, {
    expected: 'integer',
    received: 'number',
  });
  assert.strictEqual(schema.check({ n: 1, m: null }).valid, true);
  assert.strictEqual(schema.check({ n: 1, m: 2.5 }).valid, false);
  assert.strictEqual(
    new Schema('Count', { n: 'integer' }).toInterface(),
    'interface Count {\n  n: number;\n}',
  );
});

test('Numbers: min and max bound a number, a bigint or an integer', () => {
  const schema = Schema.from({
    both: { type: 'number', min: 1, max: 10 },
    low: { type: 'number', min: 0 },
    high: { type: 'integer', max: 100 },
    big: { type: 'bigint', min: 1n, max: 10n },
  });
  assert.strictEqual(schema.check({ both: 1, low: 0, high: 100, big: 10n }).valid, true);
  assert.strictEqual(schema.check({ both: 10, low: 1e9, high: -100, big: 1n }).valid, true);
  const result = schema.check({ both: 11, low: -1, high: 101, big: 0n });
  assert.deepStrictEqual(result.errors, [
    'Field "both" is greater than 10',
    'Field "low" is less than 0',
    'Field "high" is greater than 100',
    'Field "big" is less than 1',
  ]);
  assert.deepStrictEqual(result.issues[0], {
    code: 'range',
    path: ['both'],
    message: 'is greater than 10',
    params: { min: 1, max: 10, actual: 11 },
  });
  assert.deepStrictEqual(result.issues[1].params, { min: 0, max: undefined, actual: -1 });
  assert.deepStrictEqual(result.issues[3].params, { min: 1n, max: 10n, actual: 0n });
  assert.deepStrictEqual(schema.check({ both: 0, low: 0, high: 0, big: 1n }).errors, [
    'Field "both" is less than 1',
  ]);
  const uk = require('../../src/locales/uk.js');
  assert.deepStrictEqual(
    schema.check({ both: 0, low: -1, high: 0, big: 1n }, { messages: uk }).errors,
    ['Поле "both" менше за 1', 'Поле "low" менше за 0'],
  );
  // A type failure cancels the range check.
  assert.deepStrictEqual(schema.check({ both: 'x', low: 0, high: 0, big: 1n }).errors, [
    'Field "both" not of expected type: number',
  ]);
  const optional = Schema.from({ 'n?': { type: 'number', min: 1 } });
  assert.strictEqual(optional.check({}).valid, true);
  assert.strictEqual(optional.check({ n: null }).valid, true);
  assert.strictEqual(optional.check({ n: 0 }).valid, false);
});

test('Numbers: a bigint bound is compared exactly, never through Number', () => {
  const limit = 2n ** 64n;
  const schema = Schema.from({ n: { type: 'bigint', max: limit } });
  assert.strictEqual(schema.check({ n: limit }).valid, true);
  // Number(limit + 1n) === Number(limit), so a conversion would accept it.
  assert.deepStrictEqual(schema.check({ n: limit + 1n }).errors, [
    `Field "n" is greater than ${limit}`,
  ]);
  const mixed = Schema.from({ n: { type: 'number', min: 10n }, b: { type: 'bigint', max: 10 } });
  assert.strictEqual(mixed.check({ n: 10, b: 10n }).valid, true);
  assert.deepStrictEqual(mixed.check({ n: 9.5, b: 11n }).errors, [
    'Field "n" is less than 10',
    'Field "b" is greater than 10',
  ]);
});

test('Numbers: a rule a type does not accept is a definition error', () => {
  for (const type of ['number', 'bigint', 'integer']) {
    assert.throws(() => Schema.from({ n: { type, length: 3 } }), {
      name: 'SchemaDefinitionError',
      code: 'ERR_INVALID_RULE',
      message: `Rule "length" does not apply to type "${type}"; use min and max in "n"`,
    });
  }
  assert.throws(() => Schema.from({ s: { type: 'string', min: 1 } }), {
    code: 'ERR_INVALID_RULE',
    message: 'Rule "min" does not apply to type "string" in "s"',
  });
  assert.throws(() => Schema.from({ b: { type: 'boolean', length: 1 } }), {
    code: 'ERR_INVALID_RULE',
    message: 'Rule "length" does not apply to type "boolean" in "b"',
  });
  assert.throws(() => Schema.from({ tags: { array: 'string', max: 2 } }), {
    code: 'ERR_INVALID_RULE',
    message: 'Rule "max" does not apply to type "array" in "tags"',
  });
  for (const min of ['1', null, true, {}, false]) {
    assert.throws(() => Schema.from({ n: { type: 'number', min } }), {
      code: 'ERR_INVALID_RULE',
      message: 'Rule "min" needs a number or a bigint in "n"',
    });
  }
  assert.throws(() => Schema.from({ n: { type: 'number', min: 5, max: 1 } }), {
    code: 'ERR_INVALID_RULE',
    message: 'Rule "max" is below "min" in "n"',
  });
  assert.throws(() => Schema.from({ n: { type: 'bigint', min: 5, max: 1n } }), {
    code: 'ERR_INVALID_RULE',
  });
  for (const length of [{ min: 5, max: 1 }, [5, 1]]) {
    assert.throws(() => Schema.from({ s: { type: 'string', length } }), {
      code: 'ERR_INVALID_LENGTH',
      message: 'Rule "length" has min above max in "s"',
    });
  }
  assert.strictEqual(
    Schema.from({ n: { type: 'number', min: 1, max: 1 } }).check({ n: 1 }).valid,
    true,
  );
  assert.strictEqual(
    Schema.from({ s: { type: 'string', length: [1, 1] } }).check({ s: 'a' }).valid,
    true,
  );
});

test('Numbers: custom types declare the rules they accept', () => {
  const types = {
    amount: { js: 'number', metadata: { pg: 'numeric' } },
    hex: {
      kind: 'scalar',
      construct() {},
      checkType: (value) => /^[0-9a-f]+$/.test(value) || 'no',
    },
    code: { kind: 'scalar', rules: ['length'], construct() {}, checkType: () => null },
  };
  const model = new Model(types, [
    ['Price', { Struct: {}, value: { type: 'amount', min: 0 }, code: { type: 'code', length: 2 } }],
  ]);
  const price = model.entities.get('Price');
  assert.deepStrictEqual(price.check({ value: -1, code: 'abc' }).errors, [
    'Field "Price.value" is less than 0',
    'Field "Price.code" exceeds the maximum length',
  ]);
  assert.strictEqual(price.check({ value: 0, code: 'ab' }).valid, true);
  assert.throws(() => Schema.from({ h: { type: 'hex', length: 2 } }), {
    code: 'ERR_INVALID_RULE',
    message: 'Rule "length" does not apply to type "hex" in "h"',
  });
  assert.throws(() => Schema.from({ v: { type: 'amount', length: 2 } }), {
    code: 'ERR_INVALID_RULE',
    message: 'Rule "length" does not apply to type "amount"; use min and max in "v"',
  });
});

test('Numbers: string length counts UTF-16 units, or code points with unicode', () => {
  const units = Schema.from({ s: { type: 'string', length: { max: 2 } } });
  const points = Schema.from({ s: { type: 'string', length: { min: 2, max: 2 }, unicode: true } });
  assert.strictEqual(units.check({ s: '😀' }).valid, true);
  assert.deepStrictEqual(units.check({ s: '😀😀' }).issues[0].params, {
    min: undefined,
    max: 2,
    actual: 4,
  });
  assert.strictEqual(points.check({ s: '😀😀' }).valid, true);
  assert.strictEqual(points.check({ s: 'a😀' }).valid, true);
  assert.deepStrictEqual(points.check({ s: '😀😀😀' }).issues[0].params, {
    min: 2,
    max: 2,
    actual: 3,
  });
  assert.deepStrictEqual(points.check({ s: '😀' }).errors, ['Field "s" value is too short']);
  assert.strictEqual(codePoints('abc'), 3);
  assert.strictEqual(codePoints('😀'), 1);
  assert.strictEqual(codePoints('\ud83d'), 1);
  assert.strictEqual(codePoints('\ud83da'), 2);
  assert.strictEqual(codePoints('😀\ude00'), 2);
  assert.strictEqual(codePoints(''), 0);
  // unicode only changes how a string is measured.
  const list = Schema.from({ l: { array: 'string', length: { max: 1 }, unicode: true } });
  assert.strictEqual(list.check({ l: ['😀😀'] }).valid, true);
  assert.strictEqual(list.check({ l: ['a', 'b'] }).valid, false);
});
