const { test } = require('node:test');
const assert = require('node:assert');

const { Schema, Model } = require('../../index.js');
const { register } = require('../../src/generators/index.js');
const uk = require('../../src/locales/uk.js');

register();

test('Flags: an object of the names of the list, each true or false', () => {
  const schema = Schema.from({
    perms: { flags: ['read', 'write', 'constructor'] },
    'extra?': { type: 'flags', flags: ['beta'] },
  });
  assert.strictEqual(schema.fields.perms.type, 'flags');
  assert.deepStrictEqual(schema.fields.perms.flags, ['read', 'write', 'constructor']);
  for (const perms of [{}, { read: true }, { read: false, write: true, constructor: false }]) {
    assert.strictEqual(schema.check({ perms }).valid, true);
  }
  assert.strictEqual(schema.check({ perms: {}, extra: null }).valid, true);
  assert.deepStrictEqual(
    schema.check({ perms: { read: 1, write: 'yes', admin: true, toString: false } }).errors,
    [
      'Field "perms.read" not of expected type: boolean',
      'Field "perms.write" not of expected type: boolean',
      'Field "perms" has unexpected keys: admin, toString',
    ],
  );
  const result = schema.check({ perms: { read: null } });
  assert.deepStrictEqual(result.issues, [
    {
      code: 'type',
      path: ['perms', 'read'],
      message: 'not of expected type: boolean',
      params: { expected: 'boolean', received: 'null' },
    },
  ]);
  for (const perms of [null, [], 'read', 3]) {
    assert.deepStrictEqual(schema.check({ perms }).errors, [
      'Field "perms" not of expected type: flags',
    ]);
  }
  assert.deepStrictEqual(schema.check({}).errors, ['Field "perms" is required']);
  // An inherited key is no key of the value; maxErrors stops the names.
  assert.strictEqual(schema.check({ perms: Object.create({ admin: true }) }).valid, true);
  assert.strictEqual(
    schema.check({ perms: { read: 1, write: 2, admin: true } }, { maxErrors: 1 }).issues.length,
    1,
  );
  assert.deepStrictEqual(schema.check({ perms: { admin: 1 } }, { messages: uk }).errors, [
    'Поле "perms" має неочікувані ключі: admin',
  ]);
  assert.deepStrictEqual(schema.warnings, []);
});

test('Flags: a name the list does not have follows the unknown-keys policy', () => {
  const strict = Schema.from({ perms: { flags: ['read'] } });
  const lenient = new Schema('Lenient', {
    Struct: { unknown: 'ignore' },
    perms: { flags: ['read'] },
  });
  const value = { perms: { read: true, admin: true } };
  assert.strictEqual(strict.check(value).valid, false);
  assert.strictEqual(strict.check(value, { unknown: 'ignore' }).valid, true);
  assert.strictEqual(lenient.check(value).valid, true);
  assert.strictEqual(lenient.check(value, { unknown: 'reject' }).valid, false);
  // A name the list has is a boolean whatever the policy.
  assert.strictEqual(lenient.check({ perms: { read: 'yes', admin: true } }).valid, false);
  // parse keeps the value under ignore, and leaves the foreign names out
  // under strip, copying the value only then.
  const ignored = strict.parse(value, { unknown: 'ignore' });
  assert.strictEqual(ignored.value, value);
  const stripped = strict.parse(value, { unknown: 'strip' });
  assert.deepStrictEqual(stripped.value, { perms: { read: true } });
  assert.deepStrictEqual(value, { perms: { read: true, admin: true } });
  const clean = { perms: { read: false } };
  assert.strictEqual(strict.parse(clean, { unknown: 'strip' }).value.perms, clean.perms);
  // The JSON Schema is closed when the document is.
  assert.deepStrictEqual(lenient.toJSONSchema().properties.perms, {
    type: 'object',
    properties: { read: { type: 'boolean' } },
  });
  assert.deepStrictEqual(strict.toJSONSchema().properties.perms, {
    type: 'object',
    properties: { read: { type: 'boolean' } },
    additionalProperties: false,
  });
});

test('Flags: a list that is not one of distinct names is a definition error', () => {
  for (const names of [[], ['a', 'a'], [''], ['__proto__'], 'a', [1], undefined, null]) {
    assert.throws(() => Schema.from({ perms: { flags: names } }), {
      name: 'SchemaDefinitionError',
      code: 'ERR_INVALID_DEFINITION',
      message: `Type "flags" needs a list of distinct names: { flags: ['read', 'write'] } in "perms"`,
    });
  }
  assert.throws(() => Schema.from({ perms: { flags: ['a'], length: 1 } }), {
    code: 'ERR_INVALID_RULE',
  });
  // An alias of flags is flags (a name no struct of this file starts with:
  // the registry is process-wide).
  const model = new Model({ permset: { js: 'flags' } }, [
    ['User', { Struct: {}, access: { type: 'permset', flags: ['read'] } }],
  ]);
  const user = model.entities.get('User');
  assert.strictEqual(user.check({ access: { read: true } }).valid, true);
  assert.deepStrictEqual(user.check({ access: [] }).errors, [
    'Field "User.access" not of expected type: permset',
  ]);
});

test('Flags: TypeScript and the JSON Schema targets', () => {
  const schema = new Schema('Access', {
    perms: { flags: ['read', 'write', 'x-admin'] },
    'more?': { type: 'flags', flags: ['beta'], nullable: true },
  });
  assert.strictEqual(
    schema.toInterface(),
    'interface Access {\n  perms: { read?: boolean; write?: boolean; "x-admin"?: boolean };\n' +
      '  more?: { beta?: boolean } | null;\n}',
  );
  const properties = {
    read: { type: 'boolean' },
    write: { type: 'boolean' },
    'x-admin': { type: 'boolean' },
  };
  assert.deepStrictEqual(schema.toJSONSchema().properties, {
    perms: { type: 'object', properties, additionalProperties: false },
    more: {
      type: ['object', 'null'],
      properties: { beta: { type: 'boolean' } },
      additionalProperties: false,
    },
  });
  // The strict profile lists every name as required.
  assert.deepStrictEqual(schema.toJSONSchema({ profile: 'strict' }).properties.perms, {
    type: 'object',
    properties,
    required: ['read', 'write', 'x-admin'],
    additionalProperties: false,
  });
  assert.deepStrictEqual(schema.toJSONSchema({ target: 'mongodb' }).properties.perms, {
    bsonType: 'object',
    properties: {
      read: { bsonType: 'bool' },
      write: { bsonType: 'bool' },
      'x-admin': { bsonType: 'bool' },
    },
    additionalProperties: false,
  });
});
