import { expectAssignable, expectError, expectType } from 'tsd';
import { Model, Schema } from '../../index.js';
import type {
  DefinitionErrorCode,
  JSONSchema,
  JSONSchemaOptions,
  JSONSchemaTarget,
  ModelJSONSchemaOptions,
} from '../../index.js';

const user = Schema.from({ name: 'string', age: '?number' });

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

expectAssignable<DefinitionErrorCode>('ERR_UNREPRESENTABLE');
