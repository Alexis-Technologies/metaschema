const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

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

describe('Stream', () => {
  it('should yield an entry per record from checkEach, in order', () => {
    const iterator = checkEach(user, rows);
    assert.equal(typeof iterator.next, 'function');
    const out = [...iterator];
    assert.deepEqual(
      out.map((entry) => [entry.index, entry.record, entry.result.valid]),
      [
        [0, rows[0], true],
        [1, rows[1], false],
        [2, rows[2], false],
        [3, rows[3], true],
      ],
    );
    assert.equal(out[0].record, rows[0]);
    assert.deepEqual(out[1].result.errors, ['Field "User.name" not of expected type: string']);
    assert.deepEqual(out[2].result.errors, ['Field "User" has unexpected keys: extra']);
    assert.equal(out[0].result.issues.length, 0);
    // One shape for every entry; the options of check pass through as given.
    assert.deepEqual(Object.keys(out[0]), ['index', 'record', 'result']);
    const loose = { unknown: 'ignore' };
    assert.deepEqual(
      entries(checkEach(user, rows, loose)).map((entry) => entry[2]),
      [true, false, true, true],
    );
    assert.deepEqual([...checkEach(user, rows, { root: 'row' })][1].result.errors, [
      'Field "row.name" not of expected type: string',
    ]);
    // Any iterable: a Set, a generator.
    assert.equal([...checkEach(user, new Set(rows))].length, 4);
    const generated = function* () {
      yield rows[0];
      yield rows[1];
    };
    assert.deepEqual(entries(checkEach(user, generated())), [
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
    assert.equal(checked, 0);
    lazy.next();
    assert.equal(checked, 1);
  });

  it('should yield the result of parse per record from parseEach', () => {
    const out = [...parseEach(user, rows, { unknown: 'strip' })];
    assert.deepEqual(
      out.map((entry) => entry.result),
      [
        { valid: true, value: { name: 'a', age: 0 }, issues: [] },
        { valid: false, value: undefined, issues: out[1].result.issues },
        { valid: true, value: { name: 'c', age: 3 }, issues: [] },
        { valid: true, value: { name: 'd', age: 0 }, issues: [] },
      ],
    );
    assert.equal(out[1].result.issues[0].code, 'type');
    // The record is the one given, never written to.
    assert.equal(out[2].record, rows[2]);
    assert.deepEqual(rows[2], { name: 'c', age: 3, extra: true });
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
    assert.deepEqual(
      parsed.map((entry) => entry.result.value.when.getUTCFullYear()),
      [2020, 2021],
    );
  });

  it('should end the iteration after maxInvalid invalid records', () => {
    assert.deepEqual(entries(checkEach(user, rows, { maxInvalid: 1 })), [
      [0, rows[0], true],
      [1, rows[1], false],
    ]);
    assert.equal(entries(checkEach(user, rows, { maxInvalid: 2 })).length, 3);
    assert.equal(entries(checkEach(user, rows, { maxInvalid: 3 })).length, 4);
    assert.equal(entries(checkEach(user, rows, { maxInvalid: Infinity })).length, 4);
    assert.equal(entries(parseEach(user, rows, { maxInvalid: 1 })).length, 2);
  });

  it('should run checkEachAsync and parseEachAsync over sync and async sources', async () => {
    const expected = [
      [0, items[0], true],
      [1, items[1], false],
      [2, items[2], true],
    ];
    assert.deepEqual(await collect(checkEachAsync(slow, items)), expected);
    assert.deepEqual(await collect(checkEachAsync(slow, new Set(items))), expected);
    const source = async function* () {
      for (const item of items) {
        await tick();
        yield item;
      }
    };
    assert.deepEqual(await collect(checkEachAsync(slow, source())), expected);
    const parsed = [];
    for await (const entry of parseEachAsync(slow, source())) parsed.push(entry.result);
    assert.deepEqual(
      parsed.map((result) => result.valid),
      [true, false, true],
    );
    assert.deepEqual(parsed[0].value, { n: 1 });
    assert.deepEqual(
      parsed[1].issues.map((issue) => issue.message),
      ['negative'],
    );
    // The sync pair runs the sync methods, which such a schema refuses.
    assert.throws(() => [...checkEach(slow, items)], { code: 'ALX_ERR_ASYNC_VALIDATOR' });
    // maxInvalid in the async pair.
    assert.deepEqual(await collect(checkEachAsync(slow, items, { maxInvalid: 1 })), [
      [0, items[0], true],
      [1, items[1], false],
    ]);
  });

  it('should keep up to concurrency records in flight, in order', async () => {
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
    assert.deepEqual(await run(), order);
    assert.equal(most, 1);
    assert.deepEqual(await run({ concurrency: 3 }), order);
    assert.equal(most, 3);
    assert.deepEqual(await run({ concurrency: 100 }), order);
    assert.equal(most, 8);
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
      assert.deepEqual(out, [0, 1, 2, 3]);
      let seen = 0;
      for await (const entry of checkEachAsync(gate, list, { concurrency: 4 })) {
        seen += 1;
        if (entry.index === 1) break;
      }
      assert.equal(seen, 2);
      await tick();
      await tick();
      await tick();
      assert.deepEqual(unhandled, []);
    } finally {
      process.off('unhandledRejection', listen);
    }
  });

  it('should observe the promises in flight when an iteration ends early', async () => {
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
      assert.deepEqual(out, [true, false]);
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
      assert.deepEqual(unhandled, []);
    } finally {
      process.off('unhandledRejection', listen);
    }
  });

  it('should let the valid records through transform as their parsed values', async () => {
    const dropped = [];
    const onInvalid = (record, result, index) =>
      dropped.push([index, record, result.issues[0].code]);
    const out = await drain(
      readable(rows).pipeThrough(transform(user, { unknown: 'strip', onInvalid })),
    );
    assert.deepEqual(out, [
      { name: 'a', age: 0 },
      { name: 'c', age: 3 },
      { name: 'd', age: 0 },
    ]);
    assert.deepEqual(dropped, [[1, rows[1], 'type']]);
    // In check mode the record itself goes on.
    const checked = await drain(
      readable(rows).pipeThrough(transform(user, { mode: 'check', unknown: 'ignore', onInvalid })),
    );
    assert.deepEqual(checked, [rows[0], rows[2], rows[3]]);
    assert.equal(checked[0], rows[0]);
    // The async methods, one record at a time, in order.
    const seen = [];
    const asyncOut = await drain(
      readable(items).pipeThrough(
        transform(slow, { async: true, onInvalid: (record, result, index) => seen.push(index) }),
      ),
    );
    assert.deepEqual(asyncOut, [{ n: 1 }, { n: 2 }]);
    assert.deepEqual(seen, [1]);
    const asyncChecked = await drain(
      readable(items).pipeThrough(transform(slow, { async: true, mode: 'check', onInvalid })),
    );
    assert.deepEqual(asyncChecked, [items[0], items[2]]);
  });

  it('should end the stream with the error without onInvalid, or past maxInvalid', async () => {
    await assert.rejects(drain(readable(rows).pipeThrough(transform(user))), (error) => {
      assert.equal(error.name, 'SchemaUsageError');
      assert.ok(error instanceof TypeError);
      assert.equal(error.code, 'ALX_ERR_INVALID_RECORD');
      assert.equal(error.message, 'Record 1 is invalid');
      assert.equal(error.index, 1);
      assert.equal(error.record, rows[1]);
      assert.equal(error.result.valid, false);
      assert.equal(error.result.issues[0].code, 'type');
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
      { code: 'ALX_ERR_INVALID_RECORD', index: 2 },
    );
    assert.deepEqual(reported, [0, 2]);
    // The same in async mode.
    await assert.rejects(drain(readable(items).pipeThrough(transform(slow, { async: true }))), {
      code: 'ALX_ERR_INVALID_RECORD',
      index: 1,
    });
  });

  it('should throw an error of the call for a wrong target, source or option', () => {
    assert.throws(() => checkEach({}, rows), {
      name: 'SchemaUsageError',
      code: 'ALX_ERR_INVALID_TARGET',
      message: 'A Schema is expected',
    });
    assert.throws(() => transform(Schema, {}), { code: 'ALX_ERR_INVALID_TARGET' });
    for (const bad of [null, undefined, 1, 'rows', {}, { next: () => ({}) }]) {
      assert.throws(() => checkEach(user, bad), {
        code: 'ALX_ERR_INVALID_TARGET',
        message: 'An iterable of records is expected',
      });
      assert.throws(() => parseEachAsync(user, bad), { code: 'ALX_ERR_INVALID_TARGET' });
    }
    // The options of the subpath are checked as the options of check are.
    assert.throws(() => checkEach(user, rows, { maxInvalid: 0 }), {
      name: 'SchemaUsageError',
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
    assert.throws(() => transform(user, { async: 1 }), {
      message: 'async must be a boolean, got 1',
    });
    assert.throws(() => transform(user, { onInvalid: true }), {
      message: 'onInvalid must be a function, got true',
    });
    assert.throws(() => checkEach(user, rows, 'x'), {
      message: 'options must be an object, got "x"',
    });
    // The options of check are checked by check itself, at the first record.
    const bad = checkEach(user, rows, { maxErrors: 0 });
    assert.throws(() => bad.next(), {
      message: 'maxErrors must be an integer of at least 1, got 0',
    });
  });

  it('should install the methods on Schema with register(), once', async () => {
    assert.equal(user.checkEach, undefined);
    register();
    register();
    for (const name of [
      'checkEach',
      'parseEach',
      'checkEachAsync',
      'parseEachAsync',
      'transform',
    ]) {
      const own = Object.getOwnPropertyDescriptor(Schema.prototype, name);
      assert.equal(typeof own.value, 'function');
      assert.equal(own.enumerable, false);
    }
    assert.equal(Object.keys(user).includes('checkEach'), false);
    assert.equal(entries(user.checkEach(rows, { maxInvalid: 1 })).length, 2);
    assert.equal([...user.parseEach(rows)].length, 4);
    assert.equal((await collect(slow.checkEachAsync(items))).length, 3);
    assert.equal((await collect(slow.parseEachAsync(items, { concurrency: 2 }))).length, 3);
    assert.equal(user.transform() instanceof TransformStream, true);
    assert.equal(user.transform({ mode: 'check' }) instanceof TransformStream, true);
  });

  it('should never reject unhandled for a record that rejects while an earlier one is pending', async () => {
    // With a window of records in flight, the promise of a later record is
    // observed from the start: before this, a parse that threw for the second
    // record while the first still waited for its validator fired
    // unhandledRejection, then rejected the iteration all the same.
    const unhandled = [];
    const listen = (reason) => unhandled.push(reason);
    process.on('unhandledRejection', listen);
    try {
      const schema = Schema.from({
        n: { type: 'number', validate: () => new Promise((resolve) => setTimeout(resolve, 20)) },
        'd?': {
          type: 'number',
          default: () => {
            throw new Error('factory');
          },
        },
      });
      const records = [{ n: 1, d: 1 }, { n: 2 }];
      const seen = [];
      await assert.rejects(
        async () => {
          for await (const entry of parseEachAsync(schema, records, { concurrency: 2 })) {
            seen.push(entry.index);
          }
        },
        { message: 'factory' },
      );
      assert.deepEqual(seen, [0]);
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.deepEqual(unhandled, []);
    } finally {
      process.off('unhandledRejection', listen);
    }
  });

  it('should await a record that is a promise in the async pair, data in the sync pair', async () => {
    // `for await` over a sync iterable awaits its elements, so the async pair
    // checks what a promise resolves to; the sync pair checks the promise
    // itself, an object with no keys of the schema.
    const promised = [Promise.resolve({ name: 'a' }), { name: 'b' }];
    assert.deepEqual(await collect(checkEachAsync(user, promised)), [
      [0, { name: 'a' }, true],
      [1, { name: 'b' }, true],
    ]);
    const sync = entries(checkEach(user, promised));
    assert.equal(sync[0][1], promised[0]);
    assert.deepEqual(
      sync.map((entry) => entry[2]),
      [false, true],
    );
    // A rejected element rejects the iteration, as the source's own error.
    await assert.rejects(collect(checkEachAsync(user, [Promise.reject(new Error('source'))])), {
      message: 'source',
    });
  });

  it('should end the stream with the error of an onInvalid that throws, or of a parse that rejects', async () => {
    const thrower = transform(user, {
      onInvalid: () => {
        throw new Error('boom');
      },
    });
    await assert.rejects(drain(readable(rows).pipeThrough(thrower)), { message: 'boom' });
    const throwing = Schema.from({
      n: 'number',
      'd?': {
        type: 'number',
        default: () => {
          throw new Error('factory');
        },
      },
    });
    const records = [{ n: 1, d: 1 }, { n: 2 }];
    await assert.rejects(drain(readable(records).pipeThrough(transform(throwing))), {
      message: 'factory',
    });
    await assert.rejects(
      drain(readable(records).pipeThrough(transform(throwing, { async: true }))),
      {
        message: 'factory',
      },
    );
    // In check mode the default is never applied, so both records pass.
    const checked = await drain(
      readable(records).pipeThrough(transform(throwing, { mode: 'check' })),
    );
    assert.deepEqual(checked, records);
  });
});
