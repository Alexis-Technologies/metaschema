const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { Schema, Model } = require('../../index.js');
const { merge, register } = require('../../src/model/index.js');
const { compile, canEval } = require('../../src/compile/index.js');

// A merge checked on both backends: the result, and a compiled copy.
const both = (a, b, options) => {
  const merged = merge(a, b, options);
  const copy = merge(a, b, options);
  assert.equal(compile(copy, { jit: canEval() ? true : 'auto' }).accelerated, canEval());
  return [merged, copy];
};

const conflicts = (a, b, message, options) =>
  assert.throws(() => merge(a, b, options), {
    name: 'SchemaDefinitionError',
    code: 'ALX_ERR_MERGE_CONFLICT',
    message,
  });

describe('Merge', () => {
  it('should keep the fields of both and the constraints of both', () => {
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
      assert.equal(merged.name, 'User');
      assert.deepEqual(Object.keys(merged.fields), ['name', 'age', 'role', 'nick', 'tags', 'mail']);
      const { name, age, role, nick, tags } = merged.fields;
      assert.deepEqual(name.length, { min: 2, max: 8 });
      assert.equal(name.pattern.source, '^[a-z]+$');
      assert.equal(name.unique, true);
      assert.equal(age.type, 'integer');
      assert.equal(age.min, 0);
      assert.equal(age.max, 150);
      assert.deepEqual(role.enum, ['editor', 'viewer']);
      // Optional in one and required in the other is required; nullable in
      // one only is not nullable.
      assert.equal(nick.required, true);
      assert.equal(nick.nullable, undefined);
      assert.deepEqual(tags.value.length, { min: 1, max: 8 });
      assert.deepEqual(tags.length, { min: undefined, max: 3 });
      const value = { name: 'ab', age: 5, role: 'editor', nick: 'n', tags: ['x'], mail: 'm' };
      assert.equal(merged.check(value).valid, true);
      assert.deepEqual(
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
    assert.deepEqual(Object.keys(reversed.fields), ['name', 'age', 'role', 'nick', 'mail', 'tags']);
    assert.equal(reversed.name, 'Person');
    assert.deepEqual(reversed.fields.role.enum, ['editor', 'viewer']);
  });

  it('should compose validate functions, sync and async', async () => {
    const a = Schema.from({
      n: { type: 'number', validate: (value) => value % 2 === 0 || 'is odd' },
      validate: (value) => value.n < 100 || 'too big',
    });
    const b = Schema.from({
      n: { type: 'number', validate: (value) => value > 0 || 'is negative' },
      validate: (value) => value.n !== 50 || 'is fifty',
    });
    for (const merged of both(a, b)) {
      assert.equal(merged.check({ n: 2 }).valid, true);
      assert.deepEqual(merged.check({ n: -3 }).errors, [
        'Field "n" is odd',
        'Field "n" is negative',
      ]);
      assert.deepEqual(merged.check({ n: 50 }).errors, ['Field "" is fifty']);
      assert.deepEqual(merged.check({ n: 102 }).errors, ['Field "" too big']);
    }
    const slow = Schema.from({
      n: { type: 'number', validate: async (value) => value > 0 || 'is negative' },
    });
    const fast = Schema.from({
      n: { type: 'number', validate: (value) => value % 2 === 0 || 'is odd' },
    });
    const merged = merge(slow, fast);
    assert.throws(() => merged.check({ n: 1 }), { code: 'ALX_ERR_ASYNC_VALIDATOR' });
    assert.deepEqual((await merged.checkAsync({ n: -1 })).errors, [
      'Field "n" is negative',
      'Field "n" is odd',
    ]);
    assert.equal((await merged.checkAsync({ n: 2 })).valid, true);
    // The same function on both sides runs once.
    const shared = (value) => value > 0 || 'is negative';
    const once = merge(
      Schema.from({ n: { type: 'number', validate: shared } }),
      Schema.from({ n: { type: 'number', validate: shared } }),
    );
    assert.deepEqual(once.check({ n: -1 }).errors, ['Field "n" is negative']);
  });

  it('should observe the promise of the first validator when the second throws', async () => {
    const unhandled = [];
    const listen = (reason) => unhandled.push(reason);
    process.on('unhandledRejection', listen);
    try {
      const rejecting = async () => {
        throw new Error('a rejects');
      };
      const throwing = () => {
        throw new Error('b throws');
      };
      const merged = merge(
        Schema.from({ x: { type: 'string', validate: rejecting } }),
        Schema.from({ x: { type: 'string', validate: throwing } }),
      );
      const result = await merged.checkAsync({ x: 'v' });
      assert.deepEqual(result.errors, ['Field "x" validation failed Error: b throws']);
      await new Promise((resolve) => setTimeout(resolve, 1));
      assert.deepEqual(unhandled, []);
    } finally {
      process.off('unhandledRejection', listen);
    }
  });

  it('should merge nested structs, collections, tuples, references and custom types', () => {
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
      assert.equal(merged.kind, 'entity');
      assert.deepEqual(merged.custom, { table: 'docs' });
      assert.deepEqual(Object.keys(merged.fields.address.schema), ['city', 'zip', 'country']);
      assert.deepEqual(merged.fields.address.schema.zip.length, { min: 5, max: 5 });
      assert.equal(merged.fields.point.value[1].max, 9);
      assert.equal(merged.fields.byId.value.type, 'integer');
      assert.equal(merged.fields.byId.value.max, 9);
      assert.equal(merged.fields.total.type, 'money');
      assert.equal(merged.fields.total.max, 100);
      // any (unknown) and a type is that type.
      assert.equal(merged.fields.any.type, 'string');
      // A many field is recorded with the indexes, where it was.
      assert.deepEqual(Object.keys(merged.indexes), ['tags', 'byCity', 'byOwner']);
      assert.equal(
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
      assert.deepEqual(
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
    assert.deepEqual(scalar.fields.length, { min: 1, max: 4 });
    assert.equal(scalar.check('abcde').valid, false);
    const named = merge(a, b, {
      name: 'Merged',
      metadata: { kind: 'registry', scope: 'global', table: 'merged' },
    });
    assert.equal(named.name, 'Merged');
    assert.equal(named.kind, 'registry');
    assert.equal(named.scope, 'global');
    assert.deepEqual(named.custom, { table: 'merged' });
    assert.equal(Object.hasOwn(named.fields, 'docId'), true);
    // A kind given as undefined is the first schema's.
    const kept = merge(a, b, { metadata: { kind: undefined, scope: 'global' } });
    assert.equal(kept.kind, a.kind);
    assert.equal(kept.scope, 'global');
  });

  it('should throw a conflict with the field for what no value can satisfy', () => {
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
    assert.equal(
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
      name: 'SchemaUsageError',
      code: 'ALX_ERR_INVALID_TARGET',
      message: 'Two Schemas are expected',
    });
    assert.throws(() => merge(s({ a: 'string' }), s({ a: 'string' }), null), {
      code: 'ALX_ERR_INVALID_OPTION',
    });
  });

  it('should keep the fewer decimals of the two', () => {
    const merged = merge(
      Schema.from({ a: { type: 'number', decimals: 3 }, b: { type: 'number', decimals: 1 } }),
      Schema.from({ a: { type: 'number', decimals: 2 }, b: 'number' }),
    );
    assert.equal(merged.fields.a.decimals, 2);
    assert.equal(merged.fields.b.decimals, 1);
    assert.equal(merged.check({ a: 0.125, b: 1 }).valid, false);
  });

  it('should keep the names of flags both have', () => {
    const merged = merge(
      Schema.from({ perms: { flags: ['read', 'write', 'admin'] } }),
      Schema.from({ perms: { flags: ['admin', 'read'] } }),
    );
    assert.deepEqual(merged.fields.perms.flags, ['read', 'admin']);
    assert.throws(
      () =>
        merge(Schema.from({ perms: { flags: ['a'] } }), Schema.from({ perms: { flags: ['b'] } })),
      { code: 'ALX_ERR_MERGE_CONFLICT', message: 'The flags have no value in common in "perms"' },
    );
  });

  it('should take annotations from the first schema, flags from either, aliases from both', () => {
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
    assert.equal(field.title, 'A');
    assert.equal(field.description, 'd');
    assert.equal(field.unique, true);
    assert.equal(field.index, true);
    assert.equal(field.deprecated, true);
    assert.deepEqual(field.aliases, ['x', 'y']);
    assert.equal(merge(a, b).check({ y: 'v' }).valid, true);
    // The inputs are untouched.
    assert.deepEqual(a.fields.a.aliases, ['x']);
    assert.equal(a.check({ y: 'v' }).valid, false);
  });

  // R7, M7, G7: a conflict carries its field and is located like a definition
  // error; an alias that is a key of the other schema is a conflict, not a
  // definition error of the merged struct; the bounds of both sides.
  it('should locate a conflict at its field, aliases and bounds included', () => {
    const s = (def) => new Schema('S', def);
    const located = (a, b, message, field) =>
      assert.throws(() => merge(a, b), {
        code: 'ALX_ERR_MERGE_CONFLICT',
        message,
        schema: 'S',
        field,
      });
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
    assert.deepEqual(
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
    assert.deepEqual([bounded.fields.a.min, bounded.fields.a.max], [3, 5]);
    assert.deepEqual([bounded.fields.b.min, bounded.fields.b.max], [2n, 4n]);
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
    located(
      pair(['x']),
      pair({ n: 1 }),
      'A tuple in one schema and not in the other in "S.a"',
      'a',
    );
    assert.deepEqual(merge(pair(['x']), pair(['x'])).fields.a.value, ['x']);
  });

  // S4: the keys of the merged definition are defined, not assigned.
  it('should reach a schema that names itself without a model from the merge', () => {
    const node = new Schema('Node', { 'next?': 'Node' });
    const base = new Schema('Base', { a: 'string' });
    for (const schema of both(base, node)) {
      assert.deepEqual(schema.check({ a: 'x', next: { next: 5 } }).errors, [
        'Field "Base.next.next" not of expected type: object',
      ]);
      assert.deepEqual(schema.checkConsistency(), []);
    }
  });

  it('should merge a field named __proto__ like any other', () => {
    const proto = (type) => Schema.from(JSON.parse(`{"a":"string","__proto__":"${type}"}`));
    const merged = merge(proto('string'), proto('string'));
    assert.deepEqual(Object.keys(merged.fields), ['a', '__proto__']);
    assert.equal(merged.check(JSON.parse('{"a":"x","__proto__":"y"}')).valid, true);
    assert.deepEqual(merged.check(JSON.parse('{"a":"x","__proto__":1}')).errors, [
      'Field "__proto__" not of expected type: string',
    ]);
    assert.deepEqual(Object.keys(merge(Schema.from({ a: 'string' }), proto('number')).fields), [
      'a',
      '__proto__',
    ]);
    assert.throws(() => merge(proto('string'), proto('number')), {
      code: 'ALX_ERR_MERGE_CONFLICT',
      message: 'The type is string in one schema and number in the other in "__proto__"',
      field: '__proto__',
    });
  });

  it('should install Schema.merge with register()', () => {
    assert.equal(Schema.merge, undefined);
    register();
    assert.equal(Schema.merge, merge);
    assert.equal(Object.getOwnPropertyDescriptor(Schema, 'merge').enumerable, false);
    const merged = Schema.merge(Schema.from({ a: 'string' }), Schema.from({ b: 'number' }));
    assert.deepEqual(Object.keys(merged.fields), ['a', 'b']);
  });

  it('should merge structs of upper-case keys field by field', () => {
    const base = new Schema('Env', { DATABASE_URL: 'string', PORT: { type: 'number', min: 1 } });
    const more = new Schema('Env', { PORT: { type: 'number', max: 65535 }, REDIS_URL: '?string' });
    for (const merged of both(base, more)) {
      assert.equal(merged.kind, 'struct');
      assert.deepEqual(Object.keys(merged.fields), ['DATABASE_URL', 'PORT', 'REDIS_URL']);
      assert.equal(merged.fields.PORT.min, 1);
      assert.equal(merged.fields.PORT.max, 65535);
      assert.equal(merged.check({ DATABASE_URL: 'x', PORT: 80 }).valid, true);
      assert.deepEqual(merged.check({ PORT: 0 }).errors, [
        'Field "Env.DATABASE_URL" is required',
        'Field "Env.PORT" is less than 1',
      ]);
    }
    assert.throws(() => merge(base, more, { metadata: { kind: 'dTO' } }), {
      code: 'ALX_ERR_INVALID_OPTIONS',
      message: 'Metadata "kind" must be the name of a kind, got "dTO"',
    });
  });
});
