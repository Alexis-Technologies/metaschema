const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const util = require('node:util');

const { Schema, Model } = require('../../index.js');
const uk = require('../../src/locales/uk.js');
const { database, types: customTypes, ...entities } = require('../fixtures/schemas/index.js');

// The fixture model needs `datetime`, which its own type table leaves to the
// system table.
const types = { datetime: { js: 'string' }, ...customTypes };

// The consumer of the specification's README: it knows nothing about
// metaschema and reads `~standard` alone; a promise is awaited.
const standardValidate = (schema, input) => {
  const result = schema['~standard'].validate(input);
  if (result instanceof Promise) return result.then((settled) => standardValidate.settle(settled));
  return standardValidate.settle(result);
};
standardValidate.settle = (result) => {
  if (result.issues) throw new Error(JSON.stringify(result.issues));
  return result.value;
};

// How wrpc tells a Standard Schema from an Ajv schema.
const isStandardSchema = (schema) =>
  typeof schema === 'object' && schema !== null && '~standard' in schema;

const summarize = (issues) => issues.map(({ message, path }) => [message, path]);

describe('Standard', () => {
  it('should build the props of the interface once per schema', () => {
    const schema = Schema.from({ name: 'string' });
    const standard = schema['~standard'];
    assert.equal(standard.version, 1);
    assert.equal(standard.vendor, 'alexify.metaschema');
    assert.equal(typeof standard.validate, 'function');
    // The jsonSchema converter joins the props through the generators subpath.
    assert.deepEqual(Object.keys(standard), ['version', 'vendor', 'validate']);
    assert.equal(schema['~standard'], standard);
    assert.notEqual(Schema.from({ name: 'string' })['~standard'], standard);
    assert.equal(isStandardSchema(schema), true);
    assert.equal(isStandardSchema({ type: 'object' }), false);
  });

  it('should return a valid value as it is, without issues', () => {
    const schema = Schema.from({ name: 'string', 'tags?': { array: 'string' } });
    const value = { name: 'Marcus', tags: ['admin'] };
    const result = schema['~standard'].validate(value);
    // The value of parse: the value itself when no default, decoder or strip
    // touched it, as 2.0 returned it.
    assert.equal(result.value, value);
    assert.equal(result.issues, undefined);
    assert.equal('issues' in result, false);
    assert.deepEqual(Object.keys(result), ['value']);
  });

  it('should validate as parse does, with the policies of the schema', () => {
    const schema = new Schema('Event', {
      Form: { unknown: 'ignore' },
      name: 'string',
      'when?': { type: 'string', parse: (text) => new Date(text) },
      'level?': { type: 'integer', default: 1 },
    });
    const value = { name: 'x', when: '2020-01-01T00:00:00.000Z', extra: true };
    const result = schema['~standard'].validate(value);
    assert.deepEqual(result, {
      value: { name: 'x', when: new Date('2020-01-01T00:00:00.000Z'), extra: true, level: 1 },
    });
    assert.notEqual(result.value, value);
    assert.deepEqual(value, { name: 'x', when: '2020-01-01T00:00:00.000Z', extra: true });
    // The policy of the schema, unless the call says otherwise.
    const stripped = schema['~standard'].validate(value, { libraryOptions: { unknown: 'strip' } });
    assert.deepEqual(Object.keys(stripped.value), ['name', 'when', 'level']);
    const strict = Schema.from({ name: 'string' });
    assert.equal('issues' in strict['~standard'].validate({ name: 'x', extra: 1 }), true);
    // A decoder that fails is an issue, and check knows nothing of defaults.
    const failing = Schema.from({
      when: {
        type: 'string',
        parse: () => {
          throw new Error('bad date');
        },
      },
    });
    assert.deepEqual(summarize(failing['~standard'].validate({ when: 'x' }).issues), [
      ['validation failed Error: bad date', ['when']],
    ]);
    assert.equal(schema.check({ name: 'x' }).valid, true);
  });

  it('should validate through a promise for a schema with an async validator or decoder', async () => {
    const schema = Schema.from({
      login: { type: 'string', validate: async (value) => value !== 'admin' || 'is taken' },
      'when?': { type: 'string', parse: async (text) => new Date(text) },
    });
    const pending = schema['~standard'].validate({ login: 'marcus', when: '2020-01-01' });
    assert.equal(pending instanceof Promise, true);
    assert.deepEqual(await pending, {
      value: { login: 'marcus', when: new Date('2020-01-01') },
    });
    assert.deepEqual(summarize((await schema['~standard'].validate({ login: 'admin' })).issues), [
      ['is taken', ['login']],
    ]);
    assert.equal(await standardValidate(schema, { login: 'x' }).then((v) => v.login), 'x');
    // Detected on the functions of the schema and of the entities it reaches:
    // an async function anywhere makes the whole schema async.
    const model = new Model({ taken: { construct() {}, checkType: async () => true } }, [
      ['Tag', { Struct: {}, label: 'taken' }],
      ['Doc', { Struct: {}, tags: { many: 'Tag' } }],
      ['Note', { Struct: {}, text: 'string', validate: async () => true }],
      ['Plain', { Struct: {}, text: 'string', validate: () => true }],
    ]);
    const built = model.entities;
    assert.equal(built.get('Doc')['~standard'].validate({ tags: [] }) instanceof Promise, true);
    assert.equal(built.get('Note')['~standard'].validate({ text: 'x' }) instanceof Promise, true);
    assert.equal(built.get('Plain')['~standard'].validate({ text: 'x' }) instanceof Promise, false);
    // A validator that returns a promise without being an async function is
    // what it is to parse: an error of a synchronous call.
    const sneaky = Schema.from({ a: { type: 'string', validate: () => Promise.resolve(true) } });
    assert.throws(() => sneaky['~standard'].validate({ a: 'x' }), { code: 'ERR_ASYNC_VALIDATOR' });
  });

  it('should report the issues of an invalid value with a message and a path of keys', () => {
    const schema = Schema.from({
      name: 'string',
      address: { city: 'string', zip: 'string' },
      tags: { array: 'string' },
      point: ['number', 'number'],
    });
    const result = schema['~standard'].validate({
      name: 1,
      address: { city: 'Kyiv', extra: true },
      tags: ['a', 2],
      point: [0, 'y'],
      other: 1,
    });
    assert.equal('value' in result, false);
    assert.deepEqual(summarize(result.issues), [
      ['not of expected type: string', ['name']],
      ['is required', ['address', 'zip']],
      ['has unexpected keys: extra', ['address']],
      ['not of expected type: string', ['tags', 1]],
      ['not of expected type: number', ['point', 1]],
      ['has unexpected keys: other', []],
    ]);
    // The issues are the result's own, not copies: a consumer that knows
    // metaschema reads the code and the params too.
    for (const issue of result.issues) {
      assert.deepEqual(Object.keys(issue), ['code', 'path', 'message', 'params']);
    }
    assert.equal(result.issues[0].code, 'type');
    assert.deepEqual(result.issues[0].params, { expected: 'string', received: 'number' });
  });

  it('should report at the empty path for a scalar schema', () => {
    const string = Schema.from('string');
    assert.deepEqual(string['~standard'].validate('x'), { value: 'x' });
    assert.deepEqual(summarize(string['~standard'].validate(42).issues), [
      ['not of expected type: string', []],
    ]);
    const numbers = Schema.from({ array: 'number' });
    assert.deepEqual(summarize(numbers['~standard'].validate([1, 'x']).issues), [
      ['not of expected type: number', [1]],
    ]);
  });

  it('should use the message of a validator as the message of its issue', () => {
    const schema = Schema.from({
      code: { type: 'string', validate: (value) => value.length > 1 || 'too short' },
    });
    assert.deepEqual(summarize(schema['~standard'].validate({ code: 'x' }).issues), [
      ['too short', ['code']],
    ]);
  });

  it('should validate through an unbound validate', () => {
    const { validate } = Schema.from({ name: 'string' })['~standard'];
    const value = { name: 'Marcus' };
    assert.equal(validate(value).value, value);
    assert.deepEqual(summarize(validate({}).issues), [['is required', ['name']]]);
  });

  it('should read libraryOptions as the options of check', () => {
    const schema = Schema.from({ name: 'string', age: 'number' });
    const { validate } = schema['~standard'];
    const limited = validate({}, { libraryOptions: { maxErrors: 1, messages: uk } });
    assert.deepEqual(summarize(limited.issues), [['є обовʼязковим', ['name']]]);
    assert.equal(validate({}, {}).issues.length, 2);
    assert.equal(validate({}, undefined).issues.length, 2);
    assert.equal(validate({}, null).issues.length, 2);
    const value = { name: 'Marcus', age: 1, extra: true };
    assert.equal(validate(value).issues.length, 1);
    assert.equal(validate(value, { libraryOptions: { unknown: 'ignore' } }).value, value);
    assert.throws(() => validate({}, { libraryOptions: { maxErrors: 0 } }), {
      name: 'TypeError',
      message: 'maxErrors must be an integer of at least 1, got 0',
    });
  });

  it('should define ~standard as an accessor of the prototype, invisible to enumeration', () => {
    const schema = new Schema('User', { name: 'string', check: 'number' });
    const descriptor = Object.getOwnPropertyDescriptor(Schema.prototype, '~standard');
    assert.equal(typeof descriptor.get, 'function');
    assert.equal(descriptor.enumerable, false);
    assert.equal(Object.hasOwn(schema, '~standard'), false);
    assert.equal(schema['~standard'].version, 1);
    assert.equal(Object.hasOwn(schema, '~standard'), false);
    assert.equal(Object.keys(schema).includes('~standard'), false);
    const enumerated = [];
    for (const key in schema) enumerated.push(key);
    assert.equal(enumerated.includes('~standard'), false);
    assert.equal(JSON.stringify(schema).includes('~standard'), false);
    assert.equal(util.inspect(schema).includes('~standard'), false);
    assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(schema))), ['name', 'check']);
  });

  it('should serve a consumer that knows only the specification', () => {
    const string = Schema.from('string');
    assert.equal(standardValidate(string, 'x'), 'x');
    assert.throws(() => standardValidate(string, 1), {
      message: JSON.stringify([
        {
          code: 'type',
          path: [],
          message: 'not of expected type: string',
          params: { expected: 'string', received: 'number' },
        },
      ]),
    });

    const model = new Model(types, new Map(Object.entries(entities)), database);
    const account = model.entities.get('Account');
    assert.equal(isStandardSchema(account), true);
    const record = {
      login: 'marcus',
      password: 'secret',
      blocked: false,
      company: 'c1',
      fullName: { given: 'Marcus' },
      birth: { date: '121-04-26' },
      addresses: ['a1', 'a2'],
    };
    assert.equal(standardValidate(account, record), record);
    const invalid = { ...record, company: { name: 'Acme' }, addresses: ['a1', 2] };
    assert.throws(
      () => standardValidate(account, invalid),
      (error) => {
        assert.deepEqual(summarize(JSON.parse(error.message)), [
          ['not of expected type: string', ['company']],
          ['not of expected type: string', ['addresses', 1]],
        ]);
        return true;
      },
    );
  });

  it('should rebuild the Standard Schema props when a namespace is attached, async included', async () => {
    const model = new Model({}, [
      [
        'Company',
        {
          Struct: {},
          name: { type: 'string', validate: async (value) => value !== 'bad' || 'bad' },
        },
      ],
    ]);
    const person = new Schema('Person', { Struct: {}, employer: { type: 'Company', embed: true } });
    const before = person['~standard'];
    // Unresolved: a synchronous result with a reference issue.
    const sync = before.validate({ employer: { name: 'x' } });
    assert.equal(sync instanceof Promise, false);
    assert.equal(sync.issues[0].message, 'Entity "Company" is not found');
    person.attach(model);
    const after = person['~standard'];
    assert.notEqual(after, before);
    const result = after.validate({ employer: { name: 'bad' } });
    assert.equal(result instanceof Promise, true);
    assert.deepEqual((await result).issues[0].message, 'bad');
    person.detach(model);
    assert.equal(
      person['~standard'].validate({ employer: { name: 'x' } }) instanceof Promise,
      false,
    );
  });
});
