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
  SchemaDefinitionError,
  SCOPE,
  STORE,
  ValidationResult,
} from '../../index.js';
import type {
  Cardinality,
  DefinitionErrorCode,
  FieldType,
  Fields,
  IssueCode,
  Kind,
  KindMetadata,
  Relation,
  Scope,
  TypeEntry,
  TypeTable,
  ValidationIssue,
} from '../../index.js';

expectType<Array<string>>(KIND);
expectType<Array<string>>(KIND_STORED);
expectType<Array<string>>(KIND_MEMORY);
expectType<Array<string>>(SCOPE);
expectType<Array<string>>(STORE);
expectType<Array<string>>(ALLOW);

expectType<{ defs: Record<string, unknown>; metadata: KindMetadata }>(getKindMetadata('entity'));
expectType<KindMetadata>(getKindMetadata('customKind').metadata);
expectAssignable<Kind>('customKind');
expectAssignable<Kind>('entity');
expectError(getKindMetadata(42));

const schema = Schema.from({ name: 'string', age: '?number' });
expectType<Schema>(schema);
expectType<Schema>(Schema.from('string'));
expectType<Schema>(Schema.from(['string', 'number']));
expectType<Schema>(new Schema('User', { name: 'string' }));
expectType<Schema | null>(Schema.extractSchema({}));

expectType<ValidationResult>(schema.check({ name: 'Marcus' }));
expectType<boolean>(schema.check({}).valid);
expectType<string[]>(schema.check({}).errors);
expectType<ValidationIssue[]>(schema.check({}).issues);
expectType<ValidationResult>(schema.check({}, 'User', { maxErrors: 3 }));
expectError(schema.check({}, 'User', { maxErrors: '3' }));
expectAssignable<IssueCode>('required');
expectAssignable<ValidationIssue['code']>('my-own-code');
expectType<ValidationResult | null>(schema.validate({}, 'User'));
expectType<Schema | null>(schema.findReference('Company'));
expectType<string>(schema.toInterface());
expectType<Kind>(schema.kind);
expectType<Scope>(schema.scope);
expectType<Set<Relation>>(schema.relations);
expectType<Fields>(schema.fields);
expectType<FieldType | ((value: any) => unknown)>(schema.fields.name);
expectType<TypeTable>(schema.types);
expectAssignable<Cardinality>('one-to-many');
expectAssignable<Cardinality>('many-to-one');
expectError<Cardinality>('one-to-one');
expectError<Cardinality>('many-to-many');

expectError<Scope>('system');
expectAssignable<Scope>('application');

const types = { string: { metadata: { pg: 'varchar' } } };
const model = new Model(types, new Map([['Company', { Dictionary: {}, name: 'string' }]]));
expectType<Model>(model);
expectType<Model>(new Model(types, [['Company', { name: 'string' }]], null));
expectType<Map<string, Schema>>(model.entities);
expectType<Record<string, unknown> | null>(model.database);
expectType<TypeTable>(model.types);
const entries: Record<string, TypeEntry> = {
  datetime: { js: 'string', metadata: { pg: 'timestamp' } },
  hex: { kind: 'scalar', construct() {}, checkType: (value: string) => /^[0-9a-f]+$/.test(value) },
};
expectType<Model>(new Model(entries, []));
expectType<Model>(new Model(entries, [], null, { registry: 'isolated' }));
expectType<Model>(new Model(entries, [], null, { registry: 'shared' }));
expectError(new Model(entries, [], null, { registry: 'private' }));
expectError(new Model({ bad: 42 }, []));
expectType<string>(model.dts);

schema.attach(model);
schema.detach(model);
expectError(schema.detouch(model));

expectType<Promise<void>>(saveTypes('./model.d.ts', model));

const result = new ValidationResult('User');
expectType<ValidationResult>(result.add('message').add(false).add(['a', 'b']).add(null));
expectType<ValidationResult>(result.add({ code: 'format', message: 'needs an @' }, 'type'));
expectType<ValidationIssue[]>(ValidationResult.issuesOf('message', 'User', 'custom'));
expectType<boolean>(result.valid);
expectType<string[] | null>(ValidationResult.format('message', 'User'));
expectType<boolean>(ValidationResult.isInstance(result));

const error = new SchemaDefinitionError('ERR_UNKNOWN_TYPE', 'Unknown type "strng"');
expectAssignable<TypeError>(error);
expectType<DefinitionErrorCode>(error.code);
expectType<string>(error.schema);
expectType<string>(error.field);
expectType<SchemaDefinitionError>(error.locate('Order', 'total'));
expectError(new SchemaDefinitionError('ERR_NOPE', 'x'));
