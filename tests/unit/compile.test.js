const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const { Schema, Model } = require('../../index.js');
const { compile, register, canEval } = require('@alexify/metaschema/compile');
const uk = require('@alexify/metaschema/locales/uk');
const { RUN } = require('../../src/util.js');
const { Code, quote, prop, literal } = require('../../src/compile/code.js');
const { emitRoot } = require('../../src/compile/emit.js');

const ROOT = path.join(__dirname, '../..');

// The suites may run with every schema compiled at construction
// (tests/helpers/jit.js); this file compares the two backends itself, so it
// builds closures and compiles them explicitly.
register({ jit: false });

// The JIT where the environment allows it, so the comparisons below hold the
// generated code against the closures; under
// --disallow-code-generation-from-strings both sides are the closures and
// `accelerated` says so.
const JIT = { jit: canEval() ? true : 'auto' };

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

const OPTIONS = [
  undefined,
  { maxErrors: 1 },
  { maxErrors: 2 },
  { maxErrors: 3 },
  { maxErrors: 5 },
  { unknown: 'ignore' },
  { unknown: 'ignore', maxErrors: 2 },
  { references: 'embed' },
  { references: 'id' },
  { references: 'embed', maxErrors: 2 },
  { maxDepth: 1 },
  { references: 'embed', maxDepth: 1 },
  { messages: uk },
  { root: 'body' },
];

const outcome = (schema, value, options) => {
  const result = schema.check(value, options);
  return { valid: result.valid, issues: result.issues, errors: result.errors };
};

const snapshot = (schema, values) =>
  values.map((value) => OPTIONS.map((options) => outcome(schema, value, options)));

const compare = (schema, values, before) => {
  for (let index = 0; index < values.length; index += 1) {
    for (let position = 0; position < OPTIONS.length; position += 1) {
      const options = OPTIONS[position];
      const label = `${schema.name || 'schema'}: value ${index}, options ${JSON.stringify(options)}`;
      assert.deepStrictEqual(
        outcome(schema, values[index], options),
        before[index][position],
        label,
      );
    }
  }
};

// The closure backend's verdict on every value under every option, then the
// same through the compiled check: the issues, their order, their paths and
// params, and the rendered lines must not differ.
const equivalent = (schema, values) => {
  const before = snapshot(schema, values);
  assert.deepStrictEqual(compile(schema, JIT), { accelerated: canEval() });
  compare(schema, values, before);
  return schema;
};

const equivalentModel = (model, samples) => {
  const before = {};
  for (const [name, values] of Object.entries(samples)) {
    before[name] = snapshot(model.entities.get(name), values);
  }
  assert.deepStrictEqual(compile(model, JIT), { accelerated: canEval() });
  for (const [name, values] of Object.entries(samples)) {
    compare(model.entities.get(name), values, before[name]);
  }
};

const sourceOf = (schema) => {
  const code = new Code();
  emitRoot(schema, code);
  return code.source();
};

test('Compile: scalars, rules, optional, nullable and validate', () => {
  const schema = new Schema('Scalars', {
    name: { type: 'string', length: { min: 2, max: 5 } },
    'nick?': { type: 'string', length: 3 },
    code: { type: 'string', length: { min: 1 }, pattern: /^[a-z]+$/ },
    glyphs: { type: 'string', length: { min: 1, max: 2 }, unicode: true },
    free: { type: 'string', length: {} },
    age: { type: 'number', min: 0, max: 150 },
    low: { type: 'number', min: 1 },
    high: { type: 'number', max: 10 },
    big: { type: 'bigint', min: 0n, max: 10n },
    count: { type: 'integer', min: 0 },
    ratio: { type: 'number', nullable: true },
    'maybe?': { type: 'integer', nullable: true },
    flag: 'boolean',
    checked: { type: 'string', validate: (value) => value !== 'bad' || 'is bad' },
    ruled: { type: 'string', length: 3, validate: (value) => value !== 'bad' || 'is bad' },
    thrown: {
      type: 'string',
      validate: () => {
        throw new Error('boom');
      },
    },
    located: { type: 'string', validate: (value, where) => `at ${where}` },
    issue: {
      type: 'number',
      validate: () => ({ code: 'custom', message: 'from issue', path: ['deep'] }),
    },
    many: { type: 'number', validate: () => ['one', 'two', 'three'] },
    none: { type: 'any', validate: (value) => value !== undefined || 'is undefined' },
  });
  const valid = {
    name: 'ab',
    code: 'abc',
    glyphs: '\u{1F642}',
    free: '',
    age: 5,
    low: 1,
    high: 10,
    big: 5n,
    count: 3,
    ratio: null,
    maybe: null,
    flag: true,
    checked: 'ok',
    ruled: 'abc',
    thrown: 'x',
    located: 'x',
    issue: 1,
    many: 1,
    none: 1,
  };
  equivalent(schema, [
    valid,
    {
      ...valid,
      name: 'a',
      nick: 'abcd',
      code: 'ABC',
      glyphs: '\u{1F642}\u{1F642}\u{1F642}',
      age: 200,
      low: 0,
      high: 11,
      big: 11n,
      count: 1.5,
      ratio: 'x',
      maybe: 2.5,
      flag: 'yes',
      checked: 'bad',
      ruled: 'bad',
      located: 'y',
      issue: 2,
      many: 2,
      none: null,
    },
    {
      ...valid,
      name: null,
      nick: null,
      code: 5,
      glyphs: 'x',
      age: null,
      big: 5,
      count: null,
      ratio: 1.5,
      flag: null,
      ruled: 'ab',
      none: undefined,
    },
    { ...valid, ruled: 'abcd', checked: 1, extra: true, name: undefined, low: -1, high: 20 },
    { name: 'abcdef', code: '', glyphs: '', age: -1, big: -1n, count: -1 },
    {},
    null,
    [],
    'text',
    5,
  ]);
});

test('Compile: enum, date, null, any, unknown and json', () => {
  const object = { tag: 'o' };
  const schema = new Schema('Values', {
    small: { enum: ['a', 'b', 'c'] },
    large: { enum: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
    mixed: { enum: ['x', NaN, object, 2n, -0, null] },
    'optional?': { enum: ['on', 'off'] },
    nullish: { enum: ['y', null] },
    when: 'date',
    'then?': 'date',
    nothing: 'null',
    'void?': 'null',
    anything: 'any',
    'whatever?': 'unknown',
    blob: 'json',
    'extra?': 'json',
  });
  equivalent(schema, [
    {
      small: 'a',
      large: 10,
      mixed: NaN,
      nullish: null,
      when: new Date(),
      nothing: null,
      anything: undefined,
      blob: {},
    },
    {
      small: 'd',
      large: 11,
      mixed: 0,
      optional: null,
      nullish: 'n',
      when: new Date('x'),
      then: 'yesterday',
      nothing: undefined,
      void: 1,
      anything: null,
      whatever: null,
      blob: null,
      extra: [],
    },
    {
      small: null,
      large: null,
      mixed: object,
      optional: 'on',
      nullish: undefined,
      when: null,
      then: null,
      nothing: 'null',
      anything: 1,
      whatever: 'w',
      blob: 'x',
      extra: 5,
    },
    {
      small: 'b',
      large: 1,
      mixed: 2n,
      when: Date.now(),
      nothing: null,
      anything: {},
      blob: new Map(),
    },
    {
      small: 'c',
      large: 'x',
      mixed: { tag: 'o' },
      optional: 'off',
      nullish: 'y',
      when: new Date(0),
      nothing: null,
      anything: [],
      blob: [],
    },
  ]);
});

test('Compile: object, map, array, set and tuple', () => {
  const schema = new Schema('Collections', {
    dict: { object: { string: 'number' } },
    'loose?': { object: { string: 'string' }, length: { max: 2 } },
    numbered: { object: { number: 'string' } },
    table: { map: { string: 'boolean' } },
    'index?': { map: { number: 'string' } },
    sized: { map: { string: 'number' }, length: [1, 2] },
    'free?': { map: { string: 'number' }, length: { min: 1 } },
    tags: { array: 'string' },
    'few?': { array: 'number', length: 2 },
    matrix: { array: { array: 'number' } },
    rows: { array: { a: 'string', 'b?': 'number' } },
    bag: { set: 'string' },
    'sack?': { set: 'number', length: { min: 1 } },
    point: ['number', 'number'],
    named: [{ x: 'number' }, { 'y?': 'number' }, { schema: { z: 'number' } }],
    'pair?': ['string', { enum: ['a', 'b'] }],
    checked: { array: 'number', validate: (list) => list.length !== 2 || 'two' },
  });
  const valid = {
    dict: { a: 1 },
    numbered: {},
    table: new Map([['on', true]]),
    sized: new Map([['n', 1]]),
    tags: ['a'],
    matrix: [[1, 2], []],
    rows: [{ a: 'x' }, { a: 'y', b: 1 }],
    bag: new Set(['a']),
    point: [1, 2],
    named: [1, 2, { z: 3 }],
    checked: [1],
  };
  const sparse = new Array(3);
  sparse[0] = 1;
  sparse[2] = 3;
  equivalent(schema, [
    valid,
    {
      ...valid,
      dict: { a: 'x', b: 2 },
      loose: { a: 'x', b: 'y', c: 'z' },
      numbered: { 1: 'x' },
      table: new Map([
        ['on', 1],
        [2, true],
      ]),
      index: new Map([['x', 'y']]),
      sized: new Map(),
      free: new Map(),
      tags: ['a', 1, null],
      few: [1, 2, 3],
      matrix: [[1, 'x'], 'row'],
      rows: [{ a: 1, c: 2 }, 'row', null],
      bag: new Set(['a', 1]),
      sack: new Set(),
      point: [1],
      named: [1, 'two', { z: 'z' }, 4],
      pair: ['a', 'c'],
      checked: [1, 2],
    },
    {
      ...valid,
      dict: {},
      numbered: { a: 1 },
      table: new Map(),
      tags: sparse,
      matrix: [sparse],
      bag: ['a'],
      point: ['x', 'y', 'z'],
      named: [null, null, null],
      pair: null,
      checked: ['x'],
    },
    { ...valid, dict: [], table: {}, tags: new Set(['a']), bag: new Set(), point: null, named: [] },
    { ...valid, loose: null, index: null, few: null, sack: null, pair: undefined },
    { ...valid, dict: Object.assign(Object.create({ inherited: 1 }), { own: 2 }) },
    {},
  ]);
});

test('Compile: a field is read from its aliases on both backends', () => {
  const schema = new Schema('Aliased', {
    name: { type: 'string', length: { min: 2 }, aliases: ['title', 'label'] },
    'age?': { type: 'number', aliases: ['years'] },
    toString: { type: 'string', aliases: ['str'] },
    'addr?': { schema: { city: { type: 'string', aliases: ['town'] } }, aliases: ['address'] },
    tags: { array: { schema: { id: { type: 'string', aliases: ['key'] } } } },
  });
  const inherited = Object.assign(Object.create({ title: 'x', str: 'y' }), {
    label: 'l',
    tags: [],
  });
  equivalent(schema, [
    { title: 'ab', years: 2, str: 's', address: { town: 'c' }, tags: [{ key: 'k' }] },
    { label: 'ab', str: 's', tags: [] },
    { name: 'ab', title: 1, label: 2, str: 's', tags: [] },
    { title: 1, years: 'y', str: 1, address: { city: 3 }, tags: [{ key: 1 }, { id: 2 }] },
    { title: 'a', label: 'ab', str: 's', tags: [] },
    { title: undefined, years: undefined, str: 's', tags: [] },
    { name: undefined, title: 'ab', str: undefined, tags: [] },
    { name: 'ab', toString: 't', str: 1, tags: [] },
    { name: 'ab', str: 's', tags: [], extra: 1, title: 'x' },
    { name: 'ab', str: 's', tags: [], address: null },
    inherited,
    {},
    null,
    [],
  ]);
  const compiled = compile(schema, JIT);
  assert.strictEqual(compiled.accelerated, canEval());
  const source = sourceOf(schema);
  assert.strictEqual(source.includes('Object.hasOwn(v, "title")'), true);
  assert.strictEqual(source.includes('Object.hasOwn(v, "label")'), true);
});

test('Compile: nested structs, own keys, calculated fields and the unknown policy', () => {
  const schema = new Schema('Structs', {
    inner: { a: 'string', 'b?': 'number' },
    'optional?': { c: 'string' },
    lenient: { Struct: { unknown: 'ignore' }, d: 'string' },
    toString: '?string',
    constructor: 'number',
    hasOwnProperty: { type: 'string', required: false },
    ['__proto__']: 'string',
    half: (value) => value.constructor / 2,
    deep: {
      deeper: {
        deepest: { x: 'string', validate: (value) => value.x !== 'no' || 'refused' },
      },
    },
    checked: { schema: { e: 'string' }, validate: (value) => value.e !== 'no' || 'refused' },
  });
  const valid = JSON.parse(
    '{"inner":{"a":"x"},"lenient":{"d":"x"},"constructor":1,"__proto__":"p",' +
      '"deep":{"deeper":{"deepest":{"x":"y"}}},"checked":{"e":"ok"}}',
  );
  const inherited = Object.assign(Object.create({ inherited: 1 }), valid);
  equivalent(schema, [
    valid,
    inherited,
    {
      inner: { a: 1, zzz: 1 },
      optional: { c: 1 },
      lenient: { d: 'x', e: 1 },
      toString: 5,
      constructor: 'x',
      hasOwnProperty: 1,
      deep: { deeper: { deepest: { x: 'no' } } },
      checked: { e: 'no' },
      extra: 1,
    },
    { ...valid, inner: undefined, lenient: [], constructor: undefined, deep: null, checked: 'x' },
    { ...valid, inner: null, optional: null, deep: { deeper: { deepest: { x: 'y', y: 1 } } } },
    { ...valid, inner: { a: 'x', b: 'y' }, optional: {}, hasOwnProperty: 'h', toString: 't' },
    JSON.parse('{"__proto__":{"polluted":true}}'),
    {},
    [],
    null,
  ]);
});

test('Compile: unions, plain and discriminated', () => {
  const schema = new Schema('Unions', {
    either: { union: ['string', 'number'] },
    'maybe?': { union: ['boolean', { array: 'string' }] },
    shape: {
      union: [
        { Struct: {}, kind: { enum: ['circle'] }, r: 'number' },
        { kind: { enum: ['rect', 'square'] }, w: 'number' },
      ],
      discriminator: 'kind',
    },
    odd: {
      union: [
        { Struct: {}, kind: { enum: [NaN] }, a: 'string' },
        { Struct: {}, kind: { enum: [1] }, b: 'string' },
      ],
      discriminator: 'kind',
    },
    'tagged?': {
      union: [{ Struct: {}, 'k.i': { enum: ['one'] }, a: 'string' }],
      discriminator: 'k.i',
    },
    nested: {
      union: [{ Struct: {}, a: 'string' }, { Struct: {}, b: { array: 'number' } }, 'null'],
    },
    checked: { union: ['string', 'number'], validate: (value) => value !== 0 || 'zero' },
  });
  const valid = {
    either: 'x',
    shape: { kind: 'circle', r: 1 },
    odd: { kind: NaN, a: 'x' },
    nested: null,
    checked: 'x',
  };
  equivalent(schema, [
    valid,
    {
      either: true,
      maybe: ['a', 1],
      shape: { kind: 'tri' },
      odd: { kind: 2 },
      tagged: { 'k.i': 'two' },
      nested: { c: 1 },
      checked: 0,
    },
    {
      either: null,
      maybe: null,
      shape: { kind: 'rect', w: 'x' },
      odd: { kind: 1, b: 1 },
      tagged: { 'k.i': 'one', a: 1 },
      nested: { a: 1, b: ['x'] },
      checked: true,
    },
    { ...valid, shape: 'x', odd: null, maybe: true, nested: { b: [1] } },
    { ...valid, shape: { kind: 'square', w: 1, extra: 1 }, tagged: { 'k.i': 'one', a: 'a' } },
    { ...valid, either: 1, nested: { a: 'x' }, checked: 1 },
    {},
  ]);
});

test('Compile: references by kind, embedded, as ids, cycles and a missing target', () => {
  const model = new Model({}, [
    ['Company', { Registry: {}, name: 'string', 'parent?': 'Company' }],
    ['Tag', { Struct: {}, label: 'string' }],
    [
      'Person',
      {
        Entity: {},
        name: 'string',
        employer: 'Company',
        tags: { many: 'Tag' },
        'boss?': { type: 'Person', embed: true },
        'home?': { type: 'Company', embed: false },
        'friends?': { many: 'Person' },
      },
    ],
    [
      'Node',
      {
        Struct: {},
        name: 'string',
        'next?': 'Node',
        'ghost?': 'Ghost',
        'links?': { many: 'Ghost' },
      },
    ],
  ]);
  const row = { name: 'Marcus', employer: 'c1', tags: [{ label: 'stoic' }] };
  const graph = {
    name: 'Marcus',
    employer: { name: 'Rome', parent: { name: 'Italy' } },
    tags: ['t1'],
    boss: { name: 'Antoninus', employer: 'c1', tags: [] },
    home: 'c2',
    friends: ['p2', { name: 'x' }],
  };
  const loop = { name: 'self', employer: 'c1', tags: [] };
  loop.boss = loop;
  const chain = { name: 'a' };
  chain.next = { name: 'b', next: chain };
  equivalentModel(model, {
    Person: [
      row,
      graph,
      loop,
      { name: 1, employer: { name: 1 }, tags: [{ label: 1 }, 't', null], boss: 'p1', home: {} },
      { name: 'x', employer: null, tags: null, friends: [null] },
      {},
    ],
    Node: [
      { name: 'n', next: { name: 'm' } },
      chain,
      { name: 'n', ghost: 'g', links: ['a', 'b'] },
      { name: 'n', next: 'm', links: 'a' },
    ],
    Company: [{ name: 'Rome' }, { name: 'Rome', parent: { name: 'x' } }, { name: 1, parent: 1 }],
  });
});

test('Compile: custom types run their checkType, aliases their base', () => {
  const types = {
    hex: {
      kind: 'scalar',
      rules: ['length'],
      construct() {},
      checkType(value, where) {
        if (typeof value !== 'string') return false;
        return /^[0-9a-f]*$/.test(value) || `Field "${where}" is not hex`;
      },
    },
    text: { js: 'string' },
    boom: {
      construct() {},
      checkType() {
        throw new Error('boom');
      },
    },
  };
  const model = new Model(types, [
    [
      'Doc',
      {
        Struct: {},
        id: { type: 'hex', length: 4 },
        body: { type: 'text', length: { max: 3 } },
        'note?': 'text',
        crash: 'boom',
        'tags?': { array: 'hex' },
        nullable: { type: 'hex', nullable: true },
      },
    ],
  ]);
  equivalentModel(model, {
    Doc: [
      { id: 'abcd', body: 'abc', crash: 1, nullable: null },
      { id: 'xyz', body: 'abcd', note: 5, crash: null, tags: ['ab', 'zz', 1], nullable: 1 },
      { id: 'abcdef', body: 1, note: null, tags: 'ab' },
      {},
    ],
  });
});

test('Compile: a schema of one type, Schema instances as fields and the schema-level validate', () => {
  equivalent(Schema.from('string'), ['x', 5, null, undefined]);
  equivalent(
    Schema.from({ type: 'string', length: 2, validate: (value) => value !== 'no' || 'refused' }),
    ['ab', 'no', 'abc', 1],
  );
  equivalent(Schema.from({ array: 'number' }), [[1], [1, 'x'], 'x', null]);
  equivalent(new Schema('List', { array: { a: 'string' } }), [[{ a: 'x' }], [{ a: 1 }, {}], {}]);
  equivalent(new Schema('Named', { enum: ['a', 'b'] }), ['a', 'c', null]);
  const inner = new Schema('Inner', {
    a: 'string',
    validate: (value) => value.a !== 'no' || 'refused',
  });
  const single = new Schema('Single', {
    type: 'number',
    min: 1,
    validate: (value) => value !== 3 || 'three',
  });
  const outer = new Schema('Outer', {
    part: inner,
    'other?': { schema: inner },
    num: single,
    'nums?': { array: single },
    validate: (value) => value.num !== 2 || 'two',
  });
  equivalent(outer, [
    { part: { a: 'x' }, num: 1 },
    { part: { a: 'no' }, other: { a: 1 }, num: 2 },
    { part: { a: 'x' }, num: 3, nums: [1, 3, 0, 'x'] },
    { part: 5, num: 0 },
    { part: { a: 'x' }, num: 1, extra: 1 },
    { part: { a: 'x' }, other: { a: 'no' }, num: 1, nums: [] },
    null,
  ]);
  const failing = new Schema('Failing', {
    a: 'string',
    validate: () => {
      throw new Error('schema boom');
    },
  });
  equivalent(failing, [{ a: 'x' }, { a: 1 }]);
  const row = { a: 'x' };
  const standard = Schema.from({ a: 'string' });
  compile(standard, JIT);
  assert.strictEqual(standard['~standard'].validate(row).value, row);
  assert.strictEqual(standard['~standard'].validate({ a: 1 }).issues.length, 1);
});

test('Compile: parse, parseAsync, checkAsync and serialize run over the compiled check', async () => {
  const model = new Model({}, [
    ['Tag', { Struct: {}, label: { type: 'string', parse: (text) => text.toUpperCase() } }],
    [
      'Doc',
      {
        Struct: {},
        title: { type: 'string', validate: async (value) => value !== 'bad' || 'is bad' },
        when: {
          type: 'string',
          parse: (text) => new Date(text),
          serialize: (date) => date.toISOString(),
        },
        'level?': { type: 'integer', default: 1 },
        tags: { many: 'Tag' },
        rows: { array: { n: { type: 'number', parse: async (n) => n * 2 } } },
        either: {
          union: ['string', { Struct: {}, n: 'number', 'm?': { type: 'number', default: 3 } }],
        },
      },
    ],
  ]);
  const doc = model.entities.get('Doc');
  const values = [
    {
      title: 'x',
      when: '2020-01-01T00:00:00.000Z',
      tags: [{ label: 'a' }],
      rows: [{ n: 1 }],
      either: { n: 1 },
    },
    { title: 'bad', when: 'now', tags: [], rows: [{ n: 'x' }], either: 's', extra: 1 },
    { title: 1, tags: [{ label: 2 }], rows: [{}] },
    null,
  ];
  const options = [undefined, { unknown: 'strip' }, { unknown: 'ignore', maxErrors: 1 }];
  const run = async () => {
    const out = [];
    for (const value of values) {
      for (const choice of options) {
        const result = await doc.parseAsync(value, choice);
        out.push(result);
        const checked = choice === undefined ? undefined : { ...choice, unknown: 'ignore' };
        out.push(await doc.checkAsync(value, checked));
        // The schema has an async validator, so serialize cannot check here.
        if (result.valid) out.push(doc.serialize(result.value));
      }
    }
    return JSON.parse(JSON.stringify(out));
  };
  const before = await run();
  assert.deepStrictEqual(compile(model, JIT), { accelerated: canEval() });
  assert.deepStrictEqual(await run(), before);
  // The sync parse on the compiled check, against the closures.
  const sync = Schema.from({
    a: { type: 'string', parse: (text) => text.length },
    'b?': { type: 'number', default: 2 },
  });
  const expected = sync.parse({ a: 'xyz', extra: 1 }, { unknown: 'strip' });
  compile(sync, JIT);
  assert.deepStrictEqual(sync.parse({ a: 'xyz', extra: 1 }, { unknown: 'strip' }), expected);
  assert.deepStrictEqual(
    sync.parse({ a: 1 }).issues,
    Schema.from({ a: 'string' }).parse({ a: 1 }).issues,
  );
  assert.throws(() => doc.check({ title: 'x', when: 'w', tags: [], rows: [], either: 's' }), {
    code: 'ERR_ASYNC_VALIDATOR',
  });
});

test('Compile: the fixture model', () => {
  const { database, types, ...entities } = require('../fixtures/schemas/index.js');
  const model = new Model(
    { datetime: { js: 'string' }, ...types },
    new Map(Object.entries(entities)),
    database,
  );
  const account = {
    login: 'marcus',
    password: 'secret',
    blocked: false,
    company: 'c1',
    fullName: { given: 'Marcus' },
    birth: { date: '121-04-26' },
    addresses: ['a1'],
  };
  const graph = { ...account, company: { name: 'Rome', parent: 'c0' }, addresses: [] };
  const samples = {};
  for (const name of model.entities.keys()) {
    samples[name] = [account, graph, {}, { login: 1, name: 1 }, null, [], 'x'];
  }
  equivalentModel(model, samples);
});

test('Compile: keys and values that look like code are data', () => {
  const hostile = [
    '"',
    "'",
    '\\',
    '`',
    // oxlint-disable-next-line no-template-curly-in-string
    '${x}',
    'a.b',
    'a"b',
    'a\nb',
    'a\rb',
    `a${LS}b`,
    `a${PS}b`,
    '__proto__',
    'constructor',
    'prototype',
    'valueOf',
    '',
    ' ',
    '0',
    '1e3',
    'x'.repeat(300),
    '"); throw new Error("pwned"); ("',
    'δελτα',
    'c',
    'k',
    'v',
    's0',
    'r',
    'u1',
    'scope',
    'Object',
  ];
  // Null-prototype dictionaries, so that "__proto__" is a key like any other.
  const fields = Object.create(null);
  for (const key of hostile) fields[key] = '?string';
  const schema = new Schema('Hostile', {
    ...fields,
    dict: { object: { string: 'number' } },
    pick: { enum: hostile },
    few: { enum: ['"', "'", `${LS}`, '\\n'] },
    pattern: { type: 'string', pattern: /^["'\\/`$]+$/, length: { max: 9 } },
    tagged: {
      union: [{ Struct: {}, [hostile[20]]: { enum: [hostile[20], '"'] }, a: 'string' }],
      discriminator: hostile[20],
    },
    'point?': [{ '"x"': 'number' }, { 'y\n': 'number' }],
  });
  const text = Object.create(null);
  const numbers = Object.create(null);
  for (const key of hostile) {
    text[key] = key;
    numbers[key] = 1;
  }
  const extras = Object.create(null);
  for (const key of hostile) extras[`${key}!`] = key;
  const valid = {
    ...text,
    dict: { ...numbers },
    pick: hostile[20],
    few: '"',
    pattern: '"\'\\',
    tagged: { [hostile[20]]: '"', a: 'x' },
    point: [1, 2],
  };
  const own = JSON.parse(`{"__proto__": "p", "pick": ${quote(hostile[1])}}`);
  equivalent(schema, [
    valid,
    {
      ...valid,
      ...numbers,
      dict: text,
      pick: 'none',
      few: LS,
      pattern: 'x',
      tagged: { [hostile[20]]: 'z' },
    },
    { ...valid, ...extras },
    { ...valid, dict: extras, point: ['"', 2, 3] },
    own,
    JSON.parse('{"__proto__": {"polluted": true}, "constructor": 1}'),
    {},
  ]);
  const source = sourceOf(schema);
  assert.strictEqual(source.includes(LS) || source.includes(PS), false);
  assert.strictEqual(source.includes('throw new Error("pwned")'), false);
  assert.strictEqual(source.includes('v.__proto__'), true);
  assert.strictEqual(source.includes('v.constructor'), true);
  assert.strictEqual(
    source.split('\n').some((line) => line.includes('\r')),
    false,
  );
  // oxlint-disable-next-line no-new-func
  if (canEval()) assert.strictEqual(typeof new Function('scope', source), 'function');
});

test('Compile: the code builder quotes, names and literals', () => {
  assert.strictEqual(quote('a"b'), '"a\\"b"');
  assert.strictEqual(quote(`a${LS}b${PS}`), '"a\\u2028b\\u2029"');
  assert.strictEqual(prop('v', 'name'), 'v.name');
  assert.strictEqual(prop('v', '$_1'), 'v.$_1');
  assert.strictEqual(prop('v', 'a-b'), 'v["a-b"]');
  assert.strictEqual(prop('v', ''), 'v[""]');
  assert.strictEqual(prop('v', '1x'), 'v["1x"]');
  assert.strictEqual(prop('v', 0), 'v[0]');
  assert.strictEqual(prop('v', 'δ'), 'v["δ"]');
  const literals = [
    ['s', '"s"'],
    [true, 'true'],
    [1.5, '1.5'],
    [1e21, '1e+21'],
    [10n, '10n'],
    [undefined, 'void 0'],
    [null, 'null'],
    [NaN, undefined],
    [Infinity, undefined],
    [-0, undefined],
    [{}, undefined],
    [Symbol('x'), undefined],
  ];
  for (const [value, text] of literals) assert.strictEqual(literal(value), text);
  const code = new Code();
  assert.strictEqual(code.name('x'), 'x1');
  assert.strictEqual(code.name('n'), 'n2');
  const pattern = /a/;
  assert.strictEqual(code.ref(pattern), 's0');
  assert.strictEqual(code.ref(pattern), 's0');
  assert.strictEqual(code.ref(NaN), 's1');
  assert.strictEqual(code.value(NaN), 's1');
  assert.strictEqual(code.value(-0), 's2');
  assert.strictEqual(code.value(2), '2');
  assert.deepStrictEqual(code.values, [pattern, NaN, -0]);
  code.push('return 1;');
  assert.strictEqual(
    code.source(),
    '"use strict";\nconst s0 = scope[0], s1 = scope[1], s2 = scope[2];\n' +
      'return function jit(v, c, k) {\nreturn 1;\n};\n//# sourceURL=alexify-metaschema-jit/anonymous',
  );
  assert.strictEqual(
    new Code().source(),
    '"use strict";\nreturn function jit(v, c, k) {\n\n};\n//# sourceURL=alexify-metaschema-jit/anonymous',
  );
});

test('Compile: jit false leaves the closures, bad options and targets throw', () => {
  const schema = Schema.from({ name: 'string' });
  const run = schema[RUN];
  assert.deepStrictEqual(compile(schema, { jit: false }), { accelerated: false });
  assert.strictEqual(schema[RUN], run);
  assert.deepStrictEqual(compile(schema), { accelerated: canEval() });
  assert.strictEqual(schema[RUN] !== run, canEval());
  assert.strictEqual(schema[RUN].name, canEval() ? 'jit' : '');
  assert.deepStrictEqual(compile(schema, {}), { accelerated: canEval() });
  for (const jit of ['always', 1, null, 'true']) {
    assert.throws(() => compile(schema, { jit }), {
      name: 'SchemaDefinitionError',
      code: 'ERR_INVALID_OPTIONS',
      message: `Compile option "jit" must be "auto", true or false, got ${JSON.stringify(jit)}`,
    });
  }
  for (const options of [null, 'auto', true]) {
    assert.throws(() => compile(schema, options), {
      name: 'SchemaDefinitionError',
      code: 'ERR_INVALID_OPTIONS',
      message: `Compile options must be an object, got ${JSON.stringify(options)}`,
    });
  }
  for (const target of [{}, null, 'User', { entities: new Map() }, Schema, undefined]) {
    assert.throws(() => compile(target), {
      name: 'TypeError',
      code: 'ERR_INVALID_TARGET',
      message: 'A Schema or a Model is expected',
    });
  }
  assert.strictEqual(typeof canEval(), 'boolean');
  assert.strictEqual(canEval(), canEval());
  const model = new Model({}, [
    ['A', { Struct: {}, a: 'string' }],
    ['B', { Entity: {}, b: 'A' }],
  ]);
  assert.deepStrictEqual(compile(model), { accelerated: canEval() });
  for (const entity of model.entities.values()) {
    assert.strictEqual(entity[RUN].name === 'jit', canEval());
  }
  // `jit: false` puts the closures back, the very functions the schemas were
  // built with.
  assert.deepStrictEqual(compile(model, { jit: false }), { accelerated: false });
  for (const entity of model.entities.values()) assert.strictEqual(entity[RUN].name, '');
  const single = Schema.from({ a: 'string' });
  const closure = single[RUN];
  compile(single);
  assert.deepStrictEqual(compile(single, { jit: false }), { accelerated: false });
  assert.strictEqual(single[RUN], closure);
  assert.deepStrictEqual(single.check({ a: 1 }).errors, ['Field "a" not of expected type: string']);
  assert.deepStrictEqual(compile(new Model({}, [])), { accelerated: canEval() });
});

test(
  'Compile: a failing new Function is a fallback in auto mode, an error when demanded',
  { skip: !canEval() && 'needs code generation from strings' },
  () => {
    const schema = Schema.from({ name: 'string' });
    const run = schema[RUN];
    const Original = globalThis.Function;
    globalThis.Function = function Blocked() {
      throw new EvalError('blocked');
    };
    try {
      // The default mode reports what stopped the generation and keeps the
      // closures; the demanded one throws it, under one code with the cause.
      const fallen = compile(schema);
      assert.strictEqual(fallen.accelerated, false);
      assert.strictEqual(fallen.error.name, 'SchemaDefinitionError');
      assert.strictEqual(fallen.error.code, 'ERR_JIT_BUILD');
      assert.strictEqual(fallen.error.message, 'The check of "" could not be generated: blocked');
      assert.strictEqual(fallen.error.cause.message, 'blocked');
      assert.strictEqual(schema[RUN], run);
      assert.throws(() => compile(schema, { jit: true }), {
        name: 'SchemaDefinitionError',
        code: 'ERR_JIT_BUILD',
        message: 'The check of "" could not be generated: blocked',
      });
      assert.strictEqual(schema[RUN], run);
      // register tells onFallback of every schema it could not compile.
      const calls = [];
      register({ onFallback: (built, error) => calls.push([built.name, error.code]) });
      const later = new Schema('Later', { a: 'string' });
      register({ jit: false });
      assert.deepStrictEqual(calls, [['Later', 'ERR_JIT_BUILD']]);
      assert.strictEqual(later[RUN].name, '');
    } finally {
      globalThis.Function = Original;
    }
    assert.deepStrictEqual(compile(schema), { accelerated: true });
    assert.strictEqual(schema[RUN].name, 'jit');
    assert.throws(() => register({ onFallback: 1 }), {
      code: 'ERR_INVALID_OPTIONS',
      message: 'Compile option "onFallback" must be a function',
    });
    // A model is compiled all or nothing when the JIT is demanded: an error
    // on the second entity leaves the first one as it was.
    const model = new Model({}, [
      ['A', { Struct: {}, a: 'string' }],
      ['B', { Struct: {}, b: 'string' }],
    ]);
    let calls = 0;
    globalThis.Function = function Second(...args) {
      calls += 1;
      if (calls === 2) throw new EvalError('second');
      return Original(...args);
    };
    try {
      assert.throws(() => compile(model, { jit: true }), {
        code: 'ERR_JIT_BUILD',
        message: 'The check of "B" could not be generated: second',
      });
    } finally {
      globalThis.Function = Original;
    }
    for (const entity of model.entities.values()) assert.strictEqual(entity[RUN].name, '');
  },
);

test('Compile: register() compiles every schema built after it', () => {
  const before = Schema.from({ a: 'string' });
  register();
  const after = Schema.from({ a: 'string' });
  const model = new Model({}, [['A', { Struct: {}, a: 'string' }]]);
  assert.strictEqual(before[RUN].name, '');
  assert.strictEqual(after[RUN].name === 'jit', canEval());
  assert.strictEqual(model.entities.get('A')[RUN].name === 'jit', canEval());
  assert.deepStrictEqual(after.check({ a: 1 }).errors, ['Field "a" not of expected type: string']);
  assert.strictEqual(Schema.from(after), after);
  register({ jit: 'auto' });
  assert.strictEqual(Schema.from({ a: 'string' })[RUN].name === 'jit', canEval());
  register({ jit: false });
  assert.strictEqual(Schema.from({ a: 'string' })[RUN].name, '');
  assert.throws(() => register({ jit: 'x' }), {
    name: 'SchemaDefinitionError',
    code: 'ERR_INVALID_OPTIONS',
  });
  assert.throws(() => register(null), { code: 'ERR_INVALID_OPTIONS' });
  assert.strictEqual(Schema.from({ a: 'string' })[RUN].name, '');
});

test('Compile: without code generation from strings, auto falls back and true throws', () => {
  const source = [
    "const { Schema } = require('@alexify/metaschema');",
    "const { compile, register, canEval } = require('@alexify/metaschema/compile');",
    "const schema = Schema.from({ name: 'string' });",
    'const out = [canEval(), compile(schema), compile(schema, { jit: false })];',
    'out.push(schema.check({ name: 1 }).errors);',
    'for (const call of [() => compile(schema, { jit: true }), () => register({ jit: true })]) {',
    '  try { call(); out.push(null); } catch (error) { out.push([error.name, error.code, error.message]); }',
    '}',
    "register(); out.push(Schema.from({ a: 'number' }).check({ a: 'x' }).valid);",
    'process.stdout.write(JSON.stringify(out));',
  ].join('\n');
  const args = ['--disallow-code-generation-from-strings', '-e', source];
  const output = execFileSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
  const error = [
    'SchemaDefinitionError',
    'ERR_NO_EVAL',
    'Code generation from strings is not allowed in this environment; ' +
      'jit: "auto" keeps the closure backend instead',
  ];
  assert.deepStrictEqual(JSON.parse(output), [
    false,
    { accelerated: false },
    { accelerated: false },
    ['Field "name" not of expected type: string'],
    error,
    error,
    false,
  ]);
});

test('Compile: the length of a collection is measured the same way on both backends', () => {
  const schema = Schema.from({
    dict: { object: { string: 'any' }, length: { min: 1, max: 2 } },
    table: { map: { string: 'any' }, length: { max: 1 } },
    bag: { set: 'any', length: { max: 1 } },
    list: { array: 'any', length: [1, 2] },
    text: { type: 'string', length: { max: 2 } },
    wide: { type: 'string', unicode: true, length: { max: 2 } },
  });
  equivalent(schema, [
    {
      dict: { size: 10 },
      table: new Map([['a', 1]]),
      bag: new Set([1]),
      list: [1],
      text: 'ab',
      wide: '😀😀',
    },
    {
      dict: { a: 1, b: 2, c: 3 },
      table: new Map([
        ['a', 1],
        ['b', 2],
      ]),
      bag: new Set([1, 2]),
      list: [],
      text: 'abc',
      wide: '😀😀😀',
    },
    { dict: {}, table: new Map(), bag: new Set(), list: [1, 2, 3], text: '', wide: 'ab' },
  ]);
});

test('Compile: a failed branch of a plain union drops its deferred validators on both backends', async () => {
  const build = () =>
    new Schema('Pick', {
      first: { type: 'string', validate: async () => true },
      u: {
        union: [
          {
            Struct: {},
            a: { type: 'string', validate: async () => 'branch0 says no' },
            b: 'number',
          },
          { Struct: {}, a: 'string', b: 'string' },
        ],
      },
    });
  const values = [
    { first: 'f', u: { a: 'x', b: 'y' } },
    { first: 'f', u: { a: 'x', b: 1 } },
    { first: 'f', u: { a: 1, b: true } },
  ];
  const run = async (schema) => {
    const out = [];
    for (const value of values) {
      out.push((await schema.checkAsync(value)).errors, (await schema.parseAsync(value)).issues);
    }
    return out;
  };
  const closures = build();
  const compiled = build();
  assert.deepStrictEqual(compile(compiled, JIT), { accelerated: canEval() });
  const expected = await run(closures);
  assert.deepStrictEqual(expected[0], []);
  assert.deepStrictEqual(await run(compiled), expected);
});

test('Compile: the generated source is strict and named after the schema', () => {
  const user = new Schema('User', { name: 'string' });
  const source = sourceOf(user);
  assert.strictEqual(source.startsWith('"use strict";\n'), true);
  // The builder is given the name by compile; the test builder has none.
  assert.strictEqual(source.endsWith('\n//# sourceURL=alexify-metaschema-jit/anonymous'), true);
  const code = new Code();
  emitRoot(user, code);
  assert.strictEqual(
    code.source('Us er/1').endsWith('//# sourceURL=alexify-metaschema-jit/Us%20er%2F1'),
    true,
  );
  if (canEval()) {
    compile(user, { jit: true });
    assert.strictEqual(user[RUN].name, 'jit');
    assert.deepStrictEqual(user.check({ name: 1 }).errors, [
      'Field "User.name" not of expected type: string',
    ]);
  }
});
