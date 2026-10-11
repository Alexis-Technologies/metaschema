const { test } = require('node:test');
const assert = require('node:assert');

const { Schema, Model } = require('../../index.js');
const { merge, register } = require('../../src/model/index.js');
const { compile, canEval } = require('../../src/compile/index.js');

// A merge checked on both backends: the result, and a compiled copy.
const both = (a, b, options) => {
  const merged = merge(a, b, options);
  const copy = merge(a, b, options);
  assert.strictEqual(compile(copy, { jit: canEval() ? true : 'auto' }).accelerated, canEval());
  return [merged, copy];
};

const conflicts = (a, b, message, options) =>
  assert.throws(() => merge(a, b, options), {
    name: 'SchemaDefinitionError',
    code: 'ERR_MERGE_CONFLICT',
    message,
  });

test('Merge: the fields of both, the constraints of both', () => {
  const a = new Schema('User', {
    name: { type: 'string', length: { min: 2 } },
    age: { type: 'integer', min: 0 },
    role: { enum: ['admin', 'editor', 'viewer'] },
    'nick?': 'string',
    tags: { array: { type: 'string', length: 8 } },
  });
  const b = new Schema('Person', {
    name: { type: 'string', length: { max: 8 }, pattern: '^[a-z]+$', unique: true },
    age: { type: 'number', max: 150 },
    role: { enum: ['editor', 'viewer', 'guest'] },
    nick: { type: 'string', nullable: true },
    mail: 'string',
    tags: { array: { type: 'string', length: { min: 1 } }, length: 3 },
  });
  for (const merged of both(a, b)) {
    assert.strictEqual(merged.name, 'User');
    assert.deepStrictEqual(Object.keys(merged.fields), [
      'name',
      'age',
      'role',
      'nick',
      'tags',
      'mail',
    ]);
    const { name, age, role, nick, tags } = merged.fields;
    assert.deepStrictEqual(name.length, { min: 2, max: 8 });
    assert.strictEqual(name.pattern.source, '^[a-z]+$');
    assert.strictEqual(name.unique, true);
    assert.strictEqual(age.type, 'integer');
    assert.strictEqual(age.min, 0);
    assert.strictEqual(age.max, 150);
    assert.deepStrictEqual(role.enum, ['editor', 'viewer']);
    // Optional in one and required in the other is required; nullable in
    // one only is not nullable.
    assert.strictEqual(nick.required, true);
    assert.strictEqual(nick.nullable, undefined);
    assert.deepStrictEqual(tags.value.length, { min: 1, max: 8 });
    assert.deepStrictEqual(tags.length, { min: undefined, max: 3 });
    const value = { name: 'ab', age: 5, role: 'editor', nick: 'n', tags: ['x'], mail: 'm' };
    assert.strictEqual(merged.check(value).valid, true);
    assert.deepStrictEqual(
      merged.check({ name: 'A1', age: 1.5, role: 'admin', nick: null, tags: ['', 'a', 'b', 'c'] })
        .errors,
      [
        'Field "User.name" does not match the pattern ^[a-z]+$',
        'Field "User.age" not of expected type: integer',
        'Field "User.role" value is not of enum: editor, viewer',
        'Field "User.nick" not of expected type: string',
        'Field "User.tags[0]" value is too short',
        'Field "User.mail" is required',
      ],
    );
  }
  // The same in either order, up to the order of the fields.
  const reversed = merge(b, a);
  assert.deepStrictEqual(Object.keys(reversed.fields), [
    'name',
    'age',
    'role',
    'nick',
    'mail',
    'tags',
  ]);
  assert.strictEqual(reversed.name, 'Person');
  assert.deepStrictEqual(reversed.fields.role.enum, ['editor', 'viewer']);
});

test('Merge: validate functions compose, sync and async', async () => {
  const a = Schema.from({
    n: { type: 'number', validate: (value) => value % 2 === 0 || 'is odd' },
    validate: (value) => value.n < 100 || 'too big',
  });
  const b = Schema.from({
    n: { type: 'number', validate: (value) => value > 0 || 'is negative' },
    validate: (value) => value.n !== 50 || 'is fifty',
  });
  for (const merged of both(a, b)) {
    assert.strictEqual(merged.check({ n: 2 }).valid, true);
    assert.deepStrictEqual(merged.check({ n: -3 }).errors, [
      'Field "n" is odd',
      'Field "n" is negative',
    ]);
    assert.deepStrictEqual(merged.check({ n: 50 }).errors, ['Field "" is fifty']);
    assert.deepStrictEqual(merged.check({ n: 102 }).errors, ['Field "" too big']);
  }
  const slow = Schema.from({
    n: { type: 'number', validate: async (value) => value > 0 || 'is negative' },
  });
  const fast = Schema.from({
    n: { type: 'number', validate: (value) => value % 2 === 0 || 'is odd' },
  });
  const merged = merge(slow, fast);
  assert.throws(() => merged.check({ n: 1 }), { code: 'ERR_ASYNC_VALIDATOR' });
  assert.deepStrictEqual((await merged.checkAsync({ n: -1 })).errors, [
    'Field "n" is negative',
    'Field "n" is odd',
  ]);
  assert.strictEqual((await merged.checkAsync({ n: 2 })).valid, true);
  // The same function on both sides runs once.
  const shared = (value) => value > 0 || 'is negative';
  const once = merge(
    Schema.from({ n: { type: 'number', validate: shared } }),
    Schema.from({ n: { type: 'number', validate: shared } }),
  );
  assert.deepStrictEqual(once.check({ n: -1 }).errors, ['Field "n" is negative']);
});

test('Merge: nested structs, collections, tuples, references and custom types', () => {
  const types = { money: { js: 'number', metadata: { pg: 'money' } } };
  const model = new Model(types, [
    ['Company', { Entity: {}, name: 'string' }],
    ['Tag', { Struct: {}, label: 'string' }],
  ]);
  const a = new Schema(
    'Doc',
    {
      Entity: { table: 'docs' },
      address: { city: 'string', zip: { type: 'string', length: { min: 5 } } },
      point: ['number', { type: 'number', min: 0 }],
      byId: { map: { number: { type: 'integer', min: 1 } } },
      owner: 'Company',
      tags: { many: 'Tag' },
      total: { type: 'money', min: 0 },
      any: 'any',
      validate: () => true,
      byCity: { index: ['address'] },
    },
    [model],
  );
  const b = new Schema(
    'Doc',
    {
      Struct: {},
      address: {
        city: { type: 'string', length: 16 },
        zip: { type: 'string', length: { max: 5 } },
        country: '?string',
      },
      point: ['number', { type: 'number', max: 9 }],
      byId: { map: { number: { type: 'number', max: 9 } } },
      owner: 'Company',
      tags: { many: 'Tag' },
      total: { type: 'money', max: 100 },
      any: { type: 'string', length: 2 },
      byCity: { index: ['address'] },
      byOwner: { unique: ['owner'] },
    },
    [model],
  );
  for (const merged of both(a, b)) {
    assert.strictEqual(merged.kind, 'entity');
    assert.deepStrictEqual(merged.custom, { table: 'docs' });
    assert.deepStrictEqual(Object.keys(merged.fields.address.schema), ['city', 'zip', 'country']);
    assert.deepStrictEqual(merged.fields.address.schema.zip.length, { min: 5, max: 5 });
    assert.strictEqual(merged.fields.point.value[1].max, 9);
    assert.strictEqual(merged.fields.byId.value.type, 'integer');
    assert.strictEqual(merged.fields.byId.value.max, 9);
    assert.strictEqual(merged.fields.total.type, 'money');
    assert.strictEqual(merged.fields.total.max, 100);
    // any (unknown) and a type is that type.
    assert.strictEqual(merged.fields.any.type, 'string');
    // A many field is recorded with the indexes, where it was.
    assert.deepStrictEqual(Object.keys(merged.indexes), ['tags', 'byCity', 'byOwner']);
    assert.strictEqual(
      merged.check({
        address: { city: 'c', zip: '12345' },
        point: [1, 5],
        byId: new Map([[1, 2]]),
        owner: 'c1',
        tags: [{ label: 'x' }],
        total: 50,
        any: 'ab',
      }).valid,
      true,
    );
    assert.deepStrictEqual(
      merged.check({
        address: { city: 'c', zip: '1234' },
        point: [1, 10],
        byId: new Map([[1, 2.5]]),
        owner: 'c1',
        tags: [],
        total: 500,
        any: 'abc',
      }).errors,
      [
        'Field "Doc.address.zip" value is too short',
        'Field "Doc.point[1]" is greater than 9',
        'Field "Doc.byId[1]" not of expected type: integer',
        'Field "Doc.total" is greater than 100',
        'Field "Doc.any" exceeds the maximum length',
      ],
    );
  }
  // A schema of one type, and the metadata given.
  const scalar = merge(
    Schema.from({ type: 'string', length: { min: 1 } }),
    Schema.from({ type: 'string', length: 4 }),
  );
  assert.deepStrictEqual(scalar.fields.length, { min: 1, max: 4 });
  assert.strictEqual(scalar.check('abcde').valid, false);
  const named = merge(a, b, {
    name: 'Merged',
    metadata: { kind: 'registry', scope: 'global', table: 'merged' },
  });
  assert.strictEqual(named.name, 'Merged');
  assert.strictEqual(named.kind, 'registry');
  assert.strictEqual(named.scope, 'global');
  assert.deepStrictEqual(named.custom, { table: 'merged' });
  assert.strictEqual(Object.hasOwn(named.fields, 'docId'), true);
});

test('Merge: what no value can satisfy is a conflict with the field', () => {
  const s = (def) => new Schema('S', def);
  conflicts(
    s({ a: 'string' }),
    s({ a: 'number' }),
    'The type is string in one schema and number in the other in "S.a"',
  );
  conflicts(
    s({ a: { type: 'string', length: { min: 5 } } }),
    s({ a: { type: 'string', length: 3 } }),
    'The lengths have nothing in common in "S.a"',
  );
  conflicts(
    s({ a: { enum: ['x'] } }),
    s({ a: { enum: ['y'] } }),
    'The enums have no value in common in "S.a"',
  );
  conflicts(
    s({ a: { type: 'string', pattern: '^a', length: 8 } }),
    s({ a: { type: 'string', pattern: '^b', length: 8 } }),
    'The pattern differs between the schemas in "S.a"',
  );
  conflicts(
    s({ a: { type: 'string', default: 'x' } }),
    s({ a: { type: 'string', default: 'y' } }),
    'The default differs between the schemas in "S.a"',
  );
  conflicts(
    s({ a: { type: 'string', parse: (v) => v } }),
    s({ a: { type: 'string', parse: (v) => v } }),
    'The parse differs between the schemas in "S.a"',
  );
  conflicts(
    s({ a: { union: ['string'] } }),
    s({ a: { union: ['number'] } }),
    'The union differs between the schemas in "S.a"',
  );
  conflicts(
    s({ a: { object: { string: 'number' } } }),
    s({ a: { object: { number: 'number' } } }),
    'The key differs between the schemas in "S.a"',
  );
  conflicts(
    s({ a: 'Company' }),
    s({ a: 'Person' }),
    'The type is Company in one schema and Person in the other in "S.a"',
  );
  conflicts(
    s({ a: { type: 'Company', embed: false } }),
    s({ a: { type: 'Company', embed: true } }),
    'The embed differs between the schemas in "S.a"',
  );
  // A value the other side lacks stands.
  assert.strictEqual(
    merge(s({ a: 'Company' }), s({ a: { type: 'Company', embed: true } })).fields.a.embed,
    true,
  );
  conflicts(
    s({ a: { x: 'string' } }),
    s({ a: { x: 'number' } }),
    'The type is string in one schema and number in the other in "S.a.x"',
  );
  conflicts(
    s({ a: ['number'] }),
    s({ a: ['number', 'number'] }),
    'The elements differ in number in "S.a"',
  );
  conflicts(
    s({ a: { array: 'string' } }),
    s({ a: ['string'] }),
    'The type is array in one schema and tuple in the other in "S.a"',
  );
  conflicts(
    s({ a: { x: 'string' } }),
    s({ a: { schema: Schema.from('string') } }),
    'A struct in one schema and a schema of one type in the other in "S.a"',
  );
  conflicts(
    s({ a: 'string', half: (v) => v.a }),
    s({ a: 'string', half: (v) => v.a }),
    'The function differs between the schemas in "S.half"',
  );
  conflicts(
    s({ a: 'string', half: (v) => v.a }),
    s({ a: 'string', half: 'string' }),
    'The function differs between the schemas in "S.half"',
  );
  conflicts(
    s({ a: 'string', byA: { index: ['a'] } }),
    s({ a: 'string', byA: { unique: ['a'] } }),
    'The index differs between the schemas in "S.byA"',
  );
  conflicts(
    s({ a: 'string', parse: (v) => v }),
    s({ a: 'string', parse: (v) => v }),
    'The functions of the schemas differ in "S.parse"',
  );
  conflicts(
    s({ a: 'string' }),
    Schema.from('string'),
    'A struct and a schema of one type cannot be merged in "S"',
  );
  // A nested conflict names the path; a merge under another name is located there.
  conflicts(
    s({ a: { b: { c: 'string' } } }),
    s({ a: { b: { c: 'boolean' } } }),
    'The type is string in one schema and boolean in the other in "S.a.b.c"',
  );
  conflicts(
    s({ a: 'string' }),
    s({ a: 'number' }),
    'The type is string in one schema and number in the other in "M.a"',
    { name: 'M' },
  );
  assert.throws(() => merge(s({ a: 'string' }), { a: 'string' }), {
    name: 'TypeError',
    code: 'ERR_INVALID_TARGET',
    message: 'Two Schemas are expected',
  });
  assert.throws(() => merge(s({ a: 'string' }), s({ a: 'string' }), null), {
    code: 'ERR_INVALID_OPTIONS',
  });
});

test('Merge: annotations come from the first schema, flags from either, aliases from both', () => {
  const a = Schema.from({ a: { type: 'string', title: 'A', unique: true, aliases: ['x'] } });
  const b = Schema.from({
    a: {
      type: 'string',
      title: 'B',
      description: 'd',
      index: true,
      aliases: ['x', 'y'],
      deprecated: true,
    },
  });
  const { a: field } = merge(a, b).fields;
  assert.strictEqual(field.title, 'A');
  assert.strictEqual(field.description, 'd');
  assert.strictEqual(field.unique, true);
  assert.strictEqual(field.index, true);
  assert.strictEqual(field.deprecated, true);
  assert.deepStrictEqual(field.aliases, ['x', 'y']);
  assert.strictEqual(merge(a, b).check({ y: 'v' }).valid, true);
  // The inputs are untouched.
  assert.deepStrictEqual(a.fields.a.aliases, ['x']);
  assert.strictEqual(a.check({ y: 'v' }).valid, false);
});

// R7, M7, G7: a conflict carries its field and is located like a definition
// error; an alias that is a key of the other schema is a conflict, not a
// definition error of the merged struct; the bounds of both sides.
test('Merge: a conflict is located at its field, aliases and bounds included', () => {
  const s = (def) => new Schema('S', def);
  const located = (a, b, message, field) =>
    assert.throws(() => merge(a, b), { code: 'ERR_MERGE_CONFLICT', message, schema: 'S', field });
  located(
    s({ a: { b: { c: 'string' } } }),
    s({ a: { b: { c: 'number' } } }),
    'The type is string in one schema and number in the other in "S.a.b.c"',
    'a.b.c',
  );
  located(
    s({ a: 'string' }),
    Schema.from('string'),
    'A struct and a schema of one type cannot be merged in "S"',
    '',
  );
  // An alias that is a field of the other schema, or an alias of both.
  located(
    s({ title: { type: 'string', aliases: ['name'] } }),
    s({ name: 'string' }),
    'The alias "name" is a field or an alias already in "S.title"',
    'title',
  );
  located(
    s({ a: { type: 'string', aliases: ['z'] } }),
    s({ b: { type: 'string', aliases: ['z'] } }),
    'The alias "z" is a field or an alias already in "S.b"',
    'b',
  );
  assert.deepStrictEqual(
    merge(
      s({ a: { type: 'string', aliases: ['x'] } }),
      s({ b: { type: 'string', aliases: ['y'] } }),
    ).check({ x: 'v', y: 'w' }).valid,
    true,
  );
  // The bounds of both: the greater minimum, the lesser maximum, or nothing.
  const bounded = merge(
    s({ a: { type: 'number', min: 1, max: 9 }, b: { type: 'bigint', min: 2n } }),
    s({ a: { type: 'number', min: 3, max: 5 }, b: { type: 'bigint', min: 1n, max: 4n } }),
  );
  assert.deepStrictEqual([bounded.fields.a.min, bounded.fields.a.max], [3, 5]);
  assert.deepStrictEqual([bounded.fields.b.min, bounded.fields.b.max], [2n, 4n]);
  located(
    s({ a: { type: 'number', min: 5 } }),
    s({ a: { type: 'number', max: 3 } }),
    'The bounds have nothing in common in "S.a"',
    'a',
  );
  // A `value` that is a tuple in one schema and not in the other: a custom
  // type with a value option of its own, since a built-in type settles it.
  const model = new Model(
    {
      pair: {
        kind: 'scalar',
        construct(def) {
          this.value = def.value;
        },
        checkType: () => true,
      },
    },
    [],
  );
  const pair = (value) => new Schema('S', { a: { type: 'pair', value } }, [model]);
  located(pair(['x']), pair({ n: 1 }), 'A tuple in one schema and not in the other in "S.a"', 'a');
  assert.deepStrictEqual(merge(pair(['x']), pair(['x'])).fields.a.value, ['x']);
});

// S4: the keys of the merged definition are defined, not assigned.
test('Merge: a field named __proto__ merges like any other', () => {
  const proto = (type) => Schema.from(JSON.parse(`{"a":"string","__proto__":"${type}"}`));
  const merged = merge(proto('string'), proto('string'));
  assert.deepStrictEqual(Object.keys(merged.fields), ['a', '__proto__']);
  assert.strictEqual(merged.check(JSON.parse('{"a":"x","__proto__":"y"}')).valid, true);
  assert.deepStrictEqual(merged.check(JSON.parse('{"a":"x","__proto__":1}')).errors, [
    'Field "__proto__" not of expected type: string',
  ]);
  assert.deepStrictEqual(Object.keys(merge(Schema.from({ a: 'string' }), proto('number')).fields), [
    'a',
    '__proto__',
  ]);
  assert.throws(() => merge(proto('string'), proto('number')), {
    code: 'ERR_MERGE_CONFLICT',
    message: 'The type is string in one schema and number in the other in "__proto__"',
    field: '__proto__',
  });
});

test('Merge: register() installs Schema.merge', () => {
  assert.strictEqual(Schema.merge, undefined);
  register();
  assert.strictEqual(Schema.merge, merge);
  assert.strictEqual(Object.getOwnPropertyDescriptor(Schema, 'merge').enumerable, false);
  const merged = Schema.merge(Schema.from({ a: 'string' }), Schema.from({ b: 'number' }));
  assert.deepStrictEqual(Object.keys(merged.fields), ['a', 'b']);
});
