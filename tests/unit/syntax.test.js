const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { Schema, Model } = require('../../index.js');

describe('Syntax', () => {
  it('should decide between the long form and a nested struct by the first key', () => {
    const struct = Schema.from({ item: { name: 'string', type: 'string' } });
    assert.equal(struct.fields.item.type, 'schema');
    assert.deepEqual(Object.keys(struct.fields.item.schema), ['name', 'type']);
    assert.equal(struct.check({ item: { name: 'cpu', type: 'part' } }).valid, true);
    assert.deepEqual(struct.check({ item: 'cpu' }).errors, [
      'Field "item" not of expected type: object',
    ]);

    const long = Schema.from({ item: { type: 'string', name: 'string' } });
    assert.equal(long.fields.item.type, 'string');
    assert.equal(long.fields.item.name, 'string');
    assert.equal(long.check({ item: 'cpu' }).valid, true);

    // A struct with a first field named `type`, or after a type name, needs a
    // kind or the schema shorthand to say so.
    const kinded = Schema.from({ Struct: {}, type: { enum: ['a', 'b'] }, name: 'string' });
    assert.equal(kinded.fields.type.type, 'enum');
    const shorthand = Schema.from({ item: { schema: { type: 'string', name: 'string' } } });
    assert.deepEqual(Object.keys(shorthand.fields.item.schema), ['type', 'name']);
    assert.equal(shorthand.check({ item: { type: 'x', name: 'y' } }).valid, true);
  });

  it('should read a type name as the first key as that type, whatever follows', () => {
    const list = Schema.from({ tags: { array: 'string', count: 'number' } });
    assert.equal(list.fields.tags.type, 'array');
    assert.equal(list.fields.tags.count, 'number');
    assert.equal(list.check({ tags: ['a'] }).valid, true);
    const map = Schema.from({ map: { string: 'number' }, name: 'string' });
    assert.equal(map.kind, 'struct');
    assert.equal(map.fields.type, 'map');
  });

  it('should read bytes and flags as a first key as those types', () => {
    // Built in since 3.4: a struct that starts with such a field needs a kind.
    const shorthand = Schema.from({ flags: ['read', 'write'], name: 'string' });
    assert.equal(shorthand.fields.type, 'flags');
    assert.deepEqual(shorthand.fields.flags, ['read', 'write']);
    assert.deepEqual(shorthand.warnings, [
      'Warning [unknown-option]: option "name" of "" is not known to type "flags"',
    ]);
    assert.equal(Schema.from({ bytes: 'string', name: 'string' }).fields.type, 'bytes');
    const struct = Schema.from({ Struct: {}, bytes: 'bytes', flags: { flags: ['a'] } });
    assert.equal(struct.kind, 'struct');
    assert.equal(struct.check({ bytes: new Uint8Array(1), flags: { a: true } }).valid, true);
    const { readsAsStruct } = require('../../src/types.js');
    assert.equal(readsAsStruct({ bytes: 'bytes' }), false);
    assert.equal(readsAsStruct({ flags: 'string' }), false);
  });

  it('should throw for a definition that cannot be the long form, not guess', () => {
    assert.throws(() => Schema.from({ a: { required: false, type: 'string' } }), {
      name: 'SchemaDefinitionError',
      code: 'ERR_INVALID_DEFINITION',
      message: 'Invalid definition: "false" of type boolean in "a.required"',
    });
    assert.throws(() => Schema.from({ a: { type: 5 } }), {
      code: 'ERR_INVALID_DEFINITION',
      message: 'Invalid definition: "5" of type number in "a"',
    });
    assert.throws(() => Schema.from({ a: { type: { enum: ['x'] } } }), {
      code: 'ERR_INVALID_DEFINITION',
      message: 'Invalid definition: "[object Object]" of type object in "a"',
    });
  });

  it('should read a Schema instance as a nested struct in every form, with its validate', () => {
    const calls = [];
    const range = new Schema('Range', {
      min: 'number',
      max: 'number',
      validate: (value) => {
        calls.push(value);
        return value.min <= value.max || 'min is above max';
      },
    });
    const forms = [
      { span: range },
      { span: { schema: range } },
      { span: { type: 'schema', schema: range } },
      { 'span?': range },
      { span: { schema: range, required: false } },
      { span: { type: 'schema', schema: range, required: false } },
    ];
    for (const definition of forms) {
      const schema = Schema.from(definition);
      const field = schema.fields.span;
      assert.equal(field.type, 'schema', JSON.stringify(definition));
      assert.equal(field.schema, range.fields);
      assert.equal(field.validate, range.options.validate);
      assert.equal(schema.check({ span: { min: 1, max: 2 } }).valid, true);
      assert.deepEqual(schema.check({ span: { min: 2, max: 1 } }).errors, [
        'Field "span" min is above max',
      ]);
      assert.deepEqual(schema.check({ span: { min: 'x', max: 1 } }).errors, [
        'Field "span.min" not of expected type: number',
      ]);
    }
    assert.equal(calls.length, forms.length * 2);
    assert.throws(() => Schema.from({ span: { required: false, schema: range } }), {
      code: 'ERR_INVALID_DEFINITION',
    });
    assert.equal(Schema.extractSchema(range), range);
    assert.equal(Schema.extractSchema({ schema: range }), range);
    assert.equal(Schema.extractSchema({ schema: { min: 'number' } }), null);

    // References of the embedded schema are the references of the host.
    const model = new Model({}, [['Company', { Entity: {}, name: 'string' }]]);
    const employment = new Schema('Employment', { employer: 'Company', since: 'number' }, [model]);
    const person = new Schema('Person', { job: employment }, [model]);
    assert.ok(person.references.has('Company'));
    assert.ok(person.references.has('number'));
    assert.deepEqual([...person.relations], [...employment.relations]);
  });

  it('should copy the fields of its parent into a projection as its own', () => {
    const model = new Model({}, [
      [
        'Account',
        { Registry: {}, login: { type: 'string', unique: true }, tags: { array: 'string' } },
      ],
      ['Signin', { Projection: { schema: 'Account', fields: ['login', 'tags'] } }],
    ]);
    const account = model.entities.get('Account');
    const signin = model.entities.get('Signin');
    assert.notEqual(signin.fields.login, account.fields.login);
    assert.deepEqual(signin.fields.login.toJSON(), account.fields.login.toJSON());
    assert.equal(signin.fields.login.root, signin);
    assert.equal(signin.fields.tags.value.root, signin);
    assert.ok(signin.references.has('string'));
    assert.deepEqual(signin.check({ login: 'x', tags: ['a'] }).errors, []);
    assert.deepEqual(signin.check({ login: 1, tags: [2] }).errors, [
      'Field "Signin.login" not of expected type: string',
      'Field "Signin.tags[0]" not of expected type: string',
    ]);
  });

  it('should read an object with no key that starts with a letter as a struct', () => {
    // The first key is the first one that starts with a letter; an object
    // without one has no first key and is a struct of its keys, or of none.
    const empty = Schema.from({});
    assert.equal(empty.kind, 'struct');
    assert.deepEqual(Object.keys(empty.fields), []);
    assert.equal(empty.check({}).valid, true);
    assert.equal(empty.check({ a: 1 }).issues[0].code, 'unexpected');
    const underscored = Schema.from({ _id: 'string', 1: 'number', $set: '?boolean' });
    assert.deepEqual(Object.keys(underscored.fields).sort(), ['$set', '1', '_id']);
    assert.equal(underscored.check({ _id: 'x', 1: 2 }).valid, true);
    assert.deepEqual(underscored.check({ _id: 1 }).errors, [
      'Field "1" is required',
      'Field "_id" not of expected type: string',
    ]);
    const nested = Schema.from({ a: {}, b: { _x: 'string' } });
    assert.equal(nested.fields.a.type, 'schema');
    assert.equal(nested.fields.b.type, 'schema');
    assert.equal(nested.check({ a: {}, b: { _x: 'y' } }).valid, true);
    assert.equal(nested.check({ a: { x: 1 }, b: {} }).valid, false);
    // The first key that starts with a letter still decides, whatever comes
    // before it: a type name there is that type.
    const typed = Schema.from({ a: { _id: 'string', string: 'number' } });
    assert.equal(typed.fields.a.type, 'string');
    assert.deepEqual(Object.keys(typed.fields.a.toJSON()).includes('_id'), true);
  });

  // A kind key is a name a kind may have (a capital letter, then letters and
  // digits, one of them lowercase) holding the metadata of the kind, a plain
  // object. Until 3.4.1 every capitalized first key was a kind, so a struct
  // that began with `DATABASE_URL: 'string'` lost that field without a word.
  it('should read a capitalized first key as a kind only as a kind name holding metadata', () => {
    const inner = Schema.from({ a: 'string' });
    const fields = [
      [{ DATABASE_URL: 'string', host: 'string' }, ['DATABASE_URL', 'host']],
      [{ PORT: { type: 'number', default: 3000 }, host: 'string' }, ['PORT', 'host']],
      [{ NODE_ENV: { enum: ['dev', 'prod'] }, host: 'string' }, ['NODE_ENV', 'host']],
      [{ DTO: {}, host: 'string' }, ['DTO', 'host']],
      [{ X: {}, host: 'string' }, ['X', 'host']],
      [{ Api_key: {}, host: 'string' }, ['Api_key', 'host']],
      [{ 'Kind?': {}, host: 'string' }, ['Kind', 'host']],
      [{ Name: 'string', host: 'string' }, ['Name', 'host']],
      [{ Name: '?string', host: 'string' }, ['Name', 'host']],
      [{ Ids: ['string', 'number'], host: 'string' }, ['Ids', 'host']],
      [{ Total: () => 0, host: 'string' }, ['Total', 'host']],
      [{ Inner: inner, host: 'string' }, ['Inner', 'host']],
      [{ Built: inner.fields.a, host: 'string' }, ['Built', 'host']],
      [{ Fields: inner.fields, host: 'string' }, ['Fields', 'host']],
    ];
    for (const [definition, keys] of fields) {
      const schema = Schema.from(definition);
      const label = keys[0];
      assert.equal(schema.kind, 'struct', label);
      assert.deepEqual(schema.custom, {}, label);
      assert.deepEqual(Object.keys(schema.fields), keys, label);
      assert.deepEqual(schema.warnings, [], label);
    }
    assert.equal(Schema.from({ Ids: ['string', 'number'] }).fields.Ids.type, 'tuple');
    assert.equal(Schema.from({ Inner: inner }).check({ Inner: { a: 'x' } }).valid, true);
    assert.equal(Schema.from({ Built: inner.fields.a }).fields.Built.type, 'string');
    // What is no definition is an error where it stands, not kind metadata.
    assert.throws(() => new Schema('Env', { Nothing: null, host: 'string' }), {
      name: 'SchemaDefinitionError',
      code: 'ERR_INVALID_DEFINITION',
      field: 'Nothing',
    });

    const kinds = [
      [{ Struct: {}, PORT: 'number' }, 'struct', ['PORT']],
      [{ Struct: Object.create(null), PORT: 'number' }, 'struct', ['PORT']],
      [{ Form: { unknown: 'ignore' }, Name: 'string' }, 'form', ['Name']],
      [{ Settings: { theme: 'dark' }, mode: 'string' }, 'settings', ['mode']],
      [{ Http2Server: {}, port: 'number' }, 'http2Server', ['port']],
      [{ _id: 'string', Custom: {}, type: 'string' }, 'custom', ['_id', 'type']],
    ];
    for (const [definition, kind, keys] of kinds) {
      const schema = Schema.from(definition);
      assert.equal(schema.kind, kind, kind);
      assert.deepEqual(Object.keys(schema.fields), keys, kind);
    }
    assert.deepEqual(Schema.from(kinds[3][0]).custom, { theme: 'dark' });
    // The metadata of another realm is metadata: its prototype is an
    // Object.prototype, whichever.
    const vm = require('node:vm');
    const foreign = Schema.from({
      Form: vm.runInNewContext('({ unknown: "ignore" })'),
      a: 'string',
    });
    assert.equal(foreign.kind, 'form');
    assert.equal(foreign.unknown, 'ignore');
    // Only the first key is asked: after a kind a capitalized key is a field,
    // whatever it holds.
    const after = Schema.from({ Struct: {}, Address: { street: 'string' }, Settings: {} });
    assert.deepEqual(Object.keys(after.fields), ['Address', 'Settings']);
    assert.equal(after.check({ Address: { street: 'x' }, Settings: {} }).valid, true);
  });

  it('should keep every field of a struct of upper-case keys, at any depth', () => {
    const env = new Schema('Env', {
      DATABASE_URL: 'string',
      PORT: { type: 'number', default: 3000 },
      NODE_ENV: { enum: ['development', 'production'] },
      'DEBUG?': 'boolean',
    });
    assert.equal(env.kind, 'struct');
    assert.deepEqual(Object.keys(env.fields), ['DATABASE_URL', 'PORT', 'NODE_ENV', 'DEBUG']);
    const value = { DATABASE_URL: 'postgres://db', PORT: 8080, NODE_ENV: 'production' };
    assert.equal(env.check(value).valid, true);
    assert.deepEqual(env.check({ PORT: 8080, NODE_ENV: 'production' }).errors, [
      'Field "Env.DATABASE_URL" is required',
    ]);
    assert.deepEqual(env.check({ ...value, DATABASE_URL: 1 }).errors, [
      'Field "Env.DATABASE_URL" not of expected type: string',
    ]);
    const filled = env.parse({ DATABASE_URL: 'postgres://db', NODE_ENV: 'development' });
    assert.deepEqual(filled.value, {
      DATABASE_URL: 'postgres://db',
      NODE_ENV: 'development',
      PORT: 3000,
    });
    // The environment of a process: strings, and keys the schema does not have.
    require('../../src/coerce/index.js').register();
    const source = {
      DATABASE_URL: 'postgres://db',
      PORT: '8080',
      NODE_ENV: 'production',
      HOME: '/',
    };
    const parsed = env.parse(source, { coerce: true, unknown: 'strip' });
    assert.deepEqual(parsed.value, {
      DATABASE_URL: 'postgres://db',
      PORT: 8080,
      NODE_ENV: 'production',
    });

    const nested = new Schema('App', {
      name: 'string',
      config: { DATABASE_URL: 'string', PORT: 'number' },
      services: { array: { ID: 'string', name: 'string' } },
      pair: [{ LEFT: 'string', RIGHT: 'string' }, 'number'],
      either: { union: [{ A: 'string', B: 'number' }, 'boolean'] },
    });
    assert.deepEqual(Object.keys(nested.fields.config.schema), ['DATABASE_URL', 'PORT']);
    assert.deepEqual(Object.keys(nested.fields.services.value.schema), ['ID', 'name']);
    assert.deepEqual(Object.keys(nested.fields.pair.value[0].schema), ['LEFT', 'RIGHT']);
    assert.deepEqual(Object.keys(nested.fields.either.union[0].schema), ['A', 'B']);
    const app = {
      name: 'api',
      config: { DATABASE_URL: 'x', PORT: 1 },
      services: [{ ID: 'a', name: 'b' }],
      pair: [{ LEFT: 'l', RIGHT: 'r' }, 1],
      either: { A: 'a', B: 1 },
    };
    assert.equal(nested.check(app).valid, true);
    assert.deepEqual(nested.check({ ...app, config: { PORT: 1 } }).errors, [
      'Field "App.config.DATABASE_URL" is required',
    ]);

    const model = new Model({}, [
      ['Env', { DATABASE_URL: 'string', PORT: 'number' }],
      ['Stored', { Entity: {}, API_KEY: 'string' }],
    ]);
    const entity = model.entities.get('Env');
    assert.equal(entity.kind, 'struct');
    assert.deepEqual(Object.keys(entity.fields), ['DATABASE_URL', 'PORT']);
    assert.deepEqual(Object.keys(model.entities.get('Stored').fields), ['API_KEY', 'storedId']);
    const written = model.toJSON().entities.Env;
    assert.equal(written.kind, 'struct');
    assert.deepEqual(written.custom, {});
    assert.deepEqual(Object.keys(written.fields), ['DATABASE_URL', 'PORT']);
    assert.deepEqual(model.warnings, []);
  });
});
