import { expectAssignable, expectError, expectType } from 'tsd';
import { Model } from '../../index.js';
import { compatibility, compatibilityOf, diff, fromJSON, register } from '../../src/model/index.js';
import type {
  ChangeKind,
  ChangeOp,
  Compatibility,
  DefinitionErrorCode,
  ModelSnapshot,
  RestoredModel,
  RestoreOptions,
  SchemaChange,
  TypeEntry,
} from '../../index.js';

declare const model: Model;
const snapshot = model.toJSON();

// The functions of the subpath take Models or snapshots.
expectType<void>(register());
expectType<RestoredModel>(fromJSON(snapshot));
expectAssignable<Model>(fromJSON(snapshot));
expectType<RestoredModel>(
  fromJSON(snapshot, { registry: 'shared', types: { money: { js: 'number' } } }),
);
expectAssignable<RestoreOptions>({});
expectError(fromJSON(snapshot, { registry: 'private' }));
expectError(fromJSON({ format: 2, database: null, types: {}, entities: {} }));
expectType<SchemaChange[]>(diff(model, snapshot));
expectType<SchemaChange[]>(diff(snapshot, model));
expectError(diff(model, { name: 'string' }));
expectType<Compatibility>(compatibility(diff(model, model)));
expectError(compatibility(model));

// A restored model lists its placeholders, read-only.
const restored = fromJSON(snapshot);
expectType<string[]>(restored.placeholders);
expectError((restored.placeholders = []));
expectType<ModelSnapshot>(restored.toJSON());

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
expectType<Compatibility>(compatibilityOf(change));
expectError(compatibilityOf([change]));
expectAssignable<Compatibility>('backward');
expectAssignable<DefinitionErrorCode>('ERR_INVALID_SNAPSHOT');

// The statics register() installs.
expectType<RestoredModel>(Model.fromJSON(snapshot, { types: {} }));
expectType<SchemaChange[]>(Model.diff(snapshot, model));
expectType<Compatibility>(Model.compatibility([]));
expectType<Compatibility>(Model.compatibilityOf(change));
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

// The `metadata.sample` hook of a custom type: a value, or a function of
// the field and the seeded generator, typed where it is written.
expectAssignable<TypeEntry>({ metadata: { sample: 'ffffff' } });
expectAssignable<TypeEntry>({
  metadata: { sample: (field, random) => `${field.type}${random()}` },
});
expectAssignable<TypeEntry>({ metadata: { pg: 'money' } });
expectAssignable<TypeEntry>({
  metadata: {
    sample(field, random) {
      expectType<string>(field.type);
      expectType<number>(random());
      return 1;
    },
  },
});

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

// infer: a definition from samples, or a Schema, with the options.
import { infer } from '../../src/model/index.js';
import type { InferOptions } from '../../index.js';
expectType<object | string>(infer([{ name: 'x' }]));
expectType<Schema>(infer([{ name: 'x' }], { as: 'schema', name: 'User' }));
expectType<Schema>(Schema.infer(new Set([1, 2]), { as: 'schema' }));
expectType<object | string>(Schema.infer([1, 2]));
expectAssignable<InferOptions>({
  kind: 'entity',
  enum: false,
  integer: false,
  map: 32,
  maxDepth: 8,
  formats: false,
});
expectError(infer(1));
expectError(infer([1], { formats: 'no' }));
expectError(infer([1], { as: 'json' }));
expectError(infer([1], { enum: 'many' }));
expectAssignable<DefinitionErrorCode>('ERR_INFER_DEPTH');
expectAssignable<DefinitionErrorCode>('ERR_INFER_MISMATCH');
