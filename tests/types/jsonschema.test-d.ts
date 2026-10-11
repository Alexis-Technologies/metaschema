import { expectAssignable, expectError, expectType } from 'tsd';
import type { StandardJSONSchemaV1 } from '@standard-schema/spec';
import { Model, Schema } from '../../index.js';
import {
  fromJSONSchema,
  register,
  saveTypes,
  toJSONSchema,
  toTypeScript,
} from '../../src/generators/index.js';
import type {
  DefinitionErrorCode,
  FromJSONSchemaOptions,
  InferSchema,
  InterfaceOptions,
  JSONSchema,
  JSONSchemaOptions,
  JSONSchemaTarget,
  ModelJSONSchemaOptions,
  StandardConverter,
  StandardJSONSchemaOptions,
} from '../../index.js';

const user = Schema.from({ name: 'string', age: '?number' });
type User = InferSchema<typeof user>;

// The functions of the subpath take a Schema or a Model.
expectType<void>(register());
expectType<JSONSchema>(toJSONSchema(user));
expectType<JSONSchema>(toJSONSchema(user, { target: 'openapi-3.0', profile: 'strict' }));
expectError(toJSONSchema(user, { root: 'User' }));
expectError(toJSONSchema({ name: 'string' }));
expectType<string>(toTypeScript(user));
expectType<string>(toTypeScript(user, { named: true }));
expectError(toTypeScript(user, { named: 1 }));

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
expectType<JSONSchema>(toJSONSchema(model));
expectType<JSONSchema>(toJSONSchema(model, { root: 'User', target: 'mongodb' }));
expectType<string>(toTypeScript(model, { named: true }));
expectType<Promise<void>>(saveTypes('./model.d.ts', model));
expectType<Promise<void>>(saveTypes('./model.d.ts', user, { named: true }));
expectError(saveTypes('./model.d.ts', { name: 'string' }));
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

// The import of a JSON Schema document: a definition, or a Schema.
expectType<object | string>(fromJSONSchema({ type: 'string' }));
expectType<object | string>(fromJSONSchema(true, { references: 'name', unsupported: 'ignore' }));
expectType<Schema>(fromJSONSchema({ type: 'object' }, { as: 'schema', name: 'User' }));
expectType<Schema>(Schema.fromJSONSchema({ type: 'object' }, { as: 'schema' }));
expectType<object | string>(Schema.fromJSONSchema({ type: 'object' }));
expectAssignable<FromJSONSchemaOptions>({ as: 'definition' });
expectAssignable<FromJSONSchemaOptions>({
  unsupported: 'ignore',
  onUnsupported: (reason: string, pointer: string) => {
    expectType<string>(reason);
    expectType<string>(pointer);
  },
});
expectError(fromJSONSchema({ type: 'string' }, { as: 'model' }));
expectError(fromJSONSchema({ type: 'string' }, { onUnsupported: 'log' }));
expectError(fromJSONSchema('string'));
expectAssignable<DefinitionErrorCode>('ERR_UNSUPPORTED_SCHEMA');

// The dts options.
expectType<string>(user.toInterface());
expectType<string>(user.toInterface({ named: true }));
expectError(user.toInterface({ named: 'yes' }));
expectType<string>(model.toTypeScript());
expectType<string>(model.toTypeScript({ named: true }));
expectType<string>(model.dts);
expectType<Promise<void>>(saveTypes('./model.d.ts', model, { named: true }));
expectAssignable<InterfaceOptions>({});
expectAssignable<DefinitionErrorCode>('ERR_UNREPRESENTABLE');
