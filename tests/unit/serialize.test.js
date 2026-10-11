const { test } = require('node:test');
const assert = require('node:assert');

const { Schema, Model } = require('../../index.js');

test('Serialize: the value comes back as it is when there is nothing to apply', () => {
  const user = new Schema('User', { name: 'string', age: '?number' });
  const value = { name: 'Marcus' };
  assert.deepStrictEqual(user.serialize(value), { value });
  assert.strictEqual(user.serialize(value).value, value);
  // No check by default: the value is the program's, not validated.
  assert.deepStrictEqual(user.serialize({ name: 1 }), { value: { name: 1 } });
  assert.deepStrictEqual(user.serialize(null), { value: null });
  assert.strictEqual(Schema.from('string').serialize('x').value, 'x');
});

test('Serialize: the serializers run from the value down to its parts', () => {
  const order = [];
  const log = (label, fn) => (value) => {
    order.push(label);
    return fn(value);
  };
  const schema = new Schema('Event', {
    when: {
      type: 'string',
      parse: (text) => new Date(text),
      serialize: log('when', (date) => date.toISOString()),
    },
    amount: {
      type: 'string',
      parse: (text) => Math.round(Number(text) * 100),
      serialize: log('amount', (cents) => (cents / 100).toFixed(2)),
    },
    tags: {
      array: { type: 'string', serialize: log('tag', (text) => text.toLowerCase()) },
      serialize: log('tags', (text) => text.split(',')),
    },
    inner: {
      v: { type: 'number', serialize: log('inner.v', (n) => n * 10) },
      serialize: log('inner', (object) => ({ ...object, v: object.v + 1 })),
    },
    'note?': { type: 'string', serialize: log('note', (text) => `${text}!`) },
    serialize: log('root', (value) => ({ ...value, tags: value.tags.toUpperCase() })),
  });
  const program = {
    when: new Date('2020-01-02T03:04:05.000Z'),
    amount: 1234,
    tags: 'a,b',
    inner: { v: 1 },
  };
  const { value } = schema.serialize(program);
  assert.deepStrictEqual(value, {
    when: '2020-01-02T03:04:05.000Z',
    amount: '12.34',
    tags: ['a', 'b'],
    inner: { v: 20 },
  });
  assert.deepStrictEqual(order, [
    'root',
    'when',
    'amount',
    'tags',
    'tag',
    'tag',
    'inner',
    'inner.v',
  ]);
  assert.deepStrictEqual(program, {
    when: new Date('2020-01-02T03:04:05.000Z'),
    amount: 1234,
    tags: 'a,b',
    inner: { v: 1 },
  });
  // The round trip: what serialize gives, the decoders take back.
  const back = schema.parse(value).value;
  assert.deepStrictEqual(back.when, program.when);
  assert.strictEqual(back.amount, program.amount);
  // null and undefined pass a serializer by, as they pass a decoder.
  assert.strictEqual(schema.serialize({ ...program, note: null }).value.note, null);
  const seen = [];
  const field = Schema.from({
    x: {
      type: 'number',
      serialize(...args) {
        seen.push([this.type, args]);
        return args[0];
      },
    },
  });
  field.serialize({ x: 1 });
  assert.deepStrictEqual(seen, [['number', [1]]]);
});

test('Serialize: collections, tuples, unions, references and Schema fields', () => {
  const model = new Model({}, [
    ['Tag', { Struct: {}, label: { type: 'string', serialize: (text) => text.toLowerCase() } }],
    [
      'Company',
      { Registry: {}, name: 'string', serialize: (company) => ({ name: company.name.trim() }) },
    ],
    [
      'Doc',
      {
        Entity: {},
        bag: { set: { type: 'number', serialize: (n) => n * 2 } },
        dict: { object: { string: { type: 'string', serialize: (text) => `<${text}>` } } },
        table: { map: { string: { type: 'number', serialize: (n) => -n } } },
        point: [{ type: 'number', serialize: String }, 'number'],
        shape: {
          union: [
            {
              Struct: {},
              kind: { enum: ['circle'] },
              r: { type: 'number', serialize: (r) => r / 2 },
            },
            { Struct: {}, kind: { enum: ['rect'] }, w: 'number' },
          ],
          discriminator: 'kind',
        },
        either: { union: ['string', { Struct: {}, n: { type: 'number', serialize: (n) => -n } }] },
        tags: { many: 'Tag' },
        employer: 'Company',
        'home?': { type: 'Company', embed: true },
        part: new Schema('Part', { p: 'string', serialize: (part) => ({ p: `${part.p}!` }) }),
      },
    ],
  ]);
  const doc = model.entities.get('Doc');
  const program = {
    bag: new Set([1, 2]),
    dict: { k: 'v' },
    table: new Map([['x', 1]]),
    point: [1, 2],
    shape: { kind: 'circle', r: 4 },
    either: { n: 1 },
    tags: [{ label: 'STOIC' }],
    employer: 'c1',
    home: { name: ' Villa ' },
    part: { p: 'x' },
  };
  const { value } = doc.serialize(program);
  assert.deepStrictEqual(value, {
    bag: new Set([2, 4]),
    dict: { k: '<v>' },
    table: new Map([['x', -1]]),
    point: ['1', 2],
    shape: { kind: 'circle', r: 2 },
    // A plain union is entered through the first branch whose check accepts
    // the program value, so only while it has the form of the branch.
    either: { n: -1 },
    tags: [{ label: 'stoic' }],
    employer: 'c1',
    home: { name: 'Villa' },
    part: { p: 'x!' },
  });
  assert.deepStrictEqual(program.tags, [{ label: 'STOIC' }]);
  assert.deepStrictEqual(doc.serialize({ ...program, either: { n: 'x' } }).value.either, {
    n: 'x',
  });
  assert.strictEqual(doc.serialize(program, { references: 'id' }).value.home, program.home);
  assert.deepStrictEqual(
    doc.serialize({ ...program, employer: { name: ' Rome ' } }, { references: 'embed' }).value
      .employer,
    {
      name: 'Rome',
    },
  );
  // A serializer may change the shape; what it returns is what goes on.
  const shaped = Schema.from({ inner: { v: 'number', serialize: () => 'flat' } });
  assert.deepStrictEqual(shaped.serialize({ inner: { v: 1 } }).value, { inner: 'flat' });
  const gone = Schema.from({ inner: { v: 'number', serialize: () => null } });
  assert.deepStrictEqual(gone.serialize({ inner: { v: 1 } }).value, { inner: null });
});

test('Serialize: with check the result is validated', () => {
  const schema = new Schema('Event', {
    when: {
      type: 'string',
      parse: (text) => new Date(text),
      serialize: (date) => date.toISOString(),
    },
    count: 'integer',
  });
  const good = schema.serialize({ when: new Date(0), count: 1 }, { check: true });
  assert.deepStrictEqual(good, {
    valid: true,
    value: { when: '1970-01-01T00:00:00.000Z', count: 1 },
    issues: [],
  });
  const bad = schema.serialize({ when: new Date(0), count: 1.5, extra: 1 }, { check: true });
  assert.strictEqual(bad.valid, false);
  assert.deepStrictEqual(bad.value, { when: '1970-01-01T00:00:00.000Z', count: 1.5, extra: 1 });
  assert.deepStrictEqual(
    bad.issues.map(({ path, message }) => [path, message]),
    [
      [['count'], 'not of expected type: integer'],
      [[], 'has unexpected keys: extra'],
    ],
  );
  const options = { check: true, unknown: 'ignore', maxErrors: 1, root: 'out' };
  const limited = schema.serialize({ when: new Date(0), count: 1.5, extra: 1 }, options);
  assert.deepStrictEqual(
    limited.issues.map(({ path, message }) => [path, message]),
    [[['count'], 'not of expected type: integer']],
  );
  assert.deepStrictEqual(Object.keys(schema.serialize({}, { check: false })), ['value']);
  // A schema with relations checks the result with its cycle detection.
  const node = new Model({}, [
    [
      'Node',
      { Struct: {}, name: { type: 'string', serialize: (text) => text.trim() }, 'next?': 'Node' },
    ],
  ]).entities.get('Node');
  const loop = { name: ' a ' };
  loop.next = loop;
  assert.deepStrictEqual(node.serialize({ name: ' a ', next: { name: 'b ' } }, { check: true }), {
    valid: true,
    value: { name: 'a', next: { name: 'b' } },
    issues: [],
  });
  // A program value that loops is serialized down to where it loops, and the
  // check over the result reports the loop.
  const looped = node.serialize(loop, { check: true });
  assert.strictEqual(looped.value.name, 'a');
  assert.strictEqual(looped.value.next, loop);
  assert.deepStrictEqual(
    looped.issues.map(({ path, message }) => [path, message]),
    [[['next', 'next'], 'is a circular reference']],
  );
  assert.throws(() => schema.serialize({}, { check: true, unknown: 'strip' }), {
    name: 'TypeError',
  });
  // A serializer that throws is a programming error of the program's value.
  const thrower = Schema.from({
    a: {
      type: 'string',
      serialize: () => {
        throw new Error('boom');
      },
    },
  });
  assert.throws(() => thrower.serialize({ a: 'x' }), { message: 'boom' });
});

test('Serialize: format is collected and never called', () => {
  const calls = [];
  const schema = new Schema('Doc', {
    a: 'string',
    format: (value) => {
      calls.push(value);
      return value;
    },
  });
  assert.strictEqual(typeof schema.options.format, 'function');
  schema.parse({ a: 'x' });
  schema.serialize({ a: 'x' });
  schema.check({ a: 'x' });
  assert.deepStrictEqual(calls, []);
});

test('Serialize: an async validator inside a plain union is no error of the serialization', () => {
  const schema = Schema.from({
    u: {
      union: [
        {
          Struct: {},
          n: { type: 'number', validate: async () => true, serialize: (n) => String(n) },
        },
        'string',
      ],
    },
  });
  assert.deepStrictEqual(schema.serialize({ u: { n: 1 } }), { value: { u: { n: '1' } } });
  assert.deepStrictEqual(schema.serialize({ u: 's' }), { value: { u: 's' } });
});
