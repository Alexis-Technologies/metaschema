import { expectAssignable, expectError, expectType } from 'tsd';
import {
  ALLOW,
  getKindMetadata,
  KIND,
  KIND_MEMORY,
  KIND_STORED,
  Model,
  saveTypes,
  Schema,
  SCOPE,
  STORE,
} from '../../index.js';
import type { Kind, Relation, Scope, ValidationResult } from '../../index.js';

expectType<Array<string>>(KIND);
expectType<Array<string>>(KIND_STORED);
expectType<Array<string>>(KIND_MEMORY);
expectType<Array<string>>(SCOPE);
expectType<Array<string>>(STORE);
expectType<Array<string>>(ALLOW);

expectType<{ defs: object; metadata: object }>(getKindMetadata('entity'));
expectError(getKindMetadata('unknown-kind'));

const schema = Schema.from({ name: 'string', age: '?number' });
expectType<Schema>(schema);
expectType<Schema>(Schema.from('string'));
expectType<Schema>(Schema.from(['string', 'number']));
expectType<Schema>(new Schema('User', { name: 'string' }));
expectType<Schema | null>(Schema.extractSchema({}));

expectType<ValidationResult>(schema.check({ name: 'Marcus' }));
expectType<boolean>(schema.check({}).valid);
expectType<string[]>(schema.check({}).errors);
expectType<ValidationResult | null>(schema.validate({}, 'User'));
expectType<Schema | null>(schema.findReference('Company'));
expectType<string>(schema.toInterface());
expectType<Kind>(schema.kind);
expectType<Scope>(schema.scope);
expectType<Set<Relation>>(schema.relations);

expectError<Scope>('system');
expectAssignable<Scope>('application');

const types = { string: { metadata: { pg: 'varchar' } } };
const model = new Model(types, new Map([['Company', { Dictionary: {}, name: 'string' }]]));
expectType<Model>(model);
expectType<Model>(new Model(types, [['Company', { name: 'string' }]], null));
expectType<Map<string, Schema>>(model.entities);
expectType<object | null>(model.database);
expectType<string>(model.dts);

schema.attach(model);
schema.detach(model);
expectError(schema.detouch(model));

expectType<Promise<void>>(saveTypes('./model.d.ts', model));
