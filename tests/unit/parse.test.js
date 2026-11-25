const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { Schema, Model } = require('../../index.js');
const uk = require('../../src/locales/uk.js');

const summarize = (issues) => issues.map(({ code, path, message }) => [code, path, message]);

describe('Parse', () => {
  it('should return a valid value as it is when there is nothing to apply', () => {
    const user = new Schema('User', { name: 'string', age: '?number', tags: { array: 'string' } });
    const value = { name: 'Marcus', tags: ['stoic'] };
    const result = user.parse(value);
    assert.deepEqual(Object.keys(result), ['valid', 'value', 'issues']);
    assert.equal(result.valid, true);
    // The value itself: no copy is made when no default, decoder or strip
    // touched it, and it is never written to.
    assert.equal(result.value, value);
    assert.deepEqual(result.issues, []);
    assert.deepEqual(user.parse('x'), {
      valid: false,
      value: undefined,
      issues: [
        {
          code: 'type',
          path: [],
          message: 'not of expected type: object',
          params: { expected: 'object', received: 'string' },
        },
      ],
    });
    assert.equal(Schema.from('string').parse('x').value, 'x');
    assert.equal(Schema.from('string').parse(1).valid, false);
  });

  it('should give an invalid value no output and every issue of check', () => {
    const user = new Schema('User', { name: 'string', age: '?number' });
    const result = user.parse({ age: 'old', extra: 1 });
    assert.equal(result.valid, false);
    assert.equal(result.value, undefined);
    assert.deepEqual(result.issues, user.check({ age: 'old', extra: 1 }).issues);
    assert.deepEqual(summarize(user.parse({}, { maxErrors: 1 }).issues), [
      ['required', ['name'], 'is required'],
    ]);
    assert.deepEqual(summarize(user.parse({}, { messages: uk }).issues), [
      ['required', ['name'], 'є обовʼязковим'],
    ]);
    assert.equal(user.parse({ name: 'x', extra: 1 }, { unknown: 'ignore' }).valid, true);
    assert.equal(user.parse({ name: 'x', extra: 1 }).valid, false);
  });

  it('should take the options of check, with strip for unknown keys', () => {
    const user = new Schema('User', { name: 'string' });
    assert.throws(() => user.parse({}, { unknown: 'drop' }), {
      name: 'SchemaUsageError',
      message: 'unknown must be "reject", "ignore" or "strip", got "drop"',
    });
    assert.throws(() => user.check({}, { unknown: 'strip' }), {
      name: 'SchemaUsageError',
      message: 'unknown must be "reject" or "ignore", got "strip"',
    });
    assert.throws(() => user.parse({}, 'body'), { name: 'SchemaUsageError' });
    assert.throws(() => user.parse({}, { maxErrors: 0 }), { name: 'SchemaUsageError' });
    assert.throws(() => user.parse({}, { references: 'all' }), { name: 'SchemaUsageError' });
    assert.equal(user.parse({ name: 'x' }, { root: 'body' }).valid, true);
  });

  it('should fill a missing key with a default before the check, in parse only', () => {
    let calls = 0;
    const schema = new Schema('Doc', {
      title: 'string',
      status: { type: 'string', default: 'draft' },
      'views?': { type: 'integer', default: 0 },
      'labels?': { array: 'string', default: () => [] },
      serial: { type: 'number', default: () => (calls += 1) },
      'ratio?': { type: 'number', nullable: true, default: null },
    });
    const input = { title: 'x' };
    const first = schema.parse(input);
    assert.deepEqual(first, {
      valid: true,
      value: { title: 'x', status: 'draft', views: 0, labels: [], serial: 1, ratio: null },
      issues: [],
    });
    assert.notEqual(first.value, input);
    assert.deepEqual(input, { title: 'x' });
    // A factory runs on every parse, and gives every value its own instance.
    const second = schema.parse({ title: 'y', labels: undefined });
    assert.equal(second.value.serial, 2);
    assert.notEqual(second.value.labels, first.value.labels);
    // A key that is there, null included, is not defaulted; `undefined` is.
    assert.deepEqual(schema.parse({ title: 'x', status: 'live', views: null }).value, {
      title: 'x',
      status: 'live',
      views: null,
      labels: [],
      serial: 3,
      ratio: null,
    });
    // The default goes through the check like any value.
    const broken = Schema.from({ n: { type: 'number', default: 'zero' } });
    assert.deepEqual(summarize(broken.parse({}).issues), [
      ['type', ['n'], 'not of expected type: number'],
    ]);
    // check knows nothing of defaults: a missing required key is required.
    assert.deepEqual(schema.check({ title: 'x' }).errors, [
      'Field "Doc.status" is required',
      'Field "Doc.serial" is required',
    ]);
    assert.equal(schema.check({ title: 'x', status: 'draft', serial: 1 }).valid, true);
  });

  it('should apply defaults at every depth, in collections, unions and references', () => {
    const model = new Model({}, [
      ['Tag', { Struct: {}, label: 'string', 'weight?': { type: 'number', default: 1 } }],
      [
        'Doc',
        {
          Struct: {},
          address: { city: 'string', 'country?': { type: 'string', default: 'UA' } },
          'meta?': {
            type: 'schema',
            schema: { 'v?': { type: 'number', default: 1 } },
            default: {},
          },
          rows: { array: { 'n?': { type: 'number', default: 0 } } },
          bag: { set: { 'n?': { type: 'number', default: 0 } } },
          dict: { object: { string: { 'n?': { type: 'number', default: 0 } } } },
          table: { map: { string: { 'n?': { type: 'number', default: 0 } } } },
          pair: ['number', { schema: { 'n?': { type: 'number', default: 0 } } }],
          shape: {
            union: [
              { Struct: {}, kind: { enum: ['a'] }, 'x?': { type: 'number', default: 1 } },
              { Struct: {}, kind: { enum: ['b'] }, 'y?': { type: 'number', default: 2 } },
            ],
            discriminator: 'kind',
          },
          either: { union: ['string', { Struct: {}, 'z?': { type: 'number', default: 3 } }] },
          tags: { many: 'Tag' },
          tag: 'Tag',
        },
      ],
    ]);
    const doc = model.entities.get('Doc');
    const input = {
      address: { city: 'Kyiv' },
      rows: [{}, { n: 5 }],
      bag: new Set([{}]),
      dict: { a: {} },
      table: new Map([['a', {}]]),
      pair: [1, {}],
      shape: { kind: 'b' },
      either: {},
      tags: [{ label: 't' }],
      tag: { label: 'u', weight: 2 },
    };
    const { value } = doc.parse(input);
    assert.deepEqual(value, {
      address: { city: 'Kyiv', country: 'UA' },
      rows: [{ n: 0 }, { n: 5 }],
      bag: new Set([{ n: 0 }]),
      dict: { a: { n: 0 } },
      table: new Map([['a', { n: 0 }]]),
      pair: [1, { n: 0 }],
      shape: { kind: 'b', y: 2 },
      either: { z: 3 },
      tags: [{ label: 't', weight: 1 }],
      tag: { label: 'u', weight: 2 },
      meta: { v: 1 },
    });
    // Only the containers on the way to a default are new; the rest is shared.
    assert.notEqual(value.rows, input.rows);
    assert.equal(value.rows[1], input.rows[1]);
    assert.equal(value.tag, input.tag);
    assert.deepEqual(input.rows[0], {});
    assert.deepEqual(input.address, { city: 'Kyiv' });
    // A plain union takes the first branch that accepts the value with its
    // defaults in place; a branch that does not match is left alone.
    assert.deepEqual(doc.parse({ ...input, either: 'text' }).value.either, 'text');
    const either = Schema.from({
      e: {
        union: [
          { Struct: {}, a: 'string', 'n?': { type: 'number', default: 1 } },
          { Struct: {}, b: 'string', 'n?': { type: 'number', default: 2 } },
        ],
      },
    });
    assert.deepEqual(either.parse({ e: { b: 'x' } }).value, { e: { b: 'x', n: 2 } });
    assert.deepEqual(either.parse({ e: { a: 'x' } }).value, { e: { a: 'x', n: 1 } });
    assert.equal(either.parse({ e: { c: 'x' } }).valid, false);
  });

  it('should drop the keys the schema does not have under strip, at every depth', () => {
    const model = new Model({}, [
      ['Tag', { Struct: {}, label: 'string' }],
      [
        'Doc',
        {
          Entity: {},
          title: 'string',
          meta: { tag: 'string' },
          tags: { many: 'Tag' },
          rows: { array: { n: 'number' } },
          part: Schema.from({ p: 'string' }),
          shape: {
            union: [{ Struct: {}, kind: { enum: ['a'] }, x: 'number' }],
            discriminator: 'kind',
          },
          either: { union: ['string', { Struct: {}, z: 'number' }] },
          ratio: (value) => value.title.length,
          toString: '?string',
        },
      ],
    ]);
    const doc = model.entities.get('Doc');
    const input = {
      title: 'x',
      meta: { tag: 't', extra: 1 },
      tags: [{ label: 'l', extra: 2 }],
      rows: [{ n: 1, extra: 3 }],
      part: { p: 'p', extra: 4 },
      shape: { kind: 'a', x: 1, extra: 5 },
      either: { z: 1, extra: 6 },
      ratio: 7,
      extra: 8,
    };
    assert.equal(doc.parse(input).valid, false);
    const result = doc.parse(input, { unknown: 'strip' });
    assert.equal(result.valid, true);
    assert.deepEqual(result.value, {
      title: 'x',
      meta: { tag: 't' },
      tags: [{ label: 'l' }],
      rows: [{ n: 1 }],
      part: { p: 'p' },
      shape: { kind: 'a', x: 1 },
      either: { z: 1 },
      // A calculated field is a key the schema knows.
      ratio: 7,
    });
    assert.equal(Object.hasOwn(result.value, 'docId'), false);
    assert.deepEqual(input.meta, { tag: 't', extra: 1 });
    // With strip every struct is a new object, even one with nothing to drop.
    const clean = { title: 'x', meta: { tag: 't' }, tags: [], rows: [], part: { p: 'p' } };
    const stripped = doc.parse(
      { ...clean, shape: { kind: 'a', x: 1 }, either: 's' },
      { unknown: 'strip' },
    );
    assert.notEqual(stripped.value.meta, clean.meta);
    assert.notEqual(stripped.value, clean);
    // An own key set to undefined and a field named after Object.prototype.
    const own = doc.parse(
      { ...clean, shape: { kind: 'a', x: 1 }, either: 's', toString: 'me', title: 'x' },
      { unknown: 'strip' },
    );
    assert.equal(own.value.toString, 'me');
    assert.equal(Object.hasOwn(own.value, 'toString'), true);
    // A schema whose own policy is to ignore keeps them unless the call strips.
    const lenient = new Schema('Form', { Form: { unknown: 'ignore' }, name: 'string' });
    assert.deepEqual(lenient.parse({ name: 'x', extra: 1 }).value, { name: 'x', extra: 1 });
    assert.deepEqual(lenient.parse({ name: 'x', extra: 1 }, { unknown: 'strip' }).value, {
      name: 'x',
    });
    // The check behind strip ignores unknown keys, so nothing else changes.
    assert.deepEqual(summarize(doc.parse({ ...input, title: 1 }, { unknown: 'strip' }).issues), [
      ['type', ['title'], 'not of expected type: string'],
    ]);
  });

  it('should turn the validated value into the value of the program with a decoder', () => {
    const schema = new Schema('Event', {
      when: { type: 'string', parse: (text) => new Date(text) },
      amount: {
        type: 'string',
        pattern: /^\d+\.\d\d$/,
        length: 12,
        parse: (text) => Math.round(Number(text) * 100),
      },
      'note?': { type: 'string', parse: (text) => text.trim() },
      keep: { type: 'string', parse: (text) => text },
      nothing: { type: 'string', nullable: true, parse: (text) => text.length },
    });
    const input = { when: '2020-01-02T03:04:05.000Z', amount: '12.34', keep: 'k', nothing: null };
    const { valid, value } = schema.parse(input);
    assert.equal(valid, true);
    assert.deepEqual(value, {
      when: new Date('2020-01-02T03:04:05.000Z'),
      amount: 1234,
      keep: 'k',
      nothing: null,
    });
    assert.notEqual(value, input);
    assert.equal(input.when, '2020-01-02T03:04:05.000Z');
    // A decoder sees only a value that passed; null and undefined pass it by.
    assert.deepEqual(summarize(schema.parse({ ...input, amount: '1' }).issues), [
      ['pattern', ['amount'], 'does not match the pattern ^\\d+\\.\\d\\d$'],
    ]);
    assert.equal(schema.parse({ ...input, note: null }).value.note, null);
    assert.equal(schema.parse({ ...input, note: ' x ' }).value.note, 'x');
    // The decoder is called on the field, with the value only.
    const seen = [];
    const field = Schema.from({
      x: {
        type: 'number',
        parse(...args) {
          seen.push([this.type, args]);
          return args[0];
        },
      },
    });
    field.parse({ x: 1 });
    assert.deepEqual(seen, [['number', [1]]]);
  });

  it('should run decoders from the parts of a value up to the value', () => {
    const order = [];
    const log = (label, fn) => (value) => {
      order.push(label);
      return fn(value);
    };
    const schema = new Schema('Doc', {
      tags: {
        array: { type: 'string', parse: log('tag', (text) => text.toUpperCase()) },
        parse: log('tags', (list) => list.join(',')),
      },
      bag: { set: { type: 'number', parse: log('item', (n) => n * 2) } },
      dict: { object: { string: { type: 'string', parse: log('entry', (text) => `<${text}>`) } } },
      table: { map: { string: { type: 'number', parse: log('cell', (n) => -n) } } },
      point: [{ type: 'number', parse: log('x', String) }, 'number'],
      inner: {
        a: { type: 'string', parse: log('inner.a', (text) => text.length) },
        parse: log('inner', (object) => ({ ...object, decoded: true })),
      },
      plain: 'string',
      parse: log('root', (value) => ({ ...value, root: true })),
    });
    const input = {
      tags: ['a', 'b'],
      bag: new Set([1, 2]),
      dict: { k: 'v' },
      table: new Map([['x', 1]]),
      point: [1, 2],
      inner: { a: 'abc' },
      plain: 'p',
    };
    const { value } = schema.parse(input);
    assert.deepEqual(value, {
      tags: 'A,B',
      bag: new Set([2, 4]),
      dict: { k: '<v>' },
      table: new Map([['x', -1]]),
      point: ['1', 2],
      inner: { a: 3, decoded: true },
      plain: 'p',
      root: true,
    });
    assert.deepEqual(order, [
      'tag',
      'tag',
      'tags',
      'item',
      'item',
      'entry',
      'cell',
      'x',
      'inner.a',
      'inner',
      'root',
    ]);
    assert.deepEqual(input, {
      tags: ['a', 'b'],
      bag: new Set([1, 2]),
      dict: { k: 'v' },
      table: new Map([['x', 1]]),
      point: [1, 2],
      inner: { a: 'abc' },
      plain: 'p',
    });
    // The schema-level parse of a Schema used as a field, and the long form.
    const inner = new Schema('Inner', { a: 'string', parse: (object) => object.a });
    const outer = Schema.from({
      bare: inner,
      short: { schema: inner },
      long: { type: 'schema', schema: inner, parse: (object) => `${object.a}!` },
      own: { type: 'schema', schema: { a: 'string' }, parse: (object) => object.a.length },
    });
    assert.deepEqual(
      outer.parse({ bare: { a: 'x' }, short: { a: 'y' }, long: { a: 'z' }, own: { a: 'w' } }).value,
      { bare: 'x', short: 'y', long: 'z!', own: 1 },
    );
  });

  it('should report a decoder that throws as an exception issue at its path', () => {
    const calls = [];
    const schema = new Schema('Doc', {
      a: {
        b: {
          type: 'string',
          parse: () => {
            throw new Error('boom');
          },
        },
      },
      c: {
        type: 'string',
        parse: (text) => {
          calls.push(text);
          return text;
        },
      },
      parse: () => {
        calls.push('root');
        return null;
      },
    });
    const result = schema.parse({ a: { b: 'x' }, c: 'y' });
    assert.equal(result.valid, false);
    assert.equal(result.value, undefined);
    assert.equal(result.issues.length, 1);
    const [issue] = result.issues;
    assert.equal(issue.code, 'exception');
    assert.deepEqual(issue.path, ['a', 'b']);
    assert.equal(issue.message, 'validation failed Error: boom');
    assert.equal(issue.params.error.message, 'boom');
    // After the first failure no decoder runs: the result is invalid already.
    assert.deepEqual(calls, []);
    const list = Schema.from({
      array: {
        type: 'number',
        parse: (n) => {
          if (n === 2) throw new Error('two');
          return n;
        },
      },
    });
    assert.deepEqual(summarize(list.parse([1, 2, 3]).issues), [
      ['exception', [1], 'validation failed Error: two'],
    ]);
    const root = Schema.from({
      a: 'string',
      parse: () => {
        throw new Error('whole');
      },
    });
    assert.deepEqual(summarize(root.parse({ a: 'x' }).issues), [
      ['exception', [], 'validation failed Error: whole'],
    ]);
    // The schema-level validate runs before the decoders, on the validated value.
    const validated = Schema.from({
      a: { type: 'string', parse: (text) => text.length },
      validate: (value) => typeof value.a === 'string' || 'decoded too early',
    });
    assert.equal(validated.parse({ a: 'x' }).valid, true);
  });

  it('should decode references by the kind of their target', () => {
    const model = new Model({}, [
      ['Tag', { Struct: {}, label: { type: 'string', parse: (text) => text.toUpperCase() } }],
      [
        'Company',
        {
          Registry: {},
          name: 'string',
          'parent?': 'Company',
          parse: (company) => ({ ...company, registered: true }),
        },
      ],
      [
        'Person',
        {
          Entity: {},
          name: 'string',
          employer: 'Company',
          tags: { many: 'Tag' },
          'boss?': { type: 'Person', embed: true },
          'home?': { type: 'Company', embed: true, parse: (company) => company.name },
        },
      ],
    ]);
    const person = model.entities.get('Person');
    const row = {
      name: 'Marcus',
      employer: 'c1',
      tags: [{ label: 'stoic' }, { label: 'emperor' }],
    };
    assert.deepEqual(person.parse(row).value, {
      name: 'Marcus',
      employer: 'c1',
      tags: [{ label: 'STOIC' }, { label: 'EMPEROR' }],
    });
    const graph = {
      name: 'Marcus',
      employer: { name: 'Rome', parent: { name: 'Italy' } },
      tags: [{ label: 'x' }],
      boss: { name: 'Antoninus', employer: { name: 'Nemausus' }, tags: [] },
      home: { name: 'Villa' },
    };
    assert.deepEqual(person.parse(graph, { references: 'embed' }).value, {
      name: 'Marcus',
      employer: { name: 'Rome', parent: { name: 'Italy', registered: true }, registered: true },
      tags: [{ label: 'X' }],
      boss: { name: 'Antoninus', employer: { name: 'Nemausus', registered: true }, tags: [] },
      home: 'Villa',
    });
    // By kind, a stored target is an id and stays one; an embedded field
    // follows its record.
    const mixed = { ...row, boss: { name: 'Antoninus', employer: 'c0', tags: [] } };
    assert.deepEqual(person.parse(mixed).value.boss, mixed.boss);
    const ids = { name: 'Marcus', employer: 'c1', tags: ['t1'], boss: 'p1' };
    assert.equal(person.parse(ids, { references: 'id' }).value, ids);
    // The field's own decoder applies to what the field holds in that view.
    const named = person.parse({ ...ids, home: 'c2' }, { references: 'id' });
    assert.equal(named.valid, true);
    assert.equal(Object.hasOwn(named.value, 'home'), true);
    assert.equal(named.value.home, undefined);
    // A cycle is the check's circular issue; parse never recurses into it.
    const loop = { name: 'self', employer: 'c1', tags: [] };
    loop.boss = loop;
    assert.deepEqual(summarize(person.parse(loop).issues), [
      ['circular', ['boss'], 'is a circular reference'],
    ]);
    const chain = new Model({}, [
      [
        'Node',
        { Struct: {}, name: 'string', 'next?': 'Node', 'n?': { type: 'number', default: 1 } },
      ],
    ]).entities.get('Node');
    const ring = { name: 'a' };
    ring.next = { name: 'b', next: ring };
    assert.deepEqual(summarize(chain.check(ring).issues), [
      ['circular', ['next', 'next'], 'is a circular reference'],
    ]);
    // The defaults would copy the records on the way to them and the copies
    // could not close the ring, so a value that loops is checked as it is.
    assert.deepEqual(summarize(chain.parse(ring).issues), [
      ['circular', ['next', 'next'], 'is a circular reference'],
    ]);
    assert.deepEqual(summarize(chain.parse({ name: 'a', next: ring }).issues), [
      ['circular', ['next', 'next', 'next'], 'is a circular reference'],
    ]);
    assert.deepEqual(chain.parse({ name: 'a', next: { name: 'b' } }).value, {
      name: 'a',
      next: { name: 'b', n: 1 },
      n: 1,
    });
    // A reference that cannot be resolved is the check's issue.
    const lost = Schema.from({ ghost: 'Ghost' });
    assert.deepEqual(summarize(lost.parse({ ghost: 'g' }).issues), [
      ['reference', ['ghost'], 'Entity "Ghost" is not found'],
    ]);
  });

  it('should treat custom types as leaves and leave a value of any shape alone', () => {
    const model = new Model(
      {
        hex: {
          construct() {},
          checkType: (value) => /^[0-9a-f]+$/.test(value) || 'not hex',
        },
        text: { js: 'string' },
      },
      [
        [
          'Doc',
          {
            Struct: {},
            id: { type: 'hex', parse: (text) => Number.parseInt(text, 16) },
            body: { type: 'text', parse: (text) => text.length },
            'blob?': 'json',
            'what?': 'any',
          },
        ],
      ],
    );
    const doc = model.entities.get('Doc');
    const blob = { nested: { deep: true } };
    const { value } = doc.parse({ id: 'ff', body: 'abc', blob, what: [1] });
    assert.deepEqual(value, { id: 255, body: 3, blob, what: [1] });
    assert.equal(value.blob, blob);
    assert.deepEqual(summarize(doc.parse({ id: 'zz', body: 'x' }).issues), [
      ['type', ['id'], 'not hex'],
    ]);
  });

  it('should throw for a definition with a parse or serialize that is not a function', () => {
    for (const key of ['parse', 'serialize']) {
      assert.throws(() => new Schema('Doc', { a: { type: 'string', [key]: 'yes' } }), {
        name: 'SchemaDefinitionError',
        code: 'ALX_ERR_INVALID_DEFINITION',
        message: `Option "${key}" needs a function in "Doc.a"`,
      });
    }
    // A struct may have fields of those names; they are fields, not codecs.
    const named = Schema.from({ parse: 'string', serialize: 'number' });
    assert.deepEqual(named.parse({ parse: 'x', serialize: 1 }).value, {
      parse: 'x',
      serialize: 1,
    });
    // The keys are known to the lint on every type.
    const linted = Schema.from({
      a: { type: 'string', parse: (text) => text, serialize: (text) => text },
      b: { array: 'number', parse: (list) => list.length },
    });
    assert.deepEqual(linted.warnings, []);
  });

  it('should keep keys named like Object.prototype members as data in the output', () => {
    const own = (object, key) => Object.getOwnPropertyDescriptor(object, key).value;
    const schema = Schema.from({
      ['__proto__']: { type: 'string', parse: (text) => `${text}!` },
      constructor: { type: 'number', default: 1 },
      'toString?': { type: 'string', parse: (text) => text.toUpperCase() },
    });
    const input = JSON.parse('{"__proto__": "p", "toString": "t"}');
    const { value } = schema.parse(input);
    assert.equal(Object.getPrototypeOf(value), Object.prototype);
    assert.deepEqual(Object.keys(value).sort(), ['__proto__', 'constructor', 'toString']);
    assert.equal(own(value, '__proto__'), 'p!');
    assert.equal(value.constructor, 1);
    assert.equal(value.toString, 'T');
    const stripped = schema.parse({ ...input, extra: 1 }, { unknown: 'strip' }).value;
    assert.equal(Object.getPrototypeOf(stripped), Object.prototype);
    assert.equal(own(stripped, '__proto__'), 'p!');
    assert.equal(Object.hasOwn(stripped, 'extra'), false);
    const polluted = Schema.from({ a: 'string' }).parse(JSON.parse('{"__proto__": {"x": 1}}'));
    assert.equal(polluted.valid, false);
  });

  it('should bound the check behind parse by maxErrors', () => {
    const schema = Schema.from({ a: 'string', b: 'string', c: { type: 'string', parse: () => 1 } });
    const result = schema.parse({}, { maxErrors: 2 });
    assert.deepEqual(summarize(result.issues), [
      ['required', ['a'], 'is required'],
      ['required', ['b'], 'is required'],
    ]);
    assert.equal(result.value, undefined);
  });

  it('should keep a thenable in the data as data, never awaited or adopted', () => {
    let called = 0;
    const thenable = {
      then(resolve) {
        called += 1;
        resolve('hijacked');
      },
    };
    // Under strip every field of a struct is written into the output: a value
    // with a `then` of its own must come back as it is.
    const any = Schema.from({ x: 'any' });
    const stripped = any.parse({ x: thenable }, { unknown: 'strip' });
    assert.equal(stripped.valid, true);
    assert.equal(stripped.value.x, thenable);
    assert.equal(called, 0);
    // A decoder receives the thenable itself, and its parts are never awaited.
    const decoded = Schema.from({ x: { type: 'any', parse: (value) => ({ got: value }) } });
    const result = decoded.parse({ x: thenable });
    assert.equal(result.valid, true);
    assert.equal(result.value.x.got, thenable);
    assert.equal(called, 0);
    // A field called `then` makes the value itself a thenable.
    const named = Schema.from({ then: 'any' });
    const value = { then: (resolve) => resolve('hijacked') };
    assert.equal(named.parse(value, { unknown: 'strip' }).value.then, value.then);
  });

  it('should run the trial of a plain union branch under the path and root of the parse', () => {
    const paths = [];
    const schema = new Schema('Pick', {
      box: {
        u: {
          union: [
            {
              Struct: {},
              n: {
                type: 'number',
                validate: (value, path) => {
                  paths.push(path);
                  return true;
                },
              },
              'd?': { type: 'number', default: 1 },
            },
            'string',
          ],
        },
      },
    });
    const result = schema.parse({ box: { u: { n: 1 } } });
    assert.deepEqual(result, {
      valid: true,
      value: { box: { u: { n: 1, d: 1 } } },
      issues: [],
    });
    // The trial before the check, then the check itself: the same path both times.
    assert.deepEqual(paths, ['Pick.box.u.n', 'Pick.box.u.n']);
    // A validator that returns a promise is reported by the check, at its path.
    const async = new Schema('Pick', {
      u: {
        union: [
          {
            Struct: {},
            n: { type: 'number', validate: async () => true },
            'd?': { type: 'number', default: 1 },
          },
          'string',
        ],
      },
    });
    assert.throws(() => async.parse({ u: { n: 1 } }), {
      code: 'ALX_ERR_ASYNC_VALIDATOR',
      message: 'The validator of "Pick.u.n" returned a promise; use checkAsync or parseAsync',
    });
  });

  it('should throw out of parse for a default factory that throws, as a serializer does', () => {
    const schema = Schema.from({
      'a?': {
        type: 'string',
        default: () => {
          throw new Error('no default');
        },
      },
    });
    assert.throws(() => schema.parse({}), { message: 'no default' });
    assert.equal(schema.parse({ a: 'x' }).valid, true);
  });
});
