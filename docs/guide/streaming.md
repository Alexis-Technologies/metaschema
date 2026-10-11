# Records and streams

`check` and `parse` take one value. A bulk import, an export, a queue consumer or a stream of
events deals with a sequence of records, each validated on its own: which ones are valid, what
the others failed on, and the valid ones on their way without waiting for the rest. The
`@alexify/metaschema/stream` subpath is that side of a schema: generators over an iterable,
their async twins over an async one, and a `TransformStream`, all running the methods of the
core on each record, so nothing changes in what a record is checked against.

```js
const { Schema } = require('@alexify/metaschema');
const { checkEach } = require('@alexify/metaschema/stream');

const order = new Schema('Order', {
  id: 'string',
  qty: { type: 'integer', min: 1 },
  'note?': 'string',
  'tags?': { type: 'string', default: '' },
});
const rows = [{ id: 'a', qty: 1 }, { id: 'b', qty: 0 }, { id: 'c', qty: 2, extra: true }];

for (const { index, record, result } of checkEach(order, rows)) {
  if (!result.valid) console.log(index, result.errors);
}
// 1 [ 'Field "Order.qty" is less than 1' ]
// 2 [ 'Field "Order" has unexpected keys: extra' ]
```

## Entries

`checkEach(schema, records, options)` is a generator: it checks a record when the next entry is
asked for, never before, and yields `{ index, record, result }` in the order of the records.
`index` is the position in the sequence (an iterator has none of its own), `record` the record
as given (a stream cannot be read again), `result` the [`ValidationResult`](/guide/validation#the-result)
of `check`. `records` is any iterable: an array, a `Set`, a generator, the rows of a parsed
file. A string is refused: it iterates over its characters, and is surely a mistake.

The options are those of [`check`](/guide/validation#options) (`maxErrors`, `unknown`,
`references`, `messages`, `root`, `maxDepth`), handed to it as given, plus `maxInvalid`
(below). The lines of `result.errors` carry the name of the schema, or `options.root`, for
every record alike; the index of the record is in its entry.

## parse per record

`parseEach` does the same with [`parse`](/guide/parse): defaults filled in, unknown keys
stripped under `unknown: 'strip'`, the `parse` function of every field run; `result` is what
`parse` returns, `{ valid, value, issues }`.

```js
const { parseEach } = require('@alexify/metaschema/stream');

for (const { index, result } of parseEach(order, rows, { unknown: 'strip' })) {
  console.log(index, result.valid, result.value);
}
// 0 true { id: 'a', qty: 1, tags: '' }
// 1 false undefined
// 2 true { id: 'c', qty: 2, tags: '' }
```

## Stopping early

`maxInvalid` is the number of invalid records after which the iteration ends: the entry of the
n-th invalid record is the last one yielded. An import that gives up after the tenth bad row
reads no further than it has to, as `maxErrors` stops a check at the n-th issue.

```js
Array.from(checkEach(order, rows, { maxInvalid: 1 }), ({ index, result }) => [index, result.valid]);
// [ [ 0, true ], [ 1, false ] ]
```

## Async sources and concurrency

`checkEachAsync` and `parseEachAsync` run [`checkAsync` and `parseAsync`](/guide/parse#async)
on each record of a sync or async iterable (a database cursor, a `ReadableStream`, an async
generator over a file) and are async generators themselves. `concurrency` is how many records
are in flight at once, one by default: with validators that wait for a lookup, a window of
records overlaps their waits. The entries still come out in the order of the records, so a slow
record holds the ones after it until it settles.

```js
const { checkEachAsync } = require('@alexify/metaschema/stream');

const signup = new Schema('Signup', {
  login: { type: 'string', validate: async (login) => login !== 'admin' || 'is taken' },
});
const source = [{ login: 'ann' }, { login: 'admin' }];

for await (const { index, result } of checkEachAsync(signup, source, { concurrency: 4 })) {
  console.log(index, result.valid, result.errors);
}
// 0 true []
// 1 false [ 'Field "Signup.login" is taken' ]
```

When the iteration ends before the source does (`maxInvalid`, a consumer that stops reading),
the records in flight are not awaited, and their promises are observed so that none rejects
unhandled.

## A transform of a stream

`transform(schema, options)` is a
[`TransformStream`](https://developer.mozilla.org/en-US/docs/Web/API/TransformStream) (a global
in Node.js since 18 and in every browser): the records go in, and the parsed value of every
valid record comes out. An invalid record is handed to `onInvalid(record, result, index)` and
dropped; without `onInvalid` the stream ends at the first invalid record with a `TypeError`
whose `code` is `ERR_INVALID_RECORD` and which carries the `index`, the `record` and the
`result`. With `maxInvalid`, the n-th invalid record is reported and the stream ends with that
error all the same: a stream that ends looks complete to what reads it, so it cannot stop
quietly as a generator does.

```js
const { transform } = require('@alexify/metaschema/stream');

const source = ReadableStream.from(rows); // Node.js 20.6+; or new ReadableStream({ start })
const log = (index, issues) => console.log('dropped', index, issues[0].code);
const parsed = source.pipeThrough(
  transform(order, { unknown: 'strip', onInvalid: (record, result, index) => log(index, result.issues) }),
);
for await (const value of parsed) console.log('kept', value);
// kept { id: 'a', qty: 1, tags: '' }
// dropped 1 range
// kept { id: 'c', qty: 2, tags: '' }
```

`mode: 'check'` runs `check` instead and passes the record itself on; `async: true` runs the
async methods, one record at a time, in order. A Node.js stream joins through `Readable.toWeb`
and `Writable.toWeb` of `node:stream`, or through `stream.pipeline` with the Web stream in the
middle.

## The methods

`register()` installs the five functions as methods of `Schema`, non-enumerable, once per
process: `schema.checkEach(rows, options)`, `schema.parseEach(rows, options)`,
`schema.checkEachAsync(source, options)`, `schema.parseEachAsync(source, options)` and
`schema.transform(options)`. The functions do the same without it. The subpath is 1.0 KB
min+gzip on top of the core; the core entry does not carry it.

## Boundaries

- **One record at a time, nothing across records.** A rule over the sequence (unique ids, a
  running total, a header row) is the program's: the schema sees one record and its result
  says nothing about the others.
- **The entries keep the order of the records, whatever `concurrency` is.** A window of records
  overlaps their waits; it does not reorder them. A pipeline that may reorder is the program's
  to build from the async pair.
- **`maxInvalid` ends a generator and errors a stream.** A generator that ends is read to its
  end and the consumer knows how many entries it got; a stream that ends looks complete.
- **The options of `check` are checked at the first record.** A wrong `maxErrors` throws from
  `check` when the first entry is asked for, as it would from `check` itself; the options of
  the subpath (`maxInvalid`, `concurrency`, `mode`, `async`, `onInvalid`) are checked when the
  function is called, before anything is read.
- **Memory is the consumer's.** The sync pair holds one entry, the async pair `concurrency` of
  them; a program that collects every entry in an array keeps every result.
- **The cost of a record is the check's, plus about 20 ns.** An entry object and the iterator's
  own result object come on top, nothing else; `pnpm bench` puts `checkEach — 1 000 flat
  records` beside the same records in a loop of `check` (7.6 K against 9.2 K batches a second on
  the closures, 19 K against 31 K on the JIT, Node 24). A program that validates millions of
  records at the speed of the JIT and needs no entry per record loops over `check` itself.
