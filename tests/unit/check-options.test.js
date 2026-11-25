const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { Schema, Model } = require('../../index.js');

describe('Options', () => {
  it('should label the error lines with root, by default the schema name', () => {
    const user = new Schema('User', { name: 'string' });
    assert.deepEqual(user.check({}).errors, ['Field "User.name" is required']);
    assert.deepEqual(user.check({}, { root: 'body' }).errors, ['Field "body.name" is required']);
    assert.deepEqual(user.check({}, { root: '' }).errors, ['Field "name" is required']);
    assert.deepEqual(user.check({}, { root: 'body' }).issues[0].path, ['name']);
    assert.deepEqual(Schema.from({ name: 'string' }).check({}).errors, [
      'Field "name" is required',
    ]);
    assert.deepEqual(Schema.from({ name: 'string' }).check({}, { root: 'input' }).errors, [
      'Field "input.name" is required',
    ]);
    assert.deepEqual(Schema.from('string').check(5, { root: 'arg' }).errors, [
      'Field "arg" not of expected type: string',
    ]);
    assert.throws(() => user.check({}, { root: 5 }), {
      name: 'SchemaUsageError',
      message: 'root must be a string, got 5',
    });
    assert.equal(user.check({ name: 'x' }, { maxErrors: undefined, root: undefined }).valid, true);
  });

  it('should refuse the 1.x positional path with a hint', () => {
    const user = new Schema('User', { name: 'string' });
    assert.throws(() => user.check({}, 'body'), {
      name: 'SchemaUsageError',
      message: 'check options must be an object (the path is options.root now), got "body"',
    });
    assert.throws(() => user.check({}, 'body', { maxErrors: 1 }), { name: 'SchemaUsageError' });
    for (const options of [null, 42, true]) {
      assert.throws(() => user.check({}, options), {
        name: 'SchemaUsageError',
        message: `check options must be an object, got ${options}`,
      });
    }
    assert.equal(user.check({ name: 'x' }, {}).valid, true);
  });

  it('should decide by unknown what happens to keys the schema does not have', () => {
    const model = new Model({}, [
      ['Owner', { Struct: {}, name: 'string' }],
      [
        'Doc',
        {
          Entity: {},
          title: 'string',
          meta: { tag: 'string' },
          owner: 'Owner',
          items: { array: { n: 'number' } },
          part: Schema.from({ p: 'string' }),
        },
      ],
    ]);
    const doc = model.entities.get('Doc');
    const value = {
      title: 'x',
      meta: { tag: 't', extra: 1 },
      owner: { name: 'o', extra: 2 },
      items: [{ n: 1, extra: 3 }],
      part: { p: 'p', extra: 4 },
      extra: 5,
    };
    assert.deepEqual(doc.check(value).errors, [
      'Field "Doc.meta" has unexpected keys: extra',
      'Field "Doc.owner" has unexpected keys: extra',
      'Field "Doc.items[0]" has unexpected keys: extra',
      'Field "Doc.part" has unexpected keys: extra',
      'Field "Doc" has unexpected keys: extra',
    ]);
    assert.deepEqual(doc.check(value, { unknown: 'reject' }).valid, false);
    assert.deepEqual(doc.check(value, { unknown: 'ignore' }).errors, []);
    assert.equal(doc.check(value, { unknown: 'ignore' }).valid, true);
    // Ignoring unknown keys does not hide the other problems.
    assert.deepEqual(doc.check({ ...value, title: 1 }, { unknown: 'ignore' }).errors, [
      'Field "Doc.title" not of expected type: string',
    ]);
    for (const unknown of ['strip', null, true, 'Reject']) {
      assert.throws(() => doc.check(value, { unknown }), {
        name: 'SchemaUsageError',
        message: `unknown must be "reject" or "ignore", got ${JSON.stringify(unknown)}`,
      });
    }
    // The scan is skipped when the value has exactly the expected keys, and a
    // value with fewer keys has none to report.
    const flat = Schema.from({ a: 'string', 'b?': 'string' });
    assert.equal(flat.check({ a: 'x' }).valid, true);
    assert.equal(flat.check({ a: 'x', b: undefined }).valid, true);
    assert.deepEqual(flat.check({ a: 'x', c: 1 }).issues[0].params, { keys: ['c'] });
  });

  it('should apply every option together', () => {
    const uk = require('../../src/locales/uk.js');
    const schema = new Schema('User', { name: 'string', age: 'number' });
    const result = schema.check(
      { extra: 1 },
      { root: 'body', maxErrors: 1, unknown: 'ignore', messages: uk },
    );
    assert.deepEqual(result.errors, ['Поле "body.name" є обовʼязковим']);
    assert.deepEqual(result.issues, [
      { code: 'required', path: ['name'], message: 'є обовʼязковим', params: {} },
    ]);
  });

  it('should take the default of unknown from the metadata of a schema', () => {
    const form = new Schema('Signup', {
      Form: { unknown: 'ignore' },
      login: 'string',
      profile: { name: 'string' },
    });
    assert.equal(form.unknown, 'ignore');
    assert.deepEqual(form.custom, {});
    const value = { login: 'a', profile: { name: 'n', extra: 1 }, remember: true };
    assert.equal(form.check(value).valid, true);
    assert.deepEqual(form.check(value, { unknown: 'reject' }).errors, [
      'Field "Signup.profile" has unexpected keys: extra',
      'Field "Signup" has unexpected keys: remember',
    ]);
    assert.equal(form.check(value, { maxErrors: 1 }).valid, true);
    assert.equal(Schema.from({ a: 'string' }).unknown, 'reject');
    assert.equal(Schema.from({ Struct: {}, a: 'string' }).unknown, 'reject');
    for (const kind of ['Struct', 'Entity', 'Registry', 'Custom']) {
      const schema = new Schema('Thing', { [kind]: { unknown: 'ignore' }, a: 'string' });
      assert.equal(schema.unknown, 'ignore', kind);
      assert.equal(schema.check({ a: 'x', b: 1 }).valid, true, kind);
      assert.equal(schema.check({ a: 'x', b: 1 }, { unknown: 'reject' }).valid, false, kind);
    }
    for (const unknown of ['strip', null, true, 'Ignore']) {
      assert.throws(() => Schema.from({ Struct: { unknown }, a: 'string' }), {
        name: 'SchemaDefinitionError',
        code: 'ALX_ERR_INVALID_OPTIONS',
        message: `Schema metadata "unknown" must be "reject" or "ignore", got ${JSON.stringify(unknown)}`,
      });
    }
    // The policy belongs to the check, not to the struct: a lenient schema
    // embedded in a strict one is checked strictly through the strict one.
    const lenient = new Schema('Meta', { Struct: { unknown: 'ignore' }, tag: 'string' });
    const strict = new Schema('Doc', { meta: lenient, title: 'string' });
    assert.equal(lenient.check({ tag: 't', extra: 1 }).valid, true);
    assert.deepEqual(strict.check({ meta: { tag: 't', extra: 1 }, title: 'x' }).errors, [
      'Field "Doc.meta" has unexpected keys: extra',
    ]);
    const model = new Model({}, [
      ['Owner', { Entity: {}, name: 'string' }],
      ['Request', { Form: { unknown: 'ignore' }, owner: 'Owner' }],
    ]);
    assert.equal(model.entities.get('Request').unknown, 'ignore');
    assert.equal(model.entities.get('Owner').unknown, 'reject');
  });
});
