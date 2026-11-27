const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const util = require('node:util');

const { Schema, Model, ValidationResult } = require('../../index.js');
const en = require('../../src/locales/en.js');
const uk = require('../../src/locales/uk.js');
const { toDotPath } = require('../../src/issues.js');

describe('Result', () => {
  it('should render errors once, from the issues, on first use', () => {
    const schema = new Schema('User', { name: 'string', age: '?number' });
    const result = schema.check({ age: 'old' });
    assert.equal(result.valid, false);
    assert.deepEqual(result.issues, [
      { code: 'required', path: ['name'], message: 'is required', params: {} },
      {
        code: 'type',
        path: ['age'],
        message: 'not of expected type: number',
        params: { expected: 'number', received: 'string' },
      },
    ]);
    const { errors } = result;
    assert.deepEqual(errors, [
      'Field "User.name" is required',
      'Field "User.age" not of expected type: number',
    ]);
    assert.equal(result.errors, errors);
    assert.equal(result.summary, errors.join('\n'));
    result.add('late');
    assert.deepEqual(result.errors.at(-1), 'Field "User" late');
    assert.equal(Object.keys(result).join(), 'issues');
    assert.equal(
      util.inspect(schema.check({ name: 'x' })),
      'ValidationResult { valid: true, errors: [], issues: [] }',
    );
    assert.equal(JSON.stringify(schema.check({ name: 'x' })), '{"valid":true,"issues":[]}');
  });

  it('should render flatten, tree and summary', () => {
    const schema = Schema.from({
      name: 'string',
      tags: { array: { label: 'string' } },
      validate: () => 'no good',
    });
    assert.deepEqual(schema.check({ name: 'x', tags: [] }).flatten(), {
      formErrors: ['no good'],
      fieldErrors: {},
    });
    const result = schema.check({ name: 1, tags: [{ label: 'ok' }, { label: 2 }], extra: true });
    assert.deepEqual(result.flatten(), {
      formErrors: ['has unexpected keys: extra'],
      fieldErrors: {
        name: ['not of expected type: string'],
        'tags[1].label': ['not of expected type: string'],
      },
    });
    const tree = result.tree();
    assert.deepEqual(tree.errors, ['has unexpected keys: extra']);
    assert.deepEqual(tree.properties.name, { errors: ['not of expected type: string'] });
    assert.equal(tree.properties.tags.errors.length, 0);
    assert.equal(tree.properties.tags.items[0], undefined);
    assert.deepEqual(tree.properties.tags.items[1], {
      errors: [],
      properties: { label: { errors: ['not of expected type: string'] } },
    });
    assert.equal(
      result.summary,
      [
        'Field "name" not of expected type: string',
        'Field "tags[1].label" not of expected type: string',
        'Field "" has unexpected keys: extra',
      ].join('\n'),
    );
    assert.deepEqual(Schema.from({ a: 'string' }).check({ a: 'x' }).flatten(), {
      formErrors: [],
      fieldErrors: {},
    });
  });

  it('should never reach Object.prototype through paths from the value', () => {
    const schema = Schema.from({ ['__proto__']: 'number', o: { object: { string: 'number' } } });
    const value = JSON.parse('{"__proto__":"x","o":{"__proto__":"y","a.b":"z"}}');
    const result = schema.check(value);
    assert.deepEqual(
      result.issues.map((issue) => issue.path),
      [['__proto__'], ['o', '__proto__'], ['o', 'a.b']],
    );
    assert.deepEqual(result.errors, [
      'Field "__proto__" not of expected type: number',
      'Field "o.__proto__" not of expected type: number',
      'Field "o["a.b"]" not of expected type: number',
    ]);
    const flat = result.flatten();
    assert.equal(Object.getPrototypeOf(flat.fieldErrors), Object.prototype);
    assert.deepEqual(Object.keys(flat.fieldErrors), ['__proto__', 'o.__proto__', 'o["a.b"]']);
    const tree = result.tree();
    assert.equal(Object.getPrototypeOf(tree.properties), Object.prototype);
    assert.deepEqual(Object.keys(tree.properties), ['__proto__', 'o']);
    assert.deepEqual(Object.entries(tree.properties)[0][1].errors, [
      'not of expected type: number',
    ]);
    assert.deepEqual(Object.keys(tree.properties.o.properties), ['__proto__', 'a.b']);
  });

  it('should render keys with escaping and a root in toDotPath', () => {
    assert.equal(toDotPath([]), '');
    assert.equal(toDotPath([], 'User'), 'User');
    assert.equal(toDotPath(['name', 'first'], 'User'), 'User.name.first');
    assert.equal(toDotPath([1, 'nest', 0, 0]), '[1].nest[0][0]');
    assert.equal(toDotPath(['tags', 2], 'Doc'), 'Doc.tags[2]');
    assert.equal(
      toDotPath(['a.b', 'c d', '1234', '$ok', 'quote"d']),
      '["a.b"]["c d"].1234.$ok["quote\\"d"]',
    );
    assert.equal(toDotPath([Symbol('sym')]), '["Symbol(sym)"]');
    assert.equal(toDotPath(['k'.repeat(101)]), `${'k'.repeat(100)}...`);
    assert.equal(toDotPath(['k'.repeat(100)]), 'k'.repeat(100));
  });

  it('should group several messages of one path in flatten', () => {
    const schema = Schema.from({
      code: { type: 'string', validate: () => ['one', { message: 'two', path: [] }] },
    });
    const flat = schema.check({ code: 'x' }).flatten();
    assert.deepEqual(flat, { formErrors: [], fieldErrors: { code: ['one', 'two'] } });
    const tree = schema.check({ code: 'x' }).tree();
    assert.deepEqual(tree, { errors: [], properties: { code: { errors: ['one', 'two'] } } });
  });

  it('should write the verdict and the issues in toJSON', () => {
    const schema = Schema.from({ name: 'string' });
    assert.deepEqual(JSON.parse(JSON.stringify(schema.check({ name: 'x' }))), {
      valid: true,
      issues: [],
    });
    const invalid = schema.check({});
    assert.deepEqual(JSON.parse(JSON.stringify(invalid)), {
      valid: false,
      issues: [{ code: 'required', path: ['name'], message: 'is required', params: {} }],
    });
    assert.deepEqual(invalid.toJSON(), { valid: false, issues: invalid.issues });
    assert.deepEqual(Object.keys(JSON.parse(JSON.stringify({ result: invalid }))), ['result']);
  });
});

describe('Locales', () => {
  it('should have a renderer for every code in every locale', () => {
    const codes = [
      'field',
      'required',
      'type',
      'unexpected',
      'enum',
      'length',
      'range',
      'pattern',
      'format',
      'decimals',
      'union',
      'reference',
      'circular',
      'depth',
      'exception',
      'custom',
    ];
    assert.deepEqual(Object.keys(en), codes);
    assert.deepEqual(Object.keys(uk), codes);
    for (const code of codes) {
      assert.equal(typeof en[code], 'function', code);
      assert.equal(typeof uk[code], 'function', code);
    }
    assert.equal(en.length({ min: 2, max: 5, actual: 1 }), 'value is too short');
    assert.equal(en.length({ min: 2, max: 5, actual: 9 }), 'exceeds the maximum length');
    assert.equal(en.length({ min: undefined, max: 0, actual: 1 }), 'exceeds the maximum length');
    assert.equal(uk.length({ min: 2, max: 5, actual: 1 }), 'значення закоротке');
    assert.equal(uk.type({ expected: 'number', key: 'a' }), 'ключі мають бути типу number');
    assert.equal(
      uk.unexpected({ keys: ['k'.repeat(101)] }),
      `має неочікувані ключі: ${'k'.repeat(100)}...`,
    );
  });

  it('should render messages through the locale of the check', () => {
    const model = new Model({}, [
      ['Owner', { Entity: {}, name: 'string' }],
      [
        'Doc',
        {
          Entity: {},
          title: { type: 'string', length: { min: 3 } },
          status: { enum: ['a', 'b'] },
          owner: 'Owner',
          ghost: 'Nothing',
          parent: { type: 'Doc', required: false, embed: true },
          note: { type: 'string', validate: () => 'власне повідомлення' },
          bad: {
            type: 'string',
            validate: () => {
              throw new Error('boom');
            },
          },
          flag: { type: 'boolean', validate: () => false },
          byId: { map: { number: 'string' } },
        },
      ],
    ]);
    const doc = model.entities.get('Doc');
    const value = {
      title: 'ab',
      status: 'c',
      ghost: {},
      note: 'x',
      bad: 'x',
      flag: true,
      byId: new Map([['a', 'b']]),
      extra: 1,
    };
    value.parent = value;
    const result = doc.check(value, { root: 'Doc', messages: uk });
    assert.deepEqual(result.errors, [
      'Поле "Doc.title" значення закоротке',
      'Поле "Doc.status" значення не входить до переліку: a, b',
      'Поле "Doc.owner" є обовʼязковим',
      'Поле "Doc.ghost" сутність "Nothing" не знайдено',
      'Поле "Doc.parent" є циклічним посиланням',
      'Поле "Doc.note" власне повідомлення',
      'Поле "Doc.bad" перевірка завершилась помилкою Error: boom',
      'Поле "Doc.flag" помилка перевірки',
      'Поле "Doc.byId" ключі мають бути типу number',
      'Поле "Doc" має неочікувані ключі: extra',
    ]);
    assert.deepEqual(doc.check({ title: 1 }, { root: 'Doc', messages: uk }).issues[0], {
      code: 'type',
      path: ['title'],
      message: 'не відповідає типу: string',
      params: { expected: 'string', received: 'number' },
    });
    // The same issues, rendered in English by default; a partial table falls
    // back to English for the codes it does not have.
    assert.equal(doc.check(value).errors[0], 'Field "Doc.title" value is too short');
    const partial = { required: () => 'required!' };
    const mixed = doc.check({ title: 1, status: 'c' }, { root: 'Doc', messages: partial }).errors;
    assert.deepEqual(mixed, [
      'Field "Doc.title" not of expected type: string',
      'Field "Doc.status" value is not of enum: a, b',
      'Field "Doc.owner" required!',
      'Field "Doc.ghost" required!',
      'Field "Doc.note" required!',
      'Field "Doc.bad" required!',
      'Field "Doc.flag" required!',
      'Field "Doc.byId" required!',
    ]);
    // A function renders every issue itself.
    const codes = doc.check({ title: 1 }, { root: 'Doc', messages: (issue) => issue.code }).errors;
    assert.deepEqual(codes.slice(0, 3), [
      'Field "Doc.title" type',
      'Field "Doc.status" required',
      'Field "Doc.owner" required',
    ]);
    for (const messages of [null, 42, 'uk']) {
      assert.throws(() => doc.check({}, { root: 'Doc', messages }), {
        name: 'SchemaUsageError',
        message: `messages must be a locale table or a function, got ${JSON.stringify(messages)}`,
      });
    }
  });

  it('should pass the dotted path to a validate function, which may build a result', () => {
    const paths = [];
    const schema = new Schema('Order', {
      items: {
        array: {
          sku: {
            type: 'string',
            validate: (value, path) => {
              paths.push(path);
              const result = new ValidationResult();
              if (value.length < 2) result.add('is too short');
              if (!value.includes('-')) result.add({ message: 'needs a dash', path: 'dash' });
              return result;
            },
          },
        },
      },
      validate: (value, path) => {
        paths.push(path);
        return null;
      },
    });
    const result = schema.check({ items: [{ sku: 'a' }, { sku: 'a-b' }] });
    assert.deepEqual(paths, ['Order.items[0].sku', 'Order.items[1].sku']);
    assert.deepEqual(result.errors, [
      'Field "Order.items[0].sku" is too short',
      'Field "Order.items[0].sku.dash" needs a dash',
    ]);
    assert.deepEqual(result.issues[1].path, ['items', 0, 'sku', 'dash']);
    paths.length = 0;
    assert.equal(schema.check({ items: [{ sku: 'a-b' }] }).valid, true);
    assert.deepEqual(paths, ['Order.items[0].sku', 'Order']);
  });

  it('should cap the unexpected keys at ten in the message, all of them in params', () => {
    const schema = Schema.from({ a: 'string' });
    const keys = Array.from({ length: 12 }, (_, index) => `k${index}`);
    const value = { a: 'x' };
    for (const key of keys) value[key] = 1;
    const result = schema.check(value);
    assert.deepEqual(result.issues[0].params.keys, keys);
    assert.deepEqual(result.errors, [
      'Field "" has unexpected keys: k0, k1, k2, k3, k4, k5, k6, k7, k8, k9 and 2 more',
    ]);
    assert.deepEqual(schema.check(value, { messages: uk }).errors, [
      'Поле "" має неочікувані ключі: k0, k1, k2, k3, k4, k5, k6, k7, k8, k9 і ще 2',
    ]);
    const ten = {};
    for (const key of keys.slice(0, 10)) ten[key] = 1;
    assert.deepEqual(schema.check({ a: 'x', ...ten }).errors, [
      'Field "" has unexpected keys: k0, k1, k2, k3, k4, k5, k6, k7, k8, k9',
    ]);
    const many = { a: 'x' };
    for (let index = 0; index < 100_000; index += 1) many[`x${index}`] = 1;
    assert.ok(schema.check(many).errors[0].length < 200);
  });
});
