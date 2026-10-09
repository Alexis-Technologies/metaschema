const { test } = require('node:test');
const assert = require('node:assert');

const { Schema } = require('../../index.js');

test('Structs: nested schema', () => {
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
  assert.strictEqual(schema.check(obj).valid, true);
});

test('Structs: nested schema, lost field', () => {
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
  assert.deepStrictEqual(schema.check(obj).errors, [
    'Field "field2.subfield1" is required',
    'Field "field3" is required',
  ]);
});

test('Structs: optional nested struct', () => {
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
  assert.strictEqual(schema.check(obj1).valid, true);

  const obj2 = {
    struct: {
      field: 'value',
    },
  };
  assert.strictEqual(schema.check(obj2).valid, true);
});

test('Structs: optional nested struct base object', () => {
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
  assert.strictEqual(schema.check(obj1).valid, true);

  const obj2 = {
    text: 'abc',
    struct: {
      field: 'value',
    },
  };
  assert.strictEqual(schema.check(obj2).valid, true);
});

test('Structs: shorthand for optional nested struct', () => {
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
  assert.strictEqual(schema.check(obj1).valid, true);

  const obj2 = {
    struct: {
      field: 'value',
    },
  };
  assert.strictEqual(schema.check(obj2).valid, true);
});

test('Structs: multiple optional nested struct', () => {
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

  assert.strictEqual(
    schema.check({
      field: 'abc',
      data: {
        nfield1: { text: 'abc' },
      },
    }).valid,
    true,
  );

  assert.strictEqual(
    schema.check({
      field: 'abc',
      data: {
        nfield1: { text: 'abc' },
        nfield2: { text: 'aaa' },
      },
    }).valid,
    true,
  );

  assert.strictEqual(
    schema.check({
      field: 'abc',
      data: {
        nfield1: { text: 'abc' },
        nfield2: { text: 'aaa', caption: 'caption' },
      },
    }).valid,
    true,
  );

  assert.deepStrictEqual(
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

test('Structs: nested schemas with Schema instances', () => {
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
  assert.strictEqual(schema.check(obj).valid, true);
});

test('Struct: json type as any plain object', () => {
  const defs = { name: 'json' };
  const schema = Schema.from(defs);
  assert.strictEqual(schema.check({ name: {} }).valid, true);
  assert.strictEqual(schema.check({ name: { a: 'b' } }).valid, true);
  assert.strictEqual(schema.check({ name: [] }).valid, true);
  assert.strictEqual(schema.check({ name: null }).valid, false);
});

test('Structs: every optional nested struct form accepts a missing or null value', () => {
  const address = { city: 'string' };
  const definitions = [
    { 'address?': address },
    { address: { type: 'schema', schema: address, required: false } },
    { 'address?': Schema.from(address) },
    { address: { type: 'schema', schema: Schema.from(address), required: false } },
  ];
  for (const definition of definitions) {
    const schema = Schema.from(definition);
    assert.strictEqual(schema.fields.address.required, false);
    assert.deepStrictEqual(schema.check({}).errors, []);
    assert.deepStrictEqual(schema.check({ address: null }).errors, []);
    assert.deepStrictEqual(schema.check({ address: { city: 1 } }).errors, [
      'Field "address.city" not of expected type: string',
    ]);
  }
});

test('Structs: a nested struct is required unless marked optional', () => {
  const address = { city: 'string' };
  for (const definition of [
    { address },
    { address: { type: 'schema', schema: address } },
    { address: { type: 'schema', schema: address, required: true } },
  ]) {
    const schema = Schema.from(definition);
    assert.strictEqual(schema.fields.address.required, true);
    assert.deepStrictEqual(schema.check({}).errors, ['Field "address" is required']);
  }
});

test('Structs: optional nested struct as a collection element', () => {
  const item = { city: 'string' };
  const optional = { type: 'schema', schema: item, required: false };

  const list = Schema.from({ list: { array: optional } });
  assert.strictEqual(list.fields.list.value.required, false);
  assert.deepStrictEqual(list.check({ list: [null, { city: 'Kyiv' }] }).errors, []);
  assert.deepStrictEqual(list.check({ list: [null, { city: 1 }] }).errors, [
    'Field "list[1].city" not of expected type: string',
  ]);

  const byId = Schema.from({ byId: { object: { string: optional } } });
  assert.deepStrictEqual(byId.check({ byId: { a: null, b: { city: 'Lviv' } } }).errors, []);

  const required = Schema.from({ list: { array: item } });
  assert.strictEqual(required.fields.list.value.required, true);
  assert.strictEqual(required.check({ list: [null] }).valid, false);
});

test('Structs: a schema type without a schema definition throws a clear error', () => {
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
  assert.strictEqual(
    Schema.from({ data: { schema: { city: 'string' } } }).check({ data: { city: 'Lviv' } }).valid,
    true,
  );
});

test('Structs: field names may collide with Object.prototype and struct internals', () => {
  const schema = Schema.from({
    check: 'string',
    name: 'string',
    constructor: 'number',
    toString: '?string',
    hasOwnProperty: 'boolean',
  });
  assert.deepStrictEqual(Object.keys(schema.fields), [
    'check',
    'name',
    'constructor',
    'toString',
    'hasOwnProperty',
  ]);
  const valid = { check: 'x', name: 'y', constructor: 1, hasOwnProperty: true };
  assert.strictEqual(schema.check(valid).valid, true);
  const invalid = { check: 1, name: 'y', constructor: 'no', hasOwnProperty: true };
  assert.deepStrictEqual(schema.check(invalid).errors, [
    'Field "check" not of expected type: string',
    'Field "constructor" not of expected type: number',
  ]);
});

test('Structs: a value that is not an object is a type error', () => {
  assert.deepStrictEqual(Schema.from({ name: 'string' }).check(5).errors, [
    'Field "" not of expected type: object',
  ]);
  assert.deepStrictEqual(new Schema('User', { name: 'string' }).check('x').errors, [
    'Field "User" not of expected type: object',
  ]);
  assert.deepStrictEqual(Schema.from({ inner: { name: 'string' } }).check({ inner: 5 }).errors, [
    'Field "inner" not of expected type: object',
  ]);
});

test('Structs: input keys from Object.prototype are not expected', () => {
  const schema = Schema.from({ name: 'string' });
  const input = JSON.parse(
    '{"name":"x","constructor":1,"__proto__":{"z":1},"check":1,"toString":2,"hasOwnProperty":3}',
  );
  const result = schema.check(input);
  assert.deepStrictEqual(result.errors, [
    'Field "" has unexpected keys: constructor, __proto__, check, toString, hasOwnProperty',
  ]);
  assert.deepStrictEqual(result.issues[0].params.keys, [
    'constructor',
    '__proto__',
    'check',
    'toString',
    'hasOwnProperty',
  ]);
});

test('Structs: fields enumerate and serialize as plain data', () => {
  const schema = Schema.from({ name: 'string', age: '?number', half: (value) => value.age / 2 });
  assert.deepStrictEqual(Object.keys(schema.fields), ['name', 'age', 'half']);
  assert.strictEqual(typeof schema.fields.half, 'function');
  assert.strictEqual(
    JSON.stringify(schema),
    '{"name":{"required":true,"type":"string"},"age":{"required":false,"type":"number"}}',
  );
  assert.strictEqual(schema.check({ name: 'x' }).valid, true);
});
