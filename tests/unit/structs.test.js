const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { Schema, Model } = require('../../index.js');

describe('Structs', () => {
  it('should check a nested schema', () => {
    const definition = {
      field1: 'string',
      field2: {
        schema: {
          subfield1: 'number',
          subfield2: 'string',
        },
      },
    };
    const obj = {
      field1: 'value',
      field2: {
        subfield1: 500,
        subfield2: 'value',
      },
    };
    const schema = Schema.from(definition);
    assert.equal(schema.check(obj).valid, true);
  });

  it('should report a lost field of a nested schema', () => {
    const schema = Schema.from({
      field1: 'string',
      field2: {
        subfield1: 'number',
      },
      field3: 'string',
    });

    const obj = {
      field1: 'value',
      field2: {},
    };
    assert.deepEqual(schema.check(obj).errors, [
      'Field "field2.subfield1" is required',
      'Field "field3" is required',
    ]);
  });

  it('should check an optional nested struct', () => {
    const definition = {
      struct: {
        schema: {
          field: 'string',
        },
        required: false,
      },
    };
    const schema = Schema.from(definition);

    const obj1 = {};
    assert.equal(schema.check(obj1).valid, true);

    const obj2 = {
      struct: {
        field: 'value',
      },
    };
    assert.equal(schema.check(obj2).valid, true);
  });

  it('should check an optional nested struct beside a base field', () => {
    const definition = {
      text: 'string',
      struct: {
        schema: {
          field: 'string',
        },
        required: false,
      },
    };
    const schema = Schema.from(definition);

    const obj1 = { text: 'abc' };
    assert.equal(schema.check(obj1).valid, true);

    const obj2 = {
      text: 'abc',
      struct: {
        field: 'value',
      },
    };
    assert.equal(schema.check(obj2).valid, true);
  });

  it('should check the shorthand for an optional nested struct', () => {
    const definition = {
      struct: {
        schema: {
          field: 'string',
        },
        required: false,
      },
    };
    const schema = Schema.from(definition);

    const obj1 = {};
    assert.equal(schema.check(obj1).valid, true);

    const obj2 = {
      struct: {
        field: 'value',
      },
    };
    assert.equal(schema.check(obj2).valid, true);
  });

  it('should check multiple optional nested structs', () => {
    const definition = {
      field: 'string',
      data: {
        nfield1: {
          schema: {
            text: 'string',
          },
          required: true,
        },
        nfield2: {
          schema: {
            text: 'string',
            caption: '?string',
          },
          required: false,
        },
      },
    };
    const schema = Schema.from(definition);

    assert.equal(
      schema.check({
        field: 'abc',
        data: {
          nfield1: { text: 'abc' },
        },
      }).valid,
      true,
    );

    assert.equal(
      schema.check({
        field: 'abc',
        data: {
          nfield1: { text: 'abc' },
          nfield2: { text: 'aaa' },
        },
      }).valid,
      true,
    );

    assert.equal(
      schema.check({
        field: 'abc',
        data: {
          nfield1: { text: 'abc' },
          nfield2: { text: 'aaa', caption: 'caption' },
        },
      }).valid,
      true,
    );

    assert.deepEqual(
      schema.check({
        field: 'abc',
        data: {
          nfield1: {},
          nfield2: { text: 'aaa', caption: 42 },
        },
      }).errors,
      [
        `Field "data.nfield1.text" is required`,
        `Field "data.nfield2.caption" not of expected type: string`,
      ],
    );
  });

  it('should check nested schemas with Schema instances', () => {
    const def = {
      name: {
        type: 'schema',
        schema: new Schema('', {
          first: { type: 'string' },
          last: { type: 'string' },
          third: { type: 'string' },
        }),
      },
      age: { type: 'number' },
      levelOne: {
        type: 'schema',
        schema: new Schema('', {
          levelTwo: {
            type: 'schema',
            schema: new Schema('', {
              levelThree: { type: 'enum', enum: [1, 2, 3] },
            }),
          },
        }),
      },
    };
    const obj = {
      name: {
        first: 'Andrew',
        last: 'John',
        third: 'John',
      },
      age: 5,
      levelOne: {
        levelTwo: {
          levelThree: 2,
        },
      },
    };
    const schema = new Schema('', def);
    assert.equal(schema.check(obj).valid, true);
  });

  it('should accept any plain object for the json type of a struct field', () => {
    const defs = { name: 'json' };
    const schema = Schema.from(defs);
    assert.equal(schema.check({ name: {} }).valid, true);
    assert.equal(schema.check({ name: { a: 'b' } }).valid, true);
    assert.equal(schema.check({ name: [] }).valid, true);
    assert.equal(schema.check({ name: null }).valid, false);
  });

  it('should accept a missing or null value in every optional nested struct form', () => {
    const address = { city: 'string' };
    const definitions = [
      { 'address?': address },
      { address: { type: 'schema', schema: address, required: false } },
      { 'address?': Schema.from(address) },
      { address: { type: 'schema', schema: Schema.from(address), required: false } },
    ];
    for (const definition of definitions) {
      const schema = Schema.from(definition);
      assert.equal(schema.fields.address.required, false);
      assert.deepEqual(schema.check({}).errors, []);
      assert.deepEqual(schema.check({ address: null }).errors, []);
      assert.deepEqual(schema.check({ address: { city: 1 } }).errors, [
        'Field "address.city" not of expected type: string',
      ]);
    }
  });

  it('should require a nested struct unless it is marked optional', () => {
    const address = { city: 'string' };
    for (const definition of [
      { address },
      { address: { type: 'schema', schema: address } },
      { address: { type: 'schema', schema: address, required: true } },
    ]) {
      const schema = Schema.from(definition);
      assert.equal(schema.fields.address.required, true);
      assert.deepEqual(schema.check({}).errors, ['Field "address" is required']);
    }
  });

  it('should accept an optional nested struct as a collection element', () => {
    const item = { city: 'string' };
    const optional = { type: 'schema', schema: item, required: false };

    const list = Schema.from({ list: { array: optional } });
    assert.equal(list.fields.list.value.required, false);
    assert.deepEqual(list.check({ list: [null, { city: 'Kyiv' }] }).errors, []);
    assert.deepEqual(list.check({ list: [null, { city: 1 }] }).errors, [
      'Field "list[1].city" not of expected type: string',
    ]);

    const byId = Schema.from({ byId: { object: { string: optional } } });
    assert.deepEqual(byId.check({ byId: { a: null, b: { city: 'Lviv' } } }).errors, []);

    const required = Schema.from({ list: { array: item } });
    assert.equal(required.fields.list.value.required, true);
    assert.equal(required.check({ list: [null] }).valid, false);
  });

  it('should throw a clear error for a schema type without a schema definition', () => {
    const message = (type) =>
      `Type "${type}" needs a schema definition: { type: '${type}', schema: { ... } }`;
    const invalid = [
      { data: 'schema' },
      { data: { type: 'schema' } },
      { data: { type: 'schema', schema: null } },
      { data: { type: 'schema', schema: 'string' } },
      { data: { type: 'schema', schema: ['string'] } },
    ];
    for (const definition of invalid) {
      assert.throws(() => Schema.from(definition), {
        name: 'SchemaDefinitionError',
        code: 'ERR_MISSING_SCHEMA',
        message: `${message('schema')} in "data"`,
      });
    }
    assert.equal(
      Schema.from({ data: { schema: { city: 'string' } } }).check({ data: { city: 'Lviv' } }).valid,
      true,
    );
  });

  it('should accept field names that collide with Object.prototype and struct internals', () => {
    const schema = Schema.from({
      check: 'string',
      name: 'string',
      constructor: 'number',
      toString: '?string',
      hasOwnProperty: 'boolean',
    });
    assert.deepEqual(Object.keys(schema.fields), [
      'check',
      'name',
      'constructor',
      'toString',
      'hasOwnProperty',
    ]);
    const valid = { check: 'x', name: 'y', constructor: 1, hasOwnProperty: true };
    assert.equal(schema.check(valid).valid, true);
    const invalid = { check: 1, name: 'y', constructor: 'no', hasOwnProperty: true };
    assert.deepEqual(schema.check(invalid).errors, [
      'Field "check" not of expected type: string',
      'Field "constructor" not of expected type: number',
    ]);
  });

  it('should report a value that is not an object as a type error', () => {
    assert.deepEqual(Schema.from({ name: 'string' }).check(5).errors, [
      'Field "" not of expected type: object',
    ]);
    assert.deepEqual(new Schema('User', { name: 'string' }).check('x').errors, [
      'Field "User" not of expected type: object',
    ]);
    assert.deepEqual(Schema.from({ inner: { name: 'string' } }).check({ inner: 5 }).errors, [
      'Field "inner" not of expected type: object',
    ]);
  });

  it('should report input keys from Object.prototype as unexpected', () => {
    const schema = Schema.from({ name: 'string' });
    const input = JSON.parse(
      '{"name":"x","constructor":1,"__proto__":{"z":1},"check":1,"toString":2,"hasOwnProperty":3}',
    );
    const result = schema.check(input);
    assert.deepEqual(result.errors, [
      'Field "" has unexpected keys: constructor, __proto__, check, toString, hasOwnProperty',
    ]);
    assert.deepEqual(result.issues[0].params.keys, [
      'constructor',
      '__proto__',
      'check',
      'toString',
      'hasOwnProperty',
    ]);
  });

  it('should enumerate and serialize the fields as plain data', () => {
    const schema = Schema.from({ name: 'string', age: '?number', half: (value) => value.age / 2 });
    assert.deepEqual(Object.keys(schema.fields), ['name', 'age', 'half']);
    assert.equal(typeof schema.fields.half, 'function');
    assert.equal(
      JSON.stringify(schema),
      '{"name":{"required":true,"type":"string"},"age":{"required":false,"type":"number"}}',
    );
    assert.equal(schema.check({ name: 'x' }).valid, true);
  });

  it('should carry the plan and known keys of a struct, its check compiled apart', () => {
    const { STRUCT } = require('../../src/struct.js');
    const { checkOf } = require('../../src/checks.js');
    const schema = Schema.from({
      name: 'string',
      'tags?': { array: 'string' },
      toString: '?string',
      half: (value) => value.n / 2,
    });
    const struct = schema.fields[STRUCT];
    assert.ok(Object.isFrozen(struct));
    assert.ok(Object.isFrozen(struct.plan));
    assert.deepEqual(
      struct.plan.map(({ key, required, own }) => [key, required, own]),
      [
        ['name', true, false],
        ['tags', false, false],
        ['toString', false, true],
      ],
    );
    assert.equal(struct.plan[0].type, schema.fields.name);
    assert.deepEqual(Object.keys(struct.plan[0]), ['key', 'type', 'required', 'own', 'aliases']);
    assert.equal(Object.getPrototypeOf(struct.known), null);
    assert.deepEqual(Object.keys(struct.known), ['name', 'tags', 'toString', 'half']);
    assert.deepEqual(Object.keys(struct), ['plan', 'known', 'calculated']);
    assert.equal(typeof checkOf(schema.fields), 'function');
    assert.equal(checkOf(schema.fields), checkOf(schema.fields));
    assert.deepEqual(Object.keys(schema.fields), ['name', 'tags', 'toString', 'half']);
    assert.deepEqual(Object.keys(schema.fields.name), ['root', 'required', 'type']);
    assert.equal(typeof schema.fields.name.check, 'function');
    assert.ok(!('check' in JSON.parse(JSON.stringify(schema.fields.name))));
  });

  it('should compile a check on its first use, once', () => {
    let compiled = 0;
    const model = new Model(
      {
        counted: {
          kind: 'scalar',
          construct() {},
          compile() {
            compiled += 1;
            return (value, context, key) => {
              if (typeof value !== 'string') context.issues = [{ key }];
            };
          },
        },
      },
      [
        ['Inner', { Struct: {}, c: 'counted' }],
        ['Outer', { Struct: {}, a: 'counted', list: { array: 'counted' }, inner: 'Inner' }],
      ],
    );
    const outer = model.entities.get('Outer');
    // Building, reading, rendering and writing a snapshot compile nothing,
    // unless the JIT is registered (`pnpm run test:jit`), which compiles at
    // construction what it calls out to.
    const eager = process.env.METASCHEMA_BACKEND === 'jit';
    const { toTypeScript, toJSONSchema } = require('../../src/generators/index.js');
    assert.equal(toTypeScript(outer).length > 0, true);
    assert.equal(typeof toJSONSchema(outer, { unrepresentable: 'any' }), 'object');
    assert.equal(JSON.stringify(outer.toSnapshot()).length > 0, true);
    assert.equal(compiled, eager ? 3 : 0);
    outer.check({ a: 'x', list: ['y'], inner: { c: 'z' } });
    assert.equal(compiled, 3);
    outer.check({ a: 'x', list: [], inner: { c: 'z' } });
    model.entities.get('Inner').check({ c: 'z' });
    assert.equal(compiled, 3);
    // A definition error is still found when the schema is built.
    assert.throws(() => Schema.from({ n: { type: 'number', min: 5, max: 1 } }), {
      code: 'ERR_INVALID_RULE',
      message: 'Rule "max" is below "min" in "n"',
    });
  });

  it('should decide a required key by the key and the definition together', () => {
    const cases = [
      [{ 'a?': 'string' }, false],
      [{ a: '?string' }, false],
      [{ 'a?': '?string' }, false],
      [{ a: { type: 'string', required: false } }, false],
      [{ 'a?': { type: 'string', required: true } }, false],
      [{ a: { type: 'string', required: true } }, true],
      [{ a: 'string' }, true],
      [{ 'a?': ['number'] }, false],
      [{ a: ['number'] }, true],
      [{ 'a?': { b: 'string' } }, false],
      [{ 'a?': Schema.from({ b: 'string' }) }, false],
      [{ a: { schema: Schema.from({ b: 'string' }), required: false } }, false],
    ];
    for (const [definition, required] of cases) {
      const schema = Schema.from(definition);
      assert.equal(schema.fields.a.required, required, JSON.stringify(definition));
      assert.equal(schema.check({}).valid, !required, JSON.stringify(definition));
      assert.equal(schema.check({ a: null }).valid, !required, JSON.stringify(definition));
    }
  });

  it('should check a value set to undefined and an inherited member', () => {
    const schema = Schema.from({ name: 'string', 'nick?': 'string', valueOf: 'number' });
    assert.deepEqual(schema.check({ name: undefined, nick: undefined, valueOf: 1 }).errors, [
      'Field "name" not of expected type: string',
    ]);
    assert.deepEqual(schema.check({ name: 'x' }).errors, ['Field "valueOf" is required']);
    const derived = Object.create({ name: 'inherited', valueOf: 2 });
    assert.deepEqual(schema.check(derived).errors, ['Field "valueOf" is required']);
    assert.equal(Schema.from({ 'meta?': 'json' }).check({ meta: null }).valid, true);
    assert.deepEqual(Schema.from({ meta: 'json' }).check({ meta: 5 }).errors, [
      'Field "meta" not of expected type: object',
    ]);
  });

  it('should reject an array as a struct, even when every field is optional', () => {
    const schema = new Schema('Name', { 'given?': 'string', 'family?': 'string' });
    assert.equal(schema.check({}).valid, true);
    for (const value of [[], ['x'], [{ given: 'a' }]]) {
      assert.deepEqual(schema.check(value).errors, ['Field "Name" not of expected type: object']);
      assert.deepEqual(schema.check(value).issues[0].params, {
        expected: 'object',
        received: 'array',
      });
    }
    const nested = Schema.from({ name: { 'given?': 'string' } });
    assert.deepEqual(nested.check({ name: [] }).errors, [
      'Field "name" not of expected type: object',
    ]);
  });

  it('should reject the parse, serialize and validate of a nested struct as keys of the value', () => {
    const schema = new Schema('Doc', {
      inner: {
        a: 'string',
        validate: () => true,
        parse: (value) => value,
        serialize: (value) => value,
        total: () => 1,
      },
    });
    // The functions stay in the fields, as the calculated field does.
    assert.equal(typeof schema.fields.inner.schema.parse, 'function');
    assert.equal(typeof schema.fields.inner.schema.total, 'function');
    // A calculated field may be in the value; the three options may not, as at
    // the root, where they are options of the schema.
    assert.equal(schema.check({ inner: { a: 'x', total: 1 } }).valid, true);
    for (const name of ['parse', 'serialize', 'validate']) {
      const result = schema.check({ inner: { a: 'x', [name]: 'data' } });
      assert.deepEqual(result.errors, [`Field "Doc.inner" has unexpected keys: ${name}`]);
      const stripped = schema.parse({ inner: { a: 'x', [name]: 'data' } }, { unknown: 'strip' });
      assert.deepEqual(stripped.value, { inner: { a: 'x' } });
    }
    assert.deepEqual(
      schema.parse({ inner: { a: 'x', total: 2, extra: 1 } }, { unknown: 'strip' }).value,
      { inner: { a: 'x', total: 2 } },
    );
  });

  it('should accept the validate of a nested struct given on the field', () => {
    const outer = Schema.from({
      a: { type: 'schema', schema: { x: 'string' }, validate: (value) => value.x !== 'no' || 'no' },
    });
    assert.equal(typeof outer.fields.a.validate, 'function');
    assert.deepEqual(outer.check({ a: { x: 'no' } }).errors, ['Field "a" no']);
    assert.equal(outer.check({ a: { x: 'yes' } }).valid, true);
    // The field's own validate wins over the one of the definition it holds,
    // as its own parse and serialize do.
    const inner = Schema.from({ x: 'string', validate: () => 'inner' });
    const own = Schema.from({ a: { type: 'schema', schema: inner, validate: () => 'own' } });
    assert.deepEqual(own.check({ a: { x: 'y' } }).errors, ['Field "a" own']);
    const adopted = Schema.from({ a: { type: 'schema', schema: inner } });
    assert.deepEqual(adopted.check({ a: { x: 'y' } }).errors, ['Field "a" inner']);
    const nested = Schema.from({
      a: { type: 'schema', schema: { x: 'string', validate: () => 'in' } },
    });
    assert.deepEqual(nested.check({ a: { x: 'y' } }).errors, ['Field "a" in']);
  });

  it('should accept a field named required in a nested struct', () => {
    // The key of a field and its own definition decide whether it is required;
    // a `required` key inside a nested struct is a field of that struct.
    const schema = Schema.from({
      a: { required: 'boolean', b: 'string' },
      'c?': { required: 'number' },
    });
    assert.equal(schema.fields.a.required, true);
    assert.equal(schema.fields.a.schema.required.type, 'boolean');
    assert.equal(schema.fields.c.required, false);
    assert.equal(schema.check({ a: { required: true, b: 'x' } }).valid, true);
    assert.deepEqual(schema.check({ a: { b: 'x' } }).errors, ['Field "a.required" is required']);
    assert.equal(JSON.stringify(schema).includes('"required":"boolean"'), false);
    // The definition's own `required` still counts, together with the key's.
    assert.equal(Schema.from({ a: { type: 'string', required: false } }).fields.a.required, false);
    assert.equal(
      Schema.from({ 'a?': { type: 'string', required: true } }).fields.a.required,
      false,
    );
    assert.equal(
      Schema.from({ a: { schema: { x: 'string' }, required: false } }).fields.a.required,
      false,
    );
  });
});
