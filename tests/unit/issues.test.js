const { test } = require('node:test');
const assert = require('node:assert');

const { Schema, Model, ValidationResult } = require('../../index.js');

test('Issues: every message has a code and a path', () => {
  const model = new Model({}, [
    ['Owner', { Struct: {}, name: 'string' }],
    [
      'Doc',
      {
        Entity: {},
        title: 'string',
        size: { type: 'number', max: 10 },
        status: { enum: ['a', 'b'] },
        tags: { array: 'string' },
        owner: 'Owner',
        refs: { many: 'Owner' },
        ghost: 'Nothing',
        parent: { type: 'Doc', required: false, embed: true },
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
    result.issues.map(({ code, path, params }) => [code, path, params]),
    [
      ['type', ['title'], { expected: 'string', received: 'number' }],
      ['range', ['size'], { min: undefined, max: 10, actual: 11 }],
      ['enum', ['status'], { values: ['a', 'b'] }],
      ['type', ['tags', 1], { expected: 'string', received: 'number' }],
      ['type', ['owner', 'name'], { expected: 'string', received: 'number' }],
      ['type', ['refs', 1, 'name'], { expected: 'string', received: 'number' }],
      ['reference', ['ghost'], { entity: 'Nothing' }],
      ['circular', ['parent'], {}],
      ['custom', ['note'], {}],
      ['unexpected', [], { keys: ['extra'] }],
    ],
  );
  // The message describes the problem; the error line adds the location.
  assert.deepStrictEqual(
    result.issues.map((entry) => entry.message),
    [
      'not of expected type: string',
      'is greater than 10',
      'value is not of enum: a, b',
      'not of expected type: string',
      'not of expected type: string',
      'not of expected type: string',
      'Entity "Nothing" is not found',
      'is a circular reference',
      'too short',
      'has unexpected keys: extra',
    ],
  );
  assert.deepStrictEqual(result.errors, [
    'Field "Doc.title" not of expected type: string',
    'Field "Doc.size" is greater than 10',
    'Field "Doc.status" value is not of enum: a, b',
    'Field "Doc.tags[1]" not of expected type: string',
    'Field "Doc.owner.name" not of expected type: string',
    'Field "Doc.refs[1].name" not of expected type: string',
    'Field "Doc.ghost" Entity "Nothing" is not found',
    'Field "Doc.parent" is a circular reference',
    'Field "Doc.note" too short',
    'Field "Doc" has unexpected keys: extra',
  ]);
  assert.strictEqual(result.errors, result.errors);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.issues[1].params.max, 10);
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
  const result = schema.check({ b: 'x', c: 'y' });
  assert.ok(result.issues[1].params.error instanceof Error);
  assert.deepStrictEqual(
    result.issues.map(({ code, path, message }) => ({ code, path, message })),
    [
      { code: 'required', path: ['a'], message: 'is required' },
      { code: 'exception', path: ['b'], message: 'validation failed Error: boom' },
      { code: 'custom', path: ['c'], message: 'validation error' },
    ],
  );
  assert.deepStrictEqual(result.errors, [
    'Field "a" is required',
    'Field "b" validation failed Error: boom',
    'Field "c" validation error',
  ]);

  const hex = {
    kind: 'scalar',
    construct() {},
    checkType: (value, path) => (/^[0-9a-f]+$/.test(value) ? null : `Field "${path}" is not hex`),
  };
  const model = new Model({ hex }, [['Color', { Struct: {}, value: 'hex' }]]);
  const color = model.entities.get('Color').check({ value: 'zz' });
  assert.deepStrictEqual(color.issues, [
    { code: 'type', path: ['value'], message: 'Field "Color.value" is not hex', params: {} },
  ]);
  assert.deepStrictEqual(color.errors, ['Field "Color.value" is not hex']);
  const strict = { kind: 'scalar', construct() {}, checkType: (value) => value === 'ok' };
  const flag = new Model({ strict }, [['Flag', { Struct: {}, value: 'strict' }]]);
  assert.deepStrictEqual(flag.entities.get('Flag').check({ value: 'no' }).issues, [
    {
      code: 'type',
      path: ['value'],
      message: 'not of expected type: strict',
      params: { expected: 'strict', received: 'string' },
    },
  ]);

  const signup = Schema.from({
    password: 'string',
    confirm: 'string',
    validate: (value) => value.password === value.confirm || 'passwords do not match',
  });
  assert.deepStrictEqual(signup.check({ password: 'a', confirm: 'b' }).issues, [
    { code: 'custom', path: [], message: 'passwords do not match', params: {} },
  ]);

  const byKey = Schema.from({ o: { map: { number: 'string' } } });
  assert.deepStrictEqual(byKey.check({ o: new Map([['a', 'b']]) }).issues, [
    {
      code: 'type',
      path: ['o'],
      message: 'keys must be of type number',
      params: { expected: 'number', received: 'string', key: 'a' },
    },
  ]);
});

test('Issues: a validator may return { code, message } objects', () => {
  const email = {
    type: 'string',
    validate: (value) => (value.includes('@') ? null : { code: 'format', message: 'needs an @' }),
  };
  assert.deepStrictEqual(Schema.from({ email }).check({ email: 'x' }).issues, [
    { code: 'format', path: ['email'], message: 'needs an @', params: {} },
  ]);
  // The path of a returned issue is relative to the field: a key, or keys.
  const mixed = {
    type: 'string',
    validate: () => [
      'plain',
      { code: 'own', message: 'placed', path: 'elsewhere', params: { at: 1 } },
      { code: 'deep', message: 'placed', path: ['a', 0] },
    ],
  };
  assert.deepStrictEqual(Schema.from({ v: mixed }).check({ v: 'x' }).issues, [
    { code: 'custom', path: ['v'], message: 'plain', params: {} },
    { code: 'own', path: ['v', 'elsewhere'], message: 'placed', params: { at: 1 } },
    { code: 'deep', path: ['v', 'a', 0], message: 'placed', params: {} },
  ]);
  const result = new ValidationResult().add({ message: 'no code' }).add('text', 'type');
  assert.deepStrictEqual(result.issues, [
    { code: 'custom', path: [], message: 'no code', params: {} },
    { code: 'type', path: [], message: 'text', params: {} },
  ]);
  assert.deepStrictEqual(result.errors, ['Field "" no code', 'Field "" text']);
  const inner = new ValidationResult().add('nested');
  assert.deepStrictEqual(ValidationResult.issuesOf([inner, 'more', 42], ['p']), [
    { code: 'custom', path: ['p'], message: 'nested', params: {} },
    { code: 'custom', path: ['p'], message: 'more', params: {} },
    { code: 'custom', path: ['p'], message: '42', params: {} },
  ]);
  assert.deepStrictEqual(ValidationResult.issuesOf(true), []);
  assert.deepStrictEqual(ValidationResult.issuesOf(false, ['p'], 'type'), [
    { code: 'type', path: ['p'], message: 'not of expected type: undefined', params: {} },
  ]);
});

test('Issues: maxErrors stops collecting and walking', () => {
  const schema = Schema.from({ a: 'string', b: 'string', c: 'string', d: 'string' });
  const limited = schema.check({}, { root: 'S', maxErrors: 2 });
  assert.strictEqual(limited.valid, false);
  assert.deepStrictEqual(limited.errors, ['Field "S.a" is required', 'Field "S.b" is required']);
  assert.strictEqual(limited.issues.length, 2);
  assert.strictEqual(schema.check({}).errors.length, 4);

  const list = Schema.from({ items: { array: 'number' } });
  const items = Array.from({ length: 100000 }, () => 'x');
  assert.strictEqual(list.check({ items }, { maxErrors: 3 }).errors.length, 3);
  assert.strictEqual(list.check({ items }).errors.length, 100000);

  const many = Schema.from({ a: { type: 'string', validate: () => ['1', '2', '3', '4'] } });
  assert.strictEqual(many.check({ a: 'x' }, { maxErrors: 2 }).errors.length, 2);

  const model = new Model({}, [
    ['Item', { Entity: {}, n: 'number' }],
    ['Cart', { Entity: {}, items: { many: 'Item' } }],
  ]);
  const cart = model.entities.get('Cart');
  const bad = Array.from({ length: 50 }, () => ({ n: 'x' }));
  assert.strictEqual(cart.check({ items: bad }, { root: 'Cart', maxErrors: 5 }).errors.length, 5);

  for (const maxErrors of [0, -1, '3', NaN, null]) {
    assert.throws(() => schema.check({}, { maxErrors }), { name: 'TypeError' });
  }
});
