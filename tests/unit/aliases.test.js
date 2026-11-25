const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { Schema, Model } = require('../../index.js');
const { toJSONSchema, toTypeScript } = require('../../src/generators/index.js');
const { compile, canEval } = require('../../src/compile/index.js');

// The same definition on the closures and on the JIT.
const backends = (definition) => {
  const closures = Schema.from(definition);
  const jit = Schema.from(definition);
  compile(jit, { jit: canEval() ? true : 'auto' });
  return [closures, jit];
};

const user = new Schema('User', {
  name: { type: 'string', aliases: ['title', 'label'] },
  'age?': { type: 'number', aliases: ['years'] },
  toString: { type: 'string', aliases: ['str'] },
  'addr?': { schema: { city: 'string' }, aliases: ['address'] },
});

describe('Aliases', () => {
  it('should read a field from its alias in check and report under that key', () => {
    assert.equal(
      user.check({ title: 'x', years: 2, str: 's', address: { city: 'c' } }).valid,
      true,
    );
    assert.equal(user.check({ label: 'x', str: 's' }).valid, true);
    assert.deepEqual(user.check({ title: 1, years: 'y', str: 1, address: { city: 3 } }).errors, [
      'Field "User.title" not of expected type: string',
      'Field "User.years" not of expected type: number',
      'Field "User.str" not of expected type: string',
      'Field "User.address.city" not of expected type: string',
    ]);
    assert.deepEqual(user.check({ title: 1 }).issues[0].path, ['title']);
    // Neither the key nor an alias: required under the field's own key.
    assert.deepEqual(user.check({}).errors, [
      'Field "User.name" is required',
      'Field "User.toString" is required',
    ]);
    // The field's own key wins over an alias, and an alias is never unexpected.
    assert.equal(user.check({ name: 'n', title: 1, label: 2, str: 's' }).valid, true);
    assert.deepEqual(user.check({ name: 'n', str: 's', extra: 1 }).errors, [
      'Field "User" has unexpected keys: extra',
    ]);
    // The first alias the value carries is read, as the list orders them.
    assert.deepEqual(user.check({ title: 1, label: 'x', str: 's' }).errors, [
      'Field "User.title" not of expected type: string',
    ]);
    assert.deepEqual(user.check({ label: 1, str: 's' }).errors, [
      'Field "User.label" not of expected type: string',
    ]);
  });

  it('should check an alias set to undefined, inherited keys and prototype members', () => {
    // Own and undefined is a type error for a required field, nothing for an
    // optional one, under the key the value carries.
    assert.deepEqual(user.check({ title: undefined, str: 's', years: undefined }).errors, [
      'Field "User.title" not of expected type: string',
    ]);
    assert.deepEqual(user.check({ name: undefined, title: 'x', str: 's' }).errors, []);
    // An inherited key is neither the field nor its alias.
    const inherited = Object.assign(Object.create({ title: 'x', str: 'y' }), { label: 'l' });
    assert.deepEqual(user.check(inherited).errors, ['Field "User.toString" is required']);
    // A field named after a member of Object.prototype reads its alias too.
    assert.deepEqual(user.check({ name: 'n', str: 1 }).errors, [
      'Field "User.str" not of expected type: string',
    ]);
    assert.deepEqual(user.check({ name: 'n', toString: 't', str: 1 }).errors, []);
  });

  it('should rename to the field key in parse and fill no default over an alias', () => {
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
    assert.equal(parsed.valid, true);
    assert.deepEqual(parsed.value, {
      age: 1,
      name: 'x',
      addr: { city: 'c', zip: '0' },
      when: 1000,
    });
    // The value given is never written to.
    assert.deepEqual(input, {
      title: 'x',
      address: { city: 'c' },
      at: '1970-01-01T00:00:01.000Z',
    });
    assert.deepEqual(schema.parse({ title: 'x', years: 5, address: { city: 'c' } }).value, {
      name: 'x',
      age: 5,
      addr: { city: 'c', zip: '0' },
    });
    // Under strip the output has the field keys only; the field's own key wins
    // over an alias, which then stays where it was unless stripped.
    const both = { title: 'x', name: 'n', address: { city: 'c' }, extra: 1 };
    assert.deepEqual(schema.parse(both, { unknown: 'strip' }).value, {
      name: 'n',
      age: 1,
      addr: { city: 'c', zip: '0' },
    });
    assert.deepEqual(schema.parse(both, { unknown: 'ignore' }).value, {
      title: 'x',
      name: 'n',
      extra: 1,
      age: 1,
      addr: { city: 'c', zip: '0' },
    });
    // The issues of parse name the keys of the value given.
    assert.deepEqual(
      schema.parse({ title: 1, address: { city: 1 } }).issues.map((i) => i.path),
      [['title'], ['address', 'city']],
    );
    // parseAsync and the Standard Schema validate rename as well.
    const standard = schema['~standard'].validate({ title: 'x', address: { city: 'c' } });
    assert.deepEqual(standard.value, { age: 1, name: 'x', addr: { city: 'c', zip: '0' } });
  });

  it('should read aliases in parseAsync, a nested struct, a collection element and serialize', async () => {
    const schema = Schema.from({
      items: { array: { schema: { id: { type: 'string', aliases: ['key'] } } } },
      'note?': {
        type: 'string',
        aliases: ['comment'],
        validate: async (text) => text !== 'bad' || 'is bad',
      },
    });
    const settled = await schema.parseAsync({ items: [{ key: 'a' }, { id: 'b' }], comment: 'ok' });
    assert.deepEqual(settled.value, { items: [{ id: 'a' }, { id: 'b' }], note: 'ok' });
    const failed = await schema.checkAsync({ items: [{ key: 1 }], comment: 'bad' });
    assert.deepEqual(failed.errors, [
      'Field "items[0].key" not of expected type: string',
      'Field "comment" is bad',
    ]);
    // serialize reads the value of the program, which carries the field keys:
    // an alias is a key of the input, and serialize leaves the value as it is.
    const program = { items: [{ key: 'a' }] };
    assert.equal(schema.serialize(program).value, program);
  });

  it('should return the value itself from parse when no alias was used, and never rename in serialize', () => {
    const definition = {
      name: { type: 'string', aliases: ['title'] },
      n: 'number',
      items: { array: { schema: { id: { type: 'string', aliases: ['key'] } } } },
      'when?': { type: 'string', aliases: ['at'], parse: Number, serialize: String },
    };
    for (const schema of backends(definition)) {
      // Nothing applied: the same reference, as for a schema without aliases,
      // whatever the fields of the value carry under their own keys.
      const plain = { name: 'x', n: 1, items: [{ id: 'a' }, { id: 'b' }] };
      assert.equal(schema.parse(plain).value, plain);
      assert.equal(schema.parse(plain, { unknown: 'ignore' }).value, plain);
      // A renamed field takes the place of its alias; the copy is a new object
      // with the keys in that order, at every depth.
      const parsed = schema.parse({ title: 'x', n: 1, items: [{ key: 'a' }, { id: 'b' }] }).value;
      assert.deepEqual(Object.keys(parsed), ['name', 'n', 'items']);
      assert.deepEqual(parsed, { name: 'x', n: 1, items: [{ id: 'a' }, { id: 'b' }] });
      assert.deepEqual(Object.keys(parsed.items[0]), ['id']);
      assert.deepEqual(Object.keys(schema.parse({ n: 1, title: 'x', items: [] }).value), [
        'n',
        'name',
        'items',
      ]);
      // A decoder under an alias, with the key in place.
      assert.deepEqual(schema.parse({ at: '7', name: 'x', n: 1, items: [] }).value, {
        when: 7,
        name: 'x',
        n: 1,
        items: [],
      });
      // serialize reads the value of the program, which carries the field
      // keys: an alias there is left as it is, with or without a serializer
      // beside it, and the check of the result reads it as any check does.
      const program = { title: 'x', n: 1, items: [{ key: 'a' }], when: 2 };
      const expected = { title: 'x', n: 1, items: [{ key: 'a' }], when: '2' };
      assert.deepEqual(schema.serialize(program).value, expected);
      const checked = schema.serialize(program, { check: true });
      assert.equal(checked.valid, true);
      assert.deepEqual(checked.value, expected);
      const untouched = { title: 'x', n: 1, items: [{ key: 'a' }] };
      assert.equal(schema.serialize(untouched).value, untouched);
    }
  });

  it('should throw a definition error for a broken aliases option', () => {
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
    assert.equal(
      Schema.from({ a: { type: 'string', aliases: ['x'] }, inner: { x: 'string' } }).check({
        a: 'a',
        inner: { x: 'x' },
      }).valid,
      true,
    );
  });

  it('should be known to the lint, ignored by the generators and written by the snapshot', () => {
    assert.deepEqual(user.warnings, []);
    assert.deepEqual(
      Schema.from({ a: { type: 'string', aliases: ['b'], deprecated: true } }).warnings,
      [],
    );
    const json = toJSONSchema(user);
    assert.deepEqual(Object.keys(json.properties), ['name', 'age', 'toString', 'addr']);
    assert.equal(JSON.stringify(json).includes('title'), false);
    assert.equal(toTypeScript(user).includes('title'), false);
    const model = new Model({}, [['User', user]]);
    assert.deepEqual(JSON.parse(JSON.stringify(model)).entities.User.fields.name, {
      type: 'string',
      required: true,
      aliases: ['title', 'label'],
    });
  });

  it('should carry the aliases of a struct in its plan and known keys', () => {
    const { STRUCT } = require('../../src/struct.js');
    const { plan, known } = user.fields[STRUCT];
    assert.deepEqual(
      plan.map((entry) => entry.aliases),
      [['title', 'label'], ['years'], ['str'], ['address']],
    );
    assert.deepEqual(Object.keys(known), [
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
    assert.deepEqual(Schema.from({ a: 'string' }).fields[STRUCT].plan[0].aliases, []);
  });
});
