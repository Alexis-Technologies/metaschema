const { test } = require('node:test');
const assert = require('node:assert');

const { Schema, Model } = require('../../index.js');

test('Nullable: the key is required, the value may be null', () => {
  const schema = Schema.from({
    parent: { type: 'string', nullable: true },
    'nick?': 'string',
    plain: 'string',
  });
  assert.strictEqual(schema.fields.parent.required, true);
  assert.strictEqual(schema.fields.parent.nullable, true);
  assert.strictEqual(schema.check({ parent: null, plain: 'x' }).valid, true);
  assert.strictEqual(schema.check({ parent: 'root', plain: 'x' }).valid, true);
  assert.deepStrictEqual(schema.check({ plain: 'x' }).errors, ['Field "parent" is required']);
  assert.deepStrictEqual(schema.check({ parent: undefined, plain: 'x' }).errors, [
    'Field "parent" not of expected type: string',
  ]);
  assert.deepStrictEqual(schema.check({ parent: 5, plain: null }).errors, [
    'Field "parent" not of expected type: string',
    'Field "plain" not of expected type: string',
  ]);
  // '?string' stays optional: undefined or null.
  assert.strictEqual(schema.check({ parent: null, nick: null, plain: 'x' }).valid, true);
  const explicit = Schema.from({ a: { type: 'string', nullable: false } });
  assert.deepStrictEqual(explicit.check({ a: null }).errors, [
    'Field "a" not of expected type: string',
  ]);
  const both = Schema.from({ a: { type: 'string', nullable: true, required: false } });
  assert.strictEqual(both.check({}).valid, true);
  assert.strictEqual(both.check({ a: null }).valid, true);
  assert.strictEqual(both.check({ a: 1 }).valid, false);
  for (const nullable of ['yes', 1, null, {}]) {
    assert.throws(() => Schema.from({ a: { type: 'string', nullable } }), {
      name: 'SchemaDefinitionError',
      code: 'ERR_INVALID_DEFINITION',
      message: 'Option "nullable" needs a boolean in "a"',
    });
  }
});

test('Nullable: null skips the rules and validate, and works for every type', () => {
  const calls = [];
  const model = new Model({}, [['Owner', { Struct: {}, name: 'string' }]]);
  const schema = new Schema(
    'Doc',
    {
      code: {
        type: 'string',
        length: { min: 2 },
        pattern: '^a',
        nullable: true,
        validate: (value) => {
          calls.push(value);
          return true;
        },
      },
      count: { type: 'integer', min: 0, nullable: true },
      role: { enum: ['admin', 'user'], nullable: true },
      tags: { array: 'string', nullable: true },
      items: { array: { type: 'string', nullable: true } },
      address: { schema: { city: 'string' }, nullable: true },
      owner: { type: 'Owner', nullable: true },
      point: { type: 'tuple', value: ['number'], nullable: true },
    },
    [model],
  );
  const nulls = {
    code: null,
    count: null,
    role: null,
    tags: null,
    items: [null, 'x'],
    address: null,
    owner: null,
    point: null,
  };
  assert.deepStrictEqual(schema.check(nulls).errors, []);
  assert.deepStrictEqual(calls, []);
  const values = {
    code: 'ab',
    count: 1,
    role: 'admin',
    tags: ['x'],
    items: ['y'],
    address: { city: 'Lviv' },
    owner: { name: 'o' },
    point: [1],
  };
  assert.strictEqual(schema.check(values).valid, true);
  assert.deepStrictEqual(calls, ['ab']);
  assert.deepStrictEqual(schema.check({ ...values, code: 'b', count: -1, role: 'x' }).errors, [
    'Field "Doc.code" value is too short',
    'Field "Doc.code" does not match the pattern ^a',
    'Field "Doc.count" is less than 0',
    'Field "Doc.role" value is not of enum: admin, user',
  ]);
  assert.deepStrictEqual(schema.check({ ...values, items: [undefined] }).errors, [
    'Field "Doc.items[0]" not of expected type: string',
  ]);
  assert.strictEqual(
    schema.toInterface(),
    `interface Doc {
  code: string | null;
  count: number | null;
  role: "admin" | "user" | null;
  tags: string[] | null;
  items: (string | null)[];
  address: { city: string } | null;
  ownerId: string | null;
  point: [number] | null;
}`,
  );
  assert.strictEqual(Schema.from({ type: 'string', nullable: true }).check(null).valid, true);
});
