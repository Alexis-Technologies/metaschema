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
