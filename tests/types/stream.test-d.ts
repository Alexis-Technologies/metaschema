import { expectAssignable, expectError, expectType } from 'tsd';
import { Schema, ValidationResult } from '../../index.js';
import {
  checkEach,
  checkEachAsync,
  parseEach,
  parseEachAsync,
  register,
  transform,
} from '../../src/stream/index.js';
import type {
  EachAsyncOptions,
  EachOptions,
  ParseEachOptions,
  ParseResult,
  RecordEntry,
  RuntimeErrorCode,
  TransformOptions,
} from '../../index.js';

const user = Schema.from({ name: 'string', 'n?': { type: 'number', default: 1 } });
const rows: unknown[] = [];
declare const source: AsyncIterable<unknown>;

// The sync pair yields entries with the result of check or parse.
expectType<Generator<RecordEntry<unknown, ValidationResult>, void, undefined>>(
  checkEach(user, rows),
);
for (const entry of checkEach(user, rows, { maxInvalid: 1, unknown: 'ignore' })) {
  expectType<number>(entry.index);
  expectType<unknown>(entry.record);
  expectType<ValidationResult>(entry.result);
}
for (const entry of parseEach(user, rows, { unknown: 'strip' })) {
  expectType<ParseResult<{ name: string; n: number | null }>>(entry.result);
  if (entry.result.valid) expectType<number | null>(entry.result.value.n);
}
expectError(checkEach(user, rows, { unknown: 'strip' }));
expectError(checkEach(user, rows, { concurrency: 2 }));
expectError(checkEach({ name: 'string' }, rows));

// The async pair takes a sync or async source and a concurrency.
expectType<AsyncGenerator<RecordEntry<unknown, ValidationResult>, void, undefined>>(
  checkEachAsync(user, source, { concurrency: 4 }),
);
expectType<
  AsyncGenerator<
    RecordEntry<unknown, ParseResult<{ name: string; n: number | null }>>,
    void,
    undefined
  >
>(parseEachAsync(user, rows, { maxInvalid: 2 }));
expectError(checkEachAsync(user, rows, { concurrency: 'two' }));

// The transform: parsed values, or the records as they are in check mode.
expectType<TransformStream<unknown, { name: string; n: number | null }>>(transform(user));
expectType<TransformStream<unknown, { name: string; n?: number | null | undefined }>>(
  transform(user, { mode: 'check' }),
);
expectType<TransformStream<unknown, { name: string; n: number | null }>>(
  transform(user, {
    async: true,
    maxInvalid: 3,
    onInvalid: (record, result, index) => void [record, result.valid, index],
  }),
);
expectError(transform(user, { mode: 'loose' }));
expectError(transform(user, { onInvalid: 1 }));

// register installs the methods, declared on the class.
expectType<void>(register());
expectType<Generator<RecordEntry<unknown, ValidationResult>, void, undefined>>(
  user.checkEach(rows),
);
expectType<TransformStream<unknown, { name: string; n: number | null }>>(user.transform());
expectAssignable<EachOptions>({ maxErrors: 1, maxInvalid: 1 });
expectAssignable<ParseEachOptions>({ unknown: 'strip' });
expectAssignable<EachAsyncOptions>({ concurrency: 1 });
expectAssignable<TransformOptions>({ mode: 'parse', async: false });
expectAssignable<RuntimeErrorCode>('ERR_INVALID_RECORD');

// The record of an entry is typed by the source.
const typed = [{ name: 'a' }, { name: 'b' }];
for (const entry of checkEach(user, typed)) expectType<{ name: string }>(entry.record);
for (const entry of user.parseEach(typed)) expectType<{ name: string }>(entry.record);
expectType<AsyncGenerator<RecordEntry<{ name: string }, ValidationResult>, void, undefined>>(
  checkEachAsync(user, typed),
);
declare const typedSource: AsyncIterable<{ id: number }>;
expectType<AsyncGenerator<RecordEntry<{ id: number }, ValidationResult>, void, undefined>>(
  user.checkEachAsync(typedSource),
);
