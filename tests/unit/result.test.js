const { test } = require('node:test');
const assert = require('node:assert');
const util = require('node:util');

const { Schema, Model, ValidationResult } = require('../../index.js');
const en = require('../../src/locales/en.js');
const uk = require('../../src/locales/uk.js');
const { toDotPath } = require('../../src/issues.js');

test('Result: errors are rendered once, from the issues, on first use', () => {
  const schema = new Schema('User', { name: 'string', age: '?number' });
  const result = schema.check({ age: 'old' });
  assert.strictEqual(result.valid, false);
  assert.deepStrictEqual(result.issues, [
    { code: 'required', path: ['name'], message: 'is required', params: {} },
    {
      code: 'type',
      path: ['age'],
      message: 'not of expected type: number',
      params: { expected: 'number', received: 'string' },
    },
  ]);
  const { errors } = result;
  assert.deepStrictEqual(errors, [
    'Field "User.name" is required',
    'Field "User.age" not of expected type: number',
  ]);
  assert.strictEqual(result.errors, errors);
  assert.strictEqual(result.summary, errors.join('\n'));
  result.add('late');
  assert.deepStrictEqual(result.errors.at(-1), 'Field "User" late');
  assert.strictEqual(Object.keys(result).join(), 'issues');
  assert.strictEqual(
    util.inspect(schema.check({ name: 'x' })),
    'ValidationResult { valid: true, errors: [], issues: [] }',
  );
  assert.strictEqual(JSON.stringify(schema.check({ name: 'x' })), '{"issues":[]}');
});

test('Result: flatten, tree and summary', () => {
  const schema = Schema.from({
    name: 'string',
    tags: { array: { label: 'string' } },
    validate: () => 'no good',
  });
  assert.deepStrictEqual(schema.check({ name: 'x', tags: [] }).flatten(), {
    formErrors: ['no good'],
    fieldErrors: {},
  });
  const result = schema.check({ name: 1, tags: [{ label: 'ok' }, { label: 2 }], extra: true });
  assert.deepStrictEqual(result.flatten(), {
    formErrors: ['has unexpected keys: extra'],
    fieldErrors: {
      name: ['not of expected type: string'],
      'tags[1].label': ['not of expected type: string'],
    },
  });
  const tree = result.tree();
  assert.deepStrictEqual(tree.errors, ['has unexpected keys: extra']);
  assert.deepStrictEqual(tree.properties.name, { errors: ['not of expected type: string'] });
  assert.strictEqual(tree.properties.tags.errors.length, 0);
  assert.strictEqual(tree.properties.tags.items[0], undefined);
  assert.deepStrictEqual(tree.properties.tags.items[1], {
    errors: [],
    properties: { label: { errors: ['not of expected type: string'] } },
  });
  assert.strictEqual(
    result.summary,
    [
      'Field "name" not of expected type: string',
      'Field "tags[1].label" not of expected type: string',
      'Field "" has unexpected keys: extra',
    ].join('\n'),
  );
  assert.deepStrictEqual(Schema.from({ a: 'string' }).check({ a: 'x' }).flatten(), {
    formErrors: [],
    fieldErrors: {},
  });
});

test('Result: paths from the value never reach Object.prototype', () => {
  const schema = Schema.from({ ['__proto__']: 'number', o: { object: { string: 'number' } } });
  const value = JSON.parse('{"__proto__":"x","o":{"__proto__":"y","a.b":"z"}}');
  const result = schema.check(value);
  assert.deepStrictEqual(
    result.issues.map((issue) => issue.path),
    [['__proto__'], ['o', '__proto__'], ['o', 'a.b']],
  );
  assert.deepStrictEqual(result.errors, [
    'Field "__proto__" not of expected type: number',
    'Field "o.__proto__" not of expected type: number',
    'Field "o["a.b"]" not of expected type: number',
  ]);
  const flat = result.flatten();
  assert.strictEqual(Object.getPrototypeOf(flat.fieldErrors), Object.prototype);
  assert.deepStrictEqual(Object.keys(flat.fieldErrors), ['__proto__', 'o.__proto__', 'o["a.b"]']);
  const tree = result.tree();
  assert.strictEqual(Object.getPrototypeOf(tree.properties), Object.prototype);
  assert.deepStrictEqual(Object.keys(tree.properties), ['__proto__', 'o']);
  assert.deepStrictEqual(Object.entries(tree.properties)[0][1].errors, [
    'not of expected type: number',
  ]);
  assert.deepStrictEqual(Object.keys(tree.properties.o.properties), ['__proto__', 'a.b']);
});

test('Result: toDotPath renders keys with escaping and a root', () => {
  assert.strictEqual(toDotPath([]), '');
  assert.strictEqual(toDotPath([], 'User'), 'User');
  assert.strictEqual(toDotPath(['name', 'first'], 'User'), 'User.name.first');
  assert.strictEqual(toDotPath([1, 'nest', 0, 0]), '[1].nest[0][0]');
  assert.strictEqual(toDotPath(['tags', 2], 'Doc'), 'Doc.tags[2]');
  assert.strictEqual(
    toDotPath(['a.b', 'c d', '1234', '$ok', 'quote"d']),
    '["a.b"]["c d"].1234.$ok["quote\\"d"]',
  );
  assert.strictEqual(toDotPath([Symbol('sym')]), '["Symbol(sym)"]');
  assert.strictEqual(toDotPath(['k'.repeat(101)]), `${'k'.repeat(100)}...`);
  assert.strictEqual(toDotPath(['k'.repeat(100)]), 'k'.repeat(100));
});

test('Locales: every code has a renderer in every locale', () => {
  const codes = [
    'field',
    'required',
    'type',
    'unexpected',
    'enum',
    'length',
    'range',
    'pattern',
    'union',
    'reference',
    'circular',
    'exception',
    'custom',
  ];
  assert.deepStrictEqual(Object.keys(en), codes);
  assert.deepStrictEqual(Object.keys(uk), codes);
  for (const code of codes) {
    assert.strictEqual(typeof en[code], 'function', code);
    assert.strictEqual(typeof uk[code], 'function', code);
  }
  assert.strictEqual(en.length({ min: 2, max: 5, actual: 1 }), 'value is too short');
  assert.strictEqual(en.length({ min: 2, max: 5, actual: 9 }), 'exceeds the maximum length');
  assert.strictEqual(
    en.length({ min: undefined, max: 0, actual: 1 }),
    'exceeds the maximum length',
  );
  assert.strictEqual(uk.length({ min: 2, max: 5, actual: 1 }), 'значення закоротке');
  assert.strictEqual(uk.type({ expected: 'number', key: 'a' }), 'ключі мають бути типу number');
  assert.strictEqual(
    uk.unexpected({ keys: ['k'.repeat(101)] }),
    `має неочікувані ключі: ${'k'.repeat(100)}...`,
  );
});

test('Locales: messages are rendered through the locale of the check', () => {
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
  assert.deepStrictEqual(result.errors, [
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
  assert.deepStrictEqual(doc.check({ title: 1 }, { root: 'Doc', messages: uk }).issues[0], {
    code: 'type',
    path: ['title'],
    message: 'не відповідає типу: string',
    params: { expected: 'string', received: 'number' },
  });
  // The same issues, rendered in English by default; a partial table falls
  // back to English for the codes it does not have.
  assert.strictEqual(doc.check(value).errors[0], 'Field "Doc.title" value is too short');
  const partial = { required: () => 'required!' };
  const mixed = doc.check({ title: 1, status: 'c' }, { root: 'Doc', messages: partial }).errors;
  assert.deepStrictEqual(mixed, [
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
  assert.deepStrictEqual(codes.slice(0, 3), [
    'Field "Doc.title" type',
    'Field "Doc.status" required',
    'Field "Doc.owner" required',
  ]);
  for (const messages of [null, 42, 'uk']) {
    assert.throws(() => doc.check({}, { root: 'Doc', messages }), {
      name: 'TypeError',
      message: `messages must be a locale table or a function, got ${JSON.stringify(messages)}`,
    });
  }
});

test('Locales: a validate function receives the dotted path and may build a result', () => {
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
  assert.deepStrictEqual(paths, ['Order.items[0].sku', 'Order.items[1].sku']);
  assert.deepStrictEqual(result.errors, [
    'Field "Order.items[0].sku" is too short',
    'Field "Order.items[0].sku.dash" needs a dash',
  ]);
  assert.deepStrictEqual(result.issues[1].path, ['items', 0, 'sku', 'dash']);
  paths.length = 0;
  assert.strictEqual(schema.check({ items: [{ sku: 'a-b' }] }).valid, true);
  assert.deepStrictEqual(paths, ['Order.items[0].sku', 'Order']);
});

test('Result: flatten groups several messages of one path', () => {
  const schema = Schema.from({
    code: { type: 'string', validate: () => ['one', { message: 'two', path: [] }] },
  });
  const flat = schema.check({ code: 'x' }).flatten();
  assert.deepStrictEqual(flat, { formErrors: [], fieldErrors: { code: ['one', 'two'] } });
  const tree = schema.check({ code: 'x' }).tree();
  assert.deepStrictEqual(tree, { errors: [], properties: { code: { errors: ['one', 'two'] } } });
});
