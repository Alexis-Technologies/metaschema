const { test } = require('node:test');
const assert = require('node:assert');

const { Schema } = require('../../index.js');
const {
  checkEach,
  parseEach,
  checkEachAsync,
  parseEachAsync,
  transform,
  register,
} = require('../../src/stream/index.js');

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

const user = new Schema('User', { name: 'string', 'age?': { type: 'number', default: 0 } });
const rows = [{ name: 'a' }, { name: 1 }, { name: 'c', age: 3, extra: true }, { name: 'd' }];

// The entries of an iteration as `[index, record, valid]`.
const entries = (iterable) =>
  Array.from(iterable, ({ index, record, result }) => [index, record, result.valid]);

const collect = async (iterator) => {
  const out = [];
  for await (const entry of iterator) out.push([entry.index, entry.record, entry.result.valid]);
  return out;
};

// A slow schema: every record waits for a timer.
const slow = new Schema('Slow', {
  n: {
    type: 'number',
    validate: async (n) => {
      await tick();
      return n >= 0 || 'negative';
    },
  },
});
const items = [{ n: 1 }, { n: -1 }, { n: 2 }];

const readable = (list) =>
  new ReadableStream({
    start(controller) {
      for (const item of list) controller.enqueue(item);
      controller.close();
    },
  });

const drain = async (stream) => {
  const out = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
};

test('Stream: checkEach yields an entry per record, in order', () => {
  const iterator = checkEach(user, rows);
  assert.strictEqual(typeof iterator.next, 'function');
  const out = [...iterator];
  assert.deepStrictEqual(
    out.map((entry) => [entry.index, entry.record, entry.result.valid]),
    [
      [0, rows[0], true],
      [1, rows[1], false],
      [2, rows[2], false],
      [3, rows[3], true],
    ],
  );
  assert.strictEqual(out[0].record, rows[0]);
  assert.deepStrictEqual(out[1].result.errors, ['Field "User.name" not of expected type: string']);
  assert.deepStrictEqual(out[2].result.errors, ['Field "User" has unexpected keys: extra']);
  assert.strictEqual(out[0].result.issues.length, 0);
  // One shape for every entry; the options of check pass through as given.
  assert.deepStrictEqual(Object.keys(out[0]), ['index', 'record', 'result']);
  const loose = { unknown: 'ignore' };
  assert.deepStrictEqual(
    entries(checkEach(user, rows, loose)).map((entry) => entry[2]),
    [true, false, true, true],
  );
  assert.deepStrictEqual([...checkEach(user, rows, { root: 'row' })][1].result.errors, [
    'Field "row.name" not of expected type: string',
  ]);
  // Any iterable: a Set, a generator.
  assert.strictEqual([...checkEach(user, new Set(rows))].length, 4);
  const generated = function* () {
    yield rows[0];
    yield rows[1];
  };
  assert.deepStrictEqual(entries(checkEach(user, generated())), [
    [0, rows[0], true],
    [1, rows[1], false],
  ]);
  // Lazy: nothing is checked before the iterator is read.
  let checked = 0;
  const counted = Schema.from({
    n: {
      type: 'number',
      validate: () => {
        checked += 1;
        return true;
      },
    },
  });
  const lazy = checkEach(counted, [{ n: 1 }, { n: 2 }]);
  assert.strictEqual(checked, 0);
  lazy.next();
  assert.strictEqual(checked, 1);
});

test('Stream: parseEach yields the result of parse per record', () => {
  const out = [...parseEach(user, rows, { unknown: 'strip' })];
  assert.deepStrictEqual(
    out.map((entry) => entry.result),
    [
      { valid: true, value: { name: 'a', age: 0 }, issues: [] },
      { valid: false, value: undefined, issues: out[1].result.issues },
      { valid: true, value: { name: 'c', age: 3 }, issues: [] },
      { valid: true, value: { name: 'd', age: 0 }, issues: [] },
    ],
  );
  assert.strictEqual(out[1].result.issues[0].code, 'type');
  // The record is the one given, never written to.
  assert.strictEqual(out[2].record, rows[2]);
  assert.deepStrictEqual(rows[2], { name: 'c', age: 3, extra: true });
  // Decoders and aliases through parse.
  const decoded = Schema.from({
    when: { type: 'string', parse: (text) => new Date(text), aliases: ['at'] },
  });
  const parsed = [
    ...parseEach(decoded, [
      { when: '2020-01-01T00:00:00.000Z' },
      { at: '2021-01-01T00:00:00.000Z' },
    ]),
  ];
  assert.deepStrictEqual(
    parsed.map((entry) => entry.result.value.when.getUTCFullYear()),
    [2020, 2021],
  );
});

test('Stream: maxInvalid ends the iteration after that many invalid records', () => {
  assert.deepStrictEqual(entries(checkEach(user, rows, { maxInvalid: 1 })), [
    [0, rows[0], true],
    [1, rows[1], false],
  ]);
  assert.strictEqual(entries(checkEach(user, rows, { maxInvalid: 2 })).length, 3);
  assert.strictEqual(entries(checkEach(user, rows, { maxInvalid: 3 })).length, 4);
  assert.strictEqual(entries(checkEach(user, rows, { maxInvalid: Infinity })).length, 4);
  assert.strictEqual(entries(parseEach(user, rows, { maxInvalid: 1 })).length, 2);
});

test('Stream: checkEachAsync and parseEachAsync over sync and async sources', async () => {
  const expected = [
    [0, items[0], true],
    [1, items[1], false],
    [2, items[2], true],
  ];
  assert.deepStrictEqual(await collect(checkEachAsync(slow, items)), expected);
  assert.deepStrictEqual(await collect(checkEachAsync(slow, new Set(items))), expected);
  const source = async function* () {
    for (const item of items) {
      await tick();
      yield item;
    }
  };
  assert.deepStrictEqual(await collect(checkEachAsync(slow, source())), expected);
  const parsed = [];
  for await (const entry of parseEachAsync(slow, source())) parsed.push(entry.result);
  assert.deepStrictEqual(
    parsed.map((result) => result.valid),
    [true, false, true],
  );
  assert.deepStrictEqual(parsed[0].value, { n: 1 });
  assert.deepStrictEqual(
    parsed[1].issues.map((issue) => issue.message),
    ['negative'],
  );
  // The sync pair runs the sync methods, which such a schema refuses.
  assert.throws(() => [...checkEach(slow, items)], { code: 'ERR_ASYNC_VALIDATOR' });
  // maxInvalid in the async pair.
  assert.deepStrictEqual(await collect(checkEachAsync(slow, items, { maxInvalid: 1 })), [
    [0, items[0], true],
    [1, items[1], false],
  ]);
});

test('Stream: concurrency keeps up to that many records in flight, in order', async () => {
  let inFlight = 0;
  let most = 0;
  const gate = new Schema('Gate', {
    n: {
      type: 'number',
      validate: async (n) => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await tick();
        await tick();
        inFlight -= 1;
        return n !== 3 || 'three';
      },
    },
  });
  const list = Array.from({ length: 8 }, (_, n) => ({ n }));
  const run = async (options) => {
    most = 0;
    const out = [];
    for await (const entry of checkEachAsync(gate, list, options)) out.push(entry.index);
    return out;
  };
  const order = [0, 1, 2, 3, 4, 5, 6, 7];
  assert.deepStrictEqual(await run(), order);
  assert.strictEqual(most, 1);
  assert.deepStrictEqual(await run({ concurrency: 3 }), order);
  assert.strictEqual(most, 3);
  assert.deepStrictEqual(await run({ concurrency: 100 }), order);
  assert.strictEqual(most, 8);
  // The iteration ends at maxInvalid with records in flight, or when the
  // consumer stops; nothing rejects unhandled.
  const unhandled = [];
  const listen = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', listen);
  try {
    const out = [];
    for await (const entry of checkEachAsync(gate, list, { concurrency: 4, maxInvalid: 1 })) {
      out.push(entry.index);
    }
    assert.deepStrictEqual(out, [0, 1, 2, 3]);
    let seen = 0;
    for await (const entry of checkEachAsync(gate, list, { concurrency: 4 })) {
      seen += 1;
      if (entry.index === 1) break;
    }
    assert.strictEqual(seen, 2);
    await tick();
    await tick();
    await tick();
    assert.deepStrictEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', listen);
  }
});

test('Stream: an iteration that ends early observes the promises in flight', async () => {
  // A default factory that throws is a programming error: parseAsync rejects
  // with it, and the records after it are abandoned, not left to reject.
  const schema = Schema.from({
    n: 'number',
    'd?': {
      type: 'number',
      default: () => {
        throw new Error('factory');
      },
    },
  });
  const records = [{ n: 1, d: 1 }, { n: 'x', d: 1 }, { n: 3 }];
  const unhandled = [];
  const listen = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', listen);
  try {
    const out = [];
    const options = { concurrency: 3, maxInvalid: 1 };
    for await (const entry of parseEachAsync(schema, records, options)) {
      out.push(entry.result.valid);
    }
    assert.deepStrictEqual(out, [true, false]);
    await assert.rejects(
      async () => {
        const seen = [];
        for await (const entry of parseEachAsync(schema, records, { concurrency: 3 })) {
          seen.push(entry.index);
        }
        return seen;
      },
      { message: 'factory' },
    );
    await tick();
    await tick();
    assert.deepStrictEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', listen);
  }
});

test('Stream: transform lets the valid records through as their parsed values', async () => {
  const dropped = [];
  const onInvalid = (record, result, index) => dropped.push([index, record, result.issues[0].code]);
  const out = await drain(
    readable(rows).pipeThrough(transform(user, { unknown: 'strip', onInvalid })),
  );
  assert.deepStrictEqual(out, [
    { name: 'a', age: 0 },
    { name: 'c', age: 3 },
    { name: 'd', age: 0 },
  ]);
  assert.deepStrictEqual(dropped, [[1, rows[1], 'type']]);
  // In check mode the record itself goes on.
  const checked = await drain(
    readable(rows).pipeThrough(transform(user, { mode: 'check', unknown: 'ignore', onInvalid })),
  );
  assert.deepStrictEqual(checked, [rows[0], rows[2], rows[3]]);
  assert.strictEqual(checked[0], rows[0]);
  // The async methods, one record at a time, in order.
  const seen = [];
  const asyncOut = await drain(
    readable(items).pipeThrough(
      transform(slow, { async: true, onInvalid: (record, result, index) => seen.push(index) }),
    ),
  );
  assert.deepStrictEqual(asyncOut, [{ n: 1 }, { n: 2 }]);
  assert.deepStrictEqual(seen, [1]);
  const asyncChecked = await drain(
    readable(items).pipeThrough(transform(slow, { async: true, mode: 'check', onInvalid })),
  );
  assert.deepStrictEqual(asyncChecked, [items[0], items[2]]);
});

test('Stream: without onInvalid, or past maxInvalid, the stream ends with the error', async () => {
  await assert.rejects(drain(readable(rows).pipeThrough(transform(user))), (error) => {
    assert.strictEqual(error.name, 'TypeError');
    assert.strictEqual(error.code, 'ERR_INVALID_RECORD');
    assert.strictEqual(error.message, 'Record 1 is invalid');
    assert.strictEqual(error.index, 1);
    assert.strictEqual(error.record, rows[1]);
    assert.strictEqual(error.result.valid, false);
    assert.strictEqual(error.result.issues[0].code, 'type');
    return true;
  });
  // The n-th invalid record is reported, then the stream ends.
  const reported = [];
  const onInvalid = (record, result, index) => reported.push(index);
  await assert.rejects(
    drain(
      readable([rows[1], rows[0], rows[1], rows[0]]).pipeThrough(
        transform(user, { maxInvalid: 2, onInvalid }),
      ),
    ),
    { code: 'ERR_INVALID_RECORD', index: 2 },
  );
  assert.deepStrictEqual(reported, [0, 2]);
  // The same in async mode.
  await assert.rejects(drain(readable(items).pipeThrough(transform(slow, { async: true }))), {
    code: 'ERR_INVALID_RECORD',
    index: 1,
  });
});

test('Stream: a wrong target, source or option is an error of the call', () => {
  assert.throws(() => checkEach({}, rows), {
    name: 'TypeError',
    code: 'ERR_INVALID_TARGET',
    message: 'A Schema is expected',
  });
  assert.throws(() => transform(Schema, {}), { code: 'ERR_INVALID_TARGET' });
  for (const bad of [null, undefined, 1, 'rows', {}, { next: () => ({}) }]) {
    assert.throws(() => checkEach(user, bad), {
      code: 'ERR_INVALID_TARGET',
      message: 'An iterable of records is expected',
    });
    assert.throws(() => parseEachAsync(user, bad), { code: 'ERR_INVALID_TARGET' });
  }
  // The options of the subpath are checked as the options of check are.
  assert.throws(() => checkEach(user, rows, { maxInvalid: 0 }), {
    name: 'TypeError',
    message: 'maxInvalid must be an integer of at least 1, got 0',
  });
  assert.throws(() => parseEach(user, rows, { maxInvalid: 1.5 }), {
    message: 'maxInvalid must be an integer of at least 1, got 1.5',
  });
  assert.throws(() => checkEachAsync(user, rows, { concurrency: 0 }), {
    message: 'concurrency must be an integer of at least 1, got 0',
  });
  assert.throws(() => parseEachAsync(user, rows, { concurrency: 'many' }), {
    message: 'concurrency must be an integer of at least 1, got "many"',
  });
  assert.throws(() => transform(user, { mode: 'strict' }), {
    message: 'mode must be "parse" or "check", got "strict"',
  });
  assert.throws(() => transform(user, { async: 1 }), { message: 'async must be a boolean, got 1' });
  assert.throws(() => transform(user, { onInvalid: true }), {
    message: 'onInvalid must be a function, got true',
  });
  assert.throws(() => checkEach(user, rows, 'x'), {
    message: 'options must be an object, got "x"',
  });
  // The options of check are checked by check itself, at the first record.
  const bad = checkEach(user, rows, { maxErrors: 0 });
  assert.throws(() => bad.next(), { message: 'maxErrors must be an integer of at least 1, got 0' });
});

test('Stream: register() installs the methods on Schema, once', async () => {
  assert.strictEqual(user.checkEach, undefined);
  register();
  register();
  for (const name of ['checkEach', 'parseEach', 'checkEachAsync', 'parseEachAsync', 'transform']) {
    const own = Object.getOwnPropertyDescriptor(Schema.prototype, name);
    assert.strictEqual(typeof own.value, 'function');
    assert.strictEqual(own.enumerable, false);
  }
  assert.strictEqual(Object.keys(user).includes('checkEach'), false);
  assert.strictEqual(entries(user.checkEach(rows, { maxInvalid: 1 })).length, 2);
  assert.strictEqual([...user.parseEach(rows)].length, 4);
  assert.strictEqual((await collect(slow.checkEachAsync(items))).length, 3);
  assert.strictEqual((await collect(slow.parseEachAsync(items, { concurrency: 2 }))).length, 3);
  assert.strictEqual(user.transform() instanceof TransformStream, true);
  assert.strictEqual(user.transform({ mode: 'check' }) instanceof TransformStream, true);
});
