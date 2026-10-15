const { test } = require('node:test');
const assert = require('node:assert');
const util = require('node:util');

const { Schema, Model } = require('../../index.js');
const { COERCIONS, coerce, register } = require('../../src/coerce/index.js');
const { COERCION } = require('../../src/codec.js');
const { compile, canEval } = require('../../src/compile/index.js');
const { parseEach, parseEachAsync, transform } = require('../../src/stream/index.js');
const { sample, fromJSON } = require('../../src/model/index.js');

// A schema checked on both backends: the schema, and a compiled copy.
const both = (make) => {
  const schema = make();
  const copy = make();
  assert.strictEqual(compile(copy, { jit: canEval() ? true : 'auto' }).accelerated, canEval());
  return [schema, copy];
};

const valueOf = (schema, value, options = { coerce: true }) => {
  const result = schema.parse(value, options);
  assert.strictEqual(result.valid, true, JSON.stringify(result.issues));
  return result.value;
};

const notRegistered = { name: 'TypeError', code: 'ERR_NOT_REGISTERED' };

test('Coerce: before register() nothing converts, and a parse that would says so', () => {
  assert.deepStrictEqual(Object.keys(COERCIONS), []);
  const form = new Schema('Form', { Form: { coerce: true }, age: 'integer' });
  const field = Schema.from({ age: { type: 'integer', coerce: true } });
  const plain = Schema.from({ age: 'integer' });
  // Built without a complaint: the converters are looked up when a value
  // is converted, not when a schema is built. A parse that coerces says so
  // as it enters the schema, whatever the value holds: an empty body in a
  // test does not hide a missing register() from the program.
  assert.throws(() => form.parse({ age: '42' }), notRegistered);
  assert.throws(() => form.parse({}), notRegistered);
  assert.throws(() => form['~standard'].validate({}), notRegistered);
  assert.throws(() => field.parse({ age: '42' }), notRegistered);
  assert.throws(() => plain.parse({ age: '42' }, { coerce: true }), notRegistered);
  assert.throws(() => plain.parse({}, { coerce: true }), {
    ...notRegistered,
    message: 'coerce needs register() of @alexify/metaschema/coerce first',
  });
  assert.throws(() => coerce(plain, { age: '42' }), notRegistered);
  assert.throws(() => coerce(plain, {}), notRegistered);
  // A field's own policy is the one place a parse without the policy of
  // the call or the schema enters the subtree: it says so too.
  assert.throws(() => field.parse({}), notRegistered);
  // Check, serialize and a parse without the policy never convert.
  assert.strictEqual(form.check({ age: 1 }).valid, true);
  assert.deepStrictEqual(form.serialize({ age: 1 }).value, { age: 1 });
  assert.deepStrictEqual(plain.parse({ age: '42' }).issues[0].params, {
    expected: 'integer',
    received: 'string',
  });
  assert.strictEqual(form.parse({ age: 1 }, { coerce: false }).valid, true);
  // The options are what they must be.
  assert.throws(() => plain.parse({ age: 1 }, { coerce: 'yes' }), {
    name: 'TypeError',
    message: 'coerce must be a boolean, got "yes"',
  });
  assert.throws(() => Schema.from({ age: { type: 'integer', coerce: 1 } }), {
    code: 'ERR_INVALID_DEFINITION',
    message: 'Option "coerce" needs a boolean in "age"',
  });
  assert.throws(() => new Schema('Bad', { Form: { coerce: 'on' }, a: 'string' }), {
    code: 'ERR_INVALID_OPTIONS',
    message: 'Schema metadata "coerce" must be a boolean, got "on"',
  });
  assert.strictEqual(form.coerce, undefined);
  // The slot that resolves a converter says the same to a caller that reaches it directly.
  assert.throws(() => COERCION.resolve({}), notRegistered);
});

test('Coerce: register() fills the table once, and only with converters of types', () => {
  register();
  register();
  assert.deepStrictEqual(Object.keys(COERCIONS), [
    'string',
    'number',
    'integer',
    'bigint',
    'boolean',
    'date',
    'bytes',
    'enum',
    'array',
    'set',
    'map',
  ]);
  const descriptor = Object.getOwnPropertyDescriptor(Schema.prototype, 'coerce');
  assert.strictEqual(descriptor.enumerable, false);
  assert.throws(() => register({ number: Number }), {
    name: 'SchemaDefinitionError',
    code: 'ERR_COERCION_REGISTERED',
    message: 'Converter "number" is registered already with another function',
  });
  for (const [custom, message] of [
    [null, 'The converters must be an object of functions by type name'],
    [[], 'The converters must be an object of functions by type name'],
    [{ Money: (value) => value }, 'Converter "Money" needs the name of a type'],
    [JSON.parse('{"__proto__": 1}'), 'Converter "__proto__" needs the name of a type'],
    [{ money: 'number' }, 'Converter "money" must be a function'],
  ]) {
    assert.throws(() => register(custom), { code: 'ERR_INVALID_COERCION', message });
  }
  const own = (value) => value;
  register({ ownType: own });
  register({ ownType: own });
  assert.strictEqual(COERCIONS.ownType, own);
  // A call with a bad entry registers nothing, whatever came before it.
  assert.throws(() => register({ firstType: own, Second: own }), { code: 'ERR_INVALID_COERCION' });
  assert.throws(() => register({ thirdType: own, number: own }), {
    code: 'ERR_COERCION_REGISTERED',
  });
  assert.strictEqual(COERCIONS.firstType, undefined);
  assert.strictEqual(COERCIONS.thirdType, undefined);
});

const TABLE = {
  number: {
    converted: [
      ['42', 42],
      ['-1.5', -1.5],
      ['+.5', 0.5],
      ['1e3', 1000],
      ['-0', -0],
      [10n, 10],
    ],
    kept: ['', ' 42', '42 ', '0x10', 'Infinity', 'NaN', '1e400', '1,5', true, 2n ** 60n],
  },
  integer: {
    converted: [
      ['42', 42],
      ['-7', -7],
      ['1.0', 1],
      [3n, 3],
    ],
    kept: ['1.5', '9007199254740993', '', 'abc', 1.5],
  },
  bigint: {
    converted: [
      ['42', 42n],
      ['-12345678901234567890', -12345678901234567890n],
      [7, 7n],
    ],
    kept: ['1.0', '', '1e3', 1.5, 2 ** 60],
  },
  boolean: {
    converted: [
      ['true', true],
      ['false', false],
      ['1', true],
      ['0', false],
      [1, true],
      [0, false],
    ],
    kept: ['yes', 'on', 'TRUE', 'False', '', 2, -1],
  },
  date: {
    converted: [
      ['2026-02-28', new Date(Date.UTC(2026, 1, 28))],
      ['2024-02-29', new Date(Date.UTC(2024, 1, 29))],
      ['2026-10-13T10:20:30Z', new Date(Date.UTC(2026, 9, 13, 10, 20, 30))],
      ['2026-10-13 10:20:30.5+02:00', new Date(Date.UTC(2026, 9, 13, 8, 20, 30, 500))],
      ['2026-10-13t10:20:30z', new Date(Date.UTC(2026, 9, 13, 10, 20, 30))],
      [0, new Date(0)],
    ],
    kept: [
      '2026-02-29',
      '2026-02-31',
      '2026-13-01',
      '2026-10-13T10:20:30',
      '2026-10-13T24:00:00Z',
      '13.10.2026',
      '',
      NaN,
      Infinity,
      true,
    ],
  },
  string: {
    converted: [
      [42, '42'],
      [-1.5, '-1.5'],
      [10n, '10'],
      [true, 'true'],
    ],
    kept: [NaN, Infinity, new Date(0), {}, []],
  },
};

test('Coerce: what each built-in converter reads, and what it leaves to the check', () => {
  for (const type of Object.keys(TABLE)) {
    for (const schema of both(() => Schema.from({ value: type }))) {
      for (const [given, expected] of TABLE[type].converted) {
        assert.deepStrictEqual(
          valueOf(schema, { value: given }).value,
          expected,
          `${type} ${given}`,
        );
      }
      for (const given of TABLE[type].kept) {
        const result = schema.parse({ value: given }, { coerce: true });
        assert.strictEqual(result.valid, false, `${type} ${String(given)}`);
        // Reported for the value given.
        assert.strictEqual(result.issues[0].code, 'type');
        assert.deepStrictEqual(result.issues[0].path, ['value']);
      }
    }
  }
});

test('Coerce: bytes from canonical base64 only', () => {
  register();
  const schema = Schema.from({ data: 'bytes' });
  const read = (data) => {
    const result = schema.parse({ data }, { coerce: true });
    return result.valid ? Array.from(result.value.data) : result.issues[0].code;
  };
  assert.deepStrictEqual(read('QQ=='), [65]);
  assert.deepStrictEqual(read('QUI='), [65, 66]);
  assert.deepStrictEqual(read('QUJD'), [65, 66, 67]);
  assert.deepStrictEqual(read('AAAAAAAA'), [0, 0, 0, 0, 0, 0]);
  assert.deepStrictEqual(read('/+8='), [255, 239]);
  assert.deepStrictEqual(read('AA=='), [0]);
  // The text of no bytes is the empty string: an exception to the rule that
  // '' is never converted, since it is what an encoder writes for them.
  assert.deepStrictEqual(read(''), []);
  // What a decoder would forgive is left to the check: the bits the padding
  // leaves unused, the padding itself, whitespace, the URL alphabet.
  for (const text of [
    'QR==',
    'QUI',
    '====',
    'A===',
    '=QUJ',
    'QU=J',
    'QUJ=',
    'QQ',
    'QQ=',
    'Q===',
    'QUJD\n',
    ' QUJD',
    '_-8=',
    'QU JD',
  ]) {
    assert.strictEqual(read(text), 'type', JSON.stringify(text));
  }
  // A view already is bytes; another value is the check's.
  const bytes = new Uint8Array([1]);
  assert.strictEqual(schema.parse({ data: bytes }, { coerce: true }).value.data, bytes);
  assert.strictEqual(read(7), 'type');
  // Linear on hostile text.
  const started = Date.now();
  assert.strictEqual(read(`${'A'.repeat(1_000_000)}!`), 'type');
  assert.strictEqual(read(`${'AAAA'.repeat(250_000)}A===`), 'type');
  assert.ok(Date.now() - started < 1000);
  // A valid text of megabytes: one expression of quanta overflowed the stack
  // of the engine on it, and the converter left the text to the check.
  const large = schema.parse({ data: `${'AAAA'.repeat(4_000_000)}/w==` }, { coerce: true });
  assert.strictEqual(large.valid, true);
  assert.strictEqual(large.value.data.length, 12_000_001);
  assert.strictEqual(large.value.data[12_000_000], 255);
});

test('Coerce: enums, collections and maps', () => {
  const schema = Schema.from({
    level: { enum: [1, 2, 3] },
    flag: { enum: [true, 'auto'] },
    word: { enum: ['1', 'b'] },
    tags: { array: 'string' },
    ids: { array: 'integer' },
    seen: { set: 'integer' },
    one: { set: 'string' },
    scores: { map: { string: 'number' } },
    byId: { map: { number: 'boolean' } },
    pairs: { map: { string: 'date' } },
  });
  for (const parsed of both(() => schema)) {
    const value = valueOf(parsed, {
      level: '2',
      flag: 'true',
      word: 1,
      tags: 'a',
      ids: ['1', '2'],
      seen: ['1', '1', '2'],
      one: 'x',
      scores: { a: '1.5' },
      byId: { 1: '1', 20: 'false' },
      pairs: [['at', '2026-01-01']],
    });
    assert.deepStrictEqual(value, {
      level: 2,
      flag: true,
      word: '1',
      tags: ['a'],
      ids: [1, 2],
      seen: new Set([1, 2]),
      one: new Set(['x']),
      scores: new Map([['a', 1.5]]),
      byId: new Map([
        [1, true],
        [20, false],
      ]),
      pairs: new Map([['at', new Date(Date.UTC(2026, 0, 1))]]),
    });
  }
  // A value that is no member written otherwise stays what it was.
  for (const level of ['5', {}, 'two']) {
    assert.strictEqual(schema.parse({ level }, { coerce: true }).issues[0].path[0], 'level');
  }
  // A member given as it is stays; an empty string is not a list of one.
  const kept = Schema.from({ word: { enum: ['', 'a'] }, tags: { array: 'string' } });
  assert.deepStrictEqual(valueOf(kept, { word: '', tags: ['a'] }), { word: '', tags: ['a'] });
  assert.strictEqual(kept.parse({ word: 'a', tags: '' }, { coerce: true }).valid, false);
  assert.strictEqual(schema.parse({ ids: { 0: '1' } }, { coerce: true }).valid, false);
  // A Set given where a list is expected is the list of its values.
  assert.deepStrictEqual(valueOf(Schema.from({ l: { array: 'number' } }), { l: new Set(['1']) }), {
    l: [1],
  });
  // Pairs that are not pairs stay, and so does an object that is not plain:
  // the entries of a Set, a Date or a typed array are not those of a map.
  const maps = Schema.from({
    m: { map: { string: 'string' } },
    'n?': { map: { string: 'number' } },
  });
  assert.strictEqual(maps.parse({ m: [['a']] }, { coerce: true }).valid, false);
  for (const m of [new Set(['a']), new Date(0), new Uint8Array([1, 2]), Buffer.from('ab')]) {
    const result = maps.parse({ m }, { coerce: true });
    assert.strictEqual(result.valid, false, String(m));
    assert.strictEqual(maps.parse({ m: new Map(), n: m }, { coerce: true }).valid, false);
  }
  const bare = Object.assign(Object.create(null), { a: 'x' });
  assert.deepStrictEqual(valueOf(maps, { m: bare }), { m: new Map([['a', 'x']]) });
});

test('Coerce: the converters are linear on hostile strings', () => {
  const schema = Schema.from({ n: '?number', i: '?integer', b: '?bigint', d: '?date' });
  const hostile = [
    `${'1'.repeat(100_000)}x`,
    `${'1'.repeat(100_000)}.`,
    `${'1'.repeat(100_000)}e`,
    `.${'1'.repeat(100_000)}e+`,
    `-${'0'.repeat(100_000)}.${'0'.repeat(100_000)}!`,
    `2026-01-01T00:00:00.${'0'.repeat(100_000)}+`,
  ];
  for (const text of hostile) {
    const started = performance.now();
    const result = schema.parse({ n: text, i: text, b: text, d: text }, { coerce: true });
    const took = performance.now() - started;
    assert.strictEqual(result.valid, false);
    assert.ok(took < 50, `took ${took.toFixed(0)} ms on ${text.length} characters`);
  }
});

test('Coerce: the empty string is never converted', () => {
  const schema = Schema.from({
    a: '?number',
    b: { type: 'boolean', default: false },
    c: { type: 'date', nullable: true },
    d: 'string',
  });
  const result = schema.parse({ a: '', b: '', c: '', d: '' }, { coerce: true });
  assert.deepStrictEqual(
    result.issues.map((issue) => `${issue.path.join('.')} ${issue.code}`),
    ['a type', 'b type', 'c type'],
  );
  assert.deepStrictEqual(valueOf(schema, { c: null, d: '' }), { b: false, c: null, d: '' });
});

test('Coerce: the policy of the call, of the schema, of a field', () => {
  const form = new Schema('Form', {
    Form: { coerce: true },
    age: 'integer',
    raw: { type: 'integer', coerce: false },
    inner: { schema: { a: 'integer', b: { type: 'integer', coerce: true } }, coerce: false },
  });
  for (const schema of both(() => form)) {
    const given = { age: '1', raw: 2, inner: { a: 3, b: '4' } };
    assert.deepStrictEqual(valueOf(schema, given, undefined), {
      age: 1,
      raw: 2,
      inner: { a: 3, b: 4 },
    });
    // A field that does not coerce reports what it was given.
    assert.deepStrictEqual(
      schema.parse({ ...given, raw: '2' }).issues.map((issue) => issue.path.join('.')),
      ['raw'],
    );
    assert.deepStrictEqual(
      schema
        .parse({ ...given, inner: { a: '3', b: '4' } })
        .issues.map((issue) => issue.path.join('.')),
      ['inner.a'],
    );
    // The call wins over the schema, a field over the call.
    assert.deepStrictEqual(
      schema.parse(given, { coerce: false }).issues.map((issue) => issue.path.join('.')),
      ['age'],
    );
  }
  const plain = Schema.from({ a: 'integer', b: { type: 'integer', coerce: true } });
  assert.deepStrictEqual(valueOf(plain, { a: 1, b: '2' }, undefined), { a: 1, b: 2 });
  assert.deepStrictEqual(valueOf(plain, { a: '1', b: '2' }), { a: 1, b: 2 });
  // The metadata of an embedded schema is not the policy of the parse.
  const inner = new Schema('Inner', { Form: { coerce: true }, n: 'integer' });
  const outer = Schema.from({ inner });
  assert.strictEqual(outer.parse({ inner: { n: '1' } }).valid, false);
  assert.deepStrictEqual(valueOf(outer, { inner: { n: '1' } }), { inner: { n: 1 } });
  // ~standard.validate is parse with the policies of the schema.
  assert.deepStrictEqual(form['~standard'].validate({ age: '5', raw: 1, inner: { a: 1, b: 2 } }), {
    value: { age: 5, raw: 1, inner: { a: 1, b: 2 } },
  });
  const options = { libraryOptions: { coerce: true } };
  assert.deepStrictEqual(plain['~standard'].validate({ a: '1', b: 2 }, options), {
    value: { a: 1, b: 2 },
  });
});

test('Coerce: a union takes a value a branch accepts as it is, else converts it', () => {
  const schema = Schema.from({
    either: { union: ['number', 'string'] },
    flag: { union: ['number', 'boolean'] },
    shape: {
      union: [
        { schema: { kind: { enum: ['a'] }, n: 'integer' } },
        { schema: { kind: { enum: ['b'] }, on: 'boolean' } },
      ],
      discriminator: 'kind',
    },
  });
  for (const parsed of both(() => schema)) {
    assert.deepStrictEqual(
      valueOf(parsed, { either: '3', flag: 'true', shape: { kind: 'b', on: '0' } }),
      {
        either: '3',
        flag: true,
        shape: { kind: 'b', on: false },
      },
    );
    assert.deepStrictEqual(
      valueOf(parsed, { either: 3, flag: '1', shape: { kind: 'a', n: '7' } }),
      {
        either: 3,
        flag: 1,
        shape: { kind: 'a', n: 7 },
      },
    );
  }
});

test('Coerce: tuples, nested structs, dictionaries, references and aliases', () => {
  const model = new Model({}, [
    ['Company', { Entity: {}, size: 'integer' }],
    ['Tag', { Struct: {}, weight: 'number' }],
    [
      'Item',
      {
        Struct: {},
        point: ['number', 'number'],
        meta: { at: 'date', 'count?': 'integer' },
        totals: { object: { string: 'integer' } },
        company: 'Company',
        tags: { array: 'Tag' },
        main: 'Tag',
        qty: { type: 'integer', aliases: ['quantity'] },
      },
    ],
  ]);
  const item = model.entities.get('Item');
  const given = {
    point: ['1', '2.5'],
    meta: { at: '2026-01-01', count: '3' },
    totals: { a: '1' },
    company: 'c1',
    tags: [{ weight: '0.5' }],
    main: { weight: '2' },
    quantity: '4',
  };
  for (const schema of both(() => item)) {
    assert.deepStrictEqual(valueOf(schema, given), {
      point: [1, 2.5],
      meta: { at: new Date(Date.UTC(2026, 0, 1)), count: 3 },
      totals: { a: 1 },
      company: 'c1',
      tags: [{ weight: 0.5 }],
      main: { weight: 2 },
      qty: 4,
    });
  }
  // An id stays the id it was given: a number is not an id.
  assert.strictEqual(item.parse({ ...given, company: 5 }, { coerce: true }).valid, false);
  // An embedded record of a stored kind converts through its entity.
  assert.deepStrictEqual(
    valueOf(item, { ...given, company: { size: '10' } }, { coerce: true, references: 'embed' })
      .company,
    { size: 10 },
  );
});

test('Coerce: defaults, decoders, strip and the async parse', async () => {
  const schema = Schema.from({
    at: { type: 'date', parse: (date) => date.getUTCFullYear() },
    n: { type: 'integer', default: () => 7 },
    d: { type: 'integer', default: '8' },
  });
  // The decoder sees the converted value; a default is converted like any value.
  assert.deepStrictEqual(
    valueOf(schema, { at: '2026-05-05', extra: 1 }, { coerce: true, unknown: 'strip' }),
    {
      at: 2026,
      n: 7,
      d: 8,
    },
  );
  const result = await schema.parseAsync({ at: '2026-05-05', n: '1', d: 2 }, { coerce: true });
  assert.deepStrictEqual(result.value, { at: 2026, n: 1, d: 2 });
  const slow = Schema.from({
    n: { type: 'integer', validate: async (value) => (value > 1 ? null : 'small') },
  });
  assert.deepStrictEqual((await slow.parseAsync({ n: '2' }, { coerce: true })).value, { n: 2 });
  assert.deepStrictEqual(
    (await slow.parseAsync({ n: '1' }, { coerce: true })).issues.map((issue) => issue.message),
    ['small'],
  );
});

test('Coerce: records of a stream, rows of a file', () => {
  const row = new Schema('Row', {
    Form: { coerce: true },
    id: 'integer',
    price: 'number',
    paid: 'boolean',
  });
  const lines = ['1,9.5,true', '2,x,false', '3,1e2,1'];
  const records = lines.map((line) => {
    const [id, price, paid] = line.split(',');
    return { id, price, paid };
  });
  const entries = Array.from(parseEach(row, records), (entry) => entry.result.value ?? entry.index);
  assert.deepStrictEqual(entries, [
    { id: 1, price: 9.5, paid: true },
    1,
    { id: 3, price: 100, paid: true },
  ]);
});

test('Coerce: the value given is never written to, and comes back when nothing changes', () => {
  const schema = Schema.from({ a: 'integer', list: { array: 'integer' }, inner: { b: 'boolean' } });
  const given = Object.freeze({
    a: '1',
    list: Object.freeze(['2']),
    inner: Object.freeze({ b: 'true' }),
  });
  assert.deepStrictEqual(valueOf(schema, given), { a: 1, list: [2], inner: { b: true } });
  const ready = { a: 1, list: [2], inner: { b: true } };
  const result = schema.parse(ready, { coerce: true });
  assert.strictEqual(result.value, ready);
  assert.strictEqual(coerce(schema, ready), ready);
  // A value check accepts comes back the same from a parse that coerces.
  for (let seed = 1; seed < 20; seed += 1) {
    const drawn = sample(schema, { seed });
    assert.deepStrictEqual(schema.parse(drawn, { coerce: true }).value, schema.parse(drawn).value);
  }
});

test('Coerce: a value that loops is checked as it was given, maxDepth holds', () => {
  const model = new Model({}, [['Node', { Struct: {}, n: 'integer', 'next?': 'Node' }]]);
  const node = model.entities.get('Node');
  const looped = { n: '1' };
  looped.next = looped;
  const result = node.parse(looped, { coerce: true });
  assert.strictEqual(result.valid, false);
  assert.strictEqual(coerce(node, looped), looped);
  let deep = { n: '0' };
  for (let index = 0; index < 5; index += 1) deep = { n: '1', next: deep };
  assert.strictEqual(node.parse(deep, { coerce: true, maxDepth: 2 }).valid, false);
  assert.strictEqual(valueOf(node, deep).next.next.n, 1);
});

test('Coerce: coerce() is the pass parse runs before its check', () => {
  const schema = new Schema('Form', {
    age: 'integer',
    'role?': { type: 'string', default: 'user' },
  });
  const converted = coerce(schema, { age: '30' });
  assert.deepStrictEqual(converted, { age: 30, role: 'user' });
  assert.strictEqual(schema.check(converted).valid, true);
  assert.deepStrictEqual(schema.coerce({ age: 'x' }), { age: 'x', role: 'user' });
  assert.deepStrictEqual(Schema.from('integer').coerce('5'), 5);
  assert.throws(() => coerce({ age: 'integer' }, {}), { code: 'ERR_INVALID_TARGET' });
  assert.throws(() => coerce(schema, {}, { maxDepth: 0 }), { name: 'TypeError' });
  // The method is not a key of the schema.
  assert.strictEqual(Object.keys(schema).includes('coerce'), false);
  assert.strictEqual(util.inspect(schema).includes('coerce'), false);
});

test('Coerce: alias types convert as their base, a custom converter as its own', () => {
  const model = new Model(
    {
      money: { js: 'number' },
      cents: { js: 'money' },
      flag: { js: 'boolean' },
      point: {
        construct() {},
        checkType: (value) => typeof value === 'object' && value !== null && 'x' in value,
      },
    },
    [['Order', { Struct: {}, total: 'money', fee: 'cents', paid: 'flag', at: 'point' }]],
    null,
    { registry: 'isolated' },
  );
  const order = model.entities.get('Order');
  register({ point: (value) => (typeof value === 'string' ? { x: Number(value) } : value) });
  assert.deepStrictEqual(valueOf(order, { total: '1.5', fee: '2', paid: '1', at: '3' }), {
    total: 1.5,
    fee: 2,
    paid: true,
    at: { x: 3 },
  });
  // A converter that throws leaves the value to the check.
  register({
    throwing: () => {
      throw new Error('no');
    },
  });
  const odd = new Model(
    { throwing: { js: 'string' } },
    [['T', { Struct: {}, s: 'throwing' }]],
    null,
    {
      registry: 'isolated',
    },
  ).entities.get('T');
  assert.strictEqual(odd.parse({ s: 1 }, { coerce: true }).valid, false);
  // Told of it through the hook, with the field: a bug in a converter of
  // the program does not look like a value it could not read.
  const seen = [];
  register({}, { onError: (error, field) => seen.push([error.message, field.type]) });
  assert.strictEqual(odd.parse({ s: 1 }, { coerce: true }).valid, false);
  assert.deepStrictEqual(seen, [['no', 'throwing']]);
  register({});
  assert.strictEqual(odd.parse({ s: 1 }, { coerce: true }).valid, false);
  assert.strictEqual(seen.length, 2);
  for (const options of [null, 'log', { onError: true }]) {
    assert.throws(() => register({}, options), { code: 'ERR_INVALID_COERCION' });
  }
});

test('Coerce: coerce() reports the paths of what it changed', () => {
  const schema = new Schema('Order', {
    Struct: {},
    id: 'integer',
    qty: { type: 'integer', default: 1 },
    tags: { array: 'string' },
    prices: { array: 'number' },
    at: 'date',
    address: { city: 'string', zip: { type: 'integer', default: 0 } },
    scores: { map: { string: 'number' } },
    raw: 'json',
  });
  const value = {
    id: '7',
    tags: 'a',
    prices: ['1', 2, '3.5'],
    at: '2026-01-01T00:00:00Z',
    address: { city: 'Kyiv' },
    scores: { a: '1', b: 2 },
    raw: { nested: '1' },
  };
  const report = [];
  const out = coerce(schema, value, { report });
  // In the order of the keys of the output: a default filled in comes last.
  assert.deepStrictEqual(report, [
    ['id'],
    ['tags'],
    ['prices', 0],
    ['prices', 2],
    ['at'],
    ['address', 'zip'],
    ['scores'],
    ['qty'],
  ]);
  assert.strictEqual(out.raw, value.raw);
  assert.strictEqual(schema.check(out).valid, true);
  // Nothing changed: nothing reported, the value itself.
  const same = [];
  assert.strictEqual(coerce(schema, out, { report: same }), out);
  assert.deepStrictEqual(same, []);
  // A map given as a Map with values to convert reports the entries.
  const entries = [];
  coerce(
    Schema.from({ m: { map: { string: 'number' } } }),
    { m: new Map([['k', '1']]) },
    {
      report: entries,
    },
  );
  assert.deepStrictEqual(entries, [['m', 'k']]);
  // A scalar schema reports the root.
  const root = [];
  assert.strictEqual(coerce(Schema.from('number'), '1', { report: root }), 1);
  assert.deepStrictEqual(root, [[]]);
  assert.throws(() => coerce(schema, value, { report: 'yes' }), {
    code: 'ERR_INVALID_OPTION',
    message: 'report must be an array, got "yes"',
  });
  // parse reports nothing: the option is coerce()'s.
  assert.strictEqual(schema.parse(value, { coerce: true, report }).valid, true);
});

test('Coerce: a model gives converters for its own type names', () => {
  const entities = [['Item', { Struct: {}, price: 'money', name: 'string' }]];
  const cents = new Model({ money: { js: 'number' } }, entities, null, {
    registry: 'isolated',
    coercions: { money: (value) => (typeof value === 'string' ? Number(value) * 100 : value) },
  });
  const plain = new Model({ money: { js: 'number' } }, entities, null, { registry: 'isolated' });
  const asCents = cents.entities.get('Item');
  const asIs = plain.entities.get('Item');
  assert.deepStrictEqual(valueOf(asCents, { price: '1.5', name: 'x' }), { price: 150, name: 'x' });
  assert.deepStrictEqual(valueOf(asIs, { price: '1.5', name: 'x' }), { price: 1.5, name: 'x' });
  // A schema that attaches the model gets them too; one that does not, the
  // process-wide table.
  const attached = Schema.from({ total: 'money' }, [cents]);
  assert.deepStrictEqual(valueOf(attached, { total: '2' }), { total: 200 });
  // A model's converter of a built-in name wins over the process-wide one
  // for its entities only.
  const flags = new Model({}, [['Flag', { Struct: {}, on: 'boolean' }]], null, {
    coercions: { boolean: (value) => (value === 'yes' ? true : value === 'no' ? false : value) },
  });
  assert.deepStrictEqual(valueOf(flags.entities.get('Flag'), { on: 'yes' }), { on: true });
  assert.strictEqual(
    Schema.from({ on: 'boolean' }).parse({ on: 'yes' }, { coerce: true }).valid,
    false,
  );
  assert.strictEqual(Object.isFrozen(cents.coercions), true);
  assert.strictEqual(plain.coercions, null);
  for (const coercions of ['money', [], { Money: () => 1 }, { money: 'number' }]) {
    assert.throws(() => new Model({}, [], null, { coercions }), {
      code: 'ERR_INVALID_OPTIONS',
      message: /^Model option "coercions" must be an object of functions by type name/,
    });
  }
});

test('Coerce: the standalone coerce() follows references, and the streams take the policy', async () => {
  const model = new Model({}, [
    ['Company', { Struct: {}, name: 'string', staff: 'integer' }],
    ['Office', { Struct: {}, company: 'Company', floor: 'integer' }],
  ]);
  const office = model.entities.get('Office');
  const given = { company: { name: 'Acme', staff: '3' }, floor: '2' };
  assert.deepStrictEqual(coerce(office, given, { references: 'embed' }), {
    company: { name: 'Acme', staff: 3 },
    floor: 2,
  });
  // A set from '' or a Set stays what it is; a map from a Map, a map of
  // numbers with a key that is no number.
  const sets = Schema.from({ s: { set: 'integer' }, 'm?': { map: { number: 'boolean' } } });
  assert.strictEqual(sets.parse({ s: '' }, { coerce: true }).valid, false);
  assert.deepStrictEqual(valueOf(sets, { s: new Set(['1']) }), { s: new Set([1]) });
  assert.deepStrictEqual(valueOf(sets, { s: ['1'], m: new Map([[1, 'true']]) }), {
    s: new Set([1]),
    m: new Map([[1, true]]),
  });
  assert.strictEqual(sets.parse({ s: [], m: { x: 'true' } }, { coerce: true }).valid, false);
  // The async stream and the transform take the option of parse.
  const row = Schema.from({ n: 'integer' });
  const rows = [{ n: '1' }, { n: '2' }];
  const parsed = [];
  for await (const entry of parseEachAsync(row, rows, { coerce: true })) {
    parsed.push(entry.result.value);
  }
  assert.deepStrictEqual(parsed, [{ n: 1 }, { n: 2 }]);
  const out = [];
  const readable = new ReadableStream({
    start(controller) {
      for (const item of rows) controller.enqueue(item);
      controller.close();
    },
  });
  await readable.pipeThrough(transform(row, { coerce: true })).pipeTo(
    new WritableStream({
      write(chunk) {
        out.push(chunk);
      },
    }),
  );
  assert.deepStrictEqual(out, [{ n: 1 }, { n: 2 }]);
  // An async schema through Standard Schema, with the policy of the schema.
  const form = new Schema('Form', {
    Form: { coerce: true },
    n: { type: 'integer', validate: async (n) => (n > 0 ? null : 'positive') },
  });
  assert.deepStrictEqual(await form['~standard'].validate({ n: '5' }), { value: { n: 5 } });
  assert.strictEqual((await form['~standard'].validate({ n: '0' })).issues.length, 1);
});

test('Coerce: the policy is an own key, never one of Object.prototype', () => {
  const plain = Schema.from({ a: 'number' });
  const form = new Schema('Form', { Form: {}, a: 'number' });
  // The pollution under test, undone in `finally`.
  // oxlint-disable-next-line no-extend-native
  Object.prototype.coerce = true;
  try {
    assert.strictEqual(plain.parse({ a: '1' }).valid, false);
    assert.strictEqual(form.parse({ a: '1' }).valid, false);
    assert.strictEqual(Schema.from({ a: 'number' }).parse({ a: '1' }).valid, false);
    assert.strictEqual(
      new Schema('Late', { Form: {}, a: 'number' }).parse({ a: '1' }).valid,
      false,
    );
    assert.strictEqual(plain.parse({ a: '1' }, { coerce: true }).valid, true);
  } finally {
    delete Object.prototype.coerce;
  }
});

test('Coerce: the policy is part of the definition a snapshot keeps', () => {
  const model = new Model({}, [
    ['Form', { Form: { coerce: true }, a: 'integer', b: { type: 'integer', coerce: false } }],
  ]);
  const snapshot = JSON.parse(JSON.stringify(model));
  assert.strictEqual(snapshot.entities.Form.custom.coerce, true);
  assert.strictEqual(snapshot.entities.Form.fields.b.coerce, false);
  const restored = fromJSON(snapshot).entities.get('Form');
  assert.deepStrictEqual(valueOf(restored, { a: '1', b: 2 }, undefined), { a: 1, b: 2 });
  assert.deepStrictEqual(model.warnings, []);
});

test('Coerce: the enum converter of the table reads a member written as text', () => {
  register();
  const convert = COERCIONS.enum;
  assert.strictEqual(convert('2', { enum: [1, 2] }), 2);
  assert.strictEqual(convert(2, { enum: ['1', '2'] }), '2');
  assert.strictEqual(convert(2, { enum: [2] }), 2);
  assert.strictEqual(convert('x', { enum: [1, 2] }), 'x');
  const object = {};
  assert.strictEqual(convert(object, { enum: [1] }), object);
});

test('Coerce: the report names a value that changed its form', () => {
  const schema = Schema.from({ tags: { array: 'string' }, pairs: { map: { string: 'integer' } } });
  const report = [];
  coerce(schema, { tags: 'a', pairs: { x: '1' } }, { report });
  assert.deepStrictEqual(report, [['tags'], ['pairs']]);
});
