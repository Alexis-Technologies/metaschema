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
  CheckContext,
  DefinitionErrorCode,
  FieldType,
  Fields,
  FlatIssues,
  IssueCode,
  IssueOf,
  IssueTree,
  Kind,
  KindMetadata,
  Locale,
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
expectType<ValidationResult>(schema.check({}, { root: 'User', maxErrors: 3 }));
expectError(schema.check({}, { root: 'User', maxErrors: '3' }));
expectType<ValidationResult>(schema.check({}, { unknown: 'ignore' }));
expectType<ValidationResult>(schema.check({}, { root: '' }));
expectError(schema.check({}, { unknown: 'strip' }));
expectError(schema.check({}, 'User'));
expectError(schema.check({}, 'User', { maxErrors: 3 }));
expectType<ValidationResult>(schema.check({}, { root: 'User', messages: { required: () => 'x' } }));
expectType<ValidationResult>(schema.check({}, { root: 'User', messages: (issue) => issue.code }));
expectError(schema.check({}, { root: 'User', messages: 'uk' }));
expectAssignable<IssueCode>('required');
expectAssignable<ValidationIssue['code']>('my-own-code');
expectType<PropertyKey[]>(schema.check({}).issues[0].path);
expectType<string>(schema.check({}).issues[0].message);
const issue = schema.check({}).issues[0];
// A validator may use a code of its own, so a known code narrows the params
// only through IssueOf.
if (issue.code === 'format') expectType<Record<string, unknown>>(issue.params);
const typed = issue as IssueOf<'type'>;
expectType<string>(typed.params.expected);
expectType<string>(typed.params.received);
expectType<PropertyKey | undefined>(typed.params.key);
expectType<number>((issue as IssueOf<'length'>).params.actual);
expectType<string[]>((issue as IssueOf<'unexpected'>).params.keys);
expectType<unknown[]>((issue as IssueOf<'enum'>).params.values);
expectType<string>((issue as IssueOf<'reference'>).params.entity);
expectType<Record<string, unknown>>((issue as IssueOf<'custom'>).params);
expectError<IssueOf<'nope'>>(issue);
expectType<string[]>(schema.check({}).errors);
expectType<string>(schema.check({}).summary);
expectType<FlatIssues>(schema.check({}).flatten());
expectType<IssueTree>(schema.check({}).tree());
expectType<Record<string, string[]>>(schema.check({}).flatten().fieldErrors);
const locale: Locale = {
  field: (path) => `Поле "${path}"`,
  required: () => 'required',
  type: ({ expected }) => expected,
  length: ({ min, max, actual }) => `${min} ${max} ${actual}`,
};
expectType<ValidationResult>(schema.check({}, { root: 'User', messages: locale }));
expectError<Locale>({ required: () => 1 });
const field = schema.fields.name as FieldType;
expectType<void>(field.check('x', {} as CheckContext));
expectType<ValidationResult | null>(schema.validate({}, 'User'));
expectType<ValidationResult | null>(schema.validate({}));
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

const result = new ValidationResult({ root: 'User' });
expectType<ValidationResult>(new ValidationResult());
expectError(new ValidationResult('User'));
expectType<ValidationResult>(result.add('message').add(false).add(['a', 'b']).add(null));
expectType<ValidationResult>(result.add({ code: 'format', message: 'needs an @' }, 'type'));
expectType<ValidationResult>(result.add({ message: 'at', path: ['a', 0], params: { n: 1 } }));
expectType<ValidationResult>(result.add({ message: 'at', path: 'a' }));
expectType<ValidationIssue[]>(ValidationResult.issuesOf('message', ['User'], 'custom'));
expectError(ValidationResult.issuesOf('message', 'User'));
expectType<boolean>(result.valid);
expectError((result.valid = true));
expectType<boolean>(ValidationResult.isInstance(result));

const error = new SchemaDefinitionError('ERR_UNKNOWN_TYPE', 'Unknown type "strng"');
expectAssignable<TypeError>(error);
expectType<DefinitionErrorCode>(error.code);
expectType<string>(error.schema);
expectType<string>(error.field);
expectType<SchemaDefinitionError>(error.locate('Order', 'total'));
expectError(new SchemaDefinitionError('ERR_NOPE', 'x'));
