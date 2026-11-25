const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { Schema, Model } = require('../../index.js');
const { register } = require('../../src/generators/index.js');
const uk = require('../../src/locales/uk.js');

register();

describe('Flags', () => {
  it('should accept an object of the names of the list, each true or false', () => {
    const schema = Schema.from({
      perms: { flags: ['read', 'write', 'constructor'] },
      'extra?': { type: 'flags', flags: ['beta'] },
    });
    assert.equal(schema.fields.perms.type, 'flags');
    assert.deepEqual(schema.fields.perms.flags, ['read', 'write', 'constructor']);
    for (const perms of [{}, { read: true }, { read: false, write: true, constructor: false }]) {
      assert.equal(schema.check({ perms }).valid, true);
    }
    assert.equal(schema.check({ perms: {}, extra: null }).valid, true);
    assert.deepEqual(
      schema.check({ perms: { read: 1, write: 'yes', admin: true, toString: false } }).errors,
      [
        'Field "perms.read" not of expected type: boolean',
        'Field "perms.write" not of expected type: boolean',
        'Field "perms" has unexpected keys: admin, toString',
      ],
    );
    const result = schema.check({ perms: { read: null } });
    assert.deepEqual(result.issues, [
      {
        code: 'type',
        path: ['perms', 'read'],
        message: 'not of expected type: boolean',
        params: { expected: 'boolean', received: 'null' },
      },
    ]);
    for (const perms of [null, [], 'read', 3]) {
      assert.deepEqual(schema.check({ perms }).errors, [
        'Field "perms" not of expected type: flags',
      ]);
    }
    assert.deepEqual(schema.check({}).errors, ['Field "perms" is required']);
    // An inherited key is no key of the value; maxErrors stops the names.
    assert.equal(schema.check({ perms: Object.create({ admin: true }) }).valid, true);
    assert.equal(
      schema.check({ perms: { read: 1, write: 2, admin: true } }, { maxErrors: 1 }).issues.length,
      1,
    );
    assert.deepEqual(schema.check({ perms: { admin: 1 } }, { messages: uk }).errors, [
      'Поле "perms" має неочікувані ключі: admin',
    ]);
    assert.deepEqual(schema.warnings, []);
  });

  it('should follow the unknown-keys policy for a name the list does not have', () => {
    const strict = Schema.from({ perms: { flags: ['read'] } });
    const lenient = new Schema('Lenient', {
      Struct: { unknown: 'ignore' },
      perms: { flags: ['read'] },
    });
    const value = { perms: { read: true, admin: true } };
    assert.equal(strict.check(value).valid, false);
    assert.equal(strict.check(value, { unknown: 'ignore' }).valid, true);
    assert.equal(lenient.check(value).valid, true);
    assert.equal(lenient.check(value, { unknown: 'reject' }).valid, false);
    // A name the list has is a boolean whatever the policy.
    assert.equal(lenient.check({ perms: { read: 'yes', admin: true } }).valid, false);
    // parse keeps the value under ignore, and leaves the foreign names out
    // under strip, copying the value only then.
    const ignored = strict.parse(value, { unknown: 'ignore' });
    assert.equal(ignored.value, value);
    const stripped = strict.parse(value, { unknown: 'strip' });
    assert.deepEqual(stripped.value, { perms: { read: true } });
    assert.deepEqual(value, { perms: { read: true, admin: true } });
    const clean = { perms: { read: false } };
    assert.equal(strict.parse(clean, { unknown: 'strip' }).value.perms, clean.perms);
    // The JSON Schema is closed when the document is.
    assert.deepEqual(lenient.toJSONSchema().properties.perms, {
      type: 'object',
      properties: { read: { type: 'boolean' } },
    });
    assert.deepEqual(strict.toJSONSchema().properties.perms, {
      type: 'object',
      properties: { read: { type: 'boolean' } },
      additionalProperties: false,
    });
  });

  it('should throw a definition error for a list that is not one of distinct names', () => {
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
    assert.equal(user.check({ access: { read: true } }).valid, true);
    assert.deepEqual(user.check({ access: [] }).errors, [
      'Field "User.access" not of expected type: permset',
    ]);
  });

  it('should keep the list given when the field was built', () => {
    // The checks are compiled on first use; the program's array changed after
    // the schema was built reaches neither them nor parse.
    const names = ['read'];
    const schema = Schema.from({ perms: { flags: names } });
    names.push('admin', '__proto__');
    assert.deepEqual(schema.fields.perms.flags, ['read']);
    assert.equal(Object.isFrozen(schema.fields.perms.flags), true);
    assert.equal(schema.check({ perms: { admin: true } }).valid, false);
    const parsed = schema.parse({ perms: { read: true, admin: true } }, { unknown: 'strip' });
    assert.deepEqual(parsed.value, { perms: { read: true } });
  });

  it('should render TypeScript and the JSON Schema targets', () => {
    const schema = new Schema('Access', {
      perms: { flags: ['read', 'write', 'x-admin'] },
      'more?': { type: 'flags', flags: ['beta'], nullable: true },
    });
    assert.equal(
      schema.toInterface(),
      'interface Access {\n  perms: { read?: boolean; write?: boolean; "x-admin"?: boolean };\n' +
        '  more?: { beta?: boolean } | null;\n}',
    );
    // A field of another type with an option called `flags` is that type, an
    // alias of flags is flags.
    const other = new Model({ permits: { js: 'flags' } }, [
      [
        'Other',
        { Struct: {}, re: { type: 'string', flags: 'gi' }, ok: { type: 'permits', flags: ['a'] } },
      ],
    ]);
    assert.equal(
      other.entities.get('Other').toInterface(),
      'interface Other {\n  re: string;\n  ok: { a?: boolean };\n}',
    );
    const properties = {
      read: { type: 'boolean' },
      write: { type: 'boolean' },
      'x-admin': { type: 'boolean' },
    };
    assert.deepEqual(schema.toJSONSchema().properties, {
      perms: { type: 'object', properties, additionalProperties: false },
      more: {
        type: ['object', 'null'],
        properties: { beta: { type: 'boolean' } },
        additionalProperties: false,
      },
    });
    // The strict profile lists every name as required.
    assert.deepEqual(schema.toJSONSchema({ profile: 'strict' }).properties.perms, {
      type: 'object',
      properties,
      required: ['read', 'write', 'x-admin'],
      additionalProperties: false,
    });
    assert.deepEqual(schema.toJSONSchema({ target: 'mongodb' }).properties.perms, {
      bsonType: 'object',
      properties: {
        read: { bsonType: 'bool' },
        write: { bsonType: 'bool' },
        'x-admin': { bsonType: 'bool' },
      },
      additionalProperties: false,
    });
  });
});
