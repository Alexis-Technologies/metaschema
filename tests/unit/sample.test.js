const { test } = require('node:test');
const assert = require('node:assert');

const { Schema, Model } = require('../../index.js');
const { sample, register } = require('../../src/model/index.js');
const { patternOf } = require('../../src/model/pattern.js');
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

test('Sample: a number of decimals is drawn with them, inside its bounds', () => {
  const schema = Schema.from({
    price: { type: 'number', decimals: 2, min: 0, max: 1 },
    tight: { type: 'number', decimals: 1, min: 0.95, max: 1.05 },
    whole: { type: 'number', decimals: 0, max: -1 },
  });
  for (let seed = 1; seed <= 50; seed += 1) {
    const value = sample(schema, { seed });
    assert.strictEqual(schema.check(value).valid, true, `seed ${seed}`);
    assert.strictEqual(Math.round(value.price * 100) / 100, value.price);
    assert.strictEqual(value.tight, 1);
    assert.strictEqual(Number.isInteger(value.whole), true);
  }
});

test('Sample: bytes and flags', () => {
  const schema = Schema.from({ data: 'bytes', perms: { flags: ['read', 'write'] } });
  const seen = new Set();
  for (let seed = 1; seed <= 40; seed += 1) {
    const value = sample(schema, { seed });
    assert.strictEqual(schema.check(value).valid, true, `seed ${seed}`);
    assert.strictEqual(value.data instanceof Uint8Array, true);
    assert.strictEqual(value.data.length <= 16, true);
    for (const name of Object.keys(value.perms)) seen.add(`${name}:${value.perms[name]}`);
  }
  assert.deepStrictEqual(Array.from(seen).sort(), [
    'read:false',
    'read:true',
    'write:false',
    'write:true',
  ]);
  assert.deepStrictEqual(sample(schema, { seed: 7 }), sample(schema, { seed: 7 }));
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
    message: 'No value satisfies "o" (seed 1): keys must be of type number',
  });
  // A pattern and a length that contradict each other.
  assert.throws(
    () => sample(new Schema('S', { s: { type: 'string', pattern: '^a$', length: { min: 2 } } })),
    { code, message: 'No value satisfies "S.s" (seed 1): value is too short' },
  );
  // A validate function no draw passes.
  assert.throws(() => sample(Schema.from({ v: { type: 'string', validate: () => 'never' } })), {
    code,
    message: 'No value satisfies "v" (seed 1): never',
  });
  assert.throws(() => sample(Schema.from({ a: 'string', validate: () => 'nope' })), {
    code,
    message: 'No value satisfies "" (seed 1): nope',
  });
  // A reference the model does not have, a required one nested too deep.
  assert.throws(() => sample(new Schema('P', { c: 'Company' })), {
    code,
    message: 'No value satisfies "P.c" (seed 1): Entity "Company" is not found',
  });
  const deep = new Model({}, [['Node', { Struct: {}, next: 'Node' }]]);
  assert.throws(() => sample(deep.entities.get('Node'), { maxDepth: 2 }), {
    code,
    message:
      'No value satisfies "Node.next.next.next" (seed 1): "Node" nests deeper than 2 references',
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
    [
      { references: 'bogus' },
      'Sample option "references" must be "kind", "embed" or "id", got "bogus"',
    ],
    [{ maxDepth: -1 }, 'Sample option "maxDepth" must be an integer from 0 to 32'],
    [{ maxDepth: 33 }, 'Sample option "maxDepth" must be an integer from 0 to 32'],
    [{ maxDepth: 1e9 }, 'Sample option "maxDepth" must be an integer from 0 to 32'],
  ]) {
    assert.throws(() => sample(schema, options), { code: 'ERR_INVALID_OPTIONS', message });
  }
  assert.throws(() => sample({ a: 'string' }), {
    name: 'TypeError',
    code: 'ERR_INVALID_TARGET',
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

test('Sample: a union with a branch no value satisfies draws another branch', () => {
  const never = { type: 'string', validate: () => 'never' };
  const seeds = Array.from({ length: 20 }, (_, index) => index + 1);
  // A plain union, with the impossible branch first and last.
  accepts(pair({ v: { union: [never, 'number'] } }), seeds);
  accepts(pair({ v: { union: ['number', never] } }), seeds);
  // A branch the sampler cannot read, and a custom type it cannot draw.
  accepts(pair({ v: { union: [{ type: 'string', pattern: '^(?=a)a$', length: 1 }, 'number'] } }));
  const model = new Model({ unseen: { kind: 'scalar', construct() {}, checkType: () => null } }, [
    ['Mixed', { Struct: {}, v: { union: ['unseen', 'number'] } }],
  ]);
  accepts([model.entities.get('Mixed')], seeds);
  // A discriminated union.
  const shapes = {
    union: [
      { Struct: {}, kind: { enum: ['circle'] }, r: { type: 'number', validate: () => 'never' } },
      { Struct: {}, kind: { enum: ['square'] }, side: 'number' },
    ],
    discriminator: 'kind',
  };
  accepts(pair({ shape: shapes }), seeds);
  for (const seed of seeds) {
    assert.strictEqual(sample(Schema.from({ shape: shapes }), { seed }).shape.kind, 'square');
  }
  // Every branch impossible: the last error, with the path of its own branch.
  const code = 'ERR_UNSATISFIABLE';
  assert.throws(() => sample(Schema.from({ v: { union: [never, never] } })), {
    code,
    message: 'No value satisfies "v" (seed 1): never',
  });
  const nested = {
    v: {
      union: [
        { Struct: {}, a: { b: never } },
        { Struct: {}, c: never },
      ],
    },
  };
  for (const seed of seeds) {
    assert.throws(() => sample(Schema.from(nested), { seed }), {
      code,
      message: new RegExp(`^No value satisfies "(v\\.a\\.b|v\\.c)" \\(seed ${seed}\\): never$`),
    });
  }
  // What is not an error of a branch is thrown as it is.
  const thrower = { kind: 'scalar', construct() {}, checkType: () => null };
  thrower.metadata = {
    sample: () => {
      throw new RangeError('out of ink');
    },
  };
  const inked = new Model({ thrower }, [
    ['Pen', { Struct: {}, v: { union: ['thrower', 'thrower'] } }],
  ]);
  assert.throws(() => sample(inked.entities.get('Pen'), { seed: 2 }), {
    name: 'RangeError',
    message: 'out of ink',
  });
});

test('Sample: the letters of a pattern are those of the locale of the call', () => {
  const definition = {
    dot: { type: 'string', pattern: '^.{4}$', length: 4 },
    letters: { type: 'string', pattern: '^\\p{L}{3}$', length: 3 },
    mixed: { type: 'string', pattern: '^[\\p{L}\\d]{6}$', length: 6 },
  };
  const schema = Schema.from(definition);
  const cyrillic = /^[а-яіїєґ]+$/;
  const en = sample(schema, { seed: 1, locale: 'en' });
  assert.match(en.dot, /^[a-z]+$/);
  assert.match(en.letters, /^[a-z]+$/);
  // The same schema in the other locale, after the pattern was read.
  const uk = sample(schema, { seed: 1, locale: 'uk' });
  assert.match(uk.dot, cyrillic);
  assert.match(uk.letters, cyrillic);
  assert.match(uk.mixed, /^[а-яіїєґ0-9]+$/);
  assert.deepStrictEqual(uk, sample(Schema.from(definition), { seed: 1, locale: 'uk' }));
  assert.deepStrictEqual(sample(schema, { seed: 1, locale: 'en' }), en);
  // A class that excludes the letters excludes every letter.
  const none = Schema.from({
    a: { type: 'string', pattern: '^\\P{L}{8}$', length: 8 },
    b: { type: 'string', pattern: '^[^\\p{L}]{8}$', length: 8 },
  });
  for (const seed of SEEDS) {
    for (const locale of ['en', 'uk']) {
      const value = sample(none, { seed, locale });
      assert.match(value.a, /^[0-9_\- ]+$/);
      assert.match(value.b, /^[0-9_\- ]+$/);
    }
  }
});

test('Sample: a pattern is bounded before a string is built', () => {
  const field = (pattern, length) => Schema.from({ s: { type: 'string', pattern, length } });
  // A repetition over the cap, bounded or not.
  for (const pattern of ['^a{1000000}$', '^a{10001}$', '^a{0,10001}$', '^a{10001,}$']) {
    const started = performance.now();
    assert.throws(() => sample(field(pattern, { max: 10 })), {
      code: 'ERR_SAMPLE_PATTERN',
      message: `Pattern /${pattern}/ cannot be sampled: a repetition over 10000`,
    });
    assert.strictEqual(performance.now() - started < 50, true);
  }
  assert.strictEqual(sample(field('^a{10000}$', 10000)).s.length, 10000);
  // A pattern whose shortest string is over length.max: no string is built.
  const started = performance.now();
  assert.throws(() => sample(field('^(a{2000}){2000}$', { max: 10 }), { seed: 3 }), {
    code: 'ERR_UNSATISFIABLE',
    message:
      'No value satisfies "s" (seed 3): the pattern needs at least 4000000 characters, ' +
      'over the maximum 10',
  });
  assert.strictEqual(performance.now() - started < 50, true);
  assert.throws(() => sample(field('^abc$', 2)), {
    code: 'ERR_UNSATISFIABLE',
    message:
      'No value satisfies "s" (seed 1): the pattern needs at least 3 characters, over the maximum 2',
  });
  // The shortest string: the shortest alternative, an optional part left
  // out, a surrogate pair as one code point (a lower bound under both
  // counts of a length rule).
  assert.strictEqual(sample(field('^(a|bcd)$', 1)).s, 'a');
  assert.strictEqual(patternOf(/^ab?c*d{0,2}$/u).minLength, 1);
  assert.strictEqual(patternOf(/^(ab|c)+x{2}[a-z]?$/u).minLength, 3);
  assert.strictEqual(patternOf(/^\u{1F600}\u{1F600}$/u).minLength, 2);
  const glyph = { type: 'string', pattern: '^\u{1F600}$', length: 1, unicode: true };
  assert.strictEqual(sample(Schema.from({ s: glyph })).s, '\u{1F600}');
  assert.strictEqual(sample(field('^\u{1F600}$', 2)).s, '\u{1F600}');
  // A bigint span wider than a number holds.
  const wide = Schema.from({ b: { type: 'bigint', min: -(10n ** 400n), max: 10n ** 400n } });
  accepts([wide]);
  assert.strictEqual(typeof sample(wide).b, 'bigint');
});

test('Sample: the parser reads control escapes, guards \\u{ and bounds the nesting', () => {
  const field = (pattern, length) => Schema.from({ s: { type: 'string', pattern, length } });
  assert.strictEqual(sample(field('^\\cA$', 1)).s, '\u0001');
  assert.strictEqual(sample(field('^\\cz$', 1)).s, '\u001a');
  assert.strictEqual(sample(field('^[\\cJ]$', 1)).s, '\n');
  // Without the u flag `\u{41` is a RegExp of its own; the parser stops at
  // the end of the source instead of reading past it.
  assert.throws(() => patternOf(/\u{41/), {
    code: 'ERR_SAMPLE_PATTERN',
    message: 'Pattern /\\u{41/ cannot be sampled: a code point escape',
  });
  assert.throws(() => patternOf(/\cé/), {
    code: 'ERR_SAMPLE_PATTERN',
    message: 'Pattern /\\cé/ cannot be sampled: a control escape',
  });
  // Groups nest up to 64 deep.
  const nested = (depth) => `^${'('.repeat(depth)}a${')'.repeat(depth)}$`;
  assert.strictEqual(sample(field(nested(64), 1)).s, 'a');
  for (const depth of [65, 5000]) {
    assert.throws(() => sample(field(nested(depth), 1)), {
      code: 'ERR_SAMPLE_PATTERN',
      message: `Pattern /${nested(depth)}/ cannot be sampled: groups nested deeper than 64`,
    });
  }
});

test('Sample: the error names the seed, a field named __proto__ is a key', () => {
  const schema = Schema.from({ v: { type: 'string', validate: () => 'never' } });
  for (const seed of [7, 42]) {
    assert.throws(() => sample(schema, { seed }), {
      code: 'ERR_UNSATISFIABLE',
      message: `No value satisfies "v" (seed ${seed}): never`,
      seed,
    });
  }
  assert.throws(() => sample(Schema.from({ a: 'string', validate: () => 'nope' }), { seed: 9 }), {
    message: 'No value satisfies "" (seed 9): nope',
    seed: 9,
  });
  // The own property under that name, not the prototype.
  const own = (object) => Object.getOwnPropertyDescriptor(object, '__proto__')?.value;
  const definition = { a: 'number', b: { type: 'string', nullable: true } };
  Object.defineProperty(definition, '__proto__', { value: 'string', enumerable: true });
  const targets = pair(definition);
  accepts(targets, SEEDS);
  const value = sample(targets[0], { seed: 2 });
  assert.strictEqual(Object.hasOwn(value, '__proto__'), true);
  assert.strictEqual(typeof own(value), 'string');
  assert.strictEqual(Object.getPrototypeOf(value), Object.prototype);
  // A nullable one under that name is a key too.
  const nullable = { a: 'number' };
  Object.defineProperty(nullable, '__proto__', {
    value: { type: 'string', nullable: true },
    enumerable: true,
  });
  const seen = new Set();
  for (let seed = 1; seed <= 20; seed += 1) {
    const drawn = sample(Schema.from(nullable), { seed });
    assert.strictEqual(Object.hasOwn(drawn, '__proto__'), true);
    seen.add(own(drawn) === null);
  }
  assert.deepStrictEqual([...seen].sort(), [false, true]);
});
