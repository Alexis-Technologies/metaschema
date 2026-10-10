// Differential test of the JSON Schema export: for values a deterministic
// generator produces from the schemas themselves, `check` and ajv over
// `toJSONSchema` must agree on validity, for draft 2020-12 and draft-07.
//
// What the generator leaves out on purpose, because the two cannot agree:
// - `date`, `set`, `map` and `bigint`: a JSON value has no instance of them,
//   so `check` rejects what the input document describes (a date-time string,
//   an array of unique items, an object);
// - astral characters: `length` counts UTF-16 units unless the field says
//   `unicode: true`, JSON Schema counts code points;
// - an `object` or `map` with number keys: the keys of a JSON object are
//   strings, so `check` rejects every key where the pattern accepts a number;
// - `validate` functions and custom `checkType`s, which are not exported;
// - a value with inherited or non-enumerable keys, which JSON has none of.
const { test } = require('node:test');
const assert = require('node:assert');
const Ajv2020 = require('ajv/dist/2020');
const Ajv07 = require('ajv');
const addFormats = require('ajv-formats');

const { Schema, Model } = require('../../index.js');
const { hasBrand } = require('../../src/util.js');
const { isFirstUpper } = require('../../src/metautil.js');
const { embeds } = require('../../src/prototypes/reference.js');
const { database, types: customTypes, ...entities } = require('../fixtures/schemas/index.js');

const VALUES_PER_SCHEMA = 400;

// mulberry32: the same values on every run.
const prng = (seed) => {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const ALPHABET = 'abcxyzABC019 -_.éÜ';

const GARBAGE = [null, 'x', 1, true, [], {}, 'longer than expected', -1, 1.5];

// Strings for the patterns the schemas below use, valid ones first; a
// random string would almost never match.
const PATTERNS = {
  '^[a-z]{3}$': ['abc', 'xyz', 'zzz', 'ab', 'ABC', 'abcd', '123'],
  '^\\p{L}+$': ['abc', 'éÜ', 'Zebra', 'ab1', '', 'a b'],
};

class Generator {
  // `references` is the mode of the check the values are for.
  constructor(seed, references = 'kind') {
    this.random = prng(seed);
    this.references = references;
  }

  chance(probability) {
    return this.random() < probability;
  }

  int(max) {
    return Math.floor(this.random() * (max + 1));
  }

  pick(list) {
    return list[this.int(list.length - 1)];
  }

  // A string within the bounds of the field most of the time.
  string(field) {
    if (field.pattern !== undefined) {
      const samples = PATTERNS[field.pattern.source];
      return this.chance(0.75) ? samples[this.int(2)] : this.pick(samples);
    }
    const min = field.length?.min ?? 0;
    const max = field.length?.max ?? 10;
    const length = this.chance(0.85) ? min + this.int(max - min) : this.int(max + 3);
    let text = '';
    for (let index = 0; index < length; index += 1) text += this.pick(ALPHABET);
    return text;
  }

  // The value of a field: mostly what it describes, sometimes something
  // else, so both verdicts come up.
  value(field, depth) {
    if (this.chance(0.03)) return this.pick(GARBAGE);
    const { type } = field;
    if (isFirstUpper(type)) return this.reference(field, depth);
    if (field.enum) return this.chance(0.9) ? this.pick(field.enum) : 'nope';
    if (field.union) return this.value(this.pick(field.union), depth);
    if (field.schema) return this.struct(field.schema, depth);
    if (Array.isArray(field.value)) return this.tuple(field, depth);
    if (field.key !== undefined && field.value) return this.dictionary(field, depth);
    if (field.value) return this.list(field, depth);
    if (type === 'integer') return this.number(field, true);
    if (type === 'json') return this.pick([{}, [], { a: 1 }, [1, 2], 'str', 5]);
    switch (field.scalar) {
      case 'string':
        return this.string(field);
      case 'number':
        return this.number(field, false);
      case 'boolean':
        return this.pick([true, false, true, false, true, false, 'true']);
      case 'null':
        return this.pick([null, null, null, null, 0]);
      default:
        return this.pick([null, 'any', 7, { x: 1 }, [true]]);
    }
  }

  // A number within the bounds of the field most of the time.
  number(field, integer) {
    const { min = -5, max = 50 } = field;
    const inside = [min, max, min + Math.floor((max - min) / 2), min + Math.floor((max - min) / 3)];
    if (!integer) inside.push(min + (max - min) / 4);
    const outside = [min - 1, max + 1, min + 0.5, 1e3, -3.75];
    return this.pick(this.chance(0.85) ? inside : outside);
  }

  list(field, depth) {
    const min = field.length?.min ?? 0;
    const max = field.length?.max ?? 3;
    const length = this.chance(0.85) ? min + this.int(max - min) : this.int(max + 2);
    const items = [];
    for (let index = 0; index < length; index += 1) items.push(this.value(field.value, depth));
    return items;
  }

  dictionary(field, depth) {
    const min = Math.max(field.length?.min ?? 0, 1);
    const max = field.length?.max ?? 3;
    const count = this.chance(0.85) ? min + this.int(max - min) : this.int(max + 2);
    const value = {};
    for (let index = 0; index < count; index += 1) {
      value[`k${index}`] = this.value(field.value, depth);
    }
    return value;
  }

  tuple(field, depth) {
    const elements = field.value;
    const length = this.chance(0.85) ? elements.length : this.int(elements.length + 1);
    const items = [];
    for (let index = 0; index < length; index += 1) {
      const element = elements[index];
      items.push(element === undefined ? this.pick(GARBAGE) : this.value(element, depth));
    }
    return items;
  }

  // A reference as `check` reads it in the mode of the check: an id for a
  // stored kind, the record for a memory kind, or what the mode says.
  reference(field, depth) {
    const target = field.root.findReference(field.type);
    const embedded = target !== null && embeds(target, field.embed, this.references);
    const one = () => {
      if (!embedded) return this.chance(0.9) ? `id${this.int(9)}` : this.pick([5, null, {}]);
      if (depth === 0) return null;
      return this.struct(target.fields, depth - 1);
    };
    if (field.many === undefined) return one();
    const length = this.int(3);
    const items = [];
    for (let index = 0; index < length; index += 1) items.push(one());
    return items;
  }

  struct(fields, depth) {
    const value = {};
    for (const key of Object.keys(fields)) {
      const field = fields[key];
      if (!hasBrand(field, 'Type')) continue;
      if (!field.required && this.chance(0.3)) continue;
      if (this.chance(0.02)) continue;
      value[key] = this.value(field, depth);
    }
    if (this.chance(0.04)) value.extra = 1;
    return value;
  }

  // The value a schema describes, as JSON: no undefined, no instances.
  sample(schema, depth = 3) {
    const { fields } = schema;
    const raw = hasBrand(fields, 'Struct') ? this.struct(fields, depth) : this.value(fields, depth);
    return JSON.parse(JSON.stringify(raw));
  }
}

const ajvFor = (target) => {
  const Ajv = target === 'draft-07' ? Ajv07 : Ajv2020;
  // Strict mode, so that a keyword the dialect does not have fails the
  // compilation; strictTuples is off because a tuple with optional elements
  // has fewer required items than positions.
  const ajv = new Ajv({
    strict: true,
    strictTuples: false,
    allowUnionTypes: true,
    allErrors: false,
  });
  addFormats(ajv);
  return ajv;
};

// Runs the comparison over one schema for one target and returns how many
// values were valid, so a test can assert that both verdicts came up.
const compare = (schema, target, options, seed) => {
  const json = schema.toJSONSchema({ ...options, target });
  const validate = ajvFor(target).compile(json);
  const generator = new Generator(seed, options.references);
  let valid = 0;
  for (let index = 0; index < VALUES_PER_SCHEMA; index += 1) {
    const value = generator.sample(schema);
    const result = schema.check(value, options);
    const expected = result.valid;
    const actual = validate(value);
    if (actual !== expected) {
      const detail = { target, value, errors: result.errors, ajv: validate.errors };
      assert.fail(`check and ajv disagree:\n${JSON.stringify(detail, null, 2)}`);
    }
    if (expected) valid += 1;
  }
  return valid;
};

const TARGETS = ['draft-2020-12', 'draft-07'];

const differential = (name, schema, options = {}) => {
  for (const target of TARGETS) {
    test(`JSON Schema differential: ${name} (${target})`, () => {
      const valid = compare(schema, target, options, 42);
      assert.ok(valid > 0, 'no valid value was generated');
      assert.ok(valid < VALUES_PER_SCHEMA, 'no invalid value was generated');
    });
  }
};

differential(
  'scalars and rules',
  new Schema('Flat', {
    name: { type: 'string', length: { min: 2, max: 8 } },
    code: { type: 'string', pattern: '^[a-z]{3}$', length: 3 },
    word: { type: 'string', pattern: /^\p{L}+$/u, length: { max: 6 }, unicode: true },
    age: { type: 'integer', min: 0, max: 120 },
    'score?': { type: 'number', min: -1.5, max: 1.5 },
    'count?': { type: 'number', max: 10 },
    active: 'boolean',
    nothing: 'null',
    'anything?': 'any',
    unknown: 'unknown',
    payload: 'json',
    role: { enum: ['admin', 'user', 'guest'] },
    one: { enum: ['only'] },
    'level?': { enum: [1, 2, 3] },
    title: { type: 'string', nullable: true },
  }),
);

differential(
  'collections, tuples, unions and nested structs',
  new Schema('Nested', {
    address: { city: 'string', 'zip?': { type: 'string', length: [5, 5] } },
    tags: { array: { enum: ['a', 'b'] }, length: { max: 3 } },
    'optTags?': { type: 'array', value: '?string' },
    matrix: { array: { array: 'number', length: [1, 2] } },
    dict: { object: { string: 'integer' } },
    'ldict?': { type: 'object', key: 'string', value: 'boolean', length: [1, 2] },
    point: ['number', { 'label?': 'string' }],
    'triple?': ['number', '?number', 'number'],
    id: { union: ['string', 'number'] },
    'alt?': { union: ['boolean', { n: 'integer' }] },
    shape: {
      union: [
        { kind: { enum: ['c'] }, r: 'number' },
        { kind: { enum: ['s'] }, side: 'integer' },
      ],
      discriminator: 'kind',
    },
    inner: { schema: { a: 'string', b: { c: '?number' } } },
    part: Schema.from({ x: 'string' }),
  }),
);

differential(
  'a lenient struct',
  new Schema('Lenient', { Form: { unknown: 'ignore' }, name: 'string', part: { a: 'string' } }),
);

differential('a schema of one type', Schema.from({ type: 'string', length: [1, 3] }));

differential('a list schema', Schema.from({ array: { x: 'number', 'y?': 'boolean' } }));

const graph = new Model({}, [
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
      'mentor?': 'Person',
    },
  ],
]);

differential('references by kind', graph.entities.get('Person'));
differential('a recursive struct', graph.entities.get('Tag'));
differential('every reference embedded', graph.entities.get('Person'), { references: 'embed' });
differential('every reference as an id', graph.entities.get('Person'), { references: 'id' });

const fixture = new Model(
  { datetime: { js: 'string' }, ...customTypes },
  new Map(Object.entries(entities)),
  database,
);

for (const name of fixture.order) {
  differential(`the fixture entity ${name}`, fixture.entities.get(name));
}
differential('the fixture graph of an account', fixture.entities.get('Account'), {
  references: 'embed',
});
