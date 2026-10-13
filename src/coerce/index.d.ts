import type { CoerceOptions, FieldType, Schema } from '../../index.js';

// A converter: the value of a field of its type read from what the input
// gave, or the value itself when it cannot be read (the check then reports
// it as given). It never throws on purpose: a throw is taken as "cannot".
export type Coercion = (value: unknown, field: FieldType) => unknown;

// The converters by type name: the built-in ones (`string`, `number`,
// `integer`, `bigint`, `boolean`, `date`, `enum`, `array`, `set`, `map`) and
// the program's own, once `register()` ran.
export const COERCIONS: { readonly [name: string]: Coercion | undefined };

// The value with the conversions of the schema applied, and its defaults:
// the pass parse runs before its check with coercion on, nothing checked.
// The value given is never written to, and comes back itself when nothing
// changed. Needs `register()`: without it a conversion is a TypeError with
// `code: 'ERR_NOT_REGISTERED'`.
export function coerce(schema: Schema, value: unknown, options?: CoerceOptions): unknown;

// Fills the table with the built-in converters and the program's own, by
// type name, once per name and process-wide (another function under a
// registered name is `ERR_COERCION_REGISTERED`, a name that is not one of a
// type or an entry that is not a function `ERR_INVALID_COERCION`), and adds
// `schema.coerce(value, options)`. Importing the subpath registers nothing.
export function register(custom?: Record<string, Coercion>): void;
