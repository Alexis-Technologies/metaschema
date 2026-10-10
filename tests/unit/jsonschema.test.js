const { test } = require('node:test');
const assert = require('node:assert');

const { Schema, Model, SchemaDefinitionError } = require('../../index.js');
const { database, types: customTypes, ...entities } = require('../fixtures/schemas/index.js');

const DRAFT_2020 = 'https://json-schema.org/draft/2020-12/schema';
const DRAFT_07 = 'http://json-schema.org/draft-07/schema#';

const TARGETS = ['draft-2020-12', 'draft-07', 'openapi-3.0', 'mongodb'];

// The key of every stored MongoDB document.
const ID = '_id';

// The JSON Schema of one field, by target: the document of `{ x: def }`
// without its envelope, so a test reads the mapping of the field alone.
const fieldOf = (def, options = {}) => {
  const document = Schema.from({ x: def }).toJSONSchema(options);
  return document.properties.x;
};

const forEveryTarget = (def, options, expected) => {
  for (const target of TARGETS) {
    const json = fieldOf(def, { ...options, target });
    assert.deepStrictEqual(json, expected[target], target);
  }
};

test('JSON Schema: the envelope of a struct by target', () => {
  const schema = new Schema('User', { name: 'string', 'age?': 'number' });
  const properties = {
    name: { type: 'string' },
    age: { type: ['number', 'null'] },
  };
  assert.deepStrictEqual(schema.toJSONSchema(), {
    $schema: DRAFT_2020,
    type: 'object',
    properties,
    required: ['name'],
    additionalProperties: false,
  });
  assert.deepStrictEqual(Object.keys(schema.toJSONSchema()), [
    '$schema',
    'type',
    'properties',
    'required',
    'additionalProperties',
  ]);
  assert.deepStrictEqual(schema.toJSONSchema({ target: 'draft-07' }), {
    $schema: DRAFT_07,
    type: 'object',
    properties,
    required: ['name'],
    additionalProperties: false,
  });
  assert.deepStrictEqual(schema.toJSONSchema({ target: 'openapi-3.0' }), {
    type: 'object',
    properties: { name: { type: 'string' }, age: { type: 'number', nullable: true } },
    required: ['name'],
    additionalProperties: false,
  });
  assert.deepStrictEqual(schema.toJSONSchema({ target: 'mongodb' }), {
    bsonType: 'object',
    properties: {
      name: { bsonType: 'string' },
      age: { bsonType: ['number', 'null'] },
      _id: {},
    },
    required: ['name'],
    additionalProperties: false,
  });
  // The same document from a call without options and with an empty object.
  assert.deepStrictEqual(schema.toJSONSchema({}), schema.toJSONSchema());
});

test('JSON Schema: a schema of one type, and optional and nullable roots', () => {
  assert.deepStrictEqual(Schema.from('string').toJSONSchema(), {
    $schema: DRAFT_2020,
    type: 'string',
  });
  assert.deepStrictEqual(Schema.from('?string').toJSONSchema({ target: 'openapi-3.0' }), {
    type: 'string',
    nullable: true,
  });
  assert.deepStrictEqual(Schema.from({ array: 'number' }).toJSONSchema({ target: 'mongodb' }), {
    bsonType: 'array',
    items: { bsonType: 'number' },
  });
  assert.deepStrictEqual(Schema.from({ type: 'number', nullable: true }).toJSONSchema(), {
    $schema: DRAFT_2020,
    type: ['number', 'null'],
  });
});

test('JSON Schema: scalars', () => {
  forEveryTarget(
    'string',
    {},
    {
      'draft-2020-12': { type: 'string' },
      'draft-07': { type: 'string' },
      'openapi-3.0': { type: 'string' },
      mongodb: { bsonType: 'string' },
    },
  );
  forEveryTarget(
    'number',
    {},
    {
      'draft-2020-12': { type: 'number' },
      'draft-07': { type: 'number' },
      'openapi-3.0': { type: 'number' },
      mongodb: { bsonType: 'number' },
    },
  );
  forEveryTarget(
    'integer',
    {},
    {
      'draft-2020-12': { type: 'integer' },
      'draft-07': { type: 'integer' },
      'openapi-3.0': { type: 'integer' },
      mongodb: { bsonType: ['int', 'long'] },
    },
  );
  forEveryTarget(
    'boolean',
    {},
    {
      'draft-2020-12': { type: 'boolean' },
      'draft-07': { type: 'boolean' },
      'openapi-3.0': { type: 'boolean' },
      mongodb: { bsonType: 'bool' },
    },
  );
  forEveryTarget(
    'null',
    {},
    {
      'draft-2020-12': { type: 'null' },
      'draft-07': { type: 'null' },
      'openapi-3.0': { type: 'null' },
      mongodb: { bsonType: 'null' },
    },
  );
  for (const type of ['any', 'unknown']) {
    forEveryTarget(
      type,
      {},
      {
        'draft-2020-12': {},
        'draft-07': {},
        'openapi-3.0': {},
        mongodb: {},
      },
    );
  }
  forEveryTarget(
    'json',
    {},
    {
      'draft-2020-12': { type: ['object', 'array'] },
      'draft-07': { type: ['object', 'array'] },
      'openapi-3.0': { type: ['object', 'array'] },
      mongodb: { bsonType: ['object', 'array'] },
    },
  );
  // A date is a date-time string on the wire, a BSON date in a document,
  // and a Date instance (no JSON form) on the way out.
  forEveryTarget(
    'date',
    {},
    {
      'draft-2020-12': { type: 'string', format: 'date-time' },
      'draft-07': { type: 'string', format: 'date-time' },
      'openapi-3.0': { type: 'string', format: 'date-time' },
      mongodb: { bsonType: 'date' },
    },
  );
  assert.deepStrictEqual(fieldOf('date', { io: 'output', target: 'mongodb' }), {
    bsonType: 'date',
  });
  assert.throws(() => fieldOf('date', { io: 'output' }), {
    name: 'SchemaDefinitionError',
    code: 'ERR_UNREPRESENTABLE',
    message:
      'Type "date" (output) cannot be represented in JSON Schema target "draft-2020-12" in "x"',
    schema: '',
    field: 'x',
  });
  // A bigint has no JSON form; BSON has a 64-bit integer.
  assert.deepStrictEqual(fieldOf('bigint', { target: 'mongodb' }), { bsonType: 'long' });
  for (const target of ['draft-2020-12', 'draft-07', 'openapi-3.0']) {
    assert.throws(() => fieldOf('bigint', { target }), {
      code: 'ERR_UNREPRESENTABLE',
      message: `Type "bigint" cannot be represented in JSON Schema target "${target}" in "x"`,
    });
    assert.deepStrictEqual(fieldOf('bigint', { target, unrepresentable: 'any' }), {});
  }
});

test('JSON Schema: rules of strings and numbers', () => {
  const string = { type: 'string', length: { min: 3, max: 32 }, pattern: /^[a-z]+$/i };
  forEveryTarget(
    string,
    {},
    {
      'draft-2020-12': { type: 'string', minLength: 3, maxLength: 32, pattern: '^[a-z]+$' },
      'draft-07': { type: 'string', minLength: 3, maxLength: 32, pattern: '^[a-z]+$' },
      'openapi-3.0': { type: 'string', minLength: 3, maxLength: 32, pattern: '^[a-z]+$' },
      mongodb: { bsonType: 'string', minLength: 3, maxLength: 32, pattern: '^[a-z]+$' },
    },
  );
  assert.deepStrictEqual(fieldOf({ type: 'string', length: 10 }), {
    type: 'string',
    maxLength: 10,
  });
  assert.deepStrictEqual(fieldOf({ type: 'string', length: [2] }), {
    type: 'string',
    minLength: 2,
  });
  assert.deepStrictEqual(fieldOf({ type: 'string', pattern: '\\d+' }), {
    type: 'string',
    pattern: '\\d+',
  });
  assert.deepStrictEqual(fieldOf({ type: 'number', min: 1, max: 5.5 }), {
    type: 'number',
    minimum: 1,
    maximum: 5.5,
  });
  assert.deepStrictEqual(fieldOf({ type: 'integer', min: 18 }), { type: 'integer', minimum: 18 });
  assert.deepStrictEqual(fieldOf({ type: 'integer', max: 120 }, { target: 'mongodb' }), {
    bsonType: ['int', 'long'],
    maximum: 120,
  });
  // A bigint bound of a number is written as a number.
  assert.deepStrictEqual(fieldOf({ type: 'number', min: 1n, max: 9n }), {
    type: 'number',
    minimum: 1,
    maximum: 9,
  });
});

test('JSON Schema: enum', () => {
  forEveryTarget(
    { enum: ['a', 'b', 1, null] },
    {},
    {
      'draft-2020-12': { enum: ['a', 'b', 1, null] },
      'draft-07': { enum: ['a', 'b', 1, null] },
      'openapi-3.0': { enum: ['a', 'b', 1, null] },
      mongodb: { enum: ['a', 'b', 1, null] },
    },
  );
  // A single value is a const where the dialect has it.
  forEveryTarget(
    { enum: ['only'] },
    {},
    {
      'draft-2020-12': { const: 'only' },
      'draft-07': { const: 'only' },
      'openapi-3.0': { enum: ['only'] },
      mongodb: { enum: ['only'] },
    },
  );
  // The values are copied, not shared with the field.
  const schema = Schema.from({ x: { enum: ['a'] } });
  const json = schema.toJSONSchema({ target: 'mongodb' });
  json.properties.x.enum.push('b');
  assert.deepStrictEqual(schema.fields.x.enum, ['a']);
  assert.throws(() => fieldOf({ enum: [1n] }), {
    code: 'ERR_UNREPRESENTABLE',
    message: 'Enum value 1 cannot be represented in JSON Schema target "draft-2020-12" in "x"',
  });
  assert.throws(() => fieldOf({ enum: ['a', { b: 1 }] }), { code: 'ERR_UNREPRESENTABLE' });
});

test('JSON Schema: optional and nullable fields accept null', () => {
  for (const def of ['?string', { type: 'string', required: false }]) {
    forEveryTarget(
      def,
      {},
      {
        'draft-2020-12': { type: ['string', 'null'] },
        'draft-07': { type: ['string', 'null'] },
        'openapi-3.0': { type: 'string', nullable: true },
        mongodb: { bsonType: ['string', 'null'] },
      },
    );
  }
  assert.deepStrictEqual(fieldOf({ type: 'string', nullable: true }), { type: ['string', 'null'] });
  const nullable = Schema.from({ x: { type: 'string', nullable: true } }).toJSONSchema();
  assert.deepStrictEqual(nullable.required, ['x']);
  // Null itself, and a type that already allows everything, stay as they are.
  assert.deepStrictEqual(fieldOf('?null'), { type: 'null' });
  assert.deepStrictEqual(fieldOf('?any'), {});
  assert.deepStrictEqual(fieldOf('?json'), { type: ['object', 'array', 'null'] });
  assert.deepStrictEqual(fieldOf({ type: 'integer', required: false }, { target: 'mongodb' }), {
    bsonType: ['int', 'long', 'null'],
  });
  // An enum takes null as a value; a const becomes an enum.
  forEveryTarget(
    { enum: ['a', 'b'], required: false },
    {},
    {
      'draft-2020-12': { enum: ['a', 'b', null] },
      'draft-07': { enum: ['a', 'b', null] },
      'openapi-3.0': { enum: ['a', 'b', null], nullable: true },
      mongodb: { enum: ['a', 'b', null] },
    },
  );
  assert.deepStrictEqual(fieldOf({ enum: ['a', null], required: false }), { enum: ['a', null] });
  assert.deepStrictEqual(fieldOf({ enum: ['a'], required: false }), { enum: ['a', null] });
  // A union gains a null branch; anything else goes into an anyOf.
  assert.deepStrictEqual(fieldOf({ union: ['string', 'number'], required: false }), {
    anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }],
  });
  assert.deepStrictEqual(
    fieldOf({ union: ['string', 'number'], required: false }, { target: 'mongodb' }),
    {
      anyOf: [{ bsonType: 'string' }, { bsonType: 'number' }, { bsonType: 'null' }],
    },
  );
  assert.deepStrictEqual(
    fieldOf({ union: ['string', 'number'], required: false }, { target: 'openapi-3.0' }),
    { anyOf: [{ type: 'string' }, { type: 'number' }], nullable: true },
  );
  assert.deepStrictEqual(
    fieldOf(
      {
        union: [{ kind: { enum: ['a'] } }, { kind: { enum: ['b'] } }],
        discriminator: 'kind',
        required: false,
      },
      { target: 'openapi-3.0' },
    ),
    {
      oneOf: [
        {
          type: 'object',
          properties: { kind: { enum: ['a'] } },
          required: ['kind'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: { kind: { enum: ['b'] } },
          required: ['kind'],
          additionalProperties: false,
        },
      ],
      discriminator: { propertyName: 'kind' },
      nullable: true,
    },
  );
});

test('JSON Schema: collections', () => {
  forEveryTarget(
    { array: 'number' },
    {},
    {
      'draft-2020-12': { type: 'array', items: { type: 'number' } },
      'draft-07': { type: 'array', items: { type: 'number' } },
      'openapi-3.0': { type: 'array', items: { type: 'number' } },
      mongodb: { bsonType: 'array', items: { bsonType: 'number' } },
    },
  );
  assert.deepStrictEqual(fieldOf({ type: 'array', value: '?string', length: [1, 3] }), {
    type: 'array',
    items: { type: ['string', 'null'] },
    minItems: 1,
    maxItems: 3,
  });
  // A Set is unique items on the wire and has no JSON or BSON form itself.
  assert.deepStrictEqual(fieldOf({ set: 'string' }), {
    type: 'array',
    items: { type: 'string' },
    uniqueItems: true,
  });
  assert.deepStrictEqual(fieldOf({ set: 'string' }, { target: 'openapi-3.0' }), {
    type: 'array',
    items: { type: 'string' },
    uniqueItems: true,
  });
  assert.throws(() => fieldOf({ set: 'string' }, { io: 'output' }), {
    code: 'ERR_UNREPRESENTABLE',
    message: 'Type "set" cannot be represented in JSON Schema target "draft-2020-12" in "x"',
  });
  assert.throws(() => fieldOf({ set: 'string' }, { target: 'mongodb' }), {
    code: 'ERR_UNREPRESENTABLE',
  });
  // An object of free keys: a required one must not be empty, as in check.
  forEveryTarget(
    { object: { string: 'number' } },
    {},
    {
      'draft-2020-12': {
        type: 'object',
        additionalProperties: { type: 'number' },
        minProperties: 1,
      },
      'draft-07': { type: 'object', additionalProperties: { type: 'number' }, minProperties: 1 },
      'openapi-3.0': { type: 'object', additionalProperties: { type: 'number' }, minProperties: 1 },
      mongodb: {
        bsonType: 'object',
        additionalProperties: { bsonType: 'number' },
        minProperties: 1,
      },
    },
  );
  assert.deepStrictEqual(fieldOf({ object: { string: 'number' }, required: false }), {
    type: ['object', 'null'],
    additionalProperties: { type: 'number' },
  });
  assert.deepStrictEqual(
    fieldOf({ type: 'object', key: 'string', value: 'number', length: { min: 2, max: 4 } }),
    {
      type: 'object',
      additionalProperties: { type: 'number' },
      minProperties: 2,
      maxProperties: 4,
    },
  );
  assert.deepStrictEqual(
    fieldOf({ type: 'object', key: 'string', value: 'number', length: [0, 4] }),
    {
      type: 'object',
      additionalProperties: { type: 'number' },
      minProperties: 1,
      maxProperties: 4,
    },
  );
  // A number key is a pattern where propertyNames exists.
  forEveryTarget(
    { map: { number: 'boolean' } },
    {},
    {
      'draft-2020-12': {
        type: 'object',
        additionalProperties: { type: 'boolean' },
        propertyNames: { pattern: '^-?\\d+(\\.\\d+)?$' },
        minProperties: 1,
      },
      'draft-07': {
        type: 'object',
        additionalProperties: { type: 'boolean' },
        propertyNames: { pattern: '^-?\\d+(\\.\\d+)?$' },
        minProperties: 1,
      },
      'openapi-3.0': {
        type: 'object',
        additionalProperties: { type: 'boolean' },
        minProperties: 1,
      },
      mongodb: {
        bsonType: 'object',
        additionalProperties: { bsonType: 'bool' },
        minProperties: 1,
      },
    },
  );
  assert.throws(() => fieldOf({ map: { string: 'boolean' } }, { io: 'output' }), {
    code: 'ERR_UNREPRESENTABLE',
    message:
      'Type "map" (output) cannot be represented in JSON Schema target "draft-2020-12" in "x"',
  });
});

test('JSON Schema: tuples', () => {
  const point = ['number', { 'label?': 'string' }];
  forEveryTarget(
    point,
    { unrepresentable: 'any' },
    {
      'draft-2020-12': {
        type: 'array',
        prefixItems: [{ type: 'number' }, { type: ['string', 'null'] }],
        items: false,
        minItems: 1,
      },
      'draft-07': {
        type: 'array',
        items: [{ type: 'number' }, { type: ['string', 'null'] }],
        additionalItems: false,
        minItems: 1,
      },
      'openapi-3.0': {},
      mongodb: {
        bsonType: 'array',
        items: [{ bsonType: 'number' }, { bsonType: ['string', 'null'] }],
        additionalItems: false,
        minItems: 1,
      },
    },
  );
  assert.throws(() => fieldOf(point, { target: 'openapi-3.0' }), {
    code: 'ERR_UNREPRESENTABLE',
    message: 'Type "tuple" cannot be represented in JSON Schema target "openapi-3.0" in "x"',
  });
  // The elements up to the last required one must be there.
  assert.deepStrictEqual(fieldOf([{ 'x?': 'number' }, 'number']).minItems, 2);
  assert.strictEqual(fieldOf([{ 'x?': 'number' }, '?number']).minItems, undefined);
  assert.deepStrictEqual(fieldOf([{ a: 'string', b: 'number' }]).prefixItems, [
    {
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number' } },
      required: ['a', 'b'],
      additionalProperties: false,
    },
  ]);
});

test('JSON Schema: unions', () => {
  forEveryTarget(
    { union: ['string', { n: 'number' }] },
    {},
    {
      'draft-2020-12': {
        anyOf: [
          { type: 'string' },
          {
            type: 'object',
            properties: { n: { type: 'number' } },
            required: ['n'],
            additionalProperties: false,
          },
        ],
      },
      'draft-07': {
        anyOf: [
          { type: 'string' },
          {
            type: 'object',
            properties: { n: { type: 'number' } },
            required: ['n'],
            additionalProperties: false,
          },
        ],
      },
      'openapi-3.0': {
        anyOf: [
          { type: 'string' },
          {
            type: 'object',
            properties: { n: { type: 'number' } },
            required: ['n'],
            additionalProperties: false,
          },
        ],
      },
      mongodb: {
        anyOf: [
          { bsonType: 'string' },
          {
            bsonType: 'object',
            properties: { n: { bsonType: 'number' } },
            required: ['n'],
            additionalProperties: false,
          },
        ],
      },
    },
  );
  // A discriminated union is an anyOf of its branches, a oneOf with the
  // discriminator for OpenAPI.
  const shapes = {
    union: [
      { kind: { enum: ['circle'] }, r: 'number' },
      { kind: { enum: ['square'] }, side: 'number' },
    ],
    discriminator: 'kind',
  };
  const circle = {
    type: 'object',
    properties: { kind: { const: 'circle' }, r: { type: 'number' } },
    required: ['kind', 'r'],
    additionalProperties: false,
  };
  const square = {
    type: 'object',
    properties: { kind: { const: 'square' }, side: { type: 'number' } },
    required: ['kind', 'side'],
    additionalProperties: false,
  };
  assert.deepStrictEqual(fieldOf(shapes), { anyOf: [circle, square] });
  const openapi = fieldOf(shapes, { target: 'openapi-3.0' });
  assert.deepStrictEqual(Object.keys(openapi), ['oneOf', 'discriminator']);
  assert.deepStrictEqual(openapi.discriminator, { propertyName: 'kind' });
  assert.deepStrictEqual(openapi.oneOf[0].properties.kind, { enum: ['circle'] });
});

test('JSON Schema: nested structs, schema fields and Schema instances', () => {
  const address = { city: 'string', 'zip?': 'string' };
  const expected = {
    type: 'object',
    properties: { city: { type: 'string' }, zip: { type: ['string', 'null'] } },
    required: ['city'],
    additionalProperties: false,
  };
  assert.deepStrictEqual(fieldOf(address), expected);
  assert.deepStrictEqual(fieldOf({ schema: address }), expected);
  assert.deepStrictEqual(fieldOf({ type: 'schema', schema: address, required: false }), {
    ...expected,
    type: ['object', 'null'],
  });
  const instance = Schema.from(address);
  assert.deepStrictEqual(fieldOf(instance), expected);
  assert.deepStrictEqual(fieldOf({ schema: instance }), expected);
  // A Schema instance of one type as a field.
  assert.deepStrictEqual(fieldOf({ schema: Schema.from('?number') }), { type: ['number', 'null'] });
  // A calculated field, an index and the kind key are not properties.
  const order = new Schema('Order', {
    Entity: {},
    total: 'number',
    double: (value) => value.total * 2,
    byTotal: { index: ['total'] },
  });
  assert.deepStrictEqual(order.toJSONSchema(), {
    $schema: DRAFT_2020,
    type: 'object',
    properties: { total: { type: 'number' }, orderId: { type: ['string', 'null'] } },
    required: ['total'],
    additionalProperties: false,
  });
});

test('JSON Schema: the unknown-keys policy of the root', () => {
  const lenient = Schema.from({
    Form: { unknown: 'ignore' },
    name: 'string',
    part: { a: 'string' },
  });
  const json = lenient.toJSONSchema();
  assert.strictEqual(json.additionalProperties, undefined);
  assert.strictEqual(json.properties.part.additionalProperties, undefined);
  // The root of a mongodb document lets `_id` in only when it is closed.
  const mongo = lenient.toJSONSchema({ target: 'mongodb' });
  assert.strictEqual(mongo.properties[ID], undefined);
  const own = Schema.from({ _id: 'string', name: 'string' }).toJSONSchema({ target: 'mongodb' });
  assert.deepStrictEqual(own.properties[ID], { bsonType: 'string' });
  assert.deepStrictEqual(own.required, ['_id', 'name']);
  // A nested struct does not open the document.
  assert.deepStrictEqual(
    Schema.from({ part: lenient }).toJSONSchema().properties.part.additionalProperties,
    false,
  );
});

test('JSON Schema: annotations pass through by target', () => {
  const def = {
    type: 'string',
    title: 'Login',
    description: 'The login name',
    default: 'guest',
    examples: ['marcus', 'ann'],
    deprecated: true,
  };
  forEveryTarget(
    def,
    {},
    {
      'draft-2020-12': {
        type: 'string',
        title: 'Login',
        description: 'The login name',
        default: 'guest',
        examples: ['marcus', 'ann'],
        deprecated: true,
      },
      'draft-07': {
        type: 'string',
        title: 'Login',
        description: 'The login name',
        default: 'guest',
        examples: ['marcus', 'ann'],
      },
      'openapi-3.0': {
        type: 'string',
        title: 'Login',
        description: 'The login name',
        default: 'guest',
        example: 'marcus',
        deprecated: true,
      },
      mongodb: { bsonType: 'string', title: 'Login', description: 'The login name' },
    },
  );
  assert.deepStrictEqual(fieldOf({ type: 'string', examples: [] }, { target: 'openapi-3.0' }), {
    type: 'string',
  });
  assert.deepStrictEqual(fieldOf({ type: 'string', examples: 'x' }, { target: 'openapi-3.0' }), {
    type: 'string',
  });
  // The annotations sit beside the null of an optional field, on the
  // wrapper of a union.
  assert.deepStrictEqual(fieldOf({ type: 'number', required: false, description: 'd' }), {
    type: ['number', 'null'],
    description: 'd',
  });
  assert.deepStrictEqual(fieldOf({ union: ['string', 'number'], description: 'd' }), {
    anyOf: [{ type: 'string' }, { type: 'number' }],
    description: 'd',
  });
});

test('JSON Schema: custom types through metadata, aliases and js', () => {
  const types = {
    datetime: {
      js: 'string',
      metadata: { jsonSchema: { type: 'string', format: 'date-time' }, bson: 'date' },
    },
    shorttext: { js: 'string' },
    longtext: { js: 'shorttext' },
    ratio: { kind: 'scalar', construct() {}, checkType: () => null, rules: ['length'] },
    money: {
      js: 'ratio',
      metadata: { jsonSchema: { type: 'string', pattern: '^\\d+\\.\\d{2}$' } },
    },
  };
  const model = new Model(types, [
    [
      'Payment',
      {
        Struct: {},
        at: 'datetime',
        note: { type: 'shorttext', length: 10 },
        body: 'longtext',
        amount: { type: 'money', description: 'In cents' },
      },
    ],
  ]);
  const payment = model.entities.get('Payment');
  const json = payment.toJSONSchema();
  assert.deepStrictEqual(json.properties, {
    at: { type: 'string', format: 'date-time' },
    note: { type: 'string', maxLength: 10 },
    body: { type: 'string' },
    amount: { type: 'string', pattern: '^\\d+\\.\\d{2}$', description: 'In cents' },
  });
  // The metadata object is copied, not shared.
  json.properties.at.format = 'date';
  assert.strictEqual(model.types.datetime.metadata.jsonSchema.format, 'date-time');
  const mongo = payment.toJSONSchema({ target: 'mongodb', unrepresentable: 'any' });
  assert.deepStrictEqual(mongo.properties.at, { bsonType: 'date' });
  assert.deepStrictEqual(mongo.properties.note, { bsonType: 'string', maxLength: 10 });
  // Without `bson` the mongodb target does not read `jsonSchema`.
  assert.deepStrictEqual(mongo.properties.amount, { description: 'In cents' });
  assert.throws(() => payment.toJSONSchema({ target: 'mongodb' }), {
    code: 'ERR_UNREPRESENTABLE',
    message:
      'Type "money" (without metadata.bson) cannot be represented in JSON Schema target "mongodb" in "Payment.amount"',
    schema: 'Payment',
    field: 'amount',
  });
  const raw = new Model({ ratio: types.ratio }, [['Raw', { Struct: {}, n: 'ratio' }]]);
  assert.throws(() => raw.entities.get('Raw').toJSONSchema(), {
    code: 'ERR_UNREPRESENTABLE',
    message:
      'Type "ratio" (without metadata.jsonSchema) cannot be represented in JSON Schema target "draft-2020-12" in "Raw.n"',
  });
  assert.deepStrictEqual(
    raw.entities.get('Raw').toJSONSchema({ unrepresentable: 'any' }).properties,
    {
      n: {},
    },
  );
});

test('JSON Schema: references by the kind of the target', () => {
  const model = new Model({}, [
    ['Tag', { Struct: {}, label: 'string', 'parent?': 'Tag' }],
    ['Company', { Registry: {}, name: 'string' }],
    [
      'Person',
      {
        Entity: {},
        name: 'string',
        employer: 'Company',
        tags: { many: 'Tag' },
        former: { many: 'Company', embed: true },
        label: { type: 'Tag', embed: false },
        ghost: '?Nothing',
      },
    ],
  ]);
  const tag = {
    type: 'object',
    properties: {
      label: { type: 'string' },
      parent: { anyOf: [{ $ref: '#/$defs/Tag' }, { type: 'null' }] },
    },
    required: ['label'],
    additionalProperties: false,
  };
  const company = {
    type: 'object',
    properties: { name: { type: 'string' }, companyId: { type: ['string', 'null'] } },
    required: ['name'],
    additionalProperties: false,
  };
  const person = model.entities.get('Person');
  assert.deepStrictEqual(person.toJSONSchema(), {
    $schema: DRAFT_2020,
    type: 'object',
    properties: {
      name: { type: 'string' },
      employer: { type: 'string' },
      tags: { type: 'array', items: { $ref: '#/$defs/Tag' } },
      former: { type: 'array', items: { $ref: '#/$defs/Company' } },
      label: { type: 'string' },
      ghost: { type: ['string', 'null'] },
      personId: { type: ['string', 'null'] },
    },
    required: ['name', 'employer', 'tags', 'former', 'label'],
    additionalProperties: false,
    $defs: { Tag: tag, Company: company },
  });
  // The references option switches every reference, as in check.
  const ids = person.toJSONSchema({ references: 'id' });
  assert.deepStrictEqual(ids.properties.tags, { type: 'array', items: { type: 'string' } });
  assert.deepStrictEqual(ids.properties.former, { type: 'array', items: { type: 'string' } });
  assert.strictEqual(ids.$defs, undefined);
  const embedded = person.toJSONSchema({ references: 'embed' });
  assert.deepStrictEqual(embedded.properties.employer, { $ref: '#/$defs/Company' });
  assert.deepStrictEqual(embedded.properties.label, { $ref: '#/$defs/Tag' });
  assert.deepStrictEqual(Object.keys(embedded.$defs), ['Company', 'Tag']);
  // A reference to the root is `#`; a reference that does not resolve is an
  // id unless the field embeds it.
  assert.deepStrictEqual(model.entities.get('Tag').toJSONSchema().properties.parent, {
    anyOf: [{ $ref: '#' }, { type: 'null' }],
  });
  assert.deepStrictEqual(Schema.from({ owner: 'Nothing' }).toJSONSchema().properties.owner, {
    type: 'string',
  });
  assert.throws(() => Schema.from({ owner: { type: 'Nothing', embed: true } }).toJSONSchema(), {
    code: 'ERR_UNREPRESENTABLE',
    message:
      'Reference "Nothing" (embed) cannot be represented in JSON Schema target "draft-2020-12" in "owner"',
  });
  // The definitions pointer by target, and a pointer of one's own.
  assert.deepStrictEqual(person.toJSONSchema({ target: 'draft-07' }).properties.tags.items, {
    $ref: '#/definitions/Tag',
  });
  assert.deepStrictEqual(Object.keys(person.toJSONSchema({ target: 'draft-07' }).definitions), [
    'Tag',
    'Company',
  ]);
  const openapi = person.toJSONSchema({ target: 'openapi-3.0' });
  assert.deepStrictEqual(openapi.properties.tags.items, { $ref: '#/components/schemas/Tag' });
  assert.deepStrictEqual(Object.keys(openapi.components.schemas), ['Tag', 'Company']);
  assert.deepStrictEqual(openapi.components.schemas.Tag.properties.parent, {
    allOf: [{ $ref: '#/components/schemas/Tag' }],
    nullable: true,
  });
  const custom = person.toJSONSchema({ definitions: '#/x/y/' });
  assert.deepStrictEqual(custom.properties.tags.items, { $ref: '#/x/y/Tag' });
  assert.deepStrictEqual(Object.keys(custom.x.y), ['Tag', 'Company']);
  // A bare $ref carries no annotations where the dialect ignores them.
  const annotated = new Model({}, [
    ['Tag', { Struct: {}, label: 'string' }],
    ['Post', { Struct: {}, tag: { type: 'Tag', description: 'The tag' } }],
  ]).entities.get('Post');
  assert.deepStrictEqual(annotated.toJSONSchema().properties.tag, {
    $ref: '#/$defs/Tag',
    description: 'The tag',
  });
  assert.deepStrictEqual(annotated.toJSONSchema({ target: 'draft-07' }).properties.tag, {
    $ref: '#/definitions/Tag',
  });
});

test('JSON Schema: the mongodb target inlines references and refuses a cycle', () => {
  const model = new Model({}, [
    ['Tag', { Struct: {}, label: 'string', 'parent?': 'Tag' }],
    ['Company', { Registry: {}, name: 'string' }],
    ['Person', { Entity: {}, employer: 'Company', boss: { type: 'Company', embed: true } }],
  ]);
  const person = model.entities.get('Person');
  assert.deepStrictEqual(person.toJSONSchema({ target: 'mongodb' }), {
    bsonType: 'object',
    properties: {
      employer: { bsonType: 'string' },
      boss: {
        bsonType: 'object',
        properties: { name: { bsonType: 'string' }, companyId: { bsonType: ['string', 'null'] } },
        required: ['name'],
        additionalProperties: false,
      },
      personId: { bsonType: ['string', 'null'] },
      _id: {},
    },
    required: ['employer', 'boss'],
    additionalProperties: false,
  });
  assert.throws(() => model.entities.get('Tag').toJSONSchema({ target: 'mongodb' }), {
    code: 'ERR_UNREPRESENTABLE',
    message:
      'Recursive reference "Tag" cannot be represented in JSON Schema target "mongodb" in "Tag.parent.parent"',
    schema: 'Tag',
    field: 'parent.parent',
  });
  const cut = model.entities.get('Tag').toJSONSchema({ target: 'mongodb', unrepresentable: 'any' });
  assert.deepStrictEqual(cut.properties.parent.properties.parent, {});
  // No $schema, $ref, definitions, default, format or examples in a document.
  const text = JSON.stringify(model.toJSONSchema({ target: 'mongodb', unrepresentable: 'any' }));
  for (const key of ['$schema', '$ref', '$defs', 'definitions', 'default', 'format', 'examples']) {
    assert.strictEqual(text.includes(`"${key}"`), false, key);
  }
});

test('JSON Schema: the strict profile', () => {
  const schema = new Schema('Answer', {
    text: { type: 'string', length: { max: 100 }, pattern: '^\\w+$', description: 'The text' },
    score: { type: 'integer', min: 0, max: 10 },
    'tags?': { array: 'string', length: 3 },
    kind: { enum: ['yes', 'no'] },
    one: { enum: ['only'] },
    part: { a: 'string', 'b?': { enum: ['x', 'y'] } },
    ids: { set: 'number' },
    pair: ['number', '?number'],
    at: 'date',
  });
  const expected = {
    $schema: DRAFT_2020,
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The text' },
      score: { type: 'integer' },
      tags: { type: ['array', 'null'], items: { type: 'string' } },
      kind: { enum: ['yes', 'no'] },
      one: { const: 'only' },
      part: {
        type: 'object',
        properties: { a: { type: 'string' }, b: { enum: ['x', 'y', null] } },
        required: ['a', 'b'],
        additionalProperties: false,
      },
      ids: { type: 'array', items: { type: 'number' } },
      pair: {
        type: 'array',
        prefixItems: [{ type: 'number' }, { type: ['number', 'null'] }],
        items: false,
      },
      at: { type: 'string', format: 'date-time' },
    },
    required: ['text', 'score', 'tags', 'kind', 'one', 'part', 'ids', 'pair', 'at'],
    additionalProperties: false,
  };
  assert.deepStrictEqual(schema.toJSONSchema({ profile: 'strict' }), expected);
  assert.deepStrictEqual(
    schema.toJSONSchema({ profile: 'strict', target: 'draft-07' }).$schema,
    DRAFT_07,
  );
  // A lenient schema is closed anyway.
  const lenient = Schema.from({ Form: { unknown: 'ignore' }, name: 'string' });
  assert.strictEqual(lenient.toJSONSchema({ profile: 'strict' }).additionalProperties, false);
  // An optional reference is an anyOf with null.
  const model = new Model({}, [
    ['Tag', { Struct: {}, label: 'string' }],
    ['Post', { Struct: {}, 'tag?': 'Tag', tags: { many: 'Tag' } }],
  ]);
  const post = model.entities.get('Post').toJSONSchema({ profile: 'strict' });
  assert.deepStrictEqual(post.properties.tag, {
    anyOf: [{ $ref: '#/$defs/Tag' }, { type: 'null' }],
  });
  assert.deepStrictEqual(post.required, ['tag', 'tags']);
  assert.deepStrictEqual(post.$defs.Tag.required, ['label']);
  // What the LLM dialects do not take: a value without a type, an object
  // without its properties, the other targets, a root that is no object.
  for (const def of [
    'any',
    'unknown',
    'json',
    { object: { string: 'number' } },
    { map: { string: 'number' } },
  ]) {
    assert.throws(() => fieldOf(def, { profile: 'strict' }), {
      code: 'ERR_UNREPRESENTABLE',
      message:
        /\(profile strict\) cannot be represented in JSON Schema target "draft-2020-12" in "x"$/,
    });
    assert.deepStrictEqual(fieldOf(def, { profile: 'strict', unrepresentable: 'any' }), {});
  }
  for (const target of ['openapi-3.0', 'mongodb']) {
    assert.throws(() => schema.toJSONSchema({ profile: 'strict', target }), {
      name: 'SchemaDefinitionError',
      code: 'ERR_INVALID_OPTIONS',
      message: `Profile "strict" needs target "draft-2020-12" or "draft-07", got "${target}"`,
    });
  }
  assert.throws(() => Schema.from({ array: 'string' }).toJSONSchema({ profile: 'strict' }), {
    code: 'ERR_INVALID_OPTIONS',
    message: 'Profile "strict" needs a struct at the root, got "array"',
  });
  // The shape a tool definition takes.
  const tool = {
    name: 'answer',
    input_schema: schema.toJSONSchema({ profile: 'strict' }),
    strict: true,
  };
  assert.strictEqual(tool.input_schema.type, 'object');
  const text = JSON.stringify(tool.input_schema);
  for (const key of [
    'allOf',
    'not',
    'if',
    'minLength',
    'maxLength',
    'pattern',
    'minimum',
    'maximum',
    'minItems',
    'maxItems',
    'uniqueItems',
    'minProperties',
  ]) {
    assert.strictEqual(text.includes(`"${key}"`), false, key);
  }
});

test('JSON Schema: options are checked', () => {
  const schema = Schema.from({ name: 'string' });
  const cases = [
    [
      { target: 'draft-04' },
      'JSON Schema option "target" must be one of "draft-2020-12", "draft-07", "openapi-3.0", "mongodb", got "draft-04"',
    ],
    [{ io: 'both' }, 'JSON Schema option "io" must be one of "input", "output", got "both"'],
    [
      { unrepresentable: 'skip' },
      'JSON Schema option "unrepresentable" must be one of "throw", "any", got "skip"',
    ],
    [
      { references: 'inline' },
      'JSON Schema option "references" must be one of "kind", "embed", "id", got "inline"',
    ],
    [{ profile: 'loose' }, 'JSON Schema option "profile" must be "strict", got "loose"'],
    [
      { definitions: 'defs' },
      'JSON Schema option "definitions" must be a pointer such as "#/$defs/"',
    ],
    [
      { definitions: '#/' },
      'JSON Schema option "definitions" must be a pointer such as "#/$defs/"',
    ],
    [{ definitions: 42 }, 'JSON Schema option "definitions" must be a pointer such as "#/$defs/"'],
    ['strict', 'JSON Schema options must be an object'],
    [null, 'JSON Schema options must be an object'],
  ];
  for (const pair of cases) {
    assert.throws(() => schema.toJSONSchema(pair[0]), {
      name: 'SchemaDefinitionError',
      code: 'ERR_INVALID_OPTIONS',
      message: pair[1],
    });
  }
  // The mongodb target has no definitions and ignores the pointer.
  assert.strictEqual(
    schema.toJSONSchema({ target: 'mongodb', definitions: 'x' }).bsonType,
    'object',
  );
  assert.ok(new SchemaDefinitionError('ERR_UNREPRESENTABLE', 'x') instanceof TypeError);
});

test('JSON Schema: an error is located in the schema and the field', () => {
  const model = new Model({}, [
    ['Inner', { Struct: {}, deep: { value: 'bigint' } }],
    ['Outer', { Struct: {}, inner: 'Inner' }],
  ]);
  // The field of the entity that holds the type, not of the one that refers to it.
  assert.throws(() => model.entities.get('Outer').toJSONSchema(), {
    code: 'ERR_UNREPRESENTABLE',
    message:
      'Type "bigint" cannot be represented in JSON Schema target "draft-2020-12" in "Inner.deep.value"',
    schema: 'Inner',
    field: 'deep.value',
  });
  assert.throws(() => Schema.from({ list: { array: { n: 'bigint' } } }).toJSONSchema(), {
    message:
      'Type "bigint" cannot be represented in JSON Schema target "draft-2020-12" in "list.n"',
    schema: '',
    field: 'list.n',
  });
  assert.throws(() => Schema.from('bigint').toJSONSchema(), {
    message: 'Type "bigint" cannot be represented in JSON Schema target "draft-2020-12"',
    schema: '',
    field: '',
  });
});

test('JSON Schema: a model as one document of definitions, or by root', () => {
  const model = new Model({}, [
    ['Tag', { Struct: {}, label: 'string' }],
    ['Company', { Registry: { unknown: 'ignore' }, name: 'string' }],
    ['Person', { Entity: {}, employer: 'Company', tags: { many: 'Tag' } }],
  ]);
  const all = model.toJSONSchema();
  assert.deepStrictEqual(Object.keys(all), ['$schema', '$defs']);
  assert.deepStrictEqual(Object.keys(all.$defs), [...model.order]);
  // Each entity is closed or open by its own policy.
  assert.strictEqual(all.$defs.Company.additionalProperties, undefined);
  assert.strictEqual(all.$defs.Person.additionalProperties, false);
  assert.deepStrictEqual(all.$defs.Person.properties.tags.items, { $ref: '#/$defs/Tag' });
  assert.deepStrictEqual(Object.keys(model.toJSONSchema({ target: 'draft-07' })), [
    '$schema',
    'definitions',
  ]);
  const openapi = model.toJSONSchema({ target: 'openapi-3.0' });
  assert.deepStrictEqual(Object.keys(openapi), ['components']);
  assert.deepStrictEqual(Object.keys(openapi.components.schemas), [...model.order]);
  assert.deepStrictEqual(openapi.components.schemas.Person.properties.tags.items, {
    $ref: '#/components/schemas/Tag',
  });
  // One document per entity for mongodb, references inline.
  const mongo = model.toJSONSchema({ target: 'mongodb' });
  assert.deepStrictEqual(Object.keys(mongo), [...model.order]);
  assert.strictEqual(mongo.Person.properties.tags.items.bsonType, 'object');
  assert.deepStrictEqual(mongo.Person.properties[ID], {});
  assert.strictEqual(mongo.Company.properties[ID], undefined);
  // A root entity with only the definitions it needs.
  const person = model.toJSONSchema({ root: 'Person' });
  assert.deepStrictEqual(person, model.entities.get('Person').toJSONSchema());
  assert.deepStrictEqual(Object.keys(person.$defs), ['Tag']);
  assert.deepStrictEqual(model.toJSONSchema({ root: 'Tag', target: 'mongodb' }), {
    bsonType: 'object',
    properties: { label: { bsonType: 'string' }, _id: {} },
    required: ['label'],
    additionalProperties: false,
  });
  assert.throws(() => model.toJSONSchema({ root: 'Nothing' }), {
    code: 'ERR_INVALID_OPTIONS',
    message: 'Entity "Nothing" is not in the model',
  });
  assert.throws(() => model.toJSONSchema({ profile: 'strict' }), {
    code: 'ERR_INVALID_OPTIONS',
    message: 'Profile "strict" needs a root entity',
  });
  assert.strictEqual(model.toJSONSchema({ profile: 'strict', root: 'Person' }).type, 'object');
  // An empty model.
  assert.deepStrictEqual(new Model({}, []).toJSONSchema(), { $schema: DRAFT_2020 });
  assert.deepStrictEqual(new Model({}, []).toJSONSchema({ target: 'mongodb' }), {});
});

test('JSON Schema: the fixture model', () => {
  const types = {
    datetime: {
      js: 'string',
      metadata: { jsonSchema: { type: 'string', format: 'date-time' }, bson: 'date' },
    },
    ...customTypes,
    decimal: {
      ...customTypes.decimal,
      metadata: {
        ...customTypes.decimal.metadata,
        jsonSchema: { type: 'string' },
        bson: 'decimal',
      },
    },
  };
  const model = new Model(types, new Map(Object.entries(entities)), database);
  const all = model.toJSONSchema();
  assert.deepStrictEqual(Object.keys(all.$defs), [...model.order]);
  assert.deepStrictEqual(all.$defs.Account.properties.company, { type: 'string' });
  assert.deepStrictEqual(all.$defs.Account.properties.addresses, {
    type: 'array',
    items: { type: 'string' },
  });
  assert.deepStrictEqual(all.$defs.Account.properties.birth, {
    type: 'object',
    properties: { date: { type: ['string', 'null'] }, place: { type: ['string', 'null'] } },
    additionalProperties: false,
  });
  assert.deepStrictEqual(all.$defs.Identifier.properties.storage, {
    enum: ['master', 'cache', 'backup', 'replica'],
  });
  assert.deepStrictEqual(all.$defs.Signin, all.$defs.Aaa);
  assert.deepStrictEqual(Object.keys(all.$defs.Signin.properties), ['login', 'password']);
  // The graph of an account, with the strict profile, and as $jsonSchema.
  const graph = model.toJSONSchema({ root: 'Account', references: 'embed' });
  assert.deepStrictEqual(graph.properties.company, { $ref: '#/$defs/Company' });
  assert.deepStrictEqual(Object.keys(graph.$defs), ['Company', 'Address']);
  assert.deepStrictEqual(graph.$defs.Company.properties.parent, {
    anyOf: [{ $ref: '#/$defs/Company' }, { type: 'null' }],
  });
  const strict = model.toJSONSchema({ root: 'Account', profile: 'strict' });
  assert.deepStrictEqual(strict.required, Object.keys(strict.properties));
  const mongo = model.toJSONSchema({ target: 'mongodb' });
  assert.deepStrictEqual(mongo.Identifier.properties.creation, { bsonType: 'date' });
  assert.strictEqual(model.warnings.length, 0);
});

test('JSON Schema: the Standard JSON Schema converter', () => {
  const schema = Schema.from({ name: 'string', at: 'date' });
  const { jsonSchema } = schema['~standard'];
  assert.deepStrictEqual(Object.keys(jsonSchema), ['input', 'output']);
  assert.deepStrictEqual(
    jsonSchema.input({ target: 'draft-2020-12' }),
    schema.toJSONSchema({ target: 'draft-2020-12', io: 'input' }),
  );
  assert.deepStrictEqual(jsonSchema.input({ target: 'draft-07' }).$schema, DRAFT_07);
  assert.strictEqual(jsonSchema.input({ target: 'openapi-3.0' }).$schema, undefined);
  assert.throws(() => jsonSchema.output({ target: 'draft-2020-12' }), {
    code: 'ERR_UNREPRESENTABLE',
  });
  assert.deepStrictEqual(
    jsonSchema.output({ target: 'draft-2020-12', libraryOptions: { unrepresentable: 'any' } })
      .properties.at,
    {},
  );
  // The library options are those of toJSONSchema; the target wins over them.
  const strict = jsonSchema.input({
    target: 'draft-07',
    libraryOptions: { profile: 'strict', target: 'mongodb', io: 'output' },
  });
  assert.deepStrictEqual(strict.required, ['name', 'at']);
  assert.strictEqual(strict.$schema, DRAFT_07);
  // Unbound, as consumers call it.
  const { input } = jsonSchema;
  assert.strictEqual(input({ target: 'draft-2020-12' }).type, 'object');
  // Anything but the three JSON targets is refused, as the specification asks.
  for (const options of [
    { target: 'mongodb' },
    { target: 'draft-04' },
    {},
    undefined,
    null,
    'draft-07',
  ]) {
    assert.throws(() => jsonSchema.input(options), {
      name: 'SchemaDefinitionError',
      code: 'ERR_INVALID_OPTIONS',
      message: /^JSON Schema target .* is not supported$/,
    });
  }
  assert.throws(() => jsonSchema.input({ target: 'mongodb' }), {
    message: 'JSON Schema target "mongodb" is not supported',
  });
});
