import type {
  Compatibility,
  Model,
  ModelSnapshot,
  RestoreOptions,
  SchemaChange,
} from '../../index.js';

// The model of a snapshot (`model.toJSON()`), with placeholders for the
// functions; `options.types` brings the real custom types, the registry is
// 'isolated' unless `options.registry` says otherwise.
export function fromJSON(snapshot: ModelSnapshot, options?: RestoreOptions): Model;

// The changes from `prev` to `next`, each a Model or a snapshot: the
// entities of `next` in their order (added, or their changes: fields,
// indexes, relations), the entities that are gone, then the types.
export function diff(prev: Model | ModelSnapshot, next: Model | ModelSnapshot): SchemaChange[];

// The compatibility class of a list of changes by the rules of the Confluent
// Schema Registry: 'backward' when a reader with the new model reads data
// written with the old one, 'forward' the other way, 'full' when both,
// 'none' when neither.
export function compatibility(changes: SchemaChange[]): Compatibility;

// Installs `Model.fromJSON`, `Model.diff` and `Model.compatibility`. Once per
// process; later calls do nothing.
export function register(): void;
