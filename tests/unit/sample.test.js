const { test } = require('node:test');
const assert = require('node:assert');

const { Schema, Model } = require('../../index.js');
const { sample, register } = require('../../src/model/index.js');
const { compile, canEval } = require('../../src/compile/index.js');
const fixture = require('../fixtures/schemas/index.js');

const { database, types: customTypes, ...schemas } = fixture;

const SEEDS = [1, 2, 3, 4, 5, 42, 1000];

// The schema, and a copy on the other backend, so that a sample passes both.
const pair = (definition, name = 'S') => {
  const a = new Schema(name, definition);
  const b = new Schema(name, definition);
  assert.strictEqual(compile(b, { jit: canEval() ? true : 'auto' }).accelerated, canEval());
  return [a, b];
};

const accepts = (targets, seeds = SEEDS, options = {}) => {
  for (const seed of seeds) {
    const value = sample(targets[0], { seed, ...options });
    for (const schema of targets) {
      const result = schema.check(value, { references: options.references });
      assert.deepStrictEqual(result.errors, [], `seed ${seed}`);
    }
  }
};

test('Sample: every entity of the fixture model, as ids and embedded', () => {
  const types = { datetime: { js: 'string' }, ...customTypes };
  const model = new Model(types, Object.entries(schemas), database);
  for (const entity of model.entities.values()) {
    accepts([entity]);
    accepts([entity], SEEDS, { references: 'embed' });
    accepts([entity], SEEDS, { references: 'id' });
  }
  const account = model.entities.get('Account');
  const value = sample(account, { seed: 7 });
  assert.strictEqual(typeof value.company, 'string');
  assert.strictEqual(Array.isArray(value.addresses), true);
  const graph = sample(account, { seed: 7, references: 'embed' });
  assert.strictEqual(typeof graph.company.name, 'string');
});

test('Sample: every form of the language, on both backends', () => {
  const definition = {
    Struct: {},
    name: { type: 'string', length: { min: 2, max: 5 } },
    'nick?': { type: 'string', length: 3 },
    glyphs: { type: 'string', length: { min: 1, max: 2 }, unicode: true },
    free: 'string',
    age: { type: 'number', min: 0, max: 150 },
    low: { type: 'number', min: 1 },
    high: { type: 'number', max: 10 },
    count: { type: 'integer', min: 0, max: 3 },
    whole: 'integer',
    big: { type: 'bigint', min: 0n, max: 10n },
    huge: 'bigint',
    ratio: { type: 'number', nullable: true },
    flag: 'boolean',
    when: 'date',
    nothing: 'null',
    'maybe?': 'null',
    anything: 'any',
    unknown: 'unknown',
    data: 'json',
    role: { enum: ['admin', 'editor', 'viewer'] },
    many: { enum: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
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
  };
  accepts(pair(definition), [...SEEDS, 6, 7, 8, 9, 10]);
  const value = sample(new Schema('S', definition), { seed: 3 });
  assert.strictEqual(value.name.length >= 2 && value.name.length <= 5, true);
  assert.strictEqual(Number.isInteger(value.count), true);
  assert.strictEqual(typeof value.big, 'bigint');
  assert.strictEqual(value.when instanceof Date, true);
  assert.strictEqual(value.ids instanceof Set, true);
  assert.strictEqual(value.byName instanceof Map, true);
  assert.strictEqual(['circle', 'square'].includes(value.shape.kind), true);
  assert.strictEqual(value.half, undefined);
});

test('Sample: the same seed gives the same value, another seed another one', () => {
  const schema = Schema.from({ name: 'string', n: 'number', tags: { array: 'string' } });
  assert.deepStrictEqual(sample(schema, { seed: 5 }), sample(schema, { seed: 5 }));
  assert.deepStrictEqual(sample(schema), sample(schema, { seed: 1 }));
  assert.notDeepStrictEqual(sample(schema, { seed: 5 }), sample(schema, { seed: 6 }));
  // Optional and nullable fields come and go with the seed.
  const optional = Schema.from({ 'a?': 'string', b: { type: 'string', nullable: true } });
  const seen = new Set();
  for (let seed = 1; seed <= 40; seed += 1) {
    const value = sample(optional, { seed });
    seen.add(`${'a' in value} ${value.b === null}`);
  }
  assert.strictEqual(seen.size, 4);
});

test('Sample: the locale picks the letters, examples are used', () => {
  const schema = Schema.from({ name: { type: 'string', length: { min: 4 } } });
  assert.match(sample(schema, { seed: 1, locale: 'uk' }).name, /^[а-яіїєґ]+$/);
  assert.match(sample(schema, { seed: 1 }).name, /^[a-z]+$/);
  const examples = Schema.from({
    mail: { type: 'string', examples: ['a@b.c', 'x@y.z'], validate: (v) => v.includes('@') },
  });
  for (const seed of SEEDS) {
    assert.strictEqual(['a@b.c', 'x@y.z'].includes(sample(examples, { seed }).mail), true);
  }
});

test('Sample: a pattern generates a string that matches it', () => {
  const patterns = [
    '^[a-z]{3}$',
    '^\\d{2,4}-[A-Z]+$',
    '^(foo|bar|baz)?[0-9]*$',
    '^[^abc]+$',
    '^\\p{L}+\\s\\p{Lu}\\p{Nd}$',
    '^\\w+@\\w+\\.\\w{2,3}$',
    '^(?:ab|cd)+(?<tail>x|y)$',
    '^[a-f0-9]{8}-[a-f0-9]{4}$',
    '^\\u0041\\x42[\\-_.]\\.$',
    '^a.c$',
    '^[\\d\\s]+$',
    '^\\D\\W\\S$',
    '^colou?r$',
    'needle',
    '^[-a-z]+$',
    '^\\u{1F600}+$',
    '^x{3}y{2,}$',
  ];
  for (const pattern of patterns) {
    const schema = Schema.from({ s: { type: 'string', pattern, length: 64 } });
    for (const seed of SEEDS) {
      const value = sample(schema, { seed }).s;
      assert.match(value, new RegExp(pattern, 'u'), `${pattern} with seed ${seed}: ${value}`);
    }
  }
  // Flags are honoured: a case-insensitive pattern still matches.
  const flagged = Schema.from({ s: { type: 'string', pattern: /^[A-Z]{2}$/i, length: 2 } });
  assert.match(sample(flagged, { seed: 1 }).s, /^[A-Z]{2}$/i);
  // Within a length rule: the repetitions follow it.
  const long = Schema.from({
    s: { type: 'string', pattern: '^[a-z]+$', length: { min: 12, max: 20 } },
  });
  for (const seed of SEEDS) {
    const value = sample(long, { seed }).s;
    assert.strictEqual(value.length >= 12 && value.length <= 20, true, value);
  }
});

test('Sample: a pattern the sampler cannot read is an error with a code', () => {
  for (const [pattern, what] of [
    ['^(?=a)a$', 'a lookaround'],
    ['^(?!a)b$', 'a lookaround'],
    ['^(?<=a)b$', 'a lookaround'],
    ['^(a)\\1$', 'a back reference'],
    ['^(?<n>a)\\k<n>$', 'a back reference'],
    ['^\\bword\\b$', 'a word boundary'],
    ['^\\p{Script=Greek}+$', 'the property "Script=Greek"'],
    ['^[\\D]$', 'a negated class escape inside a class'],
  ]) {
    const schema = Schema.from({ s: { type: 'string', pattern, length: 8 } });
    assert.throws(() => sample(schema), {
      name: 'SchemaDefinitionError',
      code: 'ERR_SAMPLE_PATTERN',
      message: `Pattern /${pattern}/ cannot be sampled: ${what}`,
    });
  }
});

test('Sample: a custom type samples through its metadata', () => {
  const types = {
    hex: {
      kind: 'scalar',
      construct() {},
      checkType: (value) => /^[0-9a-f]{6}$/.test(value) || 'not hex',
      metadata: {
        sample: (field, random) =>
          Math.floor(random() * 0xffffff)
            .toString(16)
            .padStart(6, '0'),
      },
    },
    fixed: {
      kind: 'scalar',
      construct() {},
      checkType: (value) => value === 'fixed' || 'not fixed',
      metadata: { sample: 'fixed' },
    },
    opaque: { kind: 'scalar', construct() {}, checkType: () => null },
    money: { js: 'number', metadata: { pg: 'money' } },
  };
  const model = new Model(types, [
    [
      'Wallet',
      { Struct: {}, color: 'hex', tag: 'fixed', total: { type: 'money', min: 1, max: 2 } },
    ],
    ['Blob', { Struct: {}, data: 'opaque' }],
  ]);
  accepts([model.entities.get('Wallet')]);
  const value = sample(model.entities.get('Wallet'), { seed: 2 });
  assert.match(value.color, /^[0-9a-f]{6}$/);
  assert.strictEqual(value.tag, 'fixed');
  assert.strictEqual(value.total >= 1 && value.total <= 2, true);
  assert.throws(() => sample(model.entities.get('Blob')), {
    code: 'ERR_SAMPLE_TYPE',
    message: 'Type "opaque" needs metadata.sample to be sampled in "Blob.data"',
  });
});

test('Sample: a definition no value satisfies is an error with the field and the reason', () => {
  const code = 'ERR_UNSATISFIABLE';
  // An object with number keys has no key the check accepts.
  assert.throws(() => sample(Schema.from({ o: { object: { number: 'string' } } })), {
    name: 'SchemaDefinitionError',
    code,
    message: 'No value satisfies "o": keys must be of type number',
  });
  // A pattern and a length that contradict each other.
  assert.throws(
    () => sample(new Schema('S', { s: { type: 'string', pattern: '^a$', length: { min: 2 } } })),
    { code, message: 'No value satisfies "S.s": value is too short' },
  );
  // A validate function no draw passes.
  assert.throws(() => sample(Schema.from({ v: { type: 'string', validate: () => 'never' } })), {
    code,
    message: 'No value satisfies "v": never',
  });
  assert.throws(() => sample(Schema.from({ a: 'string', validate: () => 'nope' })), {
    code,
    message: 'No value satisfies "": nope',
  });
  // A reference the model does not have, a required one nested too deep.
  assert.throws(() => sample(new Schema('P', { c: 'Company' })), {
    code,
    message: 'No value satisfies "P.c": Entity "Company" is not found',
  });
  const deep = new Model({}, [['Node', { Struct: {}, next: 'Node' }]]);
  assert.throws(() => sample(deep.entities.get('Node'), { maxDepth: 2 }), {
    code,
    message: 'No value satisfies "Node.next.next.next": "Node" nests deeper than 2 references',
  });
  // An optional one stops there.
  const list = new Model({}, [['Node', { Struct: {}, 'next?': 'Node', value: 'number' }]]);
  accepts([list.entities.get('Node')], SEEDS, { maxDepth: 2 });
  // A set that cannot hold enough distinct values.
  assert.throws(() => sample(Schema.from({ s: { set: { enum: ['x'] }, length: { min: 2 } } })), {
    code,
  });
});

test('Sample: the options, the target and the registered method', () => {
  const schema = Schema.from({ a: 'string' });
  for (const [options, message] of [
    [null, 'Sample options must be an object'],
    [{ seed: 1.5 }, 'Sample option "seed" must be an integer'],
    [{ locale: 'fr' }, 'Sample option "locale" must be "en" or "uk", got "fr"'],
    [{ maxDepth: -1 }, 'Sample option "maxDepth" must be an integer of at least 0'],
  ]) {
    assert.throws(() => sample(schema, options), { code: 'ERR_INVALID_OPTIONS', message });
  }
  assert.throws(() => sample({ a: 'string' }), {
    name: 'TypeError',
    message: 'A Schema is expected',
  });
  assert.strictEqual(schema.sample, undefined);
  register();
  assert.deepStrictEqual(schema.sample({ seed: 3 }), sample(schema, { seed: 3 }));
  assert.strictEqual(Object.getOwnPropertyDescriptor(Schema.prototype, 'sample').enumerable, false);
  // A schema of one type.
  assert.strictEqual(typeof sample(Schema.from('string')), 'string');
  assert.strictEqual(
    Schema.from(['number', 'string']).check(sample(Schema.from(['number', 'string']))).valid,
    true,
  );
});
