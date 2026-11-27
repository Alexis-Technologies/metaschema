const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { Schema } = require('../../index.js');
const { register } = require('../../src/generators/index.js');

register();

describe('Values', () => {
  it('should accept as a date only a Date instance with a valid time', () => {
    const schema = Schema.from({ at: 'date', 'until?': 'date' });
    assert.equal(Schema.from('date').kind, 'scalar');
    assert.equal(schema.check({ at: new Date() }).valid, true);
    assert.equal(schema.check({ at: new Date(0), until: null }).valid, true);
    for (const at of [new Date('nope'), Date.now(), '2026-10-09', {}, null]) {
      assert.deepEqual(schema.check({ at }).errors, ['Field "at" not of expected type: date']);
    }
    assert.deepEqual(schema.check({ at: new Date(NaN) }).issues[0].params, {
      expected: 'date',
      received: 'object',
    });
    assert.equal(schema.check({ at: new Date(), until: 5 }).valid, false);
    assert.equal(
      new Schema('Event', { at: 'date' }).toInterface(),
      'interface Event {\n  at: Date;\n}',
    );
  });

  it('should accept only null as null', () => {
    const schema = Schema.from({ nothing: 'null', 'maybe?': 'null' });
    assert.equal(schema.check({ nothing: null }).valid, true);
    assert.equal(schema.check({ nothing: null, maybe: null }).valid, true);
    for (const nothing of [undefined, 0, '', false, {}]) {
      assert.deepEqual(schema.check({ nothing }).errors, [
        'Field "nothing" not of expected type: null',
      ]);
    }
    assert.deepEqual(schema.check({}).errors, ['Field "nothing" is required']);
    assert.deepEqual(schema.check({ nothing: null, maybe: 1 }).errors, [
      'Field "maybe" not of expected type: null',
    ]);
    assert.equal(Schema.from('null').check(null).valid, true);
    assert.equal(Schema.from('null').check(undefined).valid, false);
    assert.equal(Schema.from({ n: 'null' }).toInterface(), 'interface  {\n  n: null;\n}');
  });

  it('should accept every value for any and unknown, required keys included', () => {
    const schema = Schema.from({ a: 'any', u: 'unknown', 'o?': 'any' });
    for (const value of [null, undefined, 0, '', false, {}, [], new Map(), () => {}, Symbol('s')]) {
      assert.equal(schema.check({ a: value, u: value }).valid, true);
    }
    assert.deepEqual(schema.check({ u: 1 }).errors, ['Field "a" is required']);
    assert.equal(schema.check({ a: undefined, u: undefined }).valid, true);
    assert.equal(Schema.from('any').check(undefined).valid, true);
    assert.equal(Schema.from('any').kind, 'scalar');
    assert.equal(
      new Schema('Bag', { a: 'any', u: 'unknown', 'o?': 'unknown' }).toInterface(),
      'interface Bag {\n  a: any;\n  u: unknown;\n  o?: unknown;\n}',
    );
    assert.equal(
      Schema.from({ list: { array: 'any' } }).check({ list: [1, 'two', null] }).valid,
      true,
    );
  });

  it('should not take a value whose constructor key names a built-in for that built-in', () => {
    // JSON can carry an own key called `constructor`, and `{ name: 'Map' }`
    // under it is what the check reads the name of a built-in from; the shape
    // decides, so such a value is a type issue, never a throw out of check.
    const fake = (name) => JSON.parse(`{"constructor":{"name":"${name}"},"size":0}`);
    const schema = Schema.from({
      when: 'date',
      table: { map: { string: 'number' } },
      bag: { set: 'number' },
      'sized?': { map: { string: 'number' }, length: { max: 2 } },
      u: { union: [{ set: 'number' }, { map: { string: 'number' } }, 'date', 'string'] },
    });
    const value = {
      when: fake('Date'),
      table: fake('Map'),
      bag: fake('Set'),
      sized: fake('Map'),
      u: fake('Set'),
    };
    assert.deepEqual(schema.check(value).errors, [
      'Field "when" not of expected type: date',
      'Field "table" not of expected type: map',
      'Field "bag" not of expected type: set',
      'Field "sized" not of expected type: map',
      'Field "u" does not match any of: set, map, date, string',
    ]);
    const parsed = schema.parse(value);
    assert.equal(parsed.valid, false);
    assert.equal(parsed.issues.length, 5);
    assert.equal(schema.serialize(value).value.when, value.when);
    // The real built-ins are still what they are, from any realm.
    const real = { when: new Date(0), table: new Map([['a', 1]]), bag: new Set([1]), u: new Set() };
    assert.equal(schema.check(real).valid, true);
    assert.equal(Schema.from({ at: 'date' }).check({ at: { getTime: () => 1 } }).valid, false);
  });

  it('should accept as bytes a Uint8Array of any realm, a Buffer included', () => {
    const vm = require('node:vm');
    const schema = Schema.from({ data: 'bytes', 'thumb?': 'bytes' });
    assert.equal(Schema.from('bytes').kind, 'scalar');
    for (const data of [
      new Uint8Array(0),
      new Uint8Array([1, 2]),
      Buffer.from('ab'),
      vm.runInNewContext('new Uint8Array(3)'),
    ]) {
      assert.equal(schema.check({ data }).valid, true);
    }
    // Another view, an array of numbers, base64 text and an object that claims
    // the tag are not bytes.
    for (const data of [
      new Int8Array(1),
      new Uint8ClampedArray(1),
      new DataView(new ArrayBuffer(1)),
      new ArrayBuffer(1),
      [1, 2],
      'AQI=',
      { [Symbol.toStringTag]: 'Uint8Array', length: 0 },
      Object.create(Uint8Array.prototype),
      null,
    ]) {
      assert.deepEqual(schema.check({ data }).errors, ['Field "data" not of expected type: bytes']);
    }
    assert.deepEqual(schema.check({ data: [] }).issues[0].params, {
      expected: 'bytes',
      received: 'array',
    });
    assert.equal(schema.check({ data: Buffer.from('a'), thumb: null }).valid, true);
    assert.equal(
      new Schema('File', { data: 'bytes', 'thumb?': 'bytes' }).toInterface(),
      'interface File {\n  data: Uint8Array;\n  thumb?: Uint8Array;\n}',
    );
    // `length` counts the bytes, on both backends (compile.test.js); the rules
    // of text do not apply.
    const sized = Schema.from({ data: { type: 'bytes', length: { min: 1, max: 3 } } });
    assert.equal(sized.check({ data: Buffer.from('abc') }).valid, true);
    assert.deepEqual(sized.check({ data: new Uint8Array(4) }).issues[0].params, {
      min: 1,
      max: 3,
      actual: 4,
    });
    assert.deepEqual(sized.check({ data: new Uint8Array(0) }).errors, [
      'Field "data" value is too short',
    ]);
    assert.throws(() => Schema.from({ data: { type: 'bytes', pattern: /x/ } }), {
      code: 'ALX_ERR_INVALID_RULE',
      message: 'Rule "pattern" does not apply to type "bytes" in "data"',
    });
  });
});
