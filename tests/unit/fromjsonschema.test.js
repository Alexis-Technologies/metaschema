const { test } = require('node:test');
const assert = require('node:assert');

const { Schema, Model } = require('../../index.js');
const { fromJSONSchema, toJSONSchema, register } = require('../../src/generators/index.js');
const { sample } = require('../../src/model/index.js');
const { compile, canEval } = require('../../src/compile/index.js');

// The definition of the property `x` of a document with that one property.
const fieldOf = (json, required = true, options = {}) =>
  fromJSONSchema(
    {
      type: 'object',
      properties: { x: json },
      required: required ? ['x'] : [],
      additionalProperties: false,
    },
    options,
  ).x;

test('fromJSONSchema: every keyword of the subset has a definition', () => {
  const cases = [
    [{ type: 'string' }, 'string'],
    [
      { type: 'string', minLength: 1, maxLength: 8, pattern: '^a' },
      { type: 'string', length: { min: 1, max: 8 }, pattern: '^a' },
    ],
    [
      { type: 'string', maxLength: 8 },
      { type: 'string', length: { min: undefined, max: 8 } },
    ],
    [{ type: 'string', format: 'email' }, 'string'],
    [
      { type: 'number', minimum: 0, maximum: 1 },
      { type: 'number', min: 0, max: 1 },
    ],
    [
      { type: 'integer', maximum: 9 },
      { type: 'integer', max: 9 },
    ],
    [{ type: 'boolean' }, 'boolean'],
    [{ type: 'null' }, 'null'],
    [{ enum: ['a', 'b'] }, { type: 'enum', enum: ['a', 'b'] }],
    [{ enum: ['a', null] }, { type: 'enum', enum: ['a'], nullable: true }],
    [{ enum: [null] }, 'null'],
    [{ const: 7 }, { type: 'enum', enum: [7] }],
    [
      { type: 'array', items: { type: 'string' } },
      { type: 'array', value: 'string' },
    ],
    [
      { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 },
      { type: 'array', value: 'string', length: { min: 1, max: 3 } },
    ],
    [
      { type: 'array', items: { type: 'number' }, uniqueItems: true },
      { type: 'set', value: 'number' },
    ],
    [{ type: 'array' }, { type: 'array', value: 'any' }],
    [
      {
        type: 'array',
        prefixItems: [{ type: 'number' }, { type: 'string' }],
        items: false,
        minItems: 1,
      },
      { type: 'tuple', value: ['number', '?string'] },
    ],
    [
      { type: 'array', items: [{ type: 'number' }, { type: 'string' }], additionalItems: false },
      { type: 'tuple', value: ['number', 'string'] },
    ],
    [
      {
        type: 'object',
        properties: { a: { type: 'string' }, b: { type: 'number' } },
        required: ['a'],
      },
      { a: 'string', b: '?number' },
    ],
    [
      {
        type: 'object',
        properties: { a: { type: 'string' } },
        required: ['a'],
        additionalProperties: false,
      },
      { a: 'string' },
    ],
    [
      { type: 'object', additionalProperties: { type: 'number' } },
      { type: 'object', key: 'string', value: 'number' },
    ],
    [
      {
        type: 'object',
        additionalProperties: { type: 'number' },
        minProperties: 1,
        maxProperties: 4,
      },
      { type: 'object', key: 'string', value: 'number', length: { min: 1, max: 4 } },
    ],
    [
      {
        type: 'object',
        additionalProperties: { type: 'boolean' },
        propertyNames: { pattern: '^-?\\d+(\\.\\d+)?$' },
      },
      { type: 'object', key: 'number', value: 'boolean' },
    ],
    [{ type: 'object' }, 'json'],
    [{ type: 'object', additionalProperties: true }, 'json'],
    [{ type: ['object', 'array'] }, 'json'],
    [{ type: ['string', 'null'] }, { type: 'string', nullable: true }],
    [
      { type: ['string', 'number'] },
      { type: 'union', union: [{ type: 'string' }, { type: 'number' }] },
    ],
    [
      { type: ['string', 'number', 'null'] },
      { type: 'union', union: [{ type: 'string' }, { type: 'number' }], nullable: true },
    ],
    [
      { type: 'string', nullable: true },
      { type: 'string', nullable: true },
    ],
    [
      { anyOf: [{ type: 'string' }, { type: 'number' }] },
      { type: 'union', union: ['string', 'number'] },
    ],
    [{ oneOf: [{ type: 'string' }, { type: 'null' }] }, { type: 'string', nullable: true }],
    [{ anyOf: [{ type: 'null' }] }, 'null'],
    [
      {
        oneOf: [
          { type: 'object', properties: { k: { const: 'a' } }, required: ['k'] },
          { type: 'object', properties: { k: { const: 'b' } }, required: ['k'] },
        ],
        discriminator: { propertyName: 'k' },
      },
      {
        type: 'union',
        union: [{ k: { type: 'enum', enum: ['a'] } }, { k: { type: 'enum', enum: ['b'] } }],
        discriminator: 'k',
      },
    ],
    [
      { allOf: [{ type: 'string', maxLength: 2 }] },
      { type: 'string', length: { min: undefined, max: 2 } },
    ],
    [
      { allOf: [{ type: 'string' }], nullable: true },
      { type: 'string', nullable: true },
    ],
    [{ minLength: 2 }, { type: 'string', length: { min: 2, max: undefined } }],
    [{ maximum: 2 }, { type: 'number', max: 2 }],
    [{ properties: { a: { type: 'string' } } }, { a: '?string' }],
    [{ items: { type: 'string' } }, { type: 'array', value: 'string' }],
    [{}, 'any'],
    [true, 'any'],
    [
      {
        title: 'T',
        description: 'D',
        default: 'x',
        examples: ['y'],
        deprecated: true,
        type: 'string',
        $comment: 'c',
        readOnly: true,
      },
      {
        type: 'string',
        title: 'T',
        description: 'D',
        default: 'x',
        examples: ['y'],
        deprecated: true,
      },
    ],
    [
      { type: 'string', example: 'e' },
      { type: 'string', examples: ['e'] },
    ],
    [
      { type: 'string', deprecated: false },
      { type: 'string', deprecated: false },
    ],
    // A struct whose first key reads as something else takes the shorthand.
    [
      { type: 'object', properties: { type: { type: 'string' } }, required: ['type'] },
      { schema: { type: 'string' } },
    ],
    [
      { type: 'object', properties: { Entity: { type: 'string' } } },
      { schema: { Entity: '?string' } },
    ],
  ];
  for (const [json, expected] of cases) {
    assert.deepStrictEqual(fieldOf(json), expected, JSON.stringify(json));
  }
  // An optional property: the shorthand with `?`, or `required: false`.
  assert.strictEqual(fieldOf({ type: 'string' }, false), '?string');
  assert.strictEqual(fieldOf({ type: ['string', 'null'] }, false), '?string');
  assert.deepStrictEqual(fieldOf({ type: 'string', maxLength: 2 }, false), {
    type: 'string',
    length: { min: undefined, max: 2 },
    required: false,
  });
  assert.deepStrictEqual(
    fieldOf({ type: 'object', properties: { a: { type: 'string' } } }, false),
    {
      schema: { a: '?string' },
      required: false,
    },
  );
  assert.deepStrictEqual(fieldOf({}, false), '?any');
});

test('fromJSONSchema: the root is a struct with its kind, or a definition of one type', () => {
  const open = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] };
  assert.deepStrictEqual(fromJSONSchema(open), { Struct: { unknown: 'ignore' }, a: 'string' });
  const closed = { ...open, additionalProperties: false, title: 'A', description: 'd' };
  assert.deepStrictEqual(fromJSONSchema(closed), {
    Struct: { title: 'A', description: 'd' },
    a: 'string',
  });
  assert.deepStrictEqual(fromJSONSchema({ type: 'string', minLength: 1 }), {
    type: 'string',
    length: { min: 1, max: undefined },
  });
  assert.strictEqual(fromJSONSchema({ type: 'string' }), 'string');
  assert.strictEqual(fromJSONSchema(true), 'any');
  assert.deepStrictEqual(fromJSONSchema({ type: 'array', items: { type: 'number' } }), {
    type: 'array',
    value: 'number',
  });
  // As a Schema, with the name and the policy of the document.
  const schema = fromJSONSchema(open, { as: 'schema', name: 'User' });
  assert.strictEqual(schema.name, 'User');
  assert.strictEqual(schema.unknown, 'ignore');
  assert.strictEqual(schema.check({ a: 'x', b: 1 }).valid, true);
  const strict = fromJSONSchema(closed, { as: 'schema', name: 'User' });
  assert.deepStrictEqual(strict.custom, { title: 'A', description: 'd' });
  assert.deepStrictEqual(strict.check({ a: 'x', b: 1 }).errors, [
    'Field "User" has unexpected keys: b',
  ]);
  assert.strictEqual(fromJSONSchema({ type: 'integer' }, { as: 'schema' }).check(1.5).valid, false);
});

test('fromJSONSchema: a nested struct is wrapped when its first key would read otherwise', () => {
  // The first key that starts with a letter decides, so `_id` does not count
  // and `string` after it would make the struct a string field; an object
  // with no such key is a struct of its keys, or of none.
  const wrapped = fieldOf({
    type: 'object',
    properties: { _id: { type: 'string' }, string: { type: 'number' } },
    required: ['_id', 'string'],
  });
  assert.deepStrictEqual(wrapped, { schema: { _id: 'string', string: 'number' } });
  assert.strictEqual(Schema.from({ x: wrapped }).check({ x: { _id: 'a', string: 1 } }).valid, true);
  const empty = fieldOf({ type: 'object', properties: {} });
  assert.deepStrictEqual(empty, {});
  assert.strictEqual(Schema.from({ x: empty }).check({ x: {} }).valid, true);
  const under = fieldOf({
    type: 'object',
    properties: { _a: { type: 'string' } },
    required: ['_a'],
  });
  assert.deepStrictEqual(under, { _a: 'string' });
  assert.strictEqual(Schema.from({ x: under }).check({ x: { _a: 'y' } }).valid, true);
});

test('fromJSONSchema: a $ref is inlined, or kept as the name of an entity', () => {
  const document = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      tag: { $ref: '#/$defs/Tag' },
      tags: { type: 'array', items: { $ref: '#/$defs/Tag' } },
      opt: { anyOf: [{ $ref: '#/$defs/Tag' }, { type: 'null' }] },
    },
    required: ['tag', 'tags'],
    additionalProperties: false,
    $defs: {
      Tag: {
        type: 'object',
        properties: { label: { type: 'string' } },
        required: ['label'],
        additionalProperties: false,
      },
    },
  };
  assert.deepStrictEqual(fromJSONSchema(document), {
    Struct: {},
    tag: { label: 'string' },
    tags: { type: 'array', value: { label: 'string' } },
    opt: { schema: { label: 'string' }, required: false },
  });
  assert.deepStrictEqual(fromJSONSchema(document, { references: 'name' }), {
    Struct: {},
    tag: 'Tag',
    tags: { type: 'array', value: 'Tag' },
    opt: '?Tag',
  });
  // Through a model the names resolve; the export is the document again.
  const model = new Model({}, [
    ['Tag', fromJSONSchema(document.$defs.Tag)],
    ['Post', fromJSONSchema(document, { references: 'name' })],
  ]);
  assert.deepStrictEqual(toJSONSchema(model.entities.get('Post')), document);
  // The other pointers, and `#` for the schema itself.
  const draft7 = {
    definitions: { Tag: { type: 'string' } },
    type: 'object',
    properties: { t: { $ref: '#/definitions/Tag' } },
  };
  assert.deepStrictEqual(fromJSONSchema(draft7), { Struct: { unknown: 'ignore' }, t: '?string' });
  const openapi = {
    components: { schemas: { Tag: { type: 'string' } } },
    type: 'object',
    properties: { t: { $ref: '#/components/schemas/Tag' } },
  };
  assert.deepStrictEqual(fromJSONSchema(openapi), { Struct: { unknown: 'ignore' }, t: '?string' });
  const self = { type: 'object', properties: { next: { $ref: '#' } } };
  assert.deepStrictEqual(fromJSONSchema(self, { name: 'Node' }), {
    Struct: { unknown: 'ignore' },
    next: '?Node',
  });
  const escaped = {
    $defs: { 'a/b~c': { type: 'number' } },
    type: 'object',
    properties: { x: { $ref: '#/$defs/a~1b~0c' } },
  };
  assert.deepStrictEqual(fromJSONSchema(escaped), { Struct: { unknown: 'ignore' }, x: '?number' });
  const code = 'ERR_UNSUPPORTED_SCHEMA';
  const cycle = {
    $defs: { N: { type: 'object', properties: { n: { $ref: '#/$defs/N' } } } },
    type: 'object',
    properties: { n: { $ref: '#/$defs/N' } },
  };
  assert.throws(() => fromJSONSchema(cycle), {
    name: 'SchemaDefinitionError',
    code,
    message:
      'The recursive reference "#/$defs/N" is not supported in a JSON Schema at "/properties/n/properties/n"',
  });
  assert.deepStrictEqual(fromJSONSchema(cycle, { references: 'name' }), {
    Struct: { unknown: 'ignore' },
    n: '?N',
  });
  assert.throws(() => fromJSONSchema(self), { code, message: /not an entity name/ });
  assert.throws(
    () =>
      fromJSONSchema(
        {
          $defs: { tag: { type: 'string' } },
          type: 'object',
          properties: { t: { $ref: '#/$defs/tag' } },
        },
        { references: 'name' },
      ),
    {
      code,
      message:
        'The reference "#/$defs/tag" (not an entity name) is not supported in a JSON Schema at "/properties/t"',
    },
  );
  assert.throws(
    () => fromJSONSchema({ type: 'object', properties: { t: { $ref: '#/$defs/Nope' } } }),
    {
      code,
      message:
        'The reference "#/$defs/Nope" (nothing there) is not supported in a JSON Schema at "/properties/t"',
    },
  );
  assert.throws(
    () => fromJSONSchema({ type: 'object', properties: { t: { $ref: 'other.json#/x' } } }),
    {
      code,
      message: 'The reference "other.json#/x" is not supported in a JSON Schema at "/properties/t"',
    },
  );
});

// A document whose definitions refer twice to the next one: inlined, the
// unfolded definition has 2^n leaves, so a walk per `$ref` is exponential.
const diamond = (n) => {
  const $defs = {};
  for (let level = 0; level < n; level += 1) {
    const next = { $ref: `#/$defs/D${level + 1}` };
    $defs[`D${level}`] = { type: 'object', properties: { a: next, b: next }, required: ['a', 'b'] };
  }
  $defs[`D${n}`] = { type: 'string' };
  return {
    $defs,
    type: 'object',
    properties: { root: { $ref: '#/$defs/D0' } },
    required: ['root'],
    additionalProperties: false,
  };
};

// The objects a definition is made of: the graph, not its unfolding.
const objectsOf = (value, seen = new Set()) => {
  if (value === null || typeof value !== 'object' || seen.has(value)) return seen.size;
  seen.add(value);
  for (const key of Object.keys(value)) objectsOf(value[key], seen);
  return seen.size;
};

test('fromJSONSchema: a pointer is read in full through own keys', () => {
  const code = 'ERR_UNSUPPORTED_SCHEMA';
  // Two pointers that end alike are two targets, not a cycle.
  const alike = {
    $defs: {
      One: { type: 'object', properties: { item: { $ref: '#/$defs/Two/properties/item' } } },
      Two: { type: 'object', properties: { item: { type: 'number' } } },
    },
    type: 'object',
    properties: { s: { $ref: '#/$defs/One/properties/item' } },
    required: ['s'],
    additionalProperties: false,
  };
  assert.deepStrictEqual(fromJSONSchema(alike), { Struct: {}, s: 'number' });
  // A percent-escape decodes before the lookup: `%41` is `A`, for the cycle guard too.
  const escaped = {
    $defs: { A: { type: 'object', properties: { n: { $ref: '#/$defs/%41' } } } },
    type: 'object',
    properties: { a: { $ref: '#/$defs/A' } },
  };
  assert.throws(() => fromJSONSchema(escaped), {
    code,
    message:
      'The recursive reference "#/$defs/%41" is not supported in a JSON Schema at "/properties/a/properties/n"',
  });
  // An own key named like a member of Object.prototype is found; the member is not.
  const own = JSON.parse(
    '{"$defs":{"__proto__":{"type":"string"}},"type":"object","properties":{"p":{"$ref":"#/$defs/__proto__"}}}',
  );
  assert.deepStrictEqual(fromJSONSchema(own), { Struct: { unknown: 'ignore' }, p: '?string' });
  assert.throws(
    () => fromJSONSchema({ type: 'object', properties: { p: { $ref: '#/toString' } } }),
    {
      code,
      message:
        'The reference "#/toString" (nothing there) is not supported in a JSON Schema at "/properties/p"',
    },
  );
});

test('fromJSONSchema: a $ref is converted once per pointer', () => {
  const start = performance.now();
  const twenty = fromJSONSchema(diamond(20));
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 50, `a diamond of 20 took ${elapsed} ms`);
  // One object per level: the places that inline a definition share it.
  assert.strictEqual(objectsOf(twenty) - objectsOf(fromJSONSchema(diamond(10))), 10);
  const schema = fromJSONSchema(diamond(3), { as: 'schema', name: 'D' });
  const leaf = { a: 'x', b: 'y' };
  const level = { a: leaf, b: leaf };
  assert.strictEqual(schema.check({ root: { a: level, b: level } }).valid, true);
  assert.deepStrictEqual(schema.check({ root: { a: level, b: { a: leaf, b: { a: 1 } } } }).errors, [
    'Field "D.root.b.b.a" not of expected type: string',
    'Field "D.root.b.b.b" is required',
  ]);
  // What a place writes around the definition it inlines (its annotations,
  // nullable, required) stays with that place.
  const twice = {
    $defs: { T: { type: 'object', properties: { v: { type: 'string' } }, required: ['v'] } },
    type: 'object',
    properties: {
      a: { $ref: '#/$defs/T', description: 'first', nullable: true },
      b: { $ref: '#/$defs/T' },
      c: { $ref: '#/$defs/T' },
      d: { $ref: '#/$defs/T', title: 'last' },
    },
    required: ['a', 'b', 'd'],
    additionalProperties: false,
  };
  assert.deepStrictEqual(fromJSONSchema(twice), {
    Struct: {},
    a: { type: 'schema', schema: { v: 'string' }, nullable: true, description: 'first' },
    b: { v: 'string' },
    c: { schema: { v: 'string' }, required: false },
    d: { type: 'schema', schema: { v: 'string' }, title: 'last' },
  });
});

test('fromJSONSchema: the nesting of a document is bounded, whatever the mode', () => {
  const nested = (depth) => {
    let node = { type: 'string' };
    for (let level = 0; level < depth; level += 1) node = { type: 'array', items: node };
    return node;
  };
  let def = fromJSONSchema(nested(128));
  for (let level = 0; level < 128; level += 1) def = def.value;
  assert.strictEqual(def, 'string');
  const message = `Nesting deeper than 128 levels at "${'/items'.repeat(129)}"`;
  const calls = [];
  const lenient = { unsupported: 'ignore', onUnsupported: (...args) => calls.push(args) };
  for (const options of [{}, lenient]) {
    assert.throws(() => fromJSONSchema(nested(129), options), {
      name: 'SchemaDefinitionError',
      code: 'ERR_UNSUPPORTED_SCHEMA',
      message,
    });
  }
  assert.deepStrictEqual(calls, []);
});

test('fromJSONSchema: onUnsupported is told of every drop of the lenient mode', () => {
  const document = {
    type: 'object',
    properties: {
      n: { type: 'number', multipleOf: 2 },
      s: { type: 'string', pattern: '\\:' },
      t: { $ref: '#/$defs/T' },
      u: { $ref: '#/$defs/T' },
    },
    $defs: { T: { not: {} } },
  };
  const dropped = [];
  const onUnsupported = (reason, pointer) => dropped.push([reason, pointer]);
  assert.deepStrictEqual(fromJSONSchema(document, { unsupported: 'ignore', onUnsupported }), {
    Struct: { unknown: 'ignore' },
    n: '?number',
    s: '?string',
    t: '?any',
    u: '?any',
  });
  // One call per drop; a `$ref` converted once reports once.
  assert.deepStrictEqual(dropped, [
    ['The keyword "multipleOf"', '/properties/n'],
    [
      `The pattern ${JSON.stringify('\\:')} (not a valid pattern under the u flag)`,
      '/properties/s',
    ],
    ['The keyword "not"', '/properties/t'],
  ]);
  // Not in the throw mode: the error carries the place.
  const calls = [];
  assert.throws(() => fromJSONSchema(document, { onUnsupported: () => calls.push(1) }), {
    code: 'ERR_UNSUPPORTED_SCHEMA',
  });
  assert.deepStrictEqual(calls, []);
});

test('fromJSONSchema: a keyword outside the subset throws with its place, or is dropped', () => {
  const code = 'ERR_UNSUPPORTED_SCHEMA';
  const cases = [
    [{ type: 'number', exclusiveMinimum: 0 }, 'The keyword "exclusiveMinimum"', '/properties/x'],
    [{ type: 'number', multipleOf: 2 }, 'The keyword "multipleOf"', '/properties/x'],
    [{ type: 'object', patternProperties: {} }, 'The keyword "patternProperties"', '/properties/x'],
    [{ not: { type: 'string' } }, 'The keyword "not"', '/properties/x'],
    [{ if: {}, then: {} }, 'The keyword "if"', '/properties/x'],
    [
      { allOf: [{ type: 'string' }, { minLength: 1 }] },
      'An "allOf" of several schemas',
      '/properties/x',
    ],
    [
      { type: 'array', items: { type: 'string' }, contains: {} },
      'The keyword "contains"',
      '/properties/x',
    ],
    [
      { type: 'array', prefixItems: [{ type: 'string' }], items: { type: 'number' } },
      'A tuple with more items',
      '/properties/x',
    ],
    [
      { type: 'object', properties: {}, minProperties: 1 },
      'A struct with minProperties or maxProperties',
      '/properties/x',
    ],
    [
      { type: 'object', additionalProperties: false },
      'An object with no properties',
      '/properties/x',
    ],
    [
      {
        type: 'object',
        additionalProperties: { type: 'string' },
        propertyNames: { pattern: '^a' },
      },
      'A "propertyNames" other than the number key pattern',
      '/properties/x',
    ],
    [
      { type: 'object', properties: { a: { type: 'string', unevaluatedProperties: false } } },
      'The keyword "unevaluatedProperties"',
      '/properties/x/properties/a',
    ],
    [
      { type: 'array', items: { type: 'string', dependentRequired: {} } },
      'The keyword "dependentRequired"',
      '/properties/x/items',
    ],
    [{ anyOf: [{ type: 'string' }, { not: {} }] }, 'The keyword "not"', '/properties/x/anyOf/1'],
    [{ type: 'date' }, 'The type "date"', '/properties/x'],
    [{ enum: 'a' }, 'An "enum" that is not a list', '/properties/x'],
    [
      { type: 'object', properties: { a: {} }, required: 'a' },
      'A "required" that is not a list',
      '/properties/x',
    ],
    [
      { oneOf: [{ type: 'string' }, { type: 'number' }], discriminator: 'k' },
      'A discriminator without a propertyName',
      '/properties/x',
    ],
    [false, 'The schema false', '/properties/x'],
    [7, 'A schema that is 7', '/properties/x'],
    // The dialect of a pattern, the names of a type list, the form of a
    // pointer: the document is untrusted input.
    [
      { type: 'string', pattern: '\\:' },
      `The pattern ${JSON.stringify('\\:')} (not a valid pattern under the u flag)`,
      '/properties/x',
    ],
    [{ type: 'string', pattern: 7 }, 'A "pattern" that is not a string', '/properties/x'],
    [{ type: ['string', 'Foo'] }, 'The type "Foo"', '/properties/x'],
    [{ type: ['string', 'null', 'Foo'] }, 'The type "Foo"', '/properties/x'],
    [{ $ref: '#foo' }, 'The reference "#foo"', '/properties/x'],
    [{ $ref: '#/__proto__' }, 'The reference "#/__proto__" (nothing there)', '/properties/x'],
    [{ $ref: '#/constructor' }, 'The reference "#/constructor" (nothing there)', '/properties/x'],
    [
      { $ref: '#/$defs/%E0%A4%A' },
      'The reference "#/$defs/%E0%A4%A" (a bad escape)',
      '/properties/x',
    ],
  ];
  for (const [json, what, where] of cases) {
    assert.throws(() => fieldOf(json), {
      name: 'SchemaDefinitionError',
      code,
      message: `${what} is not supported in a JSON Schema at "${where}"`,
    });
    assert.doesNotThrow(() => fieldOf(json, true, { unsupported: 'ignore' }), what);
  }
  assert.deepStrictEqual(
    fieldOf({ type: 'number', exclusiveMinimum: 0 }, true, { unsupported: 'ignore' }),
    'number',
  );
  assert.deepStrictEqual(fieldOf(false, true, { unsupported: 'ignore' }), 'any');
  const lenient = { unsupported: 'ignore' };
  assert.strictEqual(fieldOf({ type: 'string', pattern: '\\:' }, true, lenient), 'string');
  assert.strictEqual(fieldOf({ type: ['string', 'Foo'] }, true, lenient), 'any');
  assert.strictEqual(fieldOf({ $ref: '#/__proto__' }, true, lenient), 'any');
  // A pattern the u flag rejects is reported here with its place, not as
  // ERR_INVALID_RULE by the Schema built from the definition.
  assert.throws(() => fromJSONSchema({ type: 'string', pattern: '\\:' }, { as: 'schema' }), {
    code,
    message: `The pattern ${JSON.stringify('\\:')} (not a valid pattern under the u flag) is not supported in a JSON Schema at ""`,
  });
  // A key of the document that is not a JSON pointer segment as it is.
  assert.throws(() => fromJSONSchema({ type: 'object', properties: { 'a/b': { not: {} } } }), {
    message: 'The keyword "not" is not supported in a JSON Schema at "/properties/a~1b"',
  });
  for (const [options, message] of [
    [null, 'Options must be an object'],
    [{ as: 'model' }, 'Option "as" must be one of "definition", "schema", got "model"'],
    [{ references: 'ref' }, 'Option "references" must be one of "inline", "name", got "ref"'],
    [{ unsupported: 'warn' }, 'Option "unsupported" must be one of "throw", "ignore", got "warn"'],
    [{ name: 1 }, 'Option "name" must be a string'],
    [{ onUnsupported: 'log' }, 'Option "onUnsupported" must be a function'],
  ]) {
    assert.throws(() => fromJSONSchema({ type: 'string' }, options), {
      code: 'ERR_INVALID_OPTIONS',
      message,
    });
  }
  assert.throws(() => fromJSONSchema('string'), {
    name: 'TypeError',
    code: 'ERR_INVALID_TARGET',
    message: 'A JSON Schema document (an object) is expected',
  });
});

// The subset the export writes and the import reads back as the same text.
const documents = [
  {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      login: { type: 'string', minLength: 3, maxLength: 32, description: 'The login name' },
      age: { type: ['integer', 'null'] },
      role: { enum: ['admin', 'editor', 'viewer'] },
      one: { const: 'x' },
      tags: { type: 'array', items: { type: 'string' }, minItems: 1 },
      ids: { type: 'array', items: { type: 'number' }, uniqueItems: true },
      scores: { type: 'object', additionalProperties: { type: 'number' }, minProperties: 1 },
      byId: {
        type: 'object',
        additionalProperties: { type: 'boolean' },
        propertyNames: { pattern: '^-?\\d+(\\.\\d+)?$' },
        minProperties: 1,
      },
      point: {
        type: 'array',
        prefixItems: [{ type: 'number' }, { type: ['string', 'null'] }],
        items: false,
        minItems: 1,
      },
      shape: {
        anyOf: [
          { type: 'string' },
          {
            type: 'object',
            properties: { x: { type: 'number' } },
            required: ['x'],
            additionalProperties: false,
          },
        ],
      },
      any: {},
      data: { type: ['object', 'array'] },
      n: { type: ['number', 'null'], minimum: 0 },
      address: {
        type: 'object',
        properties: {
          city: { type: 'string' },
          zip: { type: ['string', 'null'], maxLength: 5, pattern: '^\\d{5}$' },
        },
        required: ['city'],
        additionalProperties: false,
      },
    },
    required: [
      'login',
      'role',
      'one',
      'tags',
      'ids',
      'scores',
      'byId',
      'point',
      'shape',
      'any',
      'data',
      'n',
      'address',
    ],
    additionalProperties: false,
  },
  { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'string', minLength: 1 },
  {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'array',
    items: { type: 'integer' },
  },
];

test('fromJSONSchema: the export of the import is the document, on the subset', () => {
  for (const document of documents) {
    const schema = fromJSONSchema(document, { as: 'schema' });
    assert.deepStrictEqual(toJSONSchema(schema), document);
    assert.deepStrictEqual(
      toJSONSchema(fromJSONSchema(toJSONSchema(schema), { as: 'schema' })),
      document,
    );
  }
  // draft-07 and OpenAPI 3.0 documents read as well.
  const original = new Schema('User', {
    name: 'string',
    'age?': 'integer',
    point: ['number', { 'label?': 'string' }],
    kind: {
      union: [
        { Struct: {}, k: { enum: ['a'] } },
        { Struct: {}, k: { enum: ['b'] } },
      ],
      discriminator: 'k',
    },
  });
  for (const target of ['draft-07', 'openapi-3.0']) {
    const document = toJSONSchema(original, { target, unrepresentable: 'any' });
    const schema = fromJSONSchema(document, { as: 'schema', name: 'User' });
    assert.deepStrictEqual(toJSONSchema(schema, { target, unrepresentable: 'any' }), document);
  }
});

test('fromJSONSchema: the import of the export checks as the schema does, on both backends', () => {
  const definition = {
    Struct: {},
    login: { type: 'string', length: { min: 3, max: 32 } },
    'age?': 'integer',
    role: { enum: ['admin', 'editor'] },
    tags: { array: 'string', length: { min: 1 } },
    scores: { object: { string: 'number' } },
    point: ['number', { 'label?': 'string' }],
    shape: { union: ['string', { x: 'number' }] },
    n: { type: 'number', min: 0, nullable: true },
    address: { city: 'string', 'zip?': { type: 'string', pattern: '^\\d{5}$', length: 5 } },
    // A discriminator has no keyword in draft 2020-12 (the openapi-3.0
    // target carries it), so the branches come back as a plain union.
    kind: {
      union: [
        { Struct: {}, k: { enum: ['a'] }, a: 'number' },
        { Struct: {}, k: { enum: ['b'] } },
      ],
    },
  };
  const original = new Schema('User', definition);
  const imported = fromJSONSchema(toJSONSchema(original), { as: 'schema', name: 'User' });
  const compiled = fromJSONSchema(toJSONSchema(original), { as: 'schema', name: 'User' });
  assert.strictEqual(compile(compiled, { jit: canEval() ? true : 'auto' }).accelerated, canEval());
  const values = [];
  for (let seed = 1; seed <= 20; seed += 1) values.push(sample(original, { seed }));
  values.push(
    {},
    { login: 'ab' },
    {
      login: 'abc',
      role: 'nope',
      tags: [],
      scores: {},
      point: ['x'],
      shape: 1,
      n: -1,
      address: { zip: '1' },
      kind: { k: 'c' },
    },
    {
      login: 'abcd',
      age: 1.5,
      role: 'admin',
      tags: ['t'],
      scores: { a: 'x' },
      point: [1, 2],
      shape: { x: 'y' },
      n: null,
      address: { city: 1, zip: '123456' },
      kind: { k: 'a' },
    },
    {
      login: 'abcd',
      role: 'admin',
      tags: ['t'],
      scores: { a: 1 },
      point: [1],
      shape: 'ok',
      n: 1,
      address: { city: 'c' },
      kind: { k: 'b' },
      extra: 1,
    },
    null,
    [],
    'x',
  );
  for (const value of values) {
    const expected = original.check(value);
    for (const schema of [imported, compiled]) {
      const actual = schema.check(value);
      assert.strictEqual(actual.valid, expected.valid, JSON.stringify(value));
      assert.deepStrictEqual(actual.errors, expected.errors, JSON.stringify(value));
    }
  }
});

test('fromJSONSchema: register() installs Schema.fromJSONSchema', () => {
  assert.strictEqual(Schema.fromJSONSchema, undefined);
  register();
  assert.strictEqual(Schema.fromJSONSchema, fromJSONSchema);
  assert.strictEqual(Object.getOwnPropertyDescriptor(Schema, 'fromJSONSchema').enumerable, false);
  assert.strictEqual(
    Schema.fromJSONSchema({ type: 'string' }, { as: 'schema' }).check('x').valid,
    true,
  );
});

test('fromJSONSchema: a long property name is shortened in the pointer of an error', () => {
  const long = 'p'.repeat(150);
  const document = { type: 'object', properties: { [long]: { type: 'string', not: {} } } };
  assert.throws(() => fromJSONSchema(document), {
    code: 'ERR_UNSUPPORTED_SCHEMA',
    message: `The keyword "not" is not supported in a JSON Schema at "/properties/${'p'.repeat(100)}..."`,
  });
});
