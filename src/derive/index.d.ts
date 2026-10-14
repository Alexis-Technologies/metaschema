import type {
  DeriveKeyOf,
  DeriveOptions,
  DerivedSchema,
  ExtendDefinition,
  ExtendedSchema,
  KeyofDefinition,
  OmitDefinition,
  PartialDefinition,
  PartialOptions,
  PickDefinition,
  RequiredDefinition,
  RequiredOptions,
  Schema,
  StructGuardOf,
} from '../../index.js';

// Schemas made from a schema of a struct. Each builds a new Schema from the
// definition the source was built from: the source is never changed. A
// stored kind or a projection becomes a struct (without the id of the kind,
// unless the call names it), a memory kind keeps its metadata, the name is
// the source's unless `options.name`. A key the schema has no field of is
// `ERR_UNKNOWN_FIELD`, located in the schema; anything but a Schema of a
// struct is `ERR_INVALID_TARGET`.

// The fields named, in the order of the schema. The schema's own functions
// do not come along.
export function pick<
  D extends string | object,
  const K extends readonly DeriveKeyOf<D>[],
  const O extends DeriveOptions = {},
>(
  schema: Schema<D> & StructGuardOf<D>,
  keys: K,
  options?: O,
): DerivedSchema<D, PickDefinition<D, K[number], O>>;

// Every field but the ones named.
export function omit<
  D extends string | object,
  const K extends readonly DeriveKeyOf<D>[],
  const O extends DeriveOptions = {},
>(
  schema: Schema<D> & StructGuardOf<D>,
  keys: K,
  options?: O,
): DerivedSchema<D, OmitDefinition<D, K[number], O>>;

// Every field (or the ones in `options.keys`) optional, without its default
// unless `defaults: true`; `deep` goes into nested structs, not into
// collections, tuples, unions or references.
export function partial<
  D extends string | object,
  const O extends PartialOptions<DeriveKeyOf<D>> = {},
>(schema: Schema<D> & StructGuardOf<D>, options?: O): DerivedSchema<D, PartialDefinition<D, O>>;

// Every field (or the ones in `options.keys`) required; the defaults stay.
export function required<
  D extends string | object,
  const O extends RequiredOptions<DeriveKeyOf<D>> = {},
>(schema: Schema<D> & StructGuardOf<D>, options?: O): DerivedSchema<D, RequiredDefinition<D, O>>;

// The fields of the extension (an object of fields, or a Schema of a
// struct) over the schema's: one of the same name takes the place of the
// schema's, the others come after. `merge` of `./model` unifies instead. An
// extension whose definition is not known (an entity of a model) gives a
// `Schema` of an unknown one, as a source whose definition is not known does.
export function extend<
  D extends string | object,
  const X extends object,
  const O extends DeriveOptions = {},
>(
  schema: Schema<D> & StructGuardOf<D>,
  extension: X,
  options?: O,
): ExtendedSchema<D, X, ExtendDefinition<D, X, O>>;

// The names of the fields a value carries, as a schema of an enum.
export function keyof<D extends string | object>(
  schema: Schema<D> & StructGuardOf<D>,
  options?: DeriveOptions,
): DerivedSchema<D, KeyofDefinition<D>>;

// Adds the six as methods of Schema (`schema.omit(['id']).partial()`), not
// enumerable. Once per process; importing the subpath registers nothing.
export function register(): void;
