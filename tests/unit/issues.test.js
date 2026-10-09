const { test } = require('node:test');
const assert = require('node:assert');

const { Schema, Model, ValidationResult } = require('../../index.js');

test('Issues: every message has a code and a path', () => {
  const model = new Model({}, [
    ['Owner', { Entity: {}, name: 'string' }],
    [
      'Doc',
      {
        Entity: {},
        title: 'string',
        size: { type: 'number', length: { max: 10 } },
        status: { enum: ['a', 'b'] },
        tags: { array: 'string' },
        owner: 'Owner',
        refs: { many: 'Owner' },
        ghost: 'Nothing',
        parent: '?Doc',
        note: { type: 'string', validate: (value) => value.length > 1 || 'too short' },
      },
    ],
  ]);
  const doc = model.entities.get('Doc');
  const value = {
    title: 1,
    size: 11,
    status: 'c',
    tags: ['x', 2],
    owner: { name: 1 },
    refs: [{ name: 'ok' }, { name: 2 }],
    ghost: {},
    note: 'x',
    extra: true,
  };
  value.parent = value;
  const result = doc.check(value);
  assert.deepStrictEqual(
    result.issues.map(({ code, path }) => [code, path]),
    [
      ['type', 'Doc.title'],
      ['length', 'Doc.size'],
      ['enum', 'Doc.status'],
      ['type', 'Doc.tags[1]'],
      ['type', 'Doc.owner.name'],
      ['type', 'Doc.refs[1].name'],
      ['reference', 'Doc.ghost'],
      ['circular', 'Doc.parent'],
      ['custom', 'Doc.note'],
      ['unexpected', 'Doc.extra'],
    ],
  );
  assert.deepStrictEqual(
    result.issues.map((entry) => entry.message),
    result.errors,
  );
  assert.strictEqual(result.issues[6].message, 'Field "Doc.ghost" Entity "Nothing" is not found');
  assert.strictEqual(result.issues[9].message, 'Field "Doc.extra" is not expected');
});

test('Issues: required, exception, custom and type codes', () => {
  const schema = Schema.from({
    a: 'string',
    b: {
      type: 'string',
      validate: () => {
        throw new Error('boom');
      },
    },
    c: { type: 'string', validate: () => false },
  });
  assert.deepStrictEqual(schema.check({ b: 'x', c: 'y' }).issues, [
    { code: 'required', path: 'a', message: 'Field "a" is required' },
    { code: 'exception', path: 'b', message: 'Field "b" validation failed Error: boom' },
    { code: 'custom', path: 'c', message: 'Field "c" validation error' },
  ]);

  const hex = {
    kind: 'scalar',
    construct() {},
    checkType: (value, path) => (/^[0-9a-f]+$/.test(value) ? null : `Field "${path}" is not hex`),
  };
  const model = new Model({ hex }, [['Color', { Struct: {}, value: 'hex' }]]);
  assert.deepStrictEqual(model.entities.get('Color').check({ value: 'zz' }).issues, [
    { code: 'type', path: 'Color.value', message: 'Field "Color.value" is not hex' },
  ]);

  const signup = Schema.from({
    password: 'string',
    confirm: 'string',
    validate: (value) => value.password === value.confirm || 'passwords do not match',
  });
  assert.deepStrictEqual(signup.check({ password: 'a', confirm: 'b' }).issues, [
    { code: 'custom', path: '', message: 'Field "" passwords do not match' },
  ]);

  const byKey = Schema.from({ o: { map: { number: 'string' } } });
  assert.deepStrictEqual(byKey.check({ o: new Map([['a', 'b']]) }).issues, [
    { code: 'type', path: 'o', message: 'Field "o" keys must be of type number' },
  ]);
});

test('Issues: a validator may return { code, message } objects', () => {
  const email = {
    type: 'string',
    validate: (value) => (value.includes('@') ? null : { code: 'format', message: 'needs an @' }),
  };
  assert.deepStrictEqual(Schema.from({ email }).check({ email: 'x' }).issues, [
    { code: 'format', path: 'email', message: 'Field "email" needs an @' },
  ]);
  const mixed = {
    type: 'string',
    validate: () => [
      'plain',
      { code: 'own', message: 'Field "elsewhere" placed', path: 'elsewhere' },
    ],
  };
  assert.deepStrictEqual(Schema.from({ v: mixed }).check({ v: 'x' }).issues, [
    { code: 'custom', path: 'v', message: 'Field "v" plain' },
    { code: 'own', path: 'elsewhere', message: 'Field "elsewhere" placed' },
  ]);
  const result = new ValidationResult('p').add({ message: 'no code' }).add('text', 'type');
  assert.deepStrictEqual(result.issues, [
    { code: 'custom', path: 'p', message: 'Field "p" no code' },
    { code: 'type', path: 'p', message: 'Field "p" text' },
  ]);
  const inner = new ValidationResult('q').add('nested');
  assert.deepStrictEqual(ValidationResult.issuesOf([inner, 'more'], 'p'), [
    { code: 'custom', path: 'q', message: 'Field "q" nested' },
    { code: 'custom', path: 'p', message: 'Field "p" more' },
  ]);
  assert.deepStrictEqual(ValidationResult.format(['a', 'Field "x" b'], 'p'), [
    'Field "p" a',
    'Field "x" b',
  ]);
  assert.strictEqual(ValidationResult.format([], 'p'), null);
});

test('Issues: maxErrors stops collecting and walking', () => {
  const schema = Schema.from({ a: 'string', b: 'string', c: 'string', d: 'string' });
  const limited = schema.check({}, 'S', { maxErrors: 2 });
  assert.strictEqual(limited.valid, false);
  assert.deepStrictEqual(limited.errors, ['Field "S.a" is required', 'Field "S.b" is required']);
  assert.strictEqual(limited.issues.length, 2);
  assert.strictEqual(schema.check({}).errors.length, 4);

  const list = Schema.from({ items: { array: 'number' } });
  const items = Array.from({ length: 100000 }, () => 'x');
  assert.strictEqual(list.check({ items }, '', { maxErrors: 3 }).errors.length, 3);
  assert.strictEqual(list.check({ items }).errors.length, 100000);

  const many = Schema.from({ a: { type: 'string', validate: () => ['1', '2', '3', '4'] } });
  assert.strictEqual(many.check({ a: 'x' }, '', { maxErrors: 2 }).errors.length, 2);

  const model = new Model({}, [
    ['Item', { Entity: {}, n: 'number' }],
    ['Cart', { Entity: {}, items: { many: 'Item' } }],
  ]);
  const cart = model.entities.get('Cart');
  const bad = Array.from({ length: 50 }, () => ({ n: 'x' }));
  assert.strictEqual(cart.check({ items: bad }, 'Cart', { maxErrors: 5 }).errors.length, 5);

  for (const maxErrors of [0, -1, '3', NaN, null]) {
    assert.throws(() => schema.check({}, '', { maxErrors }), { name: 'TypeError' });
  }
});
