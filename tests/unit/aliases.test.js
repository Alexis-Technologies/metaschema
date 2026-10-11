const { test } = require('node:test');
const assert = require('node:assert');

const { Schema, Model } = require('../../index.js');
const { toJSONSchema, toTypeScript } = require('../../src/generators/index.js');

const user = new Schema('User', {
  name: { type: 'string', aliases: ['title', 'label'] },
  'age?': { type: 'number', aliases: ['years'] },
  toString: { type: 'string', aliases: ['str'] },
  'addr?': { schema: { city: 'string' }, aliases: ['address'] },
});

test('Aliases: check reads a field from its alias and reports under that key', () => {
  assert.strictEqual(
    user.check({ title: 'x', years: 2, str: 's', address: { city: 'c' } }).valid,
    true,
  );
  assert.strictEqual(user.check({ label: 'x', str: 's' }).valid, true);
  assert.deepStrictEqual(
    user.check({ title: 1, years: 'y', str: 1, address: { city: 3 } }).errors,
    [
      'Field "User.title" not of expected type: string',
      'Field "User.years" not of expected type: number',
      'Field "User.str" not of expected type: string',
      'Field "User.address.city" not of expected type: string',
    ],
  );
  assert.deepStrictEqual(user.check({ title: 1 }).issues[0].path, ['title']);
  // Neither the key nor an alias: required under the field's own key.
  assert.deepStrictEqual(user.check({}).errors, [
    'Field "User.name" is required',
    'Field "User.toString" is required',
  ]);
  // The field's own key wins over an alias, and an alias is never unexpected.
  assert.strictEqual(user.check({ name: 'n', title: 1, label: 2, str: 's' }).valid, true);
  assert.deepStrictEqual(user.check({ name: 'n', str: 's', extra: 1 }).errors, [
    'Field "User" has unexpected keys: extra',
  ]);
  // The first alias the value carries is read, as the list orders them.
  assert.deepStrictEqual(user.check({ title: 1, label: 'x', str: 's' }).errors, [
    'Field "User.title" not of expected type: string',
  ]);
  assert.deepStrictEqual(user.check({ label: 1, str: 's' }).errors, [
    'Field "User.label" not of expected type: string',
  ]);
});

test('Aliases: an alias set to undefined, inherited keys and prototype members', () => {
  // Own and undefined is a type error for a required field, nothing for an
  // optional one, under the key the value carries.
  assert.deepStrictEqual(user.check({ title: undefined, str: 's', years: undefined }).errors, [
    'Field "User.title" not of expected type: string',
  ]);
  assert.deepStrictEqual(user.check({ name: undefined, title: 'x', str: 's' }).errors, []);
  // An inherited key is neither the field nor its alias.
  const inherited = Object.assign(Object.create({ title: 'x', str: 'y' }), { label: 'l' });
  assert.deepStrictEqual(user.check(inherited).errors, ['Field "User.toString" is required']);
  // A field named after a member of Object.prototype reads its alias too.
  assert.deepStrictEqual(user.check({ name: 'n', str: 1 }).errors, [
    'Field "User.str" not of expected type: string',
  ]);
  assert.deepStrictEqual(user.check({ name: 'n', toString: 't', str: 1 }).errors, []);
});

test('Aliases: parse renames to the field key and fills no default over an alias', () => {
  const schema = Schema.from({
    name: { type: 'string', aliases: ['title'] },
    'age?': { type: 'number', aliases: ['years'], default: 1 },
    addr: {
      schema: { city: 'string', 'zip?': { type: 'string', default: '0' } },
      aliases: ['address'],
    },
    'when?': { type: 'string', aliases: ['at'], parse: (text) => new Date(text).getTime() },
  });
  const input = { title: 'x', address: { city: 'c' }, at: '1970-01-01T00:00:01.000Z' };
  const parsed = schema.parse(input);
  assert.strictEqual(parsed.valid, true);
  assert.deepStrictEqual(parsed.value, {
    age: 1,
    name: 'x',
    addr: { city: 'c', zip: '0' },
    when: 1000,
  });
  // The value given is never written to.
  assert.deepStrictEqual(input, {
    title: 'x',
    address: { city: 'c' },
    at: '1970-01-01T00:00:01.000Z',
  });
  assert.deepStrictEqual(schema.parse({ title: 'x', years: 5, address: { city: 'c' } }).value, {
    name: 'x',
    age: 5,
    addr: { city: 'c', zip: '0' },
  });
  // Under strip the output has the field keys only; the field's own key wins
  // over an alias, which then stays where it was unless stripped.
  const both = { title: 'x', name: 'n', address: { city: 'c' }, extra: 1 };
  assert.deepStrictEqual(schema.parse(both, { unknown: 'strip' }).value, {
    name: 'n',
    age: 1,
    addr: { city: 'c', zip: '0' },
  });
  assert.deepStrictEqual(schema.parse(both, { unknown: 'ignore' }).value, {
    title: 'x',
    name: 'n',
    extra: 1,
    age: 1,
    addr: { city: 'c', zip: '0' },
  });
  // The issues of parse name the keys of the value given.
  assert.deepStrictEqual(
    schema.parse({ title: 1, address: { city: 1 } }).issues.map((i) => i.path),
    [['title'], ['address', 'city']],
  );
  // parseAsync and the Standard Schema validate rename as well.
  const standard = schema['~standard'].validate({ title: 'x', address: { city: 'c' } });
  assert.deepStrictEqual(standard.value, { age: 1, name: 'x', addr: { city: 'c', zip: '0' } });
});

test('Aliases: parseAsync, a nested struct, a collection element and serialize', async () => {
  const schema = Schema.from({
    items: { array: { schema: { id: { type: 'string', aliases: ['key'] } } } },
    'note?': {
      type: 'string',
      aliases: ['comment'],
      validate: async (text) => text !== 'bad' || 'is bad',
    },
  });
  const settled = await schema.parseAsync({ items: [{ key: 'a' }, { id: 'b' }], comment: 'ok' });
  assert.deepStrictEqual(settled.value, { items: [{ id: 'a' }, { id: 'b' }], note: 'ok' });
  const failed = await schema.checkAsync({ items: [{ key: 1 }], comment: 'bad' });
  assert.deepStrictEqual(failed.errors, [
    'Field "items[0].key" not of expected type: string',
    'Field "comment" is bad',
  ]);
  // serialize reads the value of the program, which carries the field keys:
  // an alias is a key of the input, and serialize leaves the value as it is.
  const program = { items: [{ key: 'a' }] };
  assert.strictEqual(schema.serialize(program).value, program);
});

test('Aliases: a broken aliases option is a definition error', () => {
  const needs = 'Option "aliases" needs a list of key names';
  for (const aliases of ['old', [], [1], [''], {}, null]) {
    assert.throws(() => Schema.from({ a: { type: 'string', aliases } }), {
      name: 'SchemaDefinitionError',
      code: 'ERR_INVALID_DEFINITION',
      message: `${needs} in "a"`,
    });
  }
  // An alias is a key of the struct: it cannot be a field, a calculated field
  // or another alias, and the order of the definition does not matter.
  for (const [defs, key, field] of [
    [{ a: { type: 'string', aliases: ['b'] }, b: 'string' }, 'b', 'b'],
    [{ b: 'string', a: { type: 'string', aliases: ['b'] } }, 'b', 'a'],
    [{ a: { type: 'string', aliases: ['a'] } }, 'a', 'a'],
    [{ a: { type: 'string', aliases: ['x', 'x'] } }, 'x', 'a'],
    [{ a: { type: 'string', aliases: ['x'] }, b: { type: 'string', aliases: ['x'] } }, 'x', 'b'],
    [{ a: { type: 'string', aliases: ['half'] }, half: (value) => value.a }, 'half', 'half'],
    [{ half: (value) => value.a, a: { type: 'string', aliases: ['half'] } }, 'half', 'a'],
  ]) {
    assert.throws(() => new Schema('S', defs), {
      code: 'ERR_INVALID_DEFINITION',
      message: `Key "${key}" is a field or an alias already in "S.${field}"`,
    });
  }
  // Nested: the keys of the nested struct, not of the parent.
  assert.strictEqual(
    Schema.from({ a: { type: 'string', aliases: ['x'] }, inner: { x: 'string' } }).check({
      a: 'a',
      inner: { x: 'x' },
    }).valid,
    true,
  );
});

test('Aliases: known to the lint, ignored by the generators and the snapshot writes them', () => {
  assert.deepStrictEqual(user.warnings, []);
  assert.deepStrictEqual(
    Schema.from({ a: { type: 'string', aliases: ['b'], deprecated: true } }).warnings,
    [],
  );
  const json = toJSONSchema(user);
  assert.deepStrictEqual(Object.keys(json.properties), ['name', 'age', 'toString', 'addr']);
  assert.strictEqual(JSON.stringify(json).includes('title'), false);
  assert.strictEqual(toTypeScript(user).includes('title'), false);
  const model = new Model({}, [['User', user]]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(model)).entities.User.fields.name, {
    type: 'string',
    required: true,
    aliases: ['title', 'label'],
  });
});

test('Aliases: a struct carries its aliases in its plan and known keys', () => {
  const { STRUCT } = require('../../src/struct.js');
  const { plan, known } = user.fields[STRUCT];
  assert.deepStrictEqual(
    plan.map((entry) => entry.aliases),
    [['title', 'label'], ['years'], ['str'], ['address']],
  );
  assert.deepStrictEqual(Object.keys(known), [
    'name',
    'title',
    'label',
    'age',
    'years',
    'toString',
    'str',
    'addr',
    'address',
  ]);
  assert.deepStrictEqual(Schema.from({ a: 'string' }).fields[STRUCT].plan[0].aliases, []);
});
