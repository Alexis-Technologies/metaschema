const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const util = require('node:util');

const { Schema, Model } = require('../../index.js');
const generators = require('@alexify/metaschema/generators');

const { toJSONSchema, toTypeScript, saveTypes, register } = generators;

const entities = [
  ['Tag', { Struct: {}, label: 'string' }],
  ['Post', { Entity: {}, title: 'string', tags: { many: 'Tag' }, kind: { enum: ['a', 'b'] } }],
];

describe('Generators', () => {
  it('should render a Schema or a Model through the functions of the subpath', () => {
    const schema = new Schema('User', { name: 'string', 'age?': 'number' });
    const model = new Model({}, entities);
    assert.deepEqual(toJSONSchema(schema), {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: { name: { type: 'string' }, age: { type: ['number', 'null'] } },
      required: ['name'],
      additionalProperties: false,
    });
    assert.deepEqual(Object.keys(toJSONSchema(model).$defs), ['Tag', 'Post']);
    assert.equal(toJSONSchema(model, { root: 'Post' }).type, 'object');
    assert.equal(
      toJSONSchema(model.entities.get('Post'), { target: 'mongodb' }).bsonType,
      'object',
    );
    assert.equal(toTypeScript(schema), 'interface User {\n  name: string;\n  age?: number;\n}');
    assert.equal(toTypeScript(model).startsWith('interface Tag {'), true);
    assert.equal(toTypeScript(model).endsWith('}\n'), true);
    assert.equal(toTypeScript(model, { named: true }).includes('type PostKind = "a" | "b";'), true);
    assert.equal(typeof saveTypes, 'function');
    assert.equal(typeof generators.fromJSONSchema, 'function');
    for (const target of [{}, null, 'User', { entities: new Map() }, Schema]) {
      assert.throws(() => toJSONSchema(target), {
        name: 'SchemaUsageError',
        code: 'ALX_ERR_INVALID_TARGET',
        message: 'A Schema or a Model is expected',
      });
      assert.throws(() => toTypeScript(target), {
        name: 'SchemaUsageError',
        code: 'ALX_ERR_INVALID_TARGET',
        message: 'A Schema or a Model is expected',
      });
    }
  });

  it('should leave the core without methods and a converter until register()', () => {
    const schema = Schema.from({ name: 'string' });
    const model = new Model({}, entities);
    assert.equal(schema.toJSONSchema, undefined);
    assert.equal(schema.toInterface, undefined);
    assert.equal(model.toJSONSchema, undefined);
    assert.equal(model.toTypeScript, undefined);
    assert.equal(model.dts, undefined);
    assert.equal(Schema.fromJSONSchema, undefined);
    assert.deepEqual(Object.keys(schema['~standard']), ['version', 'vendor', 'validate']);
    assert.equal('saveTypes' in require('../../index.js'), false);
  });

  it('should install the methods and the converter once with register()', () => {
    const before = Schema.from({ name: 'string' });
    const props = before['~standard'];
    register();
    register();
    const schema = new Schema('User', { name: 'string', kind: { enum: ['a'] } });
    const model = new Model({}, entities);
    assert.deepEqual(schema.toJSONSchema(), toJSONSchema(schema));
    assert.deepEqual(
      schema.toJSONSchema({ target: 'draft-07' }),
      toJSONSchema(schema, { target: 'draft-07' }),
    );
    assert.equal(schema.toInterface(), toTypeScript(schema));
    assert.equal(schema.toInterface({ named: true }), toTypeScript(schema, { named: true }));
    assert.deepEqual(model.toJSONSchema({ root: 'Post' }), toJSONSchema(model, { root: 'Post' }));
    assert.equal(model.toTypeScript({ named: true }), toTypeScript(model, { named: true }));
    assert.equal(model.dts, toTypeScript(model));
    assert.equal(Schema.fromJSONSchema, generators.fromJSONSchema);
    assert.equal(Object.getOwnPropertyDescriptor(Schema, 'fromJSONSchema').enumerable, false);
    // The converter of Standard JSON Schema, built once per schema, on the
    // props the core built before registration too.
    assert.deepEqual(Object.keys(schema['~standard']), [
      'version',
      'vendor',
      'validate',
      'jsonSchema',
    ]);
    assert.equal(schema['~standard'].jsonSchema, schema['~standard'].jsonSchema);
    assert.deepEqual(Object.keys(schema['~standard'].jsonSchema), ['input', 'output']);
    assert.deepEqual(
      schema['~standard'].jsonSchema.input({ target: 'draft-07' }),
      toJSONSchema(schema, { target: 'draft-07' }),
    );
    assert.equal(before['~standard'], props);
    assert.equal(typeof props.jsonSchema.output, 'function');
    // Installed like class members: not enumerable, not own, invisible to
    // toJSON and inspect.
    for (const name of ['toJSONSchema', 'toInterface']) {
      const descriptor = Object.getOwnPropertyDescriptor(Schema.prototype, name);
      assert.equal(descriptor.enumerable, false);
      assert.equal(Object.hasOwn(schema, name), false);
    }
    for (const name of ['toJSONSchema', 'toTypeScript', 'dts']) {
      assert.equal(Object.getOwnPropertyDescriptor(Model.prototype, name).enumerable, false);
    }
    const enumerated = [];
    for (const key in schema) enumerated.push(key);
    assert.equal(
      enumerated.some((key) => key.startsWith('to') || key === '~standard'),
      false,
    );
    assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(schema))), ['name', 'kind']);
    assert.equal(util.inspect(schema).includes('toJSONSchema'), false);
    const standard = Object.getOwnPropertyDescriptor(Schema.prototype, '~standard');
    assert.equal(standard.enumerable, false);
    assert.equal(typeof standard.get, 'function');
  });
});
