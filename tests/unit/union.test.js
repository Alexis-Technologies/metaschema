const { test } = require('node:test');
const assert = require('node:assert');

const { Schema, Model } = require('../../index.js');

test('Union: the first branch without issues matches', () => {
  const schema = Schema.from({
    id: { union: ['string', 'number'] },
    'tags?': { union: ['string', { array: 'string' }] },
    value: { union: [{ enum: ['a', 'b'] }, { n: 'number' }, 'null'] },
  });
  assert.strictEqual(schema.fields.id.type, 'union');
  assert.strictEqual(schema.fields.id.union.length, 2);
  for (const id of ['x', 5]) assert.strictEqual(schema.check({ id, value: 'a' }).valid, true);
  assert.strictEqual(schema.check({ id: 1, tags: 'one', value: { n: 1 } }).valid, true);
  assert.strictEqual(schema.check({ id: 1, tags: ['one'], value: null }).valid, true);
  assert.strictEqual(schema.check({ id: 1, tags: null, value: 'b' }).valid, true);
  const result = schema.check({ id: true, tags: [1], value: { n: 'x' } });
  assert.deepStrictEqual(result.issues, [
    {
      code: 'union',
      path: ['id'],
      message: 'does not match any of: string, number',
      params: { expected: ['string', 'number'], discriminator: undefined },
    },
    {
      code: 'union',
      path: ['tags'],
      message: 'does not match any of: string, array',
      params: { expected: ['string', 'array'], discriminator: undefined },
    },
    {
      code: 'union',
      path: ['value'],
      message: 'does not match any of: enum, object, null',
      params: { expected: ['enum', 'object', 'null'], discriminator: undefined },
    },
  ]);
  // A failed branch leaves nothing behind: not its issues, not its path.
  assert.deepStrictEqual(schema.check({ id: null, value: 'c' }).errors, [
    'Field "id" does not match any of: string, number',
    'Field "value" does not match any of: enum, object, null',
  ]);
  const uk = require('../../src/locales/uk.js');
  assert.deepStrictEqual(schema.check({ id: null, value: 'a' }, { messages: uk }).errors, [
    'Поле "id" не відповідає жодному з: string, number',
  ]);
  assert.strictEqual(schema.check({ id: null, value: 'c' }, { maxErrors: 1 }).errors.length, 1);
  assert.deepStrictEqual(
    schema.check({ id: null, tags: [1], value: 'c' }, { maxErrors: 2 }).errors,
    [
      'Field "id" does not match any of: string, number',
      'Field "tags" does not match any of: string, array',
    ],
  );
  assert.strictEqual(Schema.from({ union: ['string', 'number'] }).check(1).valid, true);
  assert.strictEqual(Schema.from({ type: 'union', union: ['string'] }).check('s').valid, true);
  assert.strictEqual(
    new Schema('Id', { id: { union: ['string', 'number'] } }).toInterface(),
    'interface Id {\n  id: string | number;\n}',
  );
  assert.strictEqual(
    Schema.from({ ids: { array: { union: ['string', { n: 'number' }] } } }).toInterface(),
    'interface  {\n  ids: (string | { n: number })[];\n}',
  );
});

test('Union: a discriminator picks the branch by one field', () => {
  const schema = new Schema('Canvas', {
    shape: {
      union: [
        { kind: { enum: ['circle'] }, r: 'number' },
        { kind: { enum: ['square', 'rect'] }, side: 'number' },
      ],
      discriminator: 'kind',
    },
  });
  assert.strictEqual(schema.check({ shape: { kind: 'circle', r: 1 } }).valid, true);
  assert.strictEqual(schema.check({ shape: { kind: 'rect', side: 1 } }).valid, true);
  assert.deepStrictEqual(schema.check({ shape: { kind: 'circle', side: 1 } }).errors, [
    'Field "Canvas.shape.r" is required',
    'Field "Canvas.shape" has unexpected keys: side',
  ]);
  const unknown = schema.check({ shape: { kind: 'line', r: 1 } });
  assert.deepStrictEqual(unknown.issues, [
    {
      code: 'union',
      path: ['shape', 'kind'],
      message: 'is not one of: circle, square, rect',
      params: { expected: ['circle', 'square', 'rect'], discriminator: 'kind' },
    },
  ]);
  assert.deepStrictEqual(unknown.errors, [
    'Field "Canvas.shape.kind" is not one of: circle, square, rect',
  ]);
  assert.deepStrictEqual(schema.check({ shape: { r: 1 } }).errors, [
    'Field "Canvas.shape.kind" is not one of: circle, square, rect',
  ]);
  assert.deepStrictEqual(schema.check({ shape: 'circle' }).errors, [
    'Field "Canvas.shape" not of expected type: object',
  ]);
  assert.deepStrictEqual(schema.check({ shape: null }).errors, [
    'Field "Canvas.shape" not of expected type: object',
  ]);
  assert.strictEqual(
    schema.toInterface(),
    `interface Canvas {
  shape: { kind: "circle"; r: number } | { kind: "square" | "rect"; side: number };
}`,
  );
  const optional = Schema.from({
    'shape?': { union: [{ kind: { enum: ['a'] } }], discriminator: 'kind' },
  });
  assert.strictEqual(optional.check({}).valid, true);
  assert.strictEqual(optional.check({ shape: null }).valid, true);
  assert.strictEqual(optional.check({ shape: { kind: 'a' } }).valid, true);
  assert.strictEqual(optional.check({ shape: { kind: 'b' } }).valid, false);
  const top = Schema.from({ union: [{ kind: { enum: ['a'] } }], discriminator: 'kind' });
  assert.deepStrictEqual(top.check({ kind: 'b' }).errors, ['Field "kind" is not one of: a']);
  // Branches may be Schema instances, with aliases of enum; a reference
  // resolves at check time, so it cannot be a discriminated branch.
  const circle = new Schema('Circle', { kind: { enum: ['circle'] }, r: 'number' });
  const model = new Model({ tag: { js: 'enum' } }, [
    ['Square', { Struct: {}, kind: { type: 'tag', enum: ['square'] }, side: 'number' }],
  ]);
  const square = model.entities.get('Square');
  const mixed = Schema.from({ shape: { union: [circle, square], discriminator: 'kind' } });
  assert.strictEqual(mixed.check({ shape: { kind: 'circle', r: 1 } }).valid, true);
  assert.strictEqual(mixed.check({ shape: { kind: 'square', side: 1 } }).valid, true);
  assert.deepStrictEqual(mixed.check({ shape: { kind: 'square', r: 1 } }).errors, [
    'Field "shape.side" is required',
    'Field "shape" has unexpected keys: r',
  ]);
});

test('Union: a definition that cannot discriminate is an error', () => {
  const cases = [
    [{ union: [] }, 'Union needs a list of branches: { union: [...] } in "u"'],
    [{ union: 'string' }, 'Union needs a list of branches: { union: [...] } in "u"'],
    [{ union: [() => 1] }, 'Union branch 0 cannot be a function in "u"'],
    [{ union: ['string'], discriminator: 5 }, 'Union discriminator needs a field name in "u"'],
    [
      { union: ['string', { kind: { enum: ['a'] } }], discriminator: 'kind' },
      'Union branch 0 needs an enum field "kind" to discriminate on in "u"',
    ],
    [
      { union: [{ kind: { enum: ['a'] } }, 'Shape'], discriminator: 'kind' },
      'Union branch 1 needs an enum field "kind" to discriminate on in "u"',
    ],
    [
      { union: [{ kind: 'string' }], discriminator: 'kind' },
      'Union branch 0 needs an enum field "kind" to discriminate on in "u"',
    ],
    [
      { union: [{ kind: { enum: ['a'] } }, { kind: { enum: ['b', 'a'] } }], discriminator: 'kind' },
      'Union discriminator value "a" is in two branches in "u"',
    ],
    [{ union: ['strng'] }, 'Unknown type "strng" in "u"'],
  ];
  for (const [definition, message] of cases) {
    assert.throws(() => Schema.from({ u: definition }), { name: 'SchemaDefinitionError', message });
  }
  assert.throws(() => Schema.from({ u: { union: [] } }), { code: 'ERR_INVALID_UNION' });
});
