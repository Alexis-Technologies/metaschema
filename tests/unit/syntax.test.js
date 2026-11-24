const { test } = require('node:test');
const assert = require('node:assert');

const { Schema, Model } = require('../../index.js');

test('Syntax: the first key decides between the long form and a nested struct', () => {
  const struct = Schema.from({ item: { name: 'string', type: 'string' } });
  assert.strictEqual(struct.fields.item.type, 'schema');
  assert.deepStrictEqual(Object.keys(struct.fields.item.schema), ['name', 'type']);
  assert.strictEqual(struct.check({ item: { name: 'cpu', type: 'part' } }).valid, true);
  assert.deepStrictEqual(struct.check({ item: 'cpu' }).errors, [
    'Field "item" not of expected type: object',
  ]);

  const long = Schema.from({ item: { type: 'string', name: 'string' } });
  assert.strictEqual(long.fields.item.type, 'string');
  assert.strictEqual(long.fields.item.name, 'string');
  assert.strictEqual(long.check({ item: 'cpu' }).valid, true);

  // A struct with a first field named `type`, or after a type name, needs a
  // kind or the schema shorthand to say so.
  const kinded = Schema.from({ Struct: {}, type: { enum: ['a', 'b'] }, name: 'string' });
  assert.strictEqual(kinded.fields.type.type, 'enum');
  const shorthand = Schema.from({ item: { schema: { type: 'string', name: 'string' } } });
  assert.deepStrictEqual(Object.keys(shorthand.fields.item.schema), ['type', 'name']);
  assert.strictEqual(shorthand.check({ item: { type: 'x', name: 'y' } }).valid, true);
});

test('Syntax: a type name as the first key is that type, whatever follows', () => {
  const list = Schema.from({ tags: { array: 'string', count: 'number' } });
  assert.strictEqual(list.fields.tags.type, 'array');
  assert.strictEqual(list.fields.tags.count, 'number');
  assert.strictEqual(list.check({ tags: ['a'] }).valid, true);
  const map = Schema.from({ map: { string: 'number' }, name: 'string' });
  assert.strictEqual(map.kind, 'struct');
  assert.strictEqual(map.fields.type, 'map');
});

test('Syntax: bytes and flags as a first key are those types', () => {
  // Built in since 3.4: a struct that starts with such a field needs a kind.
  const shorthand = Schema.from({ flags: ['read', 'write'], name: 'string' });
  assert.strictEqual(shorthand.fields.type, 'flags');
  assert.deepStrictEqual(shorthand.fields.flags, ['read', 'write']);
  assert.deepStrictEqual(shorthand.warnings, [
    'Warning [unknown-option]: option "name" of "" is not known to type "flags"',
  ]);
  assert.strictEqual(Schema.from({ bytes: 'string', name: 'string' }).fields.type, 'bytes');
  const struct = Schema.from({ Struct: {}, bytes: 'bytes', flags: { flags: ['a'] } });
  assert.strictEqual(struct.kind, 'struct');
  assert.strictEqual(struct.check({ bytes: new Uint8Array(1), flags: { a: true } }).valid, true);
  const { readsAsStruct } = require('../../src/types.js');
  assert.strictEqual(readsAsStruct({ bytes: 'bytes' }), false);
  assert.strictEqual(readsAsStruct({ flags: 'string' }), false);
});

test('Syntax: a definition that cannot be the long form is an error, not a guess', () => {
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

test('Syntax: a Schema instance is a nested struct in every form, with its validate', () => {
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
    assert.strictEqual(field.type, 'schema', JSON.stringify(definition));
    assert.strictEqual(field.schema, range.fields);
    assert.strictEqual(field.validate, range.options.validate);
    assert.strictEqual(schema.check({ span: { min: 1, max: 2 } }).valid, true);
    assert.deepStrictEqual(schema.check({ span: { min: 2, max: 1 } }).errors, [
      'Field "span" min is above max',
    ]);
    assert.deepStrictEqual(schema.check({ span: { min: 'x', max: 1 } }).errors, [
      'Field "span.min" not of expected type: number',
    ]);
  }
  assert.strictEqual(calls.length, forms.length * 2);
  assert.throws(() => Schema.from({ span: { required: false, schema: range } }), {
    code: 'ERR_INVALID_DEFINITION',
  });
  assert.strictEqual(Schema.extractSchema(range), range);
  assert.strictEqual(Schema.extractSchema({ schema: range }), range);
  assert.strictEqual(Schema.extractSchema({ schema: { min: 'number' } }), null);

  // References of the embedded schema are the references of the host.
  const model = new Model({}, [['Company', { Entity: {}, name: 'string' }]]);
  const employment = new Schema('Employment', { employer: 'Company', since: 'number' }, [model]);
  const person = new Schema('Person', { job: employment }, [model]);
  assert.ok(person.references.has('Company'));
  assert.ok(person.references.has('number'));
  assert.deepStrictEqual([...person.relations], [...employment.relations]);
});

test('Syntax: a projection copies the fields of its parent as its own', () => {
  const model = new Model({}, [
    [
      'Account',
      { Registry: {}, login: { type: 'string', unique: true }, tags: { array: 'string' } },
    ],
    ['Signin', { Projection: { schema: 'Account', fields: ['login', 'tags'] } }],
  ]);
  const account = model.entities.get('Account');
  const signin = model.entities.get('Signin');
  assert.notStrictEqual(signin.fields.login, account.fields.login);
  assert.deepStrictEqual(signin.fields.login.toJSON(), account.fields.login.toJSON());
  assert.strictEqual(signin.fields.login.root, signin);
  assert.strictEqual(signin.fields.tags.value.root, signin);
  assert.ok(signin.references.has('string'));
  assert.deepStrictEqual(signin.check({ login: 'x', tags: ['a'] }).errors, []);
  assert.deepStrictEqual(signin.check({ login: 1, tags: [2] }).errors, [
    'Field "Signin.login" not of expected type: string',
    'Field "Signin.tags[0]" not of expected type: string',
  ]);
});

test('Syntax: an object with no key that starts with a letter is a struct', () => {
  // The first key is the first one that starts with a letter; an object
  // without one has no first key and is a struct of its keys, or of none.
  const empty = Schema.from({});
  assert.strictEqual(empty.kind, 'struct');
  assert.deepStrictEqual(Object.keys(empty.fields), []);
  assert.strictEqual(empty.check({}).valid, true);
  assert.strictEqual(empty.check({ a: 1 }).issues[0].code, 'unexpected');
  const underscored = Schema.from({ _id: 'string', 1: 'number', $set: '?boolean' });
  assert.deepStrictEqual(Object.keys(underscored.fields).sort(), ['$set', '1', '_id']);
  assert.strictEqual(underscored.check({ _id: 'x', 1: 2 }).valid, true);
  assert.deepStrictEqual(underscored.check({ _id: 1 }).errors, [
    'Field "1" is required',
    'Field "_id" not of expected type: string',
  ]);
  const nested = Schema.from({ a: {}, b: { _x: 'string' } });
  assert.strictEqual(nested.fields.a.type, 'schema');
  assert.strictEqual(nested.fields.b.type, 'schema');
  assert.strictEqual(nested.check({ a: {}, b: { _x: 'y' } }).valid, true);
  assert.strictEqual(nested.check({ a: { x: 1 }, b: {} }).valid, false);
  // The first key that starts with a letter still decides, whatever comes
  // before it: a type name there is that type.
  const typed = Schema.from({ a: { _id: 'string', string: 'number' } });
  assert.strictEqual(typed.fields.a.type, 'string');
  assert.deepStrictEqual(Object.keys(typed.fields.a.toJSON()).includes('_id'), true);
});

// A kind key is a name a kind may have (a capital letter, then letters and
// digits, one of them lowercase) holding the metadata of the kind, a plain
// object. Until 3.4.1 every capitalized first key was a kind, so a struct
// that began with `DATABASE_URL: 'string'` lost that field without a word.
test('Syntax: a capitalized first key is a kind only as a kind name holding metadata', () => {
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
    assert.strictEqual(schema.kind, 'struct', label);
    assert.deepStrictEqual(schema.custom, {}, label);
    assert.deepStrictEqual(Object.keys(schema.fields), keys, label);
    assert.deepStrictEqual(schema.warnings, [], label);
  }
  assert.strictEqual(Schema.from({ Ids: ['string', 'number'] }).fields.Ids.type, 'tuple');
  assert.strictEqual(Schema.from({ Inner: inner }).check({ Inner: { a: 'x' } }).valid, true);
  assert.strictEqual(Schema.from({ Built: inner.fields.a }).fields.Built.type, 'string');
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
    assert.strictEqual(schema.kind, kind, kind);
    assert.deepStrictEqual(Object.keys(schema.fields), keys, kind);
  }
  assert.deepStrictEqual(Schema.from(kinds[3][0]).custom, { theme: 'dark' });
  // The metadata of another realm is metadata: its prototype is an
  // Object.prototype, whichever.
  const vm = require('node:vm');
  const foreign = Schema.from({ Form: vm.runInNewContext('({ unknown: "ignore" })'), a: 'string' });
  assert.strictEqual(foreign.kind, 'form');
  assert.strictEqual(foreign.unknown, 'ignore');
  // Only the first key is asked: after a kind a capitalized key is a field,
  // whatever it holds.
  const after = Schema.from({ Struct: {}, Address: { street: 'string' }, Settings: {} });
  assert.deepStrictEqual(Object.keys(after.fields), ['Address', 'Settings']);
  assert.strictEqual(after.check({ Address: { street: 'x' }, Settings: {} }).valid, true);
});

test('Syntax: a struct of upper-case keys keeps every field, at any depth', () => {
  const env = new Schema('Env', {
    DATABASE_URL: 'string',
    PORT: { type: 'number', default: 3000 },
    NODE_ENV: { enum: ['development', 'production'] },
    'DEBUG?': 'boolean',
  });
  assert.strictEqual(env.kind, 'struct');
  assert.deepStrictEqual(Object.keys(env.fields), ['DATABASE_URL', 'PORT', 'NODE_ENV', 'DEBUG']);
  const value = { DATABASE_URL: 'postgres://db', PORT: 8080, NODE_ENV: 'production' };
  assert.strictEqual(env.check(value).valid, true);
  assert.deepStrictEqual(env.check({ PORT: 8080, NODE_ENV: 'production' }).errors, [
    'Field "Env.DATABASE_URL" is required',
  ]);
  assert.deepStrictEqual(env.check({ ...value, DATABASE_URL: 1 }).errors, [
    'Field "Env.DATABASE_URL" not of expected type: string',
  ]);
  const filled = env.parse({ DATABASE_URL: 'postgres://db', NODE_ENV: 'development' });
  assert.deepStrictEqual(filled.value, {
    DATABASE_URL: 'postgres://db',
    NODE_ENV: 'development',
    PORT: 3000,
  });
  // The environment of a process: strings, and keys the schema does not have.
  require('../../src/coerce/index.js').register();
  const source = { DATABASE_URL: 'postgres://db', PORT: '8080', NODE_ENV: 'production', HOME: '/' };
  const parsed = env.parse(source, { coerce: true, unknown: 'strip' });
  assert.deepStrictEqual(parsed.value, {
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
  assert.deepStrictEqual(Object.keys(nested.fields.config.schema), ['DATABASE_URL', 'PORT']);
  assert.deepStrictEqual(Object.keys(nested.fields.services.value.schema), ['ID', 'name']);
  assert.deepStrictEqual(Object.keys(nested.fields.pair.value[0].schema), ['LEFT', 'RIGHT']);
  assert.deepStrictEqual(Object.keys(nested.fields.either.union[0].schema), ['A', 'B']);
  const app = {
    name: 'api',
    config: { DATABASE_URL: 'x', PORT: 1 },
    services: [{ ID: 'a', name: 'b' }],
    pair: [{ LEFT: 'l', RIGHT: 'r' }, 1],
    either: { A: 'a', B: 1 },
  };
  assert.strictEqual(nested.check(app).valid, true);
  assert.deepStrictEqual(nested.check({ ...app, config: { PORT: 1 } }).errors, [
    'Field "App.config.DATABASE_URL" is required',
  ]);

  const model = new Model({}, [
    ['Env', { DATABASE_URL: 'string', PORT: 'number' }],
    ['Stored', { Entity: {}, API_KEY: 'string' }],
  ]);
  const entity = model.entities.get('Env');
  assert.strictEqual(entity.kind, 'struct');
  assert.deepStrictEqual(Object.keys(entity.fields), ['DATABASE_URL', 'PORT']);
  assert.deepStrictEqual(Object.keys(model.entities.get('Stored').fields), ['API_KEY', 'storedId']);
  const written = model.toJSON().entities.Env;
  assert.strictEqual(written.kind, 'struct');
  assert.deepStrictEqual(written.custom, {});
  assert.deepStrictEqual(Object.keys(written.fields), ['DATABASE_URL', 'PORT']);
  assert.deepStrictEqual(model.warnings, []);
});
