import { expectAssignable, expectError, expectType } from 'tsd';
import { Model, Schema, ValidationResult } from '../../index.js';
import type { Infer, JSONSchemaOptions, ParseResult, TypeEntry } from '../../index.js';
import {
  checkUpdate,
  fromDocument,
  fromDocumentAsync,
  indexesOf,
  register,
  toDocument,
  toUpdate,
  types,
} from '../../src/mongodb/index.js';
import type {
  BinaryLike,
  Decimal128Like,
  IndexDescription,
  ObjectIdLike,
  Update,
} from '../../src/mongodb/index.js';

declare const driver: {
  ObjectId: new (hex: string) => ObjectIdLike;
  Decimal128: { fromString(text: string): Decimal128Like };
};
expectType<void>(register({ bson: driver }));
expectError(register({ bson: 'mongodb' }));
expectError(register());
expectType<TypeEntry>(types.objectId);
const model = new Model({ ...types }, new Map());

// Infer learns the BSON types.
expectType<ObjectIdLike>({} as Infer<'objectId'>);
expectType<Decimal128Like>({} as Infer<'decimal128'>);
expectType<BinaryLike | Uint8Array>({} as Infer<'binary'>);
expectType<{ owner: ObjectIdLike; note?: string | null | undefined }>(
  {} as Infer<{ owner: 'objectId'; 'note?': 'string' }>,
);

const account = Schema.from({ Entity: {}, login: 'string', owner: 'objectId' });
expectType<Record<string, unknown>>(toDocument(account, {}, { ids: 'string', references: 'kind' }));
expectError(toDocument(account, {}, { ids: 'uuid' }));
expectType<ParseResult<{ login: string; owner: ObjectIdLike }>>(fromDocument(account, {}));
expectType<Promise<ParseResult<{ login: string; owner: ObjectIdLike }>>>(
  fromDocumentAsync(account, {}, { unknown: 'strip', references: 'embed' }),
);

expectType<IndexDescription[]>(indexesOf(account));
expectType<Record<string, IndexDescription[]>>(indexesOf(model));
expectAssignable<IndexDescription>({ key: { 'address.city': 1 }, unique: true, sparse: true });

const update: Update = { $set: { login: 'ann' }, $inc: { 'stats.visits': 1 } };
expectType<ValidationResult>(checkUpdate(account, update, { unknown: 'ignore', maxErrors: 1 }));
expectType<Update>(toUpdate(account, update, { ids: 'objectId' }));
expectError(checkUpdate(account, { $rename: { a: 'b' } }));

expectAssignable<JSONSchemaOptions>({ target: 'mongodb', ids: 'objectId' });
expectError<JSONSchemaOptions>({ target: 'mongodb', ids: 'uuid' });
