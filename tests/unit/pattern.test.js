const { test } = require('node:test');
const assert = require('node:assert');

const { Schema } = require('../../index.js');

test('Pattern: a string or a RegExp, compiled once with the u flag', () => {
  const schema = Schema.from({
    slug: { type: 'string', pattern: '^[a-z0-9-]+$' },
    name: { type: 'string', pattern: /^\p{L}+$/i },
    'code?': { type: 'string', pattern: /a/g },
  });
  assert.ok(schema.fields.slug.pattern instanceof RegExp);
  assert.strictEqual(schema.fields.slug.pattern.flags, 'u');
  assert.strictEqual(schema.fields.name.pattern.flags, 'iu');
  assert.strictEqual(schema.fields.code.pattern.flags, 'u');
  assert.strictEqual(schema.check({ slug: 'hello-42', name: 'Марк' }).valid, true);
  assert.strictEqual(schema.check({ slug: 'hello-42', name: 'mark' }).valid, true);
  const result = schema.check({ slug: 'Hello World', name: 'R2D2' });
  assert.deepStrictEqual(result.issues, [
    {
      code: 'pattern',
      path: ['slug'],
      message: 'does not match the pattern ^[a-z0-9-]+$',
      params: { pattern: '^[a-z0-9-]+$' },
    },
    {
      code: 'pattern',
      path: ['name'],
      message: 'does not match the pattern ^\\p{L}+$',
      params: { pattern: '^\\p{L}+$' },
    },
  ]);
  // A sticky or global flag would make the second test of the same value fail.
  for (let index = 0; index < 3; index += 1) {
    assert.strictEqual(schema.check({ slug: 'a', name: 'a', code: 'banana' }).valid, true);
  }
  assert.strictEqual(schema.check({ slug: 'a', name: 'a', code: null }).valid, true);
  assert.strictEqual(schema.check({ slug: 'a', name: 'a', code: 'xyz' }).valid, false);
  const uk = require('../../src/locales/uk.js');
  assert.deepStrictEqual(schema.check({ slug: '!', name: 'a' }, { messages: uk }).errors, [
    'Поле "slug" не відповідає шаблону ^[a-z0-9-]+$',
  ]);
  const astral = Schema.from({ s: { type: 'string', pattern: '^.$' } });
  assert.strictEqual(astral.check({ s: '😀' }).valid, true);
});

test('Pattern: runs after the type and length checks', () => {
  const calls = [];
  const schema = Schema.from({
    s: {
      type: 'string',
      length: { max: 3 },
      pattern: '^a',
      validate: (value) => {
        calls.push(value);
        return true;
      },
    },
  });
  assert.deepStrictEqual(schema.check({ s: 5 }).errors, ['Field "s" not of expected type: string']);
  assert.deepStrictEqual(schema.check({ s: 'bbbb' }).errors, [
    'Field "s" exceeds the maximum length',
    'Field "s" does not match the pattern ^a',
  ]);
  assert.deepStrictEqual(schema.check({ s: 'bbbb' }, { maxErrors: 1 }).errors, [
    'Field "s" exceeds the maximum length',
  ]);
  assert.deepStrictEqual(calls, []);
  assert.strictEqual(schema.check({ s: 'abc' }).valid, true);
  assert.deepStrictEqual(calls, ['abc']);
});

test('Pattern: an invalid pattern, or one on another type, is a definition error', () => {
  assert.throws(() => Schema.from({ s: { type: 'string', pattern: '(' } }), {
    name: 'SchemaDefinitionError',
    code: 'ERR_INVALID_RULE',
    message: /^Rule "pattern" is not a valid regular expression: .+ in "s"$/,
  });
  // `\-` is a syntax error under the u flag.
  assert.throws(() => Schema.from({ s: { type: 'string', pattern: '\\-' } }), {
    code: 'ERR_INVALID_RULE',
  });
  for (const pattern of [5, null, {}, ['a']]) {
    assert.throws(() => Schema.from({ s: { type: 'string', pattern } }), {
      code: 'ERR_INVALID_RULE',
      message: 'Rule "pattern" needs a string or a RegExp in "s"',
    });
  }
  assert.throws(() => Schema.from({ n: { type: 'number', pattern: '1' } }), {
    code: 'ERR_INVALID_RULE',
    message: 'Rule "pattern" does not apply to type "number" in "n"',
  });
  assert.throws(() => Schema.from({ tags: { array: 'string', pattern: 'a' } }), {
    code: 'ERR_INVALID_RULE',
    message: 'Rule "pattern" does not apply to type "array" in "tags"',
  });
});
