const { test } = require('node:test');
const assert = require('node:assert');
const util = require('node:util');

const { Schema, Model } = require('../../index.js');
const generators = require('@alexify/metaschema/generators');

const { toJSONSchema, toTypeScript, saveTypes, register } = generators;

const entities = [
  ['Tag', { Struct: {}, label: 'string' }],
  ['Post', { Entity: {}, title: 'string', tags: { many: 'Tag' }, kind: { enum: ['a', 'b'] } }],
];

test('Generators: the functions take a Schema or a Model', () => {
  const schema = new Schema('User', { name: 'string', 'age?': 'number' });
  const model = new Model({}, entities);
  assert.deepStrictEqual(toJSONSchema(schema), {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: { name: { type: 'string' }, age: { type: ['number', 'null'] } },
    required: ['name'],
    additionalProperties: false,
  });
  assert.deepStrictEqual(Object.keys(toJSONSchema(model).$defs), ['Tag', 'Post']);
  assert.strictEqual(toJSONSchema(model, { root: 'Post' }).type, 'object');
  assert.strictEqual(
    toJSONSchema(model.entities.get('Post'), { target: 'mongodb' }).bsonType,
    'object',
  );
  assert.strictEqual(toTypeScript(schema), 'interface User {\n  name: string;\n  age?: number;\n}');
  assert.strictEqual(toTypeScript(model).startsWith('interface Tag {'), true);
  assert.strictEqual(toTypeScript(model).endsWith('}\n'), true);
  assert.strictEqual(
    toTypeScript(model, { named: true }).includes('type PostKind = "a" | "b";'),
    true,
  );
  assert.strictEqual(typeof saveTypes, 'function');
  for (const target of [{}, null, 'User', { entities: new Map() }, Schema]) {
    assert.throws(() => toJSONSchema(target), {
      name: 'TypeError',
      message: 'A Schema or a Model is expected',
    });
    assert.throws(() => toTypeScript(target), {
      name: 'TypeError',
      message: 'A Schema or a Model is expected',
    });
  }
});

test('Generators: the core has no methods and no converter until register()', () => {
  const schema = Schema.from({ name: 'string' });
  const model = new Model({}, entities);
  assert.strictEqual(schema.toJSONSchema, undefined);
  assert.strictEqual(schema.toInterface, undefined);
  assert.strictEqual(model.toJSONSchema, undefined);
  assert.strictEqual(model.toTypeScript, undefined);
  assert.strictEqual(model.dts, undefined);
  assert.deepStrictEqual(Object.keys(schema['~standard']), ['version', 'vendor', 'validate']);
  assert.strictEqual('saveTypes' in require('../../index.js'), false);
});

test('Generators: register() installs the methods and the converter, once', () => {
  const before = Schema.from({ name: 'string' });
  const props = before['~standard'];
  register();
  register();
  const schema = new Schema('User', { name: 'string', kind: { enum: ['a'] } });
  const model = new Model({}, entities);
  assert.deepStrictEqual(schema.toJSONSchema(), toJSONSchema(schema));
  assert.deepStrictEqual(
    schema.toJSONSchema({ target: 'draft-07' }),
    toJSONSchema(schema, { target: 'draft-07' }),
  );
  assert.strictEqual(schema.toInterface(), toTypeScript(schema));
  assert.strictEqual(schema.toInterface({ named: true }), toTypeScript(schema, { named: true }));
  assert.deepStrictEqual(
    model.toJSONSchema({ root: 'Post' }),
    toJSONSchema(model, { root: 'Post' }),
  );
  assert.strictEqual(model.toTypeScript({ named: true }), toTypeScript(model, { named: true }));
  assert.strictEqual(model.dts, toTypeScript(model));
  // The converter of Standard JSON Schema, built once per schema, on the
  // props the core built before registration too.
  assert.deepStrictEqual(Object.keys(schema['~standard']), [
    'version',
    'vendor',
    'validate',
    'jsonSchema',
  ]);
  assert.strictEqual(schema['~standard'].jsonSchema, schema['~standard'].jsonSchema);
  assert.deepStrictEqual(Object.keys(schema['~standard'].jsonSchema), ['input', 'output']);
  assert.deepStrictEqual(
    schema['~standard'].jsonSchema.input({ target: 'draft-07' }),
    toJSONSchema(schema, { target: 'draft-07' }),
  );
  assert.strictEqual(before['~standard'], props);
  assert.strictEqual(typeof props.jsonSchema.output, 'function');
  // Installed like class members: not enumerable, not own, invisible to
  // toJSON and inspect.
  for (const name of ['toJSONSchema', 'toInterface']) {
    const descriptor = Object.getOwnPropertyDescriptor(Schema.prototype, name);
    assert.strictEqual(descriptor.enumerable, false);
    assert.strictEqual(Object.hasOwn(schema, name), false);
  }
  for (const name of ['toJSONSchema', 'toTypeScript', 'dts']) {
    assert.strictEqual(Object.getOwnPropertyDescriptor(Model.prototype, name).enumerable, false);
  }
  const enumerated = [];
  for (const key in schema) enumerated.push(key);
  assert.strictEqual(
    enumerated.some((key) => key.startsWith('to') || key === '~standard'),
    false,
  );
  assert.deepStrictEqual(Object.keys(JSON.parse(JSON.stringify(schema))), ['name', 'kind']);
  assert.strictEqual(util.inspect(schema).includes('toJSONSchema'), false);
  const standard = Object.getOwnPropertyDescriptor(Schema.prototype, '~standard');
  assert.strictEqual(standard.enumerable, false);
  assert.strictEqual(typeof standard.get, 'function');
});
