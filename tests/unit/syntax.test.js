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
