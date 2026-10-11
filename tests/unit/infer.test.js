const { test } = require('node:test');
const assert = require('node:assert');

const { Schema, Model } = require('../../index.js');
const { infer, sample, register } = require('../../src/model/index.js');
const { compile, canEval } = require('../../src/compile/index.js');
const fixture = require('../fixtures/schemas/index.js');

const { database, types: customTypes, ...schemas } = fixture;

// The definition inferred, as a Schema on both backends: every sample passes
// both, as the self-check promises.
const both = (samples, options = {}) => {
  const a = infer(samples, { ...options, as: 'schema' });
  const b = infer(samples, { ...options, as: 'schema' });
  assert.strictEqual(compile(b, { jit: canEval() ? true : 'auto' }).accelerated, canEval());
  for (const value of samples) {
    for (const schema of [a, b]) assert.deepStrictEqual(schema.check(value).errors, []);
  }
  return [a, b];
};

// A document with one key, whatever the key (`{ ['__proto__']: 1 }` in
// source would set the prototype).
const docOf = (key, value = 'v') => JSON.parse(`{${JSON.stringify(key)}:${JSON.stringify(value)}}`);

test('Infer: every form of a value has a definition', () => {
  const cases = [
    [['a', 'b'], 'string'],
    [[1, 2], 'integer'],
    [[1, 2.5], 'number'],
    [[1, Number.NaN], 'number'],
    [[Number.POSITIVE_INFINITY], 'number'],
    [[-0, 1e21], 'integer'],
    [[1n], 'bigint'],
    [[true, false], 'boolean'],
    [[new Date()], 'date'],
    [[new Date('nope')], 'any'],
    [[() => 1], 'any'],
    [[Symbol('s')], 'any'],
    [[null], 'null'],
    [[undefined], '?unknown'],
    [[null, undefined], '?null'],
    [[new Set([1])], { set: 'integer' }],
    [[new Set()], { set: 'unknown' }],
    [[new Map([['a', 1]])], { map: { string: 'integer' } }],
    [[new Map([[1, 'x']])], { map: { number: 'string' } }],
    [[new Map([[Symbol('k'), 1]])], 'json'],
    [[new Map()], { map: { string: 'unknown' }, required: false }],
    [[[]], { array: 'unknown' }],
    [[[1], [2.5]], { array: 'number' }],
    [[[1, 'a', { y: 1 }]], { array: { union: ['integer', 'string', { y: 'integer' }] } }],
    [[[null, 1]], { array: '?integer' }],
  ];
  for (const [samples, expected] of cases) {
    assert.deepStrictEqual(infer(samples), expected, JSON.stringify(expected));
    both(samples);
  }
  // Whole numbers are integers unless told otherwise.
  assert.deepStrictEqual(infer([{ n: 1 }], { integer: false }), { Struct: {}, n: 'number' });
  // Any object is a record of its own enumerable keys, as the check reads it.
  class Point {
    constructor() {
      this.x = 1;
      this.y = 2;
    }
  }
  assert.deepStrictEqual(infer([new Point()]), { Struct: {}, x: 'integer', y: 'integer' });
  both([new Point()]);
  assert.deepStrictEqual(infer([/a/u]), { Struct: {} });
  both([/a/u, /b/u]);
  assert.deepStrictEqual(infer([Buffer.from([1, 2])]), { object: { string: 'integer' } });
  both([Buffer.from([1, 2])]);
  // A fake Date, Set or Map is a record.
  assert.deepStrictEqual(infer([{ constructor: { name: 'Date' } }]), {
    Struct: {},
    constructor: { name: 'string' },
  });
  both([{ constructor: { name: 'Set' } }]);
});

test('Infer: a key absent or undefined is optional, null beside a type nullable', () => {
  const cases = [
    [[{ a: 'x' }, {}], { Struct: {}, a: '?string' }],
    [[{ a: 'x' }, { a: null }], { Struct: {}, a: { type: 'string', nullable: true } }],
    [[{ a: 'x' }, { a: null }, {}], { Struct: {}, a: '?string' }],
    [[{ a: 'x' }, { a: undefined }], { Struct: {}, a: '?string' }],
    [[{ a: [1, null] }], { Struct: {}, a: { array: '?integer' } }],
    [
      [{ a: { b: 1 } }, { a: null }],
      { Struct: {}, a: { schema: { b: 'integer' }, nullable: true } },
    ],
    [[{ a: { b: 1 } }, {}], { Struct: {}, a: { schema: { b: 'integer' }, required: false } }],
    [[{ a: ['x'] }, {}], { Struct: {}, a: { array: 'string', required: false } }],
    [[{ a: ['x'] }, { a: null }], { Struct: {}, a: { array: 'string', nullable: true } }],
    [
      [{ a: 1 }, { a: 'x' }, { a: null }],
      { Struct: {}, a: { union: ['integer', 'string'], nullable: true } },
    ],
    [[{ a: null }, { a: null }], { Struct: {}, a: 'null' }],
    [[{ a: null }, {}], { Struct: {}, a: '?null' }],
    [[{ a: undefined }], { Struct: {}, a: '?unknown' }],
    [[{ a: new Map([['k', null]]) }], { Struct: {}, a: { map: { string: 'null' } } }],
    [[{ a: [null] }, { a: [undefined] }], { Struct: {}, a: { array: '?null' } }],
  ];
  for (const [samples, expected] of cases) {
    assert.deepStrictEqual(infer(samples), expected, JSON.stringify(expected));
    both(samples);
  }
});

test('Infer: a string of few values, each seen twice on average, is an enum', () => {
  const statuses = (list) => list.map((status) => ({ status }));
  const mixed = ['a', 'b', 'a', 'b', 'c', 'a', 'b', 'c', 'a', 'a'];
  assert.deepStrictEqual(infer(statuses(mixed)), { Struct: {}, status: { enum: ['a', 'b', 'c'] } });
  both(statuses(mixed));
  // Fewer than four samples, or more distinct values than half the samples: a string.
  assert.deepStrictEqual(infer(statuses(['a', 'b'])), { Struct: {}, status: 'string' });
  assert.deepStrictEqual(infer(statuses(['a', 'a', 'a'])), { Struct: {}, status: 'string' });
  assert.deepStrictEqual(infer(statuses(['a', 'a', 'a', 'a'])), {
    Struct: {},
    status: { enum: ['a'] },
  });
  assert.deepStrictEqual(infer(statuses(['a', 'b', 'c', 'd', 'a', 'b'])), {
    Struct: {},
    status: 'string',
  });
  // More distinct values than the option, or the option off: a string.
  const nine = [
    'a',
    'b',
    'c',
    'd',
    'e',
    'f',
    'g',
    'h',
    'i',
    'a',
    'b',
    'c',
    'd',
    'e',
    'f',
    'g',
    'h',
    'i',
  ];
  assert.deepStrictEqual(infer(statuses(nine)), { Struct: {}, status: 'string' });
  assert.deepStrictEqual(infer(statuses(nine), { enum: 9 }), {
    Struct: {},
    status: { enum: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] },
  });
  assert.deepStrictEqual(infer(statuses(mixed), { enum: 2 }), { Struct: {}, status: 'string' });
  assert.deepStrictEqual(infer(statuses(mixed), { enum: 0 }), { Struct: {}, status: 'string' });
  assert.deepStrictEqual(infer(statuses(mixed), { enum: false }), { Struct: {}, status: 'string' });
  // Strings only, in a union too; the values keep the order of first sight.
  const union = [{ v: 'b' }, { v: 1 }, { v: 'a' }, { v: 'b' }, { v: 'a' }, { v: 'b' }];
  assert.deepStrictEqual(infer(union), {
    Struct: {},
    v: { union: ['integer', { enum: ['b', 'a'] }] },
  });
  both(union);
  const numbers = [{ n: 1 }, { n: 2 }, { n: 1 }, { n: 2 }];
  assert.deepStrictEqual(infer(numbers), { Struct: {}, n: 'integer' });
});

test('Infer: records whose keys are not names, or many sparse keys of one kind, are a dictionary', () => {
  assert.deepStrictEqual(infer([{ '2020-01-01': 1, '2020-01-02': 2 }]), {
    object: { string: 'integer' },
  });
  both([{ '2020-01-01': 1, '2020-01-02': 2 }, {}]);
  assert.deepStrictEqual(infer([{ scores: { 'u-1': 1, 'u-2': 2.5 } }]), {
    Struct: {},
    scores: { object: { string: 'number' } },
  });
  assert.deepStrictEqual(infer([{ scores: { 'u-1': 1 } }, { scores: {} }]), {
    Struct: {},
    scores: { object: { string: 'integer' }, required: false },
  });
  // Twenty ids over five records, each a record of the same shape.
  const docs = Array.from({ length: 5 }, (_, i) => {
    const byId = {};
    for (let j = 0; j < 4; j += 1) {
      byId[`k${i * 4 + j}`] = j === 0 ? { n: i, extra: true } : { n: i };
    }
    return { byId };
  });
  assert.deepStrictEqual(infer(docs), {
    Struct: {},
    byId: { object: { string: { n: 'integer', extra: '?boolean' } } },
  });
  both(docs);
  // A wide entity with a key every record carries, or mixed kinds, stays a struct.
  const wide = Array.from({ length: 3 }, (_, i) => {
    const row = { id: i };
    for (let j = 0; j < 20; j += 1) row[`c${j}`] = j % 2 === 0 ? i : `${i}`;
    return row;
  });
  const definition = infer(wide);
  assert.strictEqual(definition.id, 'integer');
  assert.strictEqual(Object.keys(definition).length, 22);
  // The option moves the threshold, or keeps every record a struct.
  assert.deepStrictEqual(infer(docs, { map: 3 }).byId.object.string.n, 'integer');
  const structs = infer(docs, { map: false });
  assert.strictEqual(Object.keys(structs.byId).length, 20);
  assert.deepStrictEqual(structs.byId.k0, {
    schema: { n: 'integer', extra: 'boolean' },
    required: false,
  });
  assert.deepStrictEqual(infer([{ '2020-01-01': 1 }], { map: false }), {
    Struct: {},
    '2020-01-01': 'integer',
  });
  both([{ '2020-01-01': 1 }], { map: false });
  // Cyrillic keys are names.
  assert.deepStrictEqual(infer([{ імʼя: 'x', вік: 1 }]), {
    Struct: {},
    імʼя: 'string',
    вік: 'integer',
  });
});

test('Infer: values of several kinds at one place are a union, the record last', () => {
  assert.deepStrictEqual(infer([{ v: 1 }, { v: 'a' }]), {
    Struct: {},
    v: { union: ['integer', 'string'] },
  });
  assert.deepStrictEqual(infer([{ v: 1 }, { v: 1.5 }]), { Struct: {}, v: 'number' });
  const sets = [
    { v: new Set([1]) },
    { v: { a: 1 } },
    { v: new Map([['k', 1]]) },
    { v: new Date() },
  ];
  assert.deepStrictEqual(infer(sets), {
    Struct: {},
    v: { union: ['date', { set: 'integer' }, { map: { string: 'integer' } }, { a: 'integer' }] },
  });
  both(sets);
  assert.deepStrictEqual(infer([{ v: [1] }, { v: 'x' }, { v: null }]), {
    Struct: {},
    v: { union: ['string', { array: 'integer' }], nullable: true },
  });
  assert.deepStrictEqual(infer([{ v: true }, { v: 1 }, {}]), {
    Struct: {},
    v: { union: ['boolean', 'integer'], required: false },
  });
  const typed = [{ v: new Date() }, { v: { type: 'x' } }, { v: 2n }];
  assert.deepStrictEqual(infer(typed), {
    Struct: {},
    v: { union: ['bigint', 'date', { schema: { type: 'string' } }] },
  });
  both(typed);
  both([1, 'a', true, null, [1], { a: 1 }, new Date(), 1n, new Set([1])]);
});

test('Infer: nested records fuse, elements fuse, at any depth', () => {
  assert.deepStrictEqual(infer([{ a: { b: 1 } }, { a: { c: 'x' } }]), {
    Struct: {},
    a: { b: '?integer', c: '?string' },
  });
  assert.deepStrictEqual(infer([{ a: [{ x: 1 }, { y: 2 }] }]), {
    Struct: {},
    a: { array: { x: '?integer', y: '?integer' } },
  });
  assert.deepStrictEqual(infer([{ a: { b: { c: { d: 1 } } } }]), {
    Struct: {},
    a: { b: { c: { d: 'integer' } } },
  });
  const byDay = [{ byDay: { '2020-01-01': [{ n: 1 }], '2020-01-02': [{ n: 2, m: 3 }] } }];
  assert.deepStrictEqual(infer(byDay), {
    Struct: {},
    byDay: { object: { string: { array: { n: 'integer', m: '?integer' } } } },
  });
  both(byDay);
  both([{ a: { b: [{ c: new Map([['k', [1, 'x']]]) }] } }]);
});

test('Infer: the root is a struct with its kind, or the definition of one type', () => {
  assert.deepStrictEqual(infer([{ a: 1 }]), { Struct: {}, a: 'integer' });
  assert.deepStrictEqual(infer([{ a: 1 }], { kind: 'entity', name: 'Order' }), {
    Entity: {},
    a: 'integer',
  });
  const order = infer([{ a: 1 }], { kind: 'entity', name: 'Order', as: 'schema' });
  assert.strictEqual(order instanceof Schema, true);
  assert.strictEqual(order.name, 'Order');
  assert.strictEqual(order.kind, 'entity');
  assert.deepStrictEqual(Object.keys(order.fields), ['a', 'orderId']);
  // The id field of a stored kind wins over a field of the same name, and
  // the self-check says so.
  assert.throws(() => infer([{ orderId: 1 }], { kind: 'entity', name: 'Order' }), {
    name: 'SchemaDefinitionError',
    code: 'ERR_INFER_MISMATCH',
    index: 0,
    message:
      'The inferred definition rejects sample 0 at "Order.orderId": not of expected type: string',
  });
  assert.strictEqual(infer(['a']), 'string');
  assert.deepStrictEqual(infer([1, 'a']), { union: ['integer', 'string'] });
  assert.strictEqual(infer([null, 1]), '?integer');
  assert.deepStrictEqual(infer([{ a: 1 }, 1]), { union: ['integer', { a: 'integer' }] });
  assert.deepStrictEqual(infer([{ a: 1 }, null]), { union: [{ a: 'integer' }], required: false });
  assert.deepStrictEqual(infer([{ a: 1 }, undefined]), {
    union: [{ a: 'integer' }],
    required: false,
  });
  both([{ a: 1 }, null]);
  both([null, 1]);
  // As a Schema: the name, and the same acceptance.
  const user = infer([{ name: 'x' }, { name: 'y', age: 1 }], { as: 'schema', name: 'User' });
  assert.strictEqual(user.name, 'User');
  assert.strictEqual(user.check({ name: 'z' }).valid, true);
  assert.deepStrictEqual(user.check({ name: 1 }).errors, [
    'Field "User.name" not of expected type: string',
  ]);
  assert.deepStrictEqual(user.check({ name: 'z', extra: 1 }).errors, [
    'Field "User" has unexpected keys: extra',
  ]);
  const typed = infer([{ type: 'a', string: 1 }], { as: 'schema' });
  assert.strictEqual(typed.check({ type: 'b', string: 2 }).valid, true);
});

test('Infer: every key of the data is a key of the definition', () => {
  const keys = [
    '__proto__',
    'constructor',
    'toString',
    '_id',
    '$set',
    'type',
    'string',
    'date',
    'Name',
  ];
  const fields = [
    'required',
    'nullable',
    'validate',
    'parse',
    'default',
    'aliases',
    'schema',
    'union',
  ];
  for (const key of [...keys, ...fields]) {
    const doc = docOf(key);
    assert.deepStrictEqual(infer([doc]), { Struct: {}, ...docOf(key, 'string') }, key);
    const [schema] = both([doc]);
    assert.strictEqual(schema.check(docOf(key, 1)).valid, false, key);
    // Nested: bare where the struct reads as one, wrapped where it does not.
    const nested = infer([{ a: doc }]);
    const bare = !['type', 'string', 'date', 'Name', 'schema', 'union'].includes(key);
    assert.deepStrictEqual(
      nested,
      { Struct: {}, a: bare ? docOf(key, 'string') : { schema: docOf(key, 'string') } },
      key,
    );
    both([{ a: doc }, { a: doc }]);
    // The definition is data: it survives JSON.
    const copy = JSON.parse(JSON.stringify(infer([{ a: doc }])));
    assert.strictEqual(Schema.from(copy).check({ a: doc }).valid, true, key);
  }
  // A key that is not a name makes the record a dictionary, from one sample on.
  for (const key of ['', '1', 'a b', '2020-01-01']) {
    assert.deepStrictEqual(infer([docOf(key)]), { object: { string: 'string' } }, key);
    assert.deepStrictEqual(
      infer([{ a: docOf(key) }]),
      { Struct: {}, a: { object: { string: 'string' } } },
      key,
    );
    both([docOf(key)]);
    assert.deepStrictEqual(
      infer([docOf(key)], { map: false }),
      { Struct: {}, ...docOf(key, 'string') },
      key,
    );
    both([docOf(key)], { map: false });
  }
  // A key ending in `?` is written with one more and read as that key.
  assert.deepStrictEqual(infer([{ name: 'x', 'foo?': 1 }]), {
    Struct: {},
    name: 'string',
    'foo??': 'integer',
  });
  const [odd] = both([{ name: 'x', 'foo?': 1 }]);
  assert.strictEqual(Object.hasOwn(odd.fields, 'foo?'), true);
  assert.strictEqual(odd.check({ name: 'y' }).valid, true);
  // The names of the methods of a field are keys like any other.
  const methods = { check: 1, checkType: 2, compile: 3, construct: 4, toJSON: 5 };
  assert.deepStrictEqual(infer([methods]), {
    Struct: {},
    check: 'integer',
    checkType: 'integer',
    compile: 'integer',
    construct: 'integer',
    toJSON: 'integer',
  });
  both([methods]);
  // Symbol keys, inherited keys and keys that do not enumerate are not keys.
  assert.deepStrictEqual(infer([{ [Symbol('s')]: 1, a: 1 }]), { Struct: {}, a: 'integer' });
  const inherited = Object.assign(Object.create({ parent: 1 }), { a: 1 });
  assert.deepStrictEqual(infer([inherited]), { Struct: {}, a: 'integer' });
  both([inherited]);
  const hidden = Object.defineProperty({ a: 1 }, 'b', { value: 2 });
  assert.deepStrictEqual(infer([hidden]), { Struct: {}, a: 'integer' });
  both([hidden]);
  // The samples are never written to.
  const frozen = Object.freeze({ a: Object.freeze([1, 2]) });
  infer([frozen]);
});

test('Infer: a sample nested deeper than maxDepth is an error with its place', () => {
  let deep = 1;
  for (let level = 0; level < 130; level += 1) deep = { k: deep };
  assert.throws(() => infer([deep]), {
    name: 'SchemaDefinitionError',
    code: 'ERR_INFER_DEPTH',
    message: /^Sample 0 nests deeper than 128 levels at "(k\.){127}k" \(a cycle\?\)$/,
  });
  assert.throws(() => infer([{}, deep]), { message: /^Sample 1 nests/ });
  const cycle = { name: 'loop' };
  cycle.self = cycle;
  assert.throws(() => infer([cycle]), {
    code: 'ERR_INFER_DEPTH',
    message: /at "(self\.){127}self"/,
  });
  assert.throws(() => infer([{ items: [cycle] }], { maxDepth: 4 }), {
    message: 'Sample 0 nests deeper than 4 levels at "items[].self.self" (a cycle?)',
  });
  assert.throws(() => infer([{ a: { b: { c: { d: 1 } } } }], { maxDepth: 3 }), {
    code: 'ERR_INFER_DEPTH',
    message: 'Sample 0 nests deeper than 3 levels at "a.b.c" (a cycle?)',
  });
  assert.deepStrictEqual(infer([{ a: { b: { c: 1 } } }], { maxDepth: 3 }), {
    Struct: {},
    a: { b: { c: 'integer' } },
  });
  assert.throws(() => infer([{ 'a b': { 1: [[1]] } }], { maxDepth: 2 }), {
    message: 'Sample 0 nests deeper than 2 levels at "["a b"]["1"]" (a cycle?)',
  });
});

test('Infer: a wrong argument is a TypeError, a wrong option ERR_INVALID_OPTIONS', () => {
  for (const bad of [undefined, null, 1, {}, 'samples', { next: () => ({}) }]) {
    assert.throws(() => infer(bad), {
      name: 'TypeError',
      code: 'ERR_INVALID_TARGET',
      message: 'An iterable of samples is expected',
    });
  }
  for (const empty of [[], new Set(), (function* () {})()]) {
    assert.throws(() => infer(empty), {
      code: 'ERR_INVALID_TARGET',
      message: 'At least one sample is expected',
    });
  }
  const invalid = (options, message) =>
    assert.throws(() => infer([1], options), {
      name: 'SchemaDefinitionError',
      code: 'ERR_INVALID_OPTIONS',
      message,
    });
  invalid(null, 'Infer options must be an object');
  invalid({ as: 'json' }, 'Infer option "as" must be "definition" or "schema"');
  invalid({ name: 1 }, 'Infer option "name" must be a string');
  invalid({ kind: '' }, 'Infer option "kind" must be the name of a kind');
  invalid({ enum: -1 }, 'Infer option "enum" must be an integer of at least 0, or false');
  invalid({ enum: 'many' }, 'Infer option "enum" must be an integer of at least 0, or false');
  invalid({ integer: 1 }, 'Infer option "integer" must be a boolean');
  invalid({ map: 0 }, 'Infer option "map" must be an integer of at least 1, or false');
  invalid({ maxDepth: 0 }, 'Infer option "maxDepth" must be an integer from 1 to 128');
  invalid({ maxDepth: 129 }, 'Infer option "maxDepth" must be an integer from 1 to 128');
  // A Set or a generator is a fine source.
  assert.strictEqual(infer(new Set(['a'])), 'string');
  assert.strictEqual(
    infer(
      (function* () {
        yield 1;
      })(),
    ),
    'integer',
  );
});

test('Infer: a definition inferred from samples of a schema accepts further samples', () => {
  const types = { datetime: { js: 'string' }, ...customTypes };
  const model = new Model(types, Object.entries(schemas), database);
  const seeds = Array.from({ length: 24 }, (_, index) => index + 1);
  const later = Array.from({ length: 24 }, (_, index) => index + 100);
  const roundTrip = (schema, options) => {
    const samples = seeds.map((seed) => sample(schema, { seed, ...options }));
    const inferred = both(samples, { name: schema.name });
    for (const seed of later) {
      const value = sample(schema, { seed, ...options });
      for (const target of inferred) {
        assert.deepStrictEqual(target.check(value).errors, [], `${schema.name} seed ${seed}`);
      }
    }
    return inferred[0];
  };
  for (const entity of model.entities.values()) roundTrip(entity, { references: 'id' });
  // Every form of the language. What does not come back: a reference is the
  // string of its id, a pattern and the bounds are gone, a custom type is
  // what it validates as, a tuple is a list, a discriminated union one
  // struct with optional keys, a validate function and the annotations are
  // not in the data.
  const every = new Schema('S', {
    name: { type: 'string', length: { min: 2, max: 5 } },
    'nick?': { type: 'string', length: 3 },
    age: { type: 'number', min: 0, max: 150 },
    count: { type: 'integer', min: 0, max: 3 },
    big: { type: 'bigint', min: 0n, max: 10n },
    ratio: { type: 'number', nullable: true },
    flag: 'boolean',
    when: 'date',
    nothing: 'null',
    'maybe?': 'null',
    data: 'json',
    role: { enum: ['admin', 'editor', 'viewer'] },
    tags: { array: 'string', length: { min: 1, max: 3 } },
    ids: { set: 'number', length: { min: 2, max: 4 } },
    scores: { object: { string: 'number' }, length: 2 },
    'byId?': { map: { number: 'boolean' } },
    byName: { map: { string: { x: 'integer' } } },
    matrix: { array: { array: 'number' } },
    point: ['number', { label: 'string' }, { 'note?': 'string' }, ['boolean']],
    id: { union: ['string', 'number'] },
    shape: {
      union: [
        { Struct: {}, kind: { enum: ['circle'] }, r: 'number' },
        { Struct: {}, kind: { enum: ['square'] }, side: 'number' },
      ],
      discriminator: 'kind',
    },
    address: { city: 'string', 'zip?': { type: 'string', pattern: '^\\d{5}$', length: 5 } },
    nested: { schema: { a: { b: { c: 'string' } } } },
    checked: { type: 'string', validate: (value) => value.length > 2 || 'too short' },
    half: (value) => value.age / 2,
  });
  const inferred = roundTrip(every);
  assert.strictEqual(inferred.fields.role.type, 'enum');
  assert.strictEqual(inferred.fields.shape.type, 'schema');
  assert.strictEqual(inferred.fields.point.type, 'array');
  assert.strictEqual(inferred.fields.checked.validate, undefined);
  assert.strictEqual(inferred.fields.ratio.nullable, true);
});

test('Infer: register() installs Schema.infer, once', () => {
  assert.strictEqual(Schema.infer, undefined);
  register();
  register();
  assert.strictEqual(Schema.infer, infer);
  assert.strictEqual(Object.getOwnPropertyDescriptor(Schema, 'infer').enumerable, false);
  assert.deepStrictEqual(Schema.infer([{ a: 1 }]), { Struct: {}, a: 'integer' });
  assert.strictEqual(Schema.infer([{ a: 1 }], { as: 'schema' }) instanceof Schema, true);
});
