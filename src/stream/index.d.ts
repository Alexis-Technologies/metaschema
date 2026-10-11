import type {
  EachAsyncOptions,
  EachOptions,
  Infer,
  InferOutput,
  ParseEachOptions,
  ParseResult,
  RecordEntry,
  Schema,
  TransformOptions,
  ValidationResult,
} from '../../index.js';

// `check` on every record of an iterable, as a generator of
// `{ index, record, result }` in the order of the records; the options are
// those of `check`, plus `maxInvalid`, the number of invalid records after
// which the iteration ends. A target that is not a Schema, or a source that
// is not iterable, is a `TypeError` with the code `ERR_INVALID_TARGET`.
export function checkEach(
  schema: Schema,
  records: Iterable<unknown>,
  options?: EachOptions,
): Generator<RecordEntry<ValidationResult>, void, undefined>;

// `parse` on every record of an iterable: the same, with the result of
// `parse` in each entry.
export function parseEach<D extends string | object>(
  schema: Schema<D>,
  records: Iterable<unknown>,
  options?: ParseEachOptions,
): Generator<RecordEntry<ParseResult<InferOutput<D>>>, void, undefined>;

// `checkAsync` on every record of a sync or async iterable, as an async
// generator in the order of the records, with up to `concurrency` records
// in flight (one by default).
export function checkEachAsync(
  schema: Schema,
  records: Iterable<unknown> | AsyncIterable<unknown>,
  options?: EachOptions & EachAsyncOptions,
): AsyncGenerator<RecordEntry<ValidationResult>, void, undefined>;

// `parseAsync` on every record of a sync or async iterable: the same, with
// the result of `parseAsync` in each entry.
export function parseEachAsync<D extends string | object>(
  schema: Schema<D>,
  records: Iterable<unknown> | AsyncIterable<unknown>,
  options?: ParseEachOptions & EachAsyncOptions,
): AsyncGenerator<RecordEntry<ParseResult<InferOutput<D>>>, void, undefined>;

// A TransformStream over the records of a stream: a valid record goes on as
// its parsed value (`mode: 'parse'`, the default) or as it is
// (`mode: 'check'`); an invalid one is handed to `onInvalid` and dropped, or
// ends the stream with a `TypeError` of the code `ERR_INVALID_RECORD` (with
// `index`, `record` and `result` on it) when there is no `onInvalid` or
// `maxInvalid` is reached. `async: true` runs the async methods.
export function transform<D extends string | object>(
  schema: Schema<D>,
  options: TransformOptions & { mode: 'check' },
): TransformStream<unknown, Infer<D>>;
export function transform<D extends string | object>(
  schema: Schema<D>,
  options?: TransformOptions,
): TransformStream<unknown, InferOutput<D>>;

// Installs `schema.checkEach`, `schema.parseEach`, `schema.checkEachAsync`,
// `schema.parseEachAsync` and `schema.transform`. Once per process; later
// calls do nothing.
export function register(): void;
