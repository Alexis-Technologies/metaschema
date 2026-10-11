import { expectAssignable, expectError, expectType } from 'tsd';
import { Model } from '../../index.js';
import { compatibility, diff, fromJSON, register } from '../../src/model/index.js';
import type {
  ChangeKind,
  ChangeOp,
  Compatibility,
  DefinitionErrorCode,
  ModelSnapshot,
  RestoreOptions,
  SchemaChange,
} from '../../index.js';

declare const model: Model;
const snapshot = model.toJSON();

// The functions of the subpath take Models or snapshots.
expectType<void>(register());
expectType<Model>(fromJSON(snapshot));
expectType<Model>(fromJSON(snapshot, { registry: 'shared', types: { money: { js: 'number' } } }));
expectAssignable<RestoreOptions>({});
expectError(fromJSON(snapshot, { registry: 'private' }));
expectError(fromJSON({ format: 2, database: null, types: {}, entities: {} }));
expectType<SchemaChange[]>(diff(model, snapshot));
expectType<SchemaChange[]>(diff(snapshot, model));
expectError(diff(model, { name: 'string' }));
expectType<Compatibility>(compatibility(diff(model, model)));
expectError(compatibility(model));

// A change and its parts.
const change = diff(model, model)[0];
expectType<ChangeKind>(change.kind);
expectType<ChangeOp>(change.op);
expectType<string>(change.entity);
expectType<string>(change.name);
expectType<unknown>(change.from);
expectType<string[] | undefined>(change.detail?.keys);
expectType<string | undefined>(change.detail?.renamed);
expectType<true | undefined>(change.detail?.deprecated);
expectAssignable<Compatibility>('backward');
expectAssignable<DefinitionErrorCode>('ERR_INVALID_SNAPSHOT');

// The statics register() installs.
expectType<Model>(Model.fromJSON(snapshot, { types: {} }));
expectType<SchemaChange[]>(Model.diff(snapshot, model));
expectType<Compatibility>(Model.compatibility([]));
expectType<ModelSnapshot>(Model.fromJSON(snapshot).toJSON());

// sample: the type of a value the schema accepts, and its options.
import { sample } from '../../src/model/index.js';
import { Schema } from '../../index.js';
import type { SampleOptions } from '../../index.js';
const user = Schema.from({ name: 'string', age: '?number' });
expectType<{ name: string; age?: number | null | undefined }>(sample(user));
expectType<{ name: string; age?: number | null | undefined }>(user.sample({ seed: 2 }));
expectAssignable<SampleOptions>({ seed: 1, locale: 'uk', references: 'embed', maxDepth: 2 });
expectError(sample(user, { locale: 'fr' }));
expectError(sample({ name: 'string' }));
expectAssignable<DefinitionErrorCode>('ERR_UNSATISFIABLE');
expectAssignable<DefinitionErrorCode>('ERR_SAMPLE_PATTERN');

// merge: a Schema from two, with the options.
import { merge } from '../../src/model/index.js';
import type { MergeOptions } from '../../index.js';
expectType<Schema>(merge(user, user));
expectType<Schema>(
  merge(user, user, { name: 'Merged', metadata: { kind: 'entity', scope: 'global' } }),
);
expectType<Schema>(Schema.merge(user, user));
expectAssignable<MergeOptions>({});
expectError(merge(user, { name: 'string' }));
expectError(merge(user, user, { name: 1 }));
expectAssignable<DefinitionErrorCode>('ERR_MERGE_CONFLICT');
