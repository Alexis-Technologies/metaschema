import type {
  Compatibility,
  Infer,
  MergeOptions,
  Model,
  ModelSnapshot,
  RestoredModel,
  RestoreOptions,
  SampleOptions,
  Schema,
  SchemaChange,
} from '../../index.js';

// The model of a snapshot (`model.toJSON()`), with placeholders for the
// functions, listed by path in `placeholders`; `options.types` brings the
// real custom types, the registry is 'isolated' unless `options.registry`
// says otherwise (a shared one takes no placeholder type). A snapshot that
// does not read is `ERR_INVALID_SNAPSHOT`, located in its entity.
export function fromJSON(snapshot: ModelSnapshot, options?: RestoreOptions): RestoredModel;

// The changes from `prev` to `next`, each a Model or a snapshot: the
// entities of `next` in their order (added, or their changes: fields,
// indexes, relations), the entities that are gone, then the types.
export function diff(prev: Model | ModelSnapshot, next: Model | ModelSnapshot): SchemaChange[];

// The compatibility class of a list of changes by the rules of the Confluent
// Schema Registry: 'backward' when a reader with the new model reads data
// written with the old one, 'forward' the other way, 'full' when both,
// 'none' when neither.
export function compatibility(changes: SchemaChange[]): Compatibility;

// The compatibility class of one change, by the same rules: what to filter
// a list of changes by.
export function compatibilityOf(change: SchemaChange): Compatibility;

// A value the schema accepts, the same for a seed: every field is drawn
// from its definition and verified with its own check. A definition no
// value satisfies is `ERR_UNSATISFIABLE`, a pattern the sampler cannot read
// `ERR_SAMPLE_PATTERN`, a custom type without `metadata.sample`
// `ERR_SAMPLE_TYPE`.
export function sample<D extends string | object>(
  schema: Schema<D>,
  options?: SampleOptions,
): Infer<D>;

// The schema both schemas describe, by unification: a field in both takes
// the constraints of both, a field in one comes as it is, and what no value
// can satisfy (two types, two patterns, bounds with nothing in common, two
// defaults) is `ERR_MERGE_CONFLICT` with the field. The kind, its metadata
// and the name are the first schema's unless the options say otherwise.
export function merge(a: Schema, b: Schema, options?: MergeOptions): Schema;

// Installs `Model.fromJSON`, `Model.diff`, `Model.compatibility`,
// `Model.compatibilityOf`, `Schema.merge` and `schema.sample`. Once per
// process; later calls do nothing.
export function register(): void;
