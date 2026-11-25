const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { Schema, Model } = require('../../index.js');
const uk = require('../../src/locales/uk.js');

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

const summarize = (issues) => issues.map(({ path, message }) => [path, message]);

describe('Async', () => {
  it('should throw from a synchronous check for a validator that returns a promise', () => {
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
    assert.equal(decoded.check({ when: 'x' }).valid, true);
  });

  it('should run the independent validators during the walk in checkAsync and settle the promises after it', async () => {
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
    assert.equal(valid.valid, true);
    // `b` is synchronous and `c` runs to its first await during the walk, as
    // in check; `a` pushes after its tick; the root one waits for all three.
    assert.deepEqual(order, ['b', 'c', 'a', 'root']);
    order.length = 0;
    const result = await schema.checkAsync({ a: 'bad', b: 'bad', c: 'bad', d: 'x' });
    assert.equal(result.valid, false);
    // What the walk records comes first, in walk order (`b` before the type
    // issue of `d`); the promises settle after it, in field order.
    assert.deepEqual(result.errors, [
      'Field "User.b" b is bad',
      'Field "User.d" not of expected type: number',
      'Field "User.a" a is bad',
      'Field "User.c" c is bad',
    ]);
    assert.deepEqual(order, ['b', 'c', 'a']);
    assert.deepEqual(result.issues[2], {
      code: 'custom',
      path: ['a'],
      message: 'a is bad',
      params: {},
    });
    // A result like any other: errors, flatten, tree, a locale.
    assert.deepEqual((await schema.checkAsync({}, { messages: uk })).errors, [
      'Поле "User.a" є обовʼязковим',
      'Поле "User.b" є обовʼязковим',
      'Поле "User.c" є обовʼязковим',
      'Поле "User.d" є обовʼязковим',
    ]);
    const plain = Schema.from({ name: 'string' });
    const sync = await plain.checkAsync({ name: 1 });
    assert.deepEqual(sync.errors, ['Field "name" not of expected type: string']);
    assert.equal(plain.checkAsync({ name: 'x' }) instanceof Promise, true);
  });

  it('should run a validator only when nothing under it failed, promises included', async () => {
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
    assert.deepEqual(
      (await schema.checkAsync({ inner: { x: 'bad', y: 'y' }, other: 'bad' })).errors,
      ['Field "Order.other" other is bad', 'Field "Order.inner.x" x is bad'],
    );
    // `other` is beside the promise of `inner.x`, not above it, and ran during
    // the walk; the validate of `inner` waited for the promise, saw its field
    // fail and did not run; the root one saw both.
    assert.deepEqual(ran, ['other']);
    ran.length = 0;
    assert.deepEqual(
      (await schema.checkAsync({ inner: { x: 'refuse', y: 'y' }, other: 'ok' })).errors,
      ['Field "Order.inner" inner refused'],
    );
    assert.deepEqual(ran, ['other', 'inner']);
    ran.length = 0;
    assert.equal((await schema.checkAsync({ inner: { x: 'x', y: 'y' }, other: 'ok' })).valid, true);
    assert.deepEqual(ran, ['other', 'inner', 'root']);
    // A sync failure under an async validator cancels it as the walk does.
    const typed = Schema.from({
      inner: { x: 'string', validate: async () => 'never' },
    });
    assert.deepEqual((await typed.checkAsync({ inner: { x: 1 } })).errors, [
      'Field "inner.x" not of expected type: string',
    ]);
    // A validator beside a promise, at another path, runs during the walk.
    const beside = Schema.from({
      a: { type: 'string', validate: async () => 'a failed' },
      b: { c: { type: 'string', validate: () => 'c ran' } },
    });
    assert.deepEqual((await beside.checkAsync({ a: 'a', b: { c: 'c' } })).errors, [
      'Field "b.c" c ran',
      'Field "a" a failed',
    ]);
  });

  it('should apply maxErrors, report exceptions and read every return value', async () => {
    let called = 0;
    const counted = (validate) => (value) => {
      called += 1;
      return validate(value);
    };
    const schema = new Schema('User', {
      a: { type: 'string', validate: counted(async () => 'a failed') },
      b: { type: 'string', validate: counted(async () => 'b failed') },
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
    assert.deepEqual((await schema.checkAsync(value)).errors, [
      'Field "User.a" a failed',
      'Field "User.b" b failed',
      'Field "User.c" validation failed Error: boom',
      'Field "User.d" validation failed Error: later',
      'Field "User.e" validation error',
      'Field "User.f.deep" own',
      'Field "User.g" one',
      'Field "User.g" two',
    ]);
    // The validators are independent, so every one is called during the walk
    // and the limit decides what is recorded, not what is run.
    called = 0;
    assert.deepEqual((await schema.checkAsync(value, { maxErrors: 2 })).errors, [
      'Field "User.a" a failed',
      'Field "User.b" b failed',
    ]);
    assert.equal(called, 2);
    assert.deepEqual((await schema.checkAsync(value, { maxErrors: 7 })).errors.length, 7);
    assert.deepEqual((await schema.checkAsync({ ...value, a: 1 }, { maxErrors: 1 })).errors, [
      'Field "User.a" not of expected type: string',
    ]);
    const limited = await schema.checkAsync({ ...value, h: 1 }, { maxErrors: 3 });
    assert.deepEqual(limited.errors, [
      'Field "User.h" not of expected type: string',
      'Field "User.a" a failed',
      'Field "User.b" b failed',
    ]);
  });

  it('should keep independent validators in flight together while a validator over them waits', async () => {
    // A gate every validator waits at: what has started before it opens is
    // in flight together, and what starts after a validator ended waited for it.
    let open;
    const gate = new Promise((resolve) => (open = resolve));
    const log = [];
    const waiting = (name, fail = false) =>
      async function validate() {
        log.push(`start:${name}`);
        await gate;
        log.push(`end:${name}`);
        return !fail || `${name} failed`;
      };
    const build = (fail) =>
      new Schema('Doc', {
        a: { type: 'string', validate: waiting('a') },
        b: { type: 'string', validate: waiting('b') },
        inner: {
          x: { type: 'string', validate: waiting('inner.x', fail) },
          validate: waiting('inner'),
        },
        items: { array: { id: 'number', validate: waiting('item') } },
        validate: waiting('root'),
      });
    const value = { a: 'a', b: 'b', inner: { x: 'x' }, items: [{ id: 1 }, { id: 2 }] };
    const pending = build(false).checkAsync(value);
    // Every validator with no promise under it started during the walk; the
    // validate of `inner` and the root one wait for the promises under them.
    assert.deepEqual(log, ['start:a', 'start:b', 'start:inner.x', 'start:item', 'start:item']);
    open();
    assert.equal((await pending).valid, true);
    assert.deepEqual(log.slice(5), [
      'end:a',
      'end:b',
      'end:inner.x',
      'end:item',
      'end:item',
      'start:inner',
      'end:inner',
      'start:root',
      'end:root',
    ]);
    // When a field under a validator fails, the validator never starts.
    log.length = 0;
    const failed = await build(true).checkAsync(value);
    assert.deepEqual(failed.errors, ['Field "Doc.inner.x" inner.x failed']);
    assert.equal(log.includes('start:inner'), false);
    assert.equal(log.includes('start:root'), false);
    // The order of the issues: what the walk recorded, in walk order, then the
    // promises in field order; a sync validator after a promise is the walk's.
    const ordered = new Schema('Mix', {
      a: { type: 'string', validate: async () => 'a async' },
      b: { type: 'string', validate: () => 'b sync' },
      c: 'number',
      d: { type: 'string', validate: async () => 'd async' },
    });
    assert.deepEqual((await ordered.checkAsync({ a: '', b: '', c: 'x', d: '' })).errors, [
      'Field "Mix.b" b sync',
      'Field "Mix.c" not of expected type: number',
      'Field "Mix.a" a async',
      'Field "Mix.d" d async',
    ]);
    // Two independent validators waiting on real timers overlap: both start
    // before either ends, so the check takes one wait, not two. Told by the
    // order, not by the clock: a timer of 20 ms fires after up to 31 ms where
    // the resolution is 15.6 ms (Windows), which a bound on the time missed.
    const timers = [];
    const timer = (name) => () => {
      timers.push(`start:${name}`);
      return new Promise((resolve) =>
        setTimeout(() => {
          timers.push(`end:${name}`);
          resolve();
        }, 20),
      );
    };
    const slow = new Schema('Slow', {
      a: { type: 'string', validate: timer('a') },
      b: { type: 'string', validate: timer('b') },
    });
    assert.equal((await slow.checkAsync({ a: 'a', b: 'b' })).valid, true);
    assert.deepEqual(timers, ['start:a', 'start:b', 'end:a', 'end:b']);
  });

  it('should let a custom type check asynchronously', async () => {
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
    assert.equal((await signup.checkAsync({ login: 'x', nick: 'abc' })).valid, true);
    assert.deepEqual((await signup.checkAsync({ login: 'admin', nick: 1 })).errors, [
      'Field "Signup.login" is taken',
      'Field "Signup.nick" not of expected type: slow',
    ]);
    // The rules of a field run after its type, so they wait for the promise too.
    assert.deepEqual((await signup.checkAsync({ login: 'x', nick: 'abcd' })).errors, [
      'Field "Signup.nick" exceeds the maximum length',
    ]);
  });

  it('should await the decoders in parseAsync, parts before the whole', async () => {
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
    assert.deepEqual(result, {
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
    assert.deepEqual(order.slice().sort(), ['inner', 'root', 'tag a', 'tag b', 'tags']);
    assert.ok(position('tag a') < position('tags') && position('tag b') < position('tags'));
    assert.equal(position('root'), order.length - 1);
    assert.deepEqual(input, {
      tags: ['a', 'b'],
      inner: { a: 'abc' },
      table: new Map([['x', 1]]),
      bag: new Set([1, 2]),
      sync: 's',
    });
    assert.deepEqual(summarize((await schema.parseAsync({ ...input, sync: 'bad' })).issues), [
      [[], 'is bad'],
    ]);
    const invalid = await schema.parseAsync({ ...input, sync: 1 });
    assert.equal(invalid.value, undefined);
    assert.deepEqual(summarize(invalid.issues), [[['sync'], 'not of expected type: string']]);
    const plain = Schema.from({ name: 'string', 'n?': { type: 'number', default: 1 } });
    const value = { name: 'x' };
    assert.deepEqual(await plain.parseAsync(value), {
      valid: true,
      value: { name: 'x', n: 1 },
      issues: [],
    });
    const given = { name: 'x', n: 2 };
    assert.equal((await plain.parseAsync(given)).value, given);
  });

  it('should settle decoders in keyed collections, references and unions in place', async () => {
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
    assert.deepEqual(result.value, {
      dict: { a: 2, b: 3 },
      table: new Map([['a', 0]]),
      tags: [{ label: 'X' }],
      tag: { label: 'Y' },
      either: { n: -1, m: 2 },
      shape: { kind: 'a', x: 1 },
    });
    assert.equal((await doc.parseAsync({ ...result.value, shape: 'x' })).valid, false);
    assert.equal((await doc.parseAsync({ ...result.value, tags: [null] })).valid, false);
  });

  it('should report a decoder that rejects or throws as an exception issue at its path', async () => {
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
    assert.equal(result.valid, false);
    assert.equal(result.value, undefined);
    assert.deepEqual(summarize(result.issues), [
      [['c'], 'validation failed Error: sync boom'],
      [['a', 'b'], 'validation failed Error: boom'],
      [['list', 1], 'validation failed Error: two'],
    ]);
    for (const issue of result.issues) assert.equal(issue.code, 'exception');
    const root = Schema.from({
      a: { type: 'string', parse: async (text) => text },
      parse: async () => {
        throw new Error('whole');
      },
    });
    assert.deepEqual(summarize((await root.parseAsync({ a: 'x' })).issues), [
      [[], 'validation failed Error: whole'],
    ]);
  });

  it('should resolve references and plain unions as the check does', async () => {
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
    assert.deepEqual(
      await person.parseAsync({ name: 'x', employer: { name: 'Acme' }, either: { n: 1 } }),
      {
        valid: true,
        value: { name: 'x', employer: { name: 'Acme', registered: true }, either: { n: 1 } },
        issues: [],
      },
    );
    const bad = await person.checkAsync({
      name: 'x',
      employer: { name: 'bad' },
      either: { n: -1 },
    });
    assert.deepEqual(bad.errors, [
      'Field "Person.employer.name" bad name',
      'Field "Person.either.n" not positive',
    ]);
    assert.throws(() => person.check({ name: 'x', employer: { name: 'ok' }, either: 's' }), {
      code: 'ERR_ASYNC_VALIDATOR',
    });
  });

  it('should let a validator run another check, sync or async', async () => {
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
    // they are; `y` is beside the promise of `x` and ran during the walk.
    assert.deepEqual((await outer.checkAsync({ x: 'x', y: 'y' })).errors, [
      'Field "b" is required',
      'Field "a" not of expected type: string',
      'Field "b" inner b',
    ]);
  });

  it('should leave no deferred validator behind a failed branch of a plain union', async () => {
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
    assert.deepEqual((await schema.checkAsync(value)).errors, []);
    assert.deepEqual(await schema.parseAsync(value), { valid: true, value, issues: [] });
    // The first branch taken: its async validator settles and may still fail
    // the value; the next branch is not tried for it.
    const first = await schema.checkAsync({ u: { a: 'x', b: 1 } });
    assert.deepEqual(first.errors, ['Field "Pick.u.a" branch0 async says no']);
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
    assert.deepEqual((await later.checkAsync({ first: 'f', u: { a: 'x', b: 'y' } })).errors, []);
  });

  it('should adopt in parseAsync the promises of its decoders, not a thenable in the data', async () => {
    let called = 0;
    const value = {
      then: (resolve) => {
        called += 1;
        resolve('hijacked');
      },
    };
    const named = Schema.from({ then: 'any', x: { type: 'string', parse: async (s) => s } });
    const result = await named.parseAsync({ ...value, x: 'x' });
    assert.equal(result.valid, true);
    assert.equal(result.value.then, value.then);
    assert.equal(result.value.x, 'x');
    assert.equal(called, 0);
    const nested = Schema.from({
      inner: { t: 'any' },
      x: { type: 'string', parse: async (s) => s },
    });
    const thenable = { then: () => (called += 1) };
    const out = await nested.parseAsync({ inner: { t: thenable }, x: 'x' }, { unknown: 'strip' });
    assert.equal(out.value.inner.t, thenable);
    assert.equal(called, 0);
  });

  it('should never let a promise the check cannot wait for reject unhandled', async () => {
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
      assert.deepEqual(result.errors, ['Field "b" not of expected type: number']);
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
              k: {
                type: 'number',
                validate: async () => {
                  await tick();
                  throw new Error('trial too');
                },
              },
              'd?': { type: 'number', default: 1 },
            },
            'string',
          ],
        },
      });
      const parsed = await tried.parseAsync({ u: { n: 1, k: 2 } });
      assert.deepEqual(parsed.valid, false);
      // A failed branch of a plain union drops the promises it set aside and
      // observes them: the value matches the second branch after the first set
      // a rejecting validator aside and failed on `b`.
      const branched = Schema.from({
        u: {
          union: [
            {
              a: { type: 'string', validate: () => Promise.reject(new Error('dropped')) },
              b: 'number',
            },
            { a: 'string', b: 'string' },
          ],
        },
      });
      assert.deepEqual((await branched.checkAsync({ u: { a: 'x', b: 'y' } })).errors, []);
      assert.equal((await branched.parseAsync({ u: { a: 'x', b: 'y' } })).valid, true);
      await tick();
      await tick();
      await tick();
      assert.deepEqual(unhandled, []);
    } finally {
      process.off('unhandledRejection', listen);
    }
  });

  it('should respect maxErrors for the decoders that reject', async () => {
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
    assert.equal(limited.valid, false);
    assert.equal(limited.issues.length, 1);
    const all = await schema.parseAsync({ a: 'x', b: 'y' });
    assert.deepEqual(summarize(all.issues), [
      [['a'], 'validation failed Error: a'],
      [['b'], 'validation failed Error: b'],
    ]);
  });

  it('should leave no promise of the check unhandled when a walk throws', async () => {
    // A getter of the value that throws is the program's error and leaves
    // checkAsync as such; the promise a validator met before it returned is
    // observed on the way out, not left to reject on its own.
    const unhandled = [];
    const listen = (reason) => unhandled.push(reason);
    process.on('unhandledRejection', listen);
    try {
      const schema = Schema.from({
        a: {
          type: 'string',
          validate: async () => {
            await tick();
            throw new Error('a rejects');
          },
        },
        b: 'string',
      });
      const value = {
        a: 'x',
        get b() {
          throw new Error('getter');
        },
      };
      await assert.rejects(schema.checkAsync(value), { message: 'getter' });
      await assert.rejects(schema.parseAsync(value), { message: 'getter' });
      await tick();
      await tick();
      assert.deepEqual(unhandled, []);
    } finally {
      process.off('unhandledRejection', listen);
    }
  });
});
