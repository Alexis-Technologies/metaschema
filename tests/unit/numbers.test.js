const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { Schema, Model } = require('../../index.js');
const { register } = require('../../src/generators/index.js');
const { codePoints } = require('../../src/checks.js');

register();

describe('Numbers', () => {
  it('should accept whole numbers only as an integer', () => {
    const schema = Schema.from({ n: 'integer', 'm?': 'integer' });
    assert.equal(Schema.from('integer').kind, 'scalar');
    for (const n of [0, 1, -5, 2 ** 53, -0]) {
      assert.equal(schema.check({ n }).valid, true, String(n));
    }
    for (const n of [1.5, '1', NaN, Infinity, 1n, null, true]) {
      assert.deepEqual(schema.check({ n }).errors, ['Field "n" not of expected type: integer']);
    }
    assert.deepEqual(schema.check({ n: 1.5 }).issues[0].params, {
      expected: 'integer',
      received: 'number',
    });
    assert.equal(schema.check({ n: 1, m: null }).valid, true);
    assert.equal(schema.check({ n: 1, m: 2.5 }).valid, false);
    assert.equal(
      new Schema('Count', { n: 'integer' }).toInterface(),
      'interface Count {\n  n: number;\n}',
    );
  });

  it('should bound a number, a bigint or an integer with min and max', () => {
    const schema = Schema.from({
      both: { type: 'number', min: 1, max: 10 },
      low: { type: 'number', min: 0 },
      high: { type: 'integer', max: 100 },
      big: { type: 'bigint', min: 1n, max: 10n },
    });
    assert.equal(schema.check({ both: 1, low: 0, high: 100, big: 10n }).valid, true);
    assert.equal(schema.check({ both: 10, low: 1e9, high: -100, big: 1n }).valid, true);
    const result = schema.check({ both: 11, low: -1, high: 101, big: 0n });
    assert.deepEqual(result.errors, [
      'Field "both" is greater than 10',
      'Field "low" is less than 0',
      'Field "high" is greater than 100',
      'Field "big" is less than 1',
    ]);
    assert.deepEqual(result.issues[0], {
      code: 'range',
      path: ['both'],
      message: 'is greater than 10',
      params: { min: 1, max: 10, actual: 11 },
    });
    assert.deepEqual(result.issues[1].params, { min: 0, max: undefined, actual: -1 });
    assert.deepEqual(result.issues[3].params, { min: 1n, max: 10n, actual: 0n });
    assert.deepEqual(schema.check({ both: 0, low: 0, high: 0, big: 1n }).errors, [
      'Field "both" is less than 1',
    ]);
    const uk = require('../../src/locales/uk.js');
    assert.deepEqual(
      schema.check({ both: 0, low: -1, high: 0, big: 1n }, { messages: uk }).errors,
      ['Поле "both" менше за 1', 'Поле "low" менше за 0'],
    );
    // A type failure cancels the range check.
    assert.deepEqual(schema.check({ both: 'x', low: 0, high: 0, big: 1n }).errors, [
      'Field "both" not of expected type: number',
    ]);
    const optional = Schema.from({ 'n?': { type: 'number', min: 1 } });
    assert.equal(optional.check({}).valid, true);
    assert.equal(optional.check({ n: null }).valid, true);
    assert.equal(optional.check({ n: 0 }).valid, false);
  });

  it('should compare a bigint bound exactly, never through Number', () => {
    const limit = 2n ** 64n;
    const schema = Schema.from({ n: { type: 'bigint', max: limit } });
    assert.equal(schema.check({ n: limit }).valid, true);
    // Number(limit + 1n) === Number(limit), so a conversion would accept it.
    assert.deepEqual(schema.check({ n: limit + 1n }).errors, [
      `Field "n" is greater than ${limit}`,
    ]);
    const mixed = Schema.from({ n: { type: 'number', min: 10n }, b: { type: 'bigint', max: 10 } });
    assert.equal(mixed.check({ n: 10, b: 10n }).valid, true);
    assert.deepEqual(mixed.check({ n: 9.5, b: 11n }).errors, [
      'Field "n" is less than 10',
      'Field "b" is greater than 10',
    ]);
  });

  it('should throw a definition error for a rule a type does not accept', () => {
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
    assert.equal(
      Schema.from({ n: { type: 'number', min: 1, max: 1 } }).check({ n: 1 }).valid,
      true,
    );
    assert.equal(
      Schema.from({ s: { type: 'string', length: [1, 1] } }).check({ s: 'a' }).valid,
      true,
    );
  });

  it('should accept only the rules custom types declare', () => {
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
      [
        'Price',
        { Struct: {}, value: { type: 'amount', min: 0 }, code: { type: 'code', length: 2 } },
      ],
    ]);
    const price = model.entities.get('Price');
    assert.deepEqual(price.check({ value: -1, code: 'abc' }).errors, [
      'Field "Price.value" is less than 0',
      'Field "Price.code" exceeds the maximum length',
    ]);
    assert.equal(price.check({ value: 0, code: 'ab' }).valid, true);
    assert.throws(() => Schema.from({ h: { type: 'hex', length: 2 } }), {
      code: 'ERR_INVALID_RULE',
      message: 'Rule "length" does not apply to type "hex" in "h"',
    });
    assert.throws(() => Schema.from({ v: { type: 'amount', length: 2 } }), {
      code: 'ERR_INVALID_RULE',
      message: 'Rule "length" does not apply to type "amount"; use min and max in "v"',
    });
  });

  it('should count string length in UTF-16 units, or code points with unicode', () => {
    const units = Schema.from({ s: { type: 'string', length: { max: 2 } } });
    const points = Schema.from({
      s: { type: 'string', length: { min: 2, max: 2 }, unicode: true },
    });
    assert.equal(units.check({ s: '😀' }).valid, true);
    assert.deepEqual(units.check({ s: '😀😀' }).issues[0].params, {
      min: undefined,
      max: 2,
      actual: 4,
    });
    assert.equal(points.check({ s: '😀😀' }).valid, true);
    assert.equal(points.check({ s: 'a😀' }).valid, true);
    assert.deepEqual(points.check({ s: '😀😀😀' }).issues[0].params, {
      min: 2,
      max: 2,
      actual: 3,
    });
    assert.deepEqual(points.check({ s: '😀' }).errors, ['Field "s" value is too short']);
    assert.equal(codePoints('abc'), 3);
    assert.equal(codePoints('😀'), 1);
    assert.equal(codePoints('\ud83d'), 1);
    assert.equal(codePoints('\ud83da'), 2);
    assert.equal(codePoints('😀\ude00'), 2);
    assert.equal(codePoints(''), 0);
    // unicode only changes how a string is measured.
    const list = Schema.from({ l: { array: 'string', length: { max: 1 }, unicode: true } });
    assert.equal(list.check({ l: ['😀😀'] }).valid, true);
    assert.equal(list.check({ l: ['a', 'b'] }).valid, false);
  });

  it('should bound the digits after the point of a number with decimals', () => {
    const schema = Schema.from({
      price: { type: 'number', decimals: 2, min: 0 },
      'whole?': { type: 'number', decimals: 0 },
      'fine?': { type: 'number', decimals: 15 },
    });
    // The error a sum of doubles carries is no decimal of its own.
    for (const price of [0, 19.99, 0.1 + 0.2, 19.99 * 3, -0 + 1.5, 1e300, 12345678.12]) {
      assert.equal(schema.check({ price }).valid, true, String(price));
    }
    for (const price of [0.123, 1.005, 12345678.123, 1e10 + 0.005]) {
      const result = schema.check({ price });
      assert.deepEqual(
        result.issues,
        [
          {
            code: 'decimals',
            path: ['price'],
            message: 'has more than 2 decimals',
            params: { decimals: 2 },
          },
        ],
        String(price),
      );
    }
    // NaN and the infinities have no decimals to count: the value is named.
    for (const price of [NaN, Infinity]) {
      assert.deepEqual(
        schema.check({ price }).issues,
        [
          {
            code: 'decimals',
            path: ['price'],
            message: `is ${price}, not a finite number`,
            params: { decimals: 2, received: String(price) },
          },
        ],
        String(price),
      );
    }
    assert.deepEqual(schema.check({ price: 1, whole: 2.5 }).errors, [
      'Field "whole" has more than 0 decimals',
    ]);
    assert.equal(schema.check({ price: 1, fine: 0.123456789012345 }).valid, true);
    // The type first, then the rules, each on its own.
    assert.deepEqual(
      schema.check({ price: -0.123 }).issues.map((issue) => issue.code),
      ['decimals', 'range'],
    );
    assert.deepEqual(schema.check({ price: '1.5' }).issues[0].code, 'type');
    // Fifteen decimals are told apart only below 2⁴³ units of the last one.
    assert.deepEqual(schema.warnings, [
      'Warning [unenforceable-decimals]: "fine" has 15 decimals, which the check tells apart only below 0.0088',
    ]);
    const uk = require('../../src/locales/uk.js');
    assert.equal(
      schema.check({ price: 0.123 }, { messages: uk }).errors[0],
      'Поле "price" має більше знаків після коми, ніж 2',
    );
    assert.equal(
      schema.check({ price: NaN }, { messages: uk }).errors[0],
      'Поле "price" дорівнює NaN і не є скінченним числом',
    );
    assert.equal(schema.fields.price.decimals, 2);
    for (const decimals of [-1, 16, 1.5, '2', null, true]) {
      assert.throws(() => Schema.from({ n: { type: 'number', decimals } }), {
        code: 'ERR_INVALID_RULE',
        message: 'Rule "decimals" needs an integer from 0 to 15 in "n"',
      });
    }
    for (const type of ['integer', 'bigint', 'string']) {
      assert.throws(() => Schema.from({ n: { type, decimals: 2 } }), {
        code: 'ERR_INVALID_RULE',
        message: `Rule "decimals" does not apply to type "${type}" in "n"`,
      });
    }
    // An alias of number takes the rule; the export writes it as multipleOf.
    const model = new Model({ money: { js: 'number' } }, [
      ['Order', { Struct: {}, total: { type: 'money', decimals: 2 } }],
    ]);
    const order = model.entities.get('Order');
    assert.equal(order.check({ total: 1.25 }).valid, true);
    assert.equal(order.check({ total: 1.255 }).valid, false);
    assert.deepEqual(order.toJSONSchema().properties.total, {
      type: 'number',
      multipleOf: 0.01,
    });
    assert.deepEqual(Schema.from({ n: { type: 'number', decimals: 0 } }).toJSONSchema(), {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { n: { type: 'number', multipleOf: 1 } },
      required: ['n'],
      additionalProperties: false,
    });
    assert.equal(order.toJSONSchema({ profile: 'strict' }).properties.total.multipleOf, undefined);
  });
});
