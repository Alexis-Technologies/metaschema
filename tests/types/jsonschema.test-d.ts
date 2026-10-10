import { expectAssignable, expectError, expectType } from 'tsd';
import type { StandardJSONSchemaV1 } from '@standard-schema/spec';
import { Model, Schema } from '../../index.js';
import type {
  DefinitionErrorCode,
  InferSchema,
  JSONSchema,
  JSONSchemaOptions,
  JSONSchemaTarget,
  ModelJSONSchemaOptions,
  StandardConverter,
  StandardJSONSchemaOptions,
} from '../../index.js';

const user = Schema.from({ name: 'string', age: '?number' });
type User = InferSchema<typeof user>;

// toJSONSchema and its options.
expectType<JSONSchema>(user.toJSONSchema());
expectType<Record<string, unknown>>(user.toJSONSchema({}));
expectType<JSONSchema>(
  user.toJSONSchema({
    target: 'draft-07',
    profile: 'strict',
    io: 'output',
    unrepresentable: 'any',
    references: 'embed',
    definitions: '#/x/',
  }),
);
expectAssignable<JSONSchemaTarget>('mongodb');
expectAssignable<JSONSchemaOptions>({ target: 'openapi-3.0', io: 'input' });
expectError(user.toJSONSchema({ target: 'draft-04' }));
expectError(user.toJSONSchema({ profile: 'loose' }));
expectError(user.toJSONSchema({ io: 'both' }));
expectError(user.toJSONSchema({ unrepresentable: 'skip' }));
expectError(user.toJSONSchema({ references: 'inline' }));
expectError(user.toJSONSchema({ definitions: 1 }));
expectError(user.toJSONSchema('strict'));

declare const model: Model;
expectType<JSONSchema>(model.toJSONSchema());
expectType<JSONSchema>(model.toJSONSchema({ root: 'User', target: 'mongodb' }));
expectAssignable<ModelJSONSchemaOptions>({ root: 'User', profile: 'strict' });
expectError(model.toJSONSchema({ root: 42 }));
expectError(user.toJSONSchema({ root: 'User' }));

// Standard JSON Schema: the converter of `@standard-schema/spec`.
expectAssignable<StandardJSONSchemaV1>(user);
expectAssignable<StandardJSONSchemaV1<User, User>>(user);
expectAssignable<StandardJSONSchemaV1.Props<User, User>>(user['~standard']);
expectAssignable<StandardJSONSchemaV1.Converter>(user['~standard'].jsonSchema);
expectType<StandardConverter>(user['~standard'].jsonSchema);
expectType<JSONSchema>(user['~standard'].jsonSchema.input({ target: 'draft-2020-12' }));
expectType<JSONSchema>(
  user['~standard'].jsonSchema.output({
    target: 'openapi-3.0',
    libraryOptions: { profile: 'strict', unrepresentable: 'any' },
  }),
);
// Any string is a target at the type level (the specification's `Target`);
// the runtime refuses what it does not support.
expectAssignable<StandardJSONSchemaOptions>({ target: 'mongodb' });
expectError(user['~standard'].jsonSchema.input({}));
expectError(
  user['~standard'].jsonSchema.input({ target: 'draft-07', libraryOptions: { io: 'output' } }),
);
const { input } = user['~standard'].jsonSchema;
expectType<JSONSchema>(input({ target: 'draft-07' }));
const account = model.entities.get('Account')!;
expectAssignable<StandardJSONSchemaV1>(account);

expectAssignable<DefinitionErrorCode>('ERR_UNREPRESENTABLE');
