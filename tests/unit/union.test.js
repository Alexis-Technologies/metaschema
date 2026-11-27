const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { Schema, Model } = require('../../index.js');
const { register } = require('../../src/generators/index.js');

register();

describe('Union', () => {
  it('should match the first branch without issues', () => {
    const schema = Schema.from({
      id: { union: ['string', 'number'] },
      'tags?': { union: ['string', { array: 'string' }] },
      value: { union: [{ enum: ['a', 'b'] }, { n: 'number' }, 'null'] },
    });
    assert.equal(schema.fields.id.type, 'union');
    assert.equal(schema.fields.id.union.length, 2);
    for (const id of ['x', 5]) assert.equal(schema.check({ id, value: 'a' }).valid, true);
    assert.equal(schema.check({ id: 1, tags: 'one', value: { n: 1 } }).valid, true);
    assert.equal(schema.check({ id: 1, tags: ['one'], value: null }).valid, true);
    assert.equal(schema.check({ id: 1, tags: null, value: 'b' }).valid, true);
    const result = schema.check({ id: true, tags: [1], value: { n: 'x' } });
    assert.deepEqual(result.issues, [
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
    assert.deepEqual(schema.check({ id: null, value: 'c' }).errors, [
      'Field "id" does not match any of: string, number',
      'Field "value" does not match any of: enum, object, null',
    ]);
    const uk = require('../../src/locales/uk.js');
    assert.deepEqual(schema.check({ id: null, value: 'a' }, { messages: uk }).errors, [
      'Поле "id" не відповідає жодному з: string, number',
    ]);
    assert.equal(schema.check({ id: null, value: 'c' }, { maxErrors: 1 }).errors.length, 1);
    assert.deepEqual(schema.check({ id: null, tags: [1], value: 'c' }, { maxErrors: 2 }).errors, [
      'Field "id" does not match any of: string, number',
      'Field "tags" does not match any of: string, array',
    ]);
    assert.equal(Schema.from({ union: ['string', 'number'] }).check(1).valid, true);
    assert.equal(Schema.from({ type: 'union', union: ['string'] }).check('s').valid, true);
    assert.equal(
      new Schema('Id', { id: { union: ['string', 'number'] } }).toInterface(),
      'interface Id {\n  id: string | number;\n}',
    );
    assert.equal(
      Schema.from({ ids: { array: { union: ['string', { n: 'number' }] } } }).toInterface(),
      'interface  {\n  ids: (string | { n: number })[];\n}',
    );
  });

  it('should pick the branch by one field with a discriminator', () => {
    const schema = new Schema('Canvas', {
      shape: {
        union: [
          { kind: { enum: ['circle'] }, r: 'number' },
          { kind: { enum: ['square', 'rect'] }, side: 'number' },
        ],
        discriminator: 'kind',
      },
    });
    assert.equal(schema.check({ shape: { kind: 'circle', r: 1 } }).valid, true);
    assert.equal(schema.check({ shape: { kind: 'rect', side: 1 } }).valid, true);
    assert.deepEqual(schema.check({ shape: { kind: 'circle', side: 1 } }).errors, [
      'Field "Canvas.shape.r" is required',
      'Field "Canvas.shape" has unexpected keys: side',
    ]);
    const unknown = schema.check({ shape: { kind: 'line', r: 1 } });
    assert.deepEqual(unknown.issues, [
      {
        code: 'union',
        path: ['shape', 'kind'],
        message: 'is not one of: circle, square, rect',
        params: { expected: ['circle', 'square', 'rect'], discriminator: 'kind' },
      },
    ]);
    assert.deepEqual(unknown.errors, [
      'Field "Canvas.shape.kind" is not one of: circle, square, rect',
    ]);
    assert.deepEqual(schema.check({ shape: { r: 1 } }).errors, [
      'Field "Canvas.shape.kind" is not one of: circle, square, rect',
    ]);
    assert.deepEqual(schema.check({ shape: 'circle' }).errors, [
      'Field "Canvas.shape" not of expected type: object',
    ]);
    assert.deepEqual(schema.check({ shape: null }).errors, [
      'Field "Canvas.shape" not of expected type: object',
    ]);
    assert.equal(
      schema.toInterface(),
      `interface Canvas {
  shape: { kind: "circle"; r: number } | { kind: "square" | "rect"; side: number };
}`,
    );
    const optional = Schema.from({
      'shape?': { union: [{ kind: { enum: ['a'] } }], discriminator: 'kind' },
    });
    assert.equal(optional.check({}).valid, true);
    assert.equal(optional.check({ shape: null }).valid, true);
    assert.equal(optional.check({ shape: { kind: 'a' } }).valid, true);
    assert.equal(optional.check({ shape: { kind: 'b' } }).valid, false);
    const top = Schema.from({ union: [{ kind: { enum: ['a'] } }], discriminator: 'kind' });
    assert.deepEqual(top.check({ kind: 'b' }).errors, ['Field "kind" is not one of: a']);
    // Branches may be Schema instances, with aliases of enum; a reference
    // resolves at check time, so it cannot be a discriminated branch.
    const circle = new Schema('Circle', { kind: { enum: ['circle'] }, r: 'number' });
    const model = new Model({ tag: { js: 'enum' } }, [
      ['Square', { Struct: {}, kind: { type: 'tag', enum: ['square'] }, side: 'number' }],
    ]);
    const square = model.entities.get('Square');
    const mixed = Schema.from({ shape: { union: [circle, square], discriminator: 'kind' } });
    assert.equal(mixed.check({ shape: { kind: 'circle', r: 1 } }).valid, true);
    assert.equal(mixed.check({ shape: { kind: 'square', side: 1 } }).valid, true);
    assert.deepEqual(mixed.check({ shape: { kind: 'square', r: 1 } }).errors, [
      'Field "shape.side" is required',
      'Field "shape" has unexpected keys: r',
    ]);
  });

  it('should reject a definition that cannot discriminate', () => {
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
        {
          union: [{ kind: { enum: ['a'] } }, { kind: { enum: ['b', 'a'] } }],
          discriminator: 'kind',
        },
        'Union discriminator value "a" is in two branches in "u"',
      ],
      [{ union: ['strng'] }, 'Unknown type "strng" in "u"'],
    ];
    for (const [definition, message] of cases) {
      assert.throws(() => Schema.from({ u: definition }), {
        name: 'SchemaDefinitionError',
        message,
      });
    }
    assert.throws(() => Schema.from({ u: { union: [] } }), { code: 'ALX_ERR_INVALID_UNION' });
  });

  it('should reject a default on a discriminator field', () => {
    assert.throws(
      () =>
        Schema.from({
          u: {
            union: [
              { Struct: {}, kind: { enum: ['a'], default: 'a' }, x: 'number' },
              { Struct: {}, kind: { enum: ['b'] }, y: 'number' },
            ],
            discriminator: 'kind',
          },
        }),
      {
        code: 'ALX_ERR_INVALID_UNION',
        message: 'Union discriminator "kind" of branch 0 cannot have a default in "u"',
      },
    );
  });

  it('should refuse a discriminator field that is optional or nullable', () => {
    // A value without the tag, or with null, is in no branch: such a branch
    // could never be picked, so the definition is refused, as a default is.
    const other = { Struct: {}, kind: { enum: ['b'] }, y: 'number' };
    const message = (index) =>
      `Union discriminator "kind" of branch ${index} must be required and not nullable in "u"`;
    const tags = [
      { 'kind?': { enum: ['a'] } },
      { kind: { type: 'enum', enum: ['a'], required: false } },
      { kind: { enum: ['a'], nullable: true } },
    ];
    for (const tag of tags) {
      assert.throws(
        () =>
          Schema.from({
            u: { union: [{ Struct: {}, ...tag, x: 'number' }, other], discriminator: 'kind' },
          }),
        { name: 'SchemaDefinitionError', code: 'ALX_ERR_INVALID_UNION', message: message(0) },
      );
    }
    // A branch that is a Schema instance is held to it too.
    const branch = new Schema('Circle', { Struct: {}, 'kind?': { enum: ['c'] }, r: 'number' });
    assert.throws(() => Schema.from({ u: { union: [other, branch], discriminator: 'kind' } }), {
      code: 'ALX_ERR_INVALID_UNION',
      message: message(1),
    });
    // A snapshot that says so does not restore (the error of the definition,
    // located in the entity, as every definition error of a snapshot is).
    const { fromJSON } = require('../../src/model/index.js');
    const valid = new Model({}, [
      [
        'A',
        {
          Struct: {},
          u: { union: [{ Struct: {}, kind: { enum: ['a'] } }, other], discriminator: 'kind' },
        },
      ],
    ]);
    const snapshot = JSON.parse(JSON.stringify(valid));
    snapshot.entities.A.fields.u.union[0].schema.kind.required = false;
    assert.throws(() => fromJSON(snapshot), {
      code: 'ALX_ERR_INVALID_UNION',
      message: 'Union discriminator "kind" of branch 0 must be required and not nullable in "A.u"',
    });
    // What merge and derive make of a valid one keeps the tags required:
    // deep partial stops at a union.
    const { merge } = require('../../src/model/index.js');
    const { partial } = require('../../src/derive/index.js');
    const entity = valid.entities.get('A');
    assert.equal(merge(entity, entity).fields.u.union[0].schema.kind.required, true);
    const patch = partial(entity, { deep: true });
    assert.equal(patch.fields.u.required, false);
    assert.equal(patch.fields.u.union[0].schema.kind.required, true);
    assert.equal(patch.check({ u: { kind: 'b', y: 1 } }).valid, true);
  });
});
