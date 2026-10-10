import { expectAssignable, expectError, expectNotAssignable, expectType } from 'tsd';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { Model, Schema } from '../../index.js';
import type {
  InferSchema,
  StandardOptions,
  StandardProps,
  StandardResult,
  ValidationIssue,
} from '../../index.js';

declare const as: <T>() => T;

// index.d.ts cannot import the specification, so the shape it writes out is
// checked here against `StandardSchemaV1` of `@standard-schema/spec`.
const user = Schema.from({ name: 'string', age: '?number' });
type User = InferSchema<typeof user>;

expectAssignable<StandardSchemaV1>(user);
expectAssignable<StandardSchemaV1<unknown, User>>(user);
expectAssignable<StandardSchemaV1<User, User>>(user);
expectAssignable<StandardSchemaV1<User>>(user);
expectNotAssignable<StandardSchemaV1<unknown, { name: number }>>(user);
expectAssignable<StandardSchemaV1.Props<User, User>>(user['~standard']);
expectType<User>(as<StandardSchemaV1.InferOutput<typeof user>>());
expectType<User>(as<StandardSchemaV1.InferInput<typeof user>>());

// The props: a literal version and vendor, a synchronous validate.
expectType<StandardProps<{ readonly name: 'string'; readonly age: '?number' }>>(user['~standard']);
expectType<1>(user['~standard'].version);
expectType<'alexify.metaschema'>(user['~standard'].vendor);
const result = user['~standard'].validate({ name: 'Marcus' });
expectType<StandardResult<User>>(result);
expectAssignable<StandardSchemaV1.Result<User>>(result);
expectNotAssignable<Promise<unknown>>(result);
if (result.issues === undefined) {
  expectType<User>(result.value);
} else {
  expectType<ReadonlyArray<ValidationIssue>>(result.issues);
  expectAssignable<ReadonlyArray<StandardSchemaV1.Issue>>(result.issues);
}

// An issue of a check is an issue of the specification: a message and a path
// of keys.
expectAssignable<StandardSchemaV1.Issue>(user.check({}).issues[0]);

// The vendor-specific options are the options of check.
expectAssignable<StandardOptions>({ libraryOptions: { maxErrors: 1, unknown: 'ignore' } });
expectType<StandardResult<User>>(
  user['~standard'].validate({}, { libraryOptions: { maxErrors: 1 } }),
);
expectError(user['~standard'].validate({}, { libraryOptions: { maxErrors: '1' } }));
expectError(user['~standard'].validate({}, { libraryOptions: { unknown: 'strip' } }));

// A scalar schema, and any schema (an entity of a model) as a Standard Schema
// of unknown.
expectType<string>(as<StandardSchemaV1.InferOutput<Schema<'string'>>>());
expectAssignable<StandardSchemaV1<string, string>>(Schema.from('string'));
declare const model: Model;
const account = model.entities.get('Account')!;
expectAssignable<StandardSchemaV1>(account);
expectType<unknown>(as<StandardSchemaV1.InferOutput<typeof account>>());
expectType<StandardResult<unknown>>(account['~standard'].validate({}));
