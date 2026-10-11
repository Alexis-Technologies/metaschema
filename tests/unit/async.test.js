const { test } = require('node:test');
const assert = require('node:assert');

const { Schema, Model } = require('../../index.js');
const uk = require('../../src/locales/uk.js');

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

const summarize = (issues) => issues.map(({ path, message }) => [path, message]);

test('Async: a validator that returns a promise is an error of a synchronous check', () => {
  const schema = new Schema('User', {
    name: { type: 'string', validate: async (value) => value !== 'bad' || 'is bad' },
  });
  assert.throws(() => schema.check({ name: 'ok' }), {
    name: 'TypeError',
    code: 'ERR_ASYNC_VALIDATOR',
    message: 'The validator of "User.name" returned a promise; use checkAsync or parseAsync',
  });
  assert.throws(() => schema.parse({ name: 'ok' }), { code: 'ERR_ASYNC_VALIDATOR' });
  assert.throws(() => schema['~standard'].validate !== undefined && schema.check({ name: 'x' }), {
    code: 'ERR_ASYNC_VALIDATOR',
  });
  const root = Schema.from({ name: 'string', validate: () => Promise.resolve(true) });
  assert.throws(() => root.check({ name: 'x' }), {
    code: 'ERR_ASYNC_VALIDATOR',
    message: 'The validator of "" returned a promise; use checkAsync or parseAsync',
  });
  const decoded = new Schema('Doc', { when: { type: 'string', parse: async (text) => text } });
  assert.throws(() => decoded.parse({ when: 'x' }), {
    name: 'TypeError',
    code: 'ERR_ASYNC_VALIDATOR',
    message: 'The decoder of "Doc.when" returned a promise; use parseAsync',
  });
  // Only when the function returns one: a sync validator works as before.
  assert.strictEqual(decoded.check({ when: 'x' }).valid, true);
});

test('Async: checkAsync settles the validators after the walk, in field order', async () => {
  const order = [];
  const schema = new Schema('User', {
    a: {
      type: 'string',
      validate: async (value) => {
        await tick();
        order.push('a');
        return value !== 'bad' || 'a is bad';
      },
    },
    b: {
      type: 'string',
      validate: (value) => {
        order.push('b');
        return value !== 'bad' || 'b is bad';
      },
    },
    c: {
      type: 'string',
      validate: async (value) => {
        order.push('c');
        return value !== 'bad' || 'c is bad';
      },
    },
    d: 'number',
    validate: async (value) => {
      order.push('root');
      return value.a !== value.b || 'a and b must differ';
    },
  });
  const valid = await schema.checkAsync({ a: 'x', b: 'y', c: 'z', d: 1 });
  assert.strictEqual(valid.valid, true);
  assert.deepStrictEqual(order, ['a', 'b', 'c', 'root']);
  order.length = 0;
  const result = await schema.checkAsync({ a: 'bad', b: 'bad', c: 'bad', d: 'x' });
  assert.strictEqual(result.valid, false);
  // The type issue of `d` is recorded during the walk; the validators come
  // after it, each at its own path, and the root one last.
  assert.deepStrictEqual(result.errors, [
    'Field "User.d" not of expected type: number',
    'Field "User.a" a is bad',
    'Field "User.b" b is bad',
    'Field "User.c" c is bad',
  ]);
  assert.deepStrictEqual(order, ['a', 'b', 'c']);
  assert.deepStrictEqual(result.issues[1], {
    code: 'custom',
    path: ['a'],
    message: 'a is bad',
    params: {},
  });
  // A result like any other: errors, flatten, tree, a locale.
  assert.deepStrictEqual((await schema.checkAsync({}, { messages: uk })).errors, [
    'Поле "User.a" є обовʼязковим',
    'Поле "User.b" є обовʼязковим',
    'Поле "User.c" є обовʼязковим',
    'Поле "User.d" є обовʼязковим',
  ]);
  const plain = Schema.from({ name: 'string' });
  const sync = await plain.checkAsync({ name: 1 });
  assert.deepStrictEqual(sync.errors, ['Field "name" not of expected type: string']);
  assert.strictEqual(plain.checkAsync({ name: 'x' }) instanceof Promise, true);
});

test('Async: a validator runs only when nothing under it failed, promises included', async () => {
  const ran = [];
  const schema = new Schema('Order', {
    inner: {
      x: {
        type: 'string',
        validate: async (value) => value !== 'bad' || 'x is bad',
      },
      y: {
        type: 'string',
        validate: (value) => value !== 'bad' || 'y is bad',
      },
      validate: (value) => {
        ran.push('inner');
        return value.x !== 'refuse' || 'inner refused';
      },
    },
    other: {
      type: 'string',
      validate: (value) => {
        ran.push('other');
        return value !== 'bad' || 'other is bad';
      },
    },
    validate: () => {
      ran.push('root');
      return true;
    },
  });
  assert.deepStrictEqual(
    (await schema.checkAsync({ inner: { x: 'bad', y: 'y' }, other: 'bad' })).errors,
    ['Field "Order.inner.x" x is bad', 'Field "Order.other" other is bad'],
  );
  // The validate of `inner` saw its field fail and did not run; `other`
  // is beside it and did; the root one saw both.
  assert.deepStrictEqual(ran, ['other']);
  ran.length = 0;
  assert.deepStrictEqual(
    (await schema.checkAsync({ inner: { x: 'refuse', y: 'y' }, other: 'ok' })).errors,
    ['Field "Order.inner" inner refused'],
  );
  assert.deepStrictEqual(ran, ['inner', 'other']);
  ran.length = 0;
  assert.strictEqual(
    (await schema.checkAsync({ inner: { x: 'x', y: 'y' }, other: 'ok' })).valid,
    true,
  );
  assert.deepStrictEqual(ran, ['inner', 'other', 'root']);
  // A sync failure under an async validator cancels it as the walk does.
  const typed = Schema.from({
    inner: { x: 'string', validate: async () => 'never' },
  });
  assert.deepStrictEqual((await typed.checkAsync({ inner: { x: 1 } })).errors, [
    'Field "inner.x" not of expected type: string',
  ]);
  // An issue beside a deferred validator, at a shorter path, is not under it.
  const beside = Schema.from({
    a: { type: 'string', validate: async () => 'a failed' },
    b: { c: { type: 'string', validate: () => 'c ran' } },
  });
  assert.deepStrictEqual((await beside.checkAsync({ a: 'a', b: { c: 'c' } })).errors, [
    'Field "a" a failed',
    'Field "b.c" c ran',
  ]);
});

test('Async: maxErrors, exceptions and every return value', async () => {
  const schema = new Schema('User', {
    a: { type: 'string', validate: async () => 'a failed' },
    b: { type: 'string', validate: async () => 'b failed' },
    c: {
      type: 'string',
      validate: async () => {
        throw new Error('boom');
      },
    },
    d: { type: 'string', validate: () => Promise.reject(new Error('later')) },
    e: { type: 'string', validate: async () => false },
    f: { type: 'string', validate: async () => ({ message: 'own', path: 'deep', code: 'mine' }) },
    g: { type: 'string', validate: async () => ['one', 'two'] },
    h: { type: 'string', validate: async () => true },
  });
  const value = { a: 'a', b: 'b', c: 'c', d: 'd', e: 'e', f: 'f', g: 'g', h: 'h' };
  assert.deepStrictEqual((await schema.checkAsync(value)).errors, [
    'Field "User.a" a failed',
    'Field "User.b" b failed',
    'Field "User.c" validation failed Error: boom',
    'Field "User.d" validation failed Error: later',
    'Field "User.e" validation error',
    'Field "User.f.deep" own',
    'Field "User.g" one',
    'Field "User.g" two',
  ]);
  assert.deepStrictEqual((await schema.checkAsync(value, { maxErrors: 2 })).errors, [
    'Field "User.a" a failed',
    'Field "User.b" b failed',
  ]);
  assert.deepStrictEqual((await schema.checkAsync(value, { maxErrors: 7 })).errors.length, 7);
  assert.deepStrictEqual((await schema.checkAsync({ ...value, a: 1 }, { maxErrors: 1 })).errors, [
    'Field "User.a" not of expected type: string',
  ]);
  const limited = await schema.checkAsync({ ...value, h: 1 }, { maxErrors: 3 });
  assert.deepStrictEqual(limited.errors, [
    'Field "User.h" not of expected type: string',
    'Field "User.a" a failed',
    'Field "User.b" b failed',
  ]);
});

test('Async: a custom type may check asynchronously', async () => {
  const model = new Model(
    {
      taken: {
        construct() {},
        checkType: async (value) => value !== 'admin' || 'is taken',
      },
      slow: {
        rules: ['length'],
        construct() {},
        checkType(value) {
          return Promise.resolve(typeof value === 'string');
        },
      },
    },
    [['Signup', { Struct: {}, login: 'taken', nick: { type: 'slow', length: 3 } }]],
  );
  const signup = model.entities.get('Signup');
  assert.throws(() => signup.check({ login: 'x', nick: 'abc' }), { code: 'ERR_ASYNC_VALIDATOR' });
  assert.strictEqual((await signup.checkAsync({ login: 'x', nick: 'abc' })).valid, true);
  assert.deepStrictEqual((await signup.checkAsync({ login: 'admin', nick: 1 })).errors, [
    'Field "Signup.login" is taken',
    'Field "Signup.nick" not of expected type: slow',
  ]);
  // The rules of a field run after its type, so they wait for the promise too.
  assert.deepStrictEqual((await signup.checkAsync({ login: 'x', nick: 'abcd' })).errors, [
    'Field "Signup.nick" exceeds the maximum length',
  ]);
});

test('Async: parseAsync awaits the decoders, parts before the whole', async () => {
  const order = [];
  const schema = new Schema('Doc', {
    tags: {
      array: {
        type: 'string',
        parse: async (text) => {
          await tick();
          order.push(`tag ${text}`);
          return text.toUpperCase();
        },
      },
      parse: (list) => {
        order.push('tags');
        return list.join(',');
      },
    },
    inner: {
      a: { type: 'string', parse: async (text) => text.length },
      parse: async (object) => {
        order.push('inner');
        return { ...object, decoded: true };
      },
    },
    table: { map: { string: { type: 'number', parse: async (n) => -n } } },
    bag: { set: { type: 'number', parse: async (n) => n * 2 } },
    sync: { type: 'string', parse: (text) => `${text}!` },
    'none?': { type: 'string', parse: async (text) => text },
    validate: async (value) => value.sync !== 'bad' || 'is bad',
    parse: async (value) => {
      order.push('root');
      return { ...value, root: true };
    },
  });
  const input = {
    tags: ['a', 'b'],
    inner: { a: 'abc' },
    table: new Map([['x', 1]]),
    bag: new Set([1, 2]),
    sync: 's',
  };
  const result = await schema.parseAsync(input);
  assert.deepStrictEqual(result, {
    valid: true,
    value: {
      tags: 'A,B',
      inner: { a: 3, decoded: true },
      table: new Map([['x', -1]]),
      bag: new Set([2, 4]),
      sync: 's!',
      root: true,
    },
    issues: [],
  });
  // The parts of a value settle before its own decoder runs, and the whole
  // value before the schema's; the subtrees of a value settle side by side.
  const position = (label) => order.indexOf(label);
  assert.deepStrictEqual(order.slice().sort(), ['inner', 'root', 'tag a', 'tag b', 'tags']);
  assert.ok(position('tag a') < position('tags') && position('tag b') < position('tags'));
  assert.strictEqual(position('root'), order.length - 1);
  assert.deepStrictEqual(input, {
    tags: ['a', 'b'],
    inner: { a: 'abc' },
    table: new Map([['x', 1]]),
    bag: new Set([1, 2]),
    sync: 's',
  });
  assert.deepStrictEqual(summarize((await schema.parseAsync({ ...input, sync: 'bad' })).issues), [
    [[], 'is bad'],
  ]);
  const invalid = await schema.parseAsync({ ...input, sync: 1 });
  assert.strictEqual(invalid.value, undefined);
  assert.deepStrictEqual(summarize(invalid.issues), [[['sync'], 'not of expected type: string']]);
  const plain = Schema.from({ name: 'string', 'n?': { type: 'number', default: 1 } });
  const value = { name: 'x' };
  assert.deepStrictEqual(await plain.parseAsync(value), {
    valid: true,
    value: { name: 'x', n: 1 },
    issues: [],
  });
  const given = { name: 'x', n: 2 };
  assert.strictEqual((await plain.parseAsync(given)).value, given);
});

test('Async: decoders in keyed collections, references and unions settle in place', async () => {
  const model = new Model({}, [
    ['Tag', { Struct: {}, label: { type: 'string', parse: async (text) => text.toUpperCase() } }],
    [
      'Doc',
      {
        Struct: {},
        dict: { object: { string: { type: 'number', parse: async (n) => n + 1 } } },
        table: { map: { string: { type: 'number', parse: async (n) => n - 1 } } },
        tags: { many: 'Tag' },
        tag: 'Tag',
        either: {
          union: [
            'string',
            {
              Struct: {},
              n: { type: 'number', parse: async (n) => -n },
              'm?': { type: 'number', default: 2 },
            },
          ],
        },
        shape: {
          union: [{ Struct: {}, kind: { enum: ['a'] }, 'x?': { type: 'number', default: 1 } }],
          discriminator: 'kind',
        },
      },
    ],
  ]);
  const doc = model.entities.get('Doc');
  const result = await doc.parseAsync({
    dict: { a: 1, b: 2 },
    table: new Map([['a', 1]]),
    tags: [{ label: 'x' }],
    tag: { label: 'y' },
    either: { n: 1 },
    shape: { kind: 'a' },
  });
  assert.deepStrictEqual(result.value, {
    dict: { a: 2, b: 3 },
    table: new Map([['a', 0]]),
    tags: [{ label: 'X' }],
    tag: { label: 'Y' },
    either: { n: -1, m: 2 },
    shape: { kind: 'a', x: 1 },
  });
  assert.strictEqual((await doc.parseAsync({ ...result.value, shape: 'x' })).valid, false);
  assert.strictEqual((await doc.parseAsync({ ...result.value, tags: [null] })).valid, false);
});

test('Async: a decoder that rejects or throws is an exception issue at its path', async () => {
  const schema = new Schema('Doc', {
    a: {
      b: {
        type: 'string',
        parse: async () => {
          throw new Error('boom');
        },
      },
    },
    list: {
      array: {
        type: 'number',
        parse: (n) => (n === 2 ? Promise.reject(new Error('two')) : Promise.resolve(n)),
      },
    },
    c: {
      type: 'string',
      parse: () => {
        throw new Error('sync boom');
      },
    },
  });
  const result = await schema.parseAsync({ a: { b: 'x' }, list: [1, 2], c: 'c' });
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.value, undefined);
  assert.deepStrictEqual(summarize(result.issues), [
    [['c'], 'validation failed Error: sync boom'],
    [['a', 'b'], 'validation failed Error: boom'],
    [['list', 1], 'validation failed Error: two'],
  ]);
  for (const issue of result.issues) assert.strictEqual(issue.code, 'exception');
  const root = Schema.from({
    a: { type: 'string', parse: async (text) => text },
    parse: async () => {
      throw new Error('whole');
    },
  });
  assert.deepStrictEqual(summarize((await root.parseAsync({ a: 'x' })).issues), [
    [[], 'validation failed Error: whole'],
  ]);
});

test('Async: references and plain unions resolve as the check does', async () => {
  const model = new Model({}, [
    [
      'Company',
      {
        Registry: {},
        name: { type: 'string', validate: async (value) => value !== 'bad' || 'bad name' },
        parse: async (company) => ({ ...company, registered: true }),
      },
    ],
    [
      'Person',
      {
        Entity: {},
        name: 'string',
        employer: { type: 'Company', embed: true },
        either: {
          union: [
            'string',
            { Struct: {}, n: { type: 'number', validate: async (n) => n > 0 || 'not positive' } },
          ],
        },
      },
    ],
  ]);
  const person = model.entities.get('Person');
  assert.deepStrictEqual(
    await person.parseAsync({ name: 'x', employer: { name: 'Acme' }, either: { n: 1 } }),
    {
      valid: true,
      value: { name: 'x', employer: { name: 'Acme', registered: true }, either: { n: 1 } },
      issues: [],
    },
  );
  const bad = await person.checkAsync({ name: 'x', employer: { name: 'bad' }, either: { n: -1 } });
  assert.deepStrictEqual(bad.errors, [
    'Field "Person.employer.name" bad name',
    'Field "Person.either.n" not positive',
  ]);
  assert.throws(() => person.check({ name: 'x', employer: { name: 'ok' }, either: 's' }), {
    code: 'ERR_ASYNC_VALIDATOR',
  });
});

test('Async: a validator may run another check, sync or async', async () => {
  const inner = Schema.from({
    a: 'string',
    b: { type: 'string', validate: async () => 'inner b' },
  });
  const outer = Schema.from({
    x: {
      type: 'string',
      validate: async () => {
        const result = await inner.checkAsync({ a: 1, b: 'b' });
        return result.errors;
      },
    },
    y: { type: 'string', validate: () => inner.check({ a: 'a' }).errors },
  });
  // The lines of an inner result already name their field and are kept as
  // they are; `y` was met after the promise of `x` and waits for it.
  assert.deepStrictEqual((await outer.checkAsync({ x: 'x', y: 'y' })).errors, [
    'Field "a" not of expected type: string',
    'Field "b" inner b',
    'Field "b" is required',
  ]);
});

test('Async: a failed branch of a plain union leaves no deferred validator behind', async () => {
  const schema = new Schema('Pick', {
    u: {
      union: [
        {
          Struct: {},
          a: { type: 'string', validate: async () => 'branch0 async says no' },
          b: 'number',
        },
        { Struct: {}, a: 'string', b: 'string' },
      ],
    },
  });
  // The value matches the second branch: the first one fails on `b` after its
  // async validator of `a` was set aside, and that validator must go with
  // the branch.
  const value = { u: { a: 'x', b: 'y' } };
  assert.deepStrictEqual((await schema.checkAsync(value)).errors, []);
  assert.deepStrictEqual(await schema.parseAsync(value), { valid: true, value, issues: [] });
  // The first branch taken: its async validator settles and may still fail
  // the value; the next branch is not tried for it.
  const first = await schema.checkAsync({ u: { a: 'x', b: 1 } });
  assert.deepStrictEqual(first.errors, ['Field "Pick.u.a" branch0 async says no']);
  // A deferred validator (met after a promise) inside a failed branch goes too.
  const later = new Schema('Later', {
    first: { type: 'string', validate: async () => true },
    u: {
      union: [
        { Struct: {}, a: { type: 'string', validate: () => 'sync says no' }, b: 'number' },
        { Struct: {}, a: 'string', b: 'string' },
      ],
    },
  });
  assert.deepStrictEqual(
    (await later.checkAsync({ first: 'f', u: { a: 'x', b: 'y' } })).errors,
    [],
  );
});

test('Async: parseAsync adopts the promises of its decoders, not a thenable in the data', async () => {
  let called = 0;
  const value = {
    then: (resolve) => {
      called += 1;
      resolve('hijacked');
    },
  };
  const named = Schema.from({ then: 'any', x: { type: 'string', parse: async (s) => s } });
  const result = await named.parseAsync({ ...value, x: 'x' });
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.value.then, value.then);
  assert.strictEqual(result.value.x, 'x');
  assert.strictEqual(called, 0);
  const nested = Schema.from({ inner: { t: 'any' }, x: { type: 'string', parse: async (s) => s } });
  const thenable = { then: () => (called += 1) };
  const out = await nested.parseAsync({ inner: { t: thenable }, x: 'x' }, { unknown: 'strip' });
  assert.strictEqual(out.value.inner.t, thenable);
  assert.strictEqual(called, 0);
});

test('Async: a promise the check cannot wait for never rejects unhandled', async () => {
  const unhandled = [];
  const listen = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', listen);
  try {
    // The synchronous calls throw for a promise and must not drop it.
    const checked = Schema.from({
      a: { type: 'string', validate: () => Promise.reject(new Error('a')) },
    });
    assert.throws(() => checked.check({ a: 'x' }), { code: 'ERR_ASYNC_VALIDATOR' });
    const decoded = Schema.from({
      a: { type: 'string', parse: () => Promise.reject(new Error('d')) },
    });
    assert.throws(() => decoded.parse({ a: 'x' }), { code: 'ERR_ASYNC_VALIDATOR' });
    // The error limit stops settle before the promise it holds.
    const limited = Schema.from({
      a: {
        type: 'string',
        validate: async () => {
          await tick();
          throw new Error('late');
        },
      },
      b: 'number',
    });
    const result = await limited.checkAsync({ a: 'x', b: 'y' }, { maxErrors: 1 });
    assert.deepStrictEqual(result.errors, ['Field "b" not of expected type: number']);
    // The trial of a plain union in parseAsync sets validators aside and drops them.
    const tried = Schema.from({
      u: {
        union: [
          {
            Struct: {},
            n: {
              type: 'number',
              validate: async () => {
                await tick();
                throw new Error('trial');
              },
            },
            'd?': { type: 'number', default: 1 },
          },
          'string',
        ],
      },
    });
    const parsed = await tried.parseAsync({ u: { n: 1 } });
    assert.deepStrictEqual(parsed.valid, false);
    await tick();
    await tick();
    await tick();
    assert.deepStrictEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', listen);
  }
});

test('Async: the decoders that reject respect maxErrors', async () => {
  const schema = Schema.from({
    a: {
      type: 'string',
      parse: async () => {
        throw new Error('a');
      },
    },
    b: {
      type: 'string',
      parse: async () => {
        throw new Error('b');
      },
    },
  });
  const limited = await schema.parseAsync({ a: 'x', b: 'y' }, { maxErrors: 1 });
  assert.strictEqual(limited.valid, false);
  assert.strictEqual(limited.issues.length, 1);
  const all = await schema.parseAsync({ a: 'x', b: 'y' });
  assert.deepStrictEqual(summarize(all.issues), [
    [['a'], 'validation failed Error: a'],
    [['b'], 'validation failed Error: b'],
  ]);
});
