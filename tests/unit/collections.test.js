const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { Schema } = require('../../index.js');

describe('Collections', () => {
  it('should check collections in the fields of a struct', () => {
    const def1 = {
      field1: { array: 'number' },
    };
    const obj1 = {
      field1: [1, 2, 3],
    };
    const schema1 = Schema.from(def1);
    assert.equal(schema1.check(obj1).valid, true);

    const def2 = {
      field1: { array: 'number' },
    };
    const obj2 = {
      field1: ['uno', 2, 3],
    };
    const schema2 = Schema.from(def2);
    assert.equal(schema2.check(obj2).valid, false);

    const def3 = {
      field1: { object: { string: 'string' } },
    };
    const obj3 = {
      field1: { a: 'A', b: 'B' },
    };
    const schema3 = Schema.from(def3);
    assert.equal(schema3.check(obj3).valid, true);

    const def4 = {
      field1: { object: { string: 'string' } },
    };
    const obj4 = {
      field1: { a: 1, b: 'B' },
    };
    const schema4 = Schema.from(def4);
    assert.equal(schema4.check(obj4).valid, false);

    const def5 = {
      field1: { set: 'number' },
    };
    const obj5 = {
      field1: new Set([1, 2, 3]),
    };
    const schema5 = Schema.from(def5);
    assert.equal(schema5.check(obj5).valid, true);

    const def6 = {
      field1: { set: 'number' },
    };
    const obj6 = {
      field1: new Set(['uno', 2, 3]),
    };
    const schema6 = Schema.from(def6);
    assert.equal(schema6.check(obj6).valid, false);

    const def7 = {
      field1: { map: { string: 'string' } },
    };
    const obj7 = {
      field1: new Map([
        ['a', 'A'],
        ['b', 'B'],
      ]),
    };
    const schema7 = Schema.from(def7);
    assert.equal(schema7.check(obj7).valid, true);

    const def8 = {
      field1: { map: { string: 'string' } },
    };
    const obj8 = {
      field1: new Map([
        ['a', 1],
        ['b', 'B'],
      ]),
    };
    const schema8 = Schema.from(def8);
    assert.equal(schema8.check(obj8).valid, false);
  });

  it('should check collections as the value of a schema', () => {
    const def1 = { array: 'number' };
    const obj1 = [1, 2, 3];
    const schema1 = Schema.from(def1);
    assert.equal(schema1.check(obj1).valid, true);

    const def2 = { array: 'number' };
    const obj2 = ['uno', 2, 3];
    const schema2 = Schema.from(def2);
    assert.equal(schema2.check(obj2).valid, false);

    const def3 = { object: { string: 'string' } };
    const obj3 = { a: 'A', b: 'B' };
    const schema3 = Schema.from(def3);
    assert.equal(schema3.check(obj3).valid, true);

    const def4 = { object: { string: 'string' } };
    const obj4 = { a: 1, b: 'B' };
    const schema4 = Schema.from(def4);
    assert.equal(schema4.check(obj4).valid, false);

    const def5 = { set: 'number' };
    const obj5 = new Set([1, 2, 3]);
    const schema5 = Schema.from(def5);
    assert.equal(schema5.check(obj5).valid, true);

    const def6 = { set: 'number' };
    const obj6 = new Set(['uno', 2, 3]);
    const schema6 = Schema.from(def6);
    assert.equal(schema6.check(obj6).valid, false);

    const def7 = { map: { string: 'string' } };
    const obj7 = new Map([
      ['a', 'A'],
      ['b', 'B'],
    ]);
    const schema7 = Schema.from(def7);
    assert.equal(schema7.check(obj7).valid, true);

    const def8 = { map: { string: 'string' } };
    const obj8 = new Map([
      ['a', 1],
      ['b', 'B'],
    ]);
    const schema8 = Schema.from(def8);
    assert.equal(schema8.check(obj8).valid, false);
  });

  it('should check the value of the long form', () => {
    const def1 = { type: 'array', value: 'number' };
    const obj1 = [1, 2, 3];
    const schema1 = Schema.from(def1);
    assert.equal(schema1.check(obj1).valid, true);

    const def2 = { type: 'array', value: 'number' };
    const obj2 = ['uno', 2, 3];
    const schema2 = Schema.from(def2);
    assert.equal(schema2.check(obj2).valid, false);

    const def3 = { type: 'object', key: 'string', value: 'string' };
    const obj3 = { a: 'A', b: 'B' };
    const schema3 = Schema.from(def3);
    assert.equal(schema3.check(obj3).valid, true);

    const def4 = { type: 'object', key: 'string', value: 'string' };
    const obj4 = { a: 1, b: 'B' };
    const schema4 = Schema.from(def4);
    assert.equal(schema4.check(obj4).valid, false);

    const def5 = { type: 'set', value: 'number' };
    const obj5 = new Set([1, 2, 3]);
    const schema5 = Schema.from(def5);
    assert.equal(schema5.check(obj5).valid, true);

    const def6 = { type: 'set', value: 'number' };
    const obj6 = new Set(['uno', 2, 3]);
    const schema6 = Schema.from(def6);
    assert.equal(schema6.check(obj6).valid, false);

    const def7 = { type: 'map', key: 'string', value: 'string' };
    const obj7 = new Map([
      ['a', 'A'],
      ['b', 'B'],
    ]);
    const schema7 = Schema.from(def7);
    assert.equal(schema7.check(obj7).valid, true);

    const def8 = { type: 'map', key: 'string', value: 'string' };
    const obj8 = new Map([
      ['a', 1],
      ['b', 'B'],
    ]);
    const schema8 = Schema.from(def8);
    assert.equal(schema8.check(obj8).valid, false);
  });

  it('should check multiple nested arrays', () => {
    const defs1 = {
      Entity: {},
      name: {
        first: { type: 'string' },
        last: { type: 'string' },
        third: { type: '?string' },
      },
      age: { type: 'number' },
      levelOne: {
        levelTwo: {
          levelThree: { type: 'enum', enum: [1, 2, 3] },
        },
      },
      collection: { array: { array: 'number' } },
    };

    const schema1 = Schema.from(defs1);

    const obj1 = {
      name: {
        first: 'a',
        last: 'b',
      },
      age: 5,
      levelOne: { levelTwo: { levelThree: 1 } },
      collection: [
        [1, 2, 3],
        [3, 5, 6],
      ],
    };
    assert.equal(schema1.check(obj1).valid, true);

    const defs2 = {
      array: {
        name: 'string',
        age: 'number',
        nest: {
          arr1: { array: { enum: [1, 2, 3] } },
          arr2: { array: { array: { object: { string: 'string' } } } },
        },
      },
    };
    const obj2 = [
      {
        name: 'A',
        age: 5,
        nest: {
          arr1: [1, 2, 3],
          arr2: [
            [{ hello: 'world' }, { your: 'world' }],
            [{ hello: 'world' }, { your: 'world' }],
          ],
        },
      },
      {
        name: 'A',
        age: 5,
        nest: {
          arr1: [1, 2, 3],
          arr2: [
            [{ hello: 'world' }, { your: 'world' }],
            [{ hello: 'world' }, { your: 'world' }],
          ],
        },
      },
    ];
    const schema2 = Schema.from(defs2);
    assert.equal(schema2.check(obj2).valid, true);

    const obj3 = [
      {
        name: 'A',
        age: 5,
        nest: {
          arr1: [1, 2, 3],
          arr2: [
            [{ hello: 'world' }, { your: 'world' }],
            [{ hello: 'world' }, { your: 'world' }],
          ],
        },
      },
      {
        name: 'A',
        age: 5,
        nest: {
          arr1: [1, 2, 3],
          arr2: [
            [{ hello: 'world' }, { your: 1 }],
            [{ hello: 'world' }, { your: 2 }],
          ],
        },
      },
    ];

    assert.deepEqual(schema2.check(obj3).errors, [
      'Field "[1].nest.arr2[0][1].your" not of expected type: string',
      'Field "[1].nest.arr2[1][1].your" not of expected type: string',
    ]);
  });

  it('should accept empty collections under an optional shorthand key', () => {
    const defs1 = { 'array?': 'string' };
    const defs2 = { 'object?': { string: 'string' } };
    const defs3 = { 'set?': 'string' };
    const defs4 = { 'map?': { string: 'string' } };

    const sch1 = Schema.from(defs1);
    const sch2 = Schema.from(defs2);
    const sch3 = Schema.from(defs3);
    const sch4 = Schema.from(defs4);

    assert.equal(sch1.check([]).valid, true);
    assert.equal(sch2.check({}).valid, true);
    assert.equal(sch3.check(new Set()).valid, true);
    assert.equal(sch4.check(new Map()).valid, true);
  });

  it('should check a nested object', () => {
    const defs1 = { object: { string: { array: 'string' } } };
    const defs2 = { type: 'object', key: 'string', value: { array: 'string' } };
    const defs3 = {
      type: 'object',
      key: 'string',
      value: {
        type: 'array',
        value: {
          type: 'object',
          key: 'string',
          value: { type: 'object', key: 'string', value: { name: 'string' } },
        },
      },
    };
    const defs4 = { 'object?': { string: { array: 'string' } } };

    const sch1 = Schema.from(defs1);
    const sch2 = Schema.from(defs2);
    const sch3 = Schema.from(defs3);
    const sch4 = Schema.from(defs4);

    assert.equal(sch1.check({ key: ['hello', 'there'] }).valid, true);
    assert.equal(sch1.check({ key: 'hello' }).valid, false);
    assert.equal(sch1.check({}).valid, false);
    assert.equal(sch2.check({ key: ['hello', 'there'] }).valid, true);
    assert.equal(sch2.check({ key: 'hello' }).valid, false);
    assert.equal(sch2.check({}).valid, false);
    assert.equal(sch3.check({ key: [{ key: { key: { name: 'Georg' } } }] }).valid, true);
    assert.equal(sch3.check({ key: [{ key: { name: 'Georg' } }] }).valid, false);
    assert.equal(sch4.check({}).valid, true);
    assert.equal(sch4.fields.required, false);
  });

  it('should render the error messages', () => {
    const object = Schema.from({ field1: { object: { string: 'string' } } });
    assert.deepEqual(object.check({ field1: 5 }).errors, [
      'Field "field1" not of expected type: object',
    ]);
    const map = Schema.from({ field1: { map: { string: 'string' } } });
    assert.deepEqual(map.check({ field1: {} }).errors, [
      'Field "field1" not of expected type: map',
    ]);
    assert.deepEqual(map.check({ field1: new Map() }).errors, ['Field "field1" is required']);
  });

  it('should reject null and arrays in an object field as type errors', () => {
    const schema = Schema.from({ o: { object: { string: 'number' } } });
    assert.deepEqual(schema.check({ o: null }).errors, ['Field "o" not of expected type: object']);
    assert.deepEqual(schema.check({ o: [1, 2] }).errors, [
      'Field "o" not of expected type: object',
    ]);
    assert.deepEqual(schema.check({ o: 'x' }).errors, ['Field "o" not of expected type: object']);
    assert.equal(schema.check({ o: { a: 1 } }).valid, true);
    assert.equal(
      Schema.from({ 'o?': { object: { string: 'number' } } }).check({ o: null }).valid,
      true,
    );
  });

  it('should accept null in optional collections and report wrong values as type errors', () => {
    const optional = Schema.from({
      'list?': { array: 'number' },
      'ids?': { set: 'number' },
      'byKey?': { object: { string: 'number' } },
      'byId?': { map: { string: 'number' } },
    });
    assert.equal(optional.check({ list: null, ids: null, byKey: null, byId: null }).valid, true);
    assert.equal(optional.check({ byId: new Map(), byKey: {} }).valid, true);
    const required = Schema.from({
      list: { array: 'number' },
      ids: { set: 'number' },
      byKey: { object: { string: 'number' } },
      byId: { map: { string: 'number' } },
    });
    const result = required.check({ list: new Set([1]), ids: [1], byKey: 5, byId: {} });
    assert.deepEqual(result.errors, [
      'Field "list" not of expected type: array',
      'Field "ids" not of expected type: set',
      'Field "byKey" not of expected type: object',
      'Field "byId" not of expected type: map',
    ]);
    assert.deepEqual(
      result.issues.map((issue) => issue.params.received),
      ['object', 'array', 'number', 'object'],
    );
    assert.deepEqual(required.check({ list: null, ids: null, byKey: null, byId: null }).errors, [
      'Field "list" not of expected type: array',
      'Field "ids" not of expected type: set',
      'Field "byKey" not of expected type: object',
      'Field "byId" not of expected type: map',
    ]);
    const byNumber = Schema.from({ o: { object: { number: 'string' } } });
    assert.deepEqual(byNumber.check({ o: { a: 'x' } }).issues, [
      {
        code: 'type',
        path: ['o'],
        message: 'keys must be of type number',
        params: { expected: 'number', received: 'string', key: 'a' },
      },
    ]);
    const instances = [
      [{ array: 'number' }, [1], new Set([1])],
      [{ set: 'number' }, new Set([1]), [1]],
      [{ object: { string: 'number' } }, { a: 1 }, [1]],
      [{ map: { string: 'number' } }, new Map(), { a: 1 }],
    ];
    for (const [definition, yes, no] of instances) {
      const field = Schema.from(definition).fields;
      assert.equal(field.isInstance(yes), true, field.type);
      assert.equal(field.isInstance(no), false, field.type);
      assert.equal(field.isInstance(null), false, field.type);
    }
  });

  it('should report elements by index or key, with the limit respected', () => {
    const schema = Schema.from({
      ids: { set: 'number' },
      byId: { map: { string: 'number' } },
      byKey: { object: { string: 'number' } },
    });
    const value = {
      ids: new Set([1, 'two', 'three']),
      byId: new Map([
        ['a', 1],
        ['b', 'x'],
      ]),
      byKey: { c: 'y', d: 2 },
    };
    assert.deepEqual(schema.check(value).errors, [
      'Field "ids[1]" not of expected type: number',
      'Field "ids[2]" not of expected type: number',
      'Field "byId.b" not of expected type: number',
      'Field "byKey.c" not of expected type: number',
    ]);
    assert.equal(schema.check(value, { maxErrors: 1 }).errors.length, 1);
    assert.equal(schema.check(value, { maxErrors: 3 }).errors.length, 3);
    const many = Schema.from({ byKey: { object: { string: 'number' }, length: { max: 1 } } });
    assert.deepEqual(many.check({ byKey: { a: 1, b: 2 } }).errors, [
      'Field "byKey" exceeds the maximum length',
    ]);
    assert.equal(many.check({ byKey: { a: 1 } }).valid, true);
  });

  it('should settle the key type as "string" or "number" when the field is built', () => {
    const invalid = { name: 'SchemaDefinitionError', code: 'ERR_INVALID_DEFINITION' };
    assert.throws(() => Schema.from({ f: { type: 'map', value: 'string' } }), {
      ...invalid,
      message: /Type "map" needs a key type of "string" or "number".* in "f"$/,
    });
    assert.throws(() => Schema.from({ f: { object: 'string' } }), invalid);
    assert.throws(() => Schema.from({ f: { type: 'object', key: 'boolean', value: 'string' } }), {
      ...invalid,
      message: /Type "object" needs a key type/,
    });
    assert.throws(() => Schema.from({ f: { map: { 1: 'string' } } }), invalid);
    const numbered = Schema.from({ f: { object: { number: 'string' } } });
    assert.equal(numbered.fields.f.key, 'number');
    assert.equal(
      Schema.from({ f: { type: 'map', key: 'string', value: 'number' } }).fields.f.key,
      'string',
    );
  });
});
