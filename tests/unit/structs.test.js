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
