import type {
  CheckOptions,
  InferOutput,
  Model,
  ParseOptions,
  ParseResult,
  Schema,
  TypeEntry,
  ValidationResult,
} from '../../index.js';

// What the subpath reads of the values of bson (4 to 6) or of the driver,
// which re-exports them; nothing is imported from either.
export interface ObjectIdLike {
  readonly _bsontype: 'ObjectId' | 'ObjectID';
  toHexString(): string;
}
export interface Decimal128Like {
  readonly _bsontype: 'Decimal128';
  toJSON(): unknown;
}
export interface BinaryLike {
  readonly _bsontype: 'Binary';
  toJSON(): unknown;
}

// The module of the driver (`require('mongodb')`) or of bson.
export interface BSONModule {
  ObjectId: new (hex: string) => ObjectIdLike;
  Decimal128?: { fromString(text: string): Decimal128Like };
  Binary?: { createFromBase64(text: string): BinaryLike };
}

// The BSON types, to give a model: `new Model({ ...types, ...own }, entities)`.
// A value is one by its `_bsontype` and a method, never by `instanceof`;
// `binary` takes a Uint8Array too.
export const types: {
  readonly objectId: TypeEntry;
  readonly decimal128: TypeEntry;
  readonly binary: TypeEntry;
};

// Keeps the module of the driver for the functions below and teaches
// `./coerce` the BSON types (a string of 24 hex digits is an ObjectId, a
// decimal string a Decimal128, base64 text a Binary). Once: another module
// after the first throws.
export function register(options: { bson: BSONModule }): void;

export interface DocumentOptions {
  // The ids of stored records and references as ObjectIds (the default) or
  // as the strings the program keeps.
  ids?: 'objectId' | 'string';
  // Which references are records (and so documents with their own `_id`)
  // and which ids, as in `check`.
  references?: 'kind' | 'embed' | 'id';
}

// The document of a value: its serializers run, the id field of a stored
// record moved to `_id` (left out when there is none, so that the database
// gives one), ids made ObjectIds, undefined values and calculated fields left
// out. Needs `register()`: `ERR_NOT_REGISTERED` otherwise.
export function toDocument(
  target: Schema,
  value: unknown,
  options?: DocumentOptions,
): Record<string, unknown>;

// The value of a document: `_id` back to the id field, ObjectIds to their hex
// strings, then `parse` with `coerce: true` unless the options say otherwise.
export function fromDocument<D extends string | object>(
  target: Schema<D>,
  document: unknown,
  options?: ParseOptions & Pick<DocumentOptions, 'references'>,
): ParseResult<InferOutput<D>>;
export function fromDocumentAsync<D extends string | object>(
  target: Schema<D>,
  document: unknown,
  options?: ParseOptions & Pick<DocumentOptions, 'references'>,
): Promise<ParseResult<InferOutput<D>>>;

// An index as `createIndexes` takes it.
export interface IndexDescription {
  key: Record<string, 1>;
  name?: string;
  unique?: true;
  sparse?: true;
}

// The indexes of a schema, or of every stored entity of a model by name.
export function indexesOf(target: Schema): IndexDescription[];
export function indexesOf(target: Model): Record<string, IndexDescription[]>;

// An update of the driver: operators and the dotted paths they act on.
export type UpdateOperator =
  | '$set'
  | '$setOnInsert'
  | '$unset'
  | '$inc'
  | '$mul'
  | '$min'
  | '$max'
  | '$currentDate'
  | '$push'
  | '$addToSet'
  | '$pull'
  | '$pullAll'
  | '$pop';
export type Update = { [O in UpdateOperator]?: Record<string, unknown> };

// The issues of an update against the schema: the field each path names,
// the value each operator sets, pushes or adds to it. The id of a stored
// record is set by `$setOnInsert` only.
export function checkUpdate(
  target: Schema,
  update: Update,
  options?: CheckOptions,
): ValidationResult;

// The update as the database takes it: the values serialized, their ids made
// ObjectIds, the id of the record as `_id`. Check it with `checkUpdate` first.
export function toUpdate(target: Schema, update: Update, options?: DocumentOptions): Update;

// `Infer` learns the BSON types once this file is loaded.
declare module '../../index.js' {
  interface CustomTypes {
    objectId: ObjectIdLike;
    decimal128: Decimal128Like;
    binary: BinaryLike | Uint8Array;
  }
}
