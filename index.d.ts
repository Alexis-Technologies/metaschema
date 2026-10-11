export type Scope = 'global' | 'local' | 'application';

export type Allow = 'read' | 'write' | 'append';

export type Store = 'persistent' | 'memory';

export type KnownKind =
  | 'dictionary'
  | 'registry'
  | 'entity'
  | 'details'
  | 'relation'
  | 'form'
  | 'view'
  | 'projection'
  | 'journal'
  | 'struct'
  | 'scalar';

// A capitalized first key that is not a known kind is a custom kind; the
// intersection keeps the known names in completions.
export type Kind = KnownKind | (string & {});

export type Cardinality = 'one-to-many' | 'many-to-one';

export interface Relation {
  to: string;
  type: Cardinality;
}

// Codes of the issues the library produces; a validator may use its own.
export type IssueCode =
  | 'required'
  | 'type'
  | 'unexpected'
  | 'enum'
  | 'length'
  | 'range'
  | 'pattern'
  | 'union'
  | 'reference'
  | 'circular'
  | 'depth'
  | 'exception'
  | 'custom';

// The params of the issues the library produces, by code.
export interface IssueParams {
  required: {};
  // `key` is set when a key of an `object` or `map`, not a value, has the wrong type.
  type: { expected: string; received: string; key?: PropertyKey };
  unexpected: { keys: string[] };
  enum: { values: unknown[] };
  length: { min: number | undefined; max: number | undefined; actual: number };
  // A `min`/`max` rule failed; the bounds are what the definition gave.
  range: { min: number | bigint | undefined; max: number | bigint | undefined; actual: number | bigint };
  // The source of the pattern the string did not match.
  pattern: { pattern: string };
  // No branch of a union matched: the branch names, or the discriminator
  // values when the union has a discriminator (the path then ends with it).
  union: { expected: unknown[]; discriminator: string | undefined };
  reference: { entity: string };
  circular: {};
  depth: { max: number };
  exception: { error: unknown };
  // A validator's own issue carries the params it gave, if any.
  custom: Record<string, unknown>;
}

// An issue is data: the code, the path of keys from the root of the value, the
// message about the problem (without the location) and the params the message
// was rendered from. A validator's own issue carries the code and params it
// gave; `IssueOf<Code>` is the issue of one of the library's codes.
export type ValidationIssue =
  | {
      [Code in IssueCode]: {
        code: Code;
        path: PropertyKey[];
        message: string;
        params: IssueParams[Code];
      };
    }[IssueCode]
  | { code: string; path: PropertyKey[]; message: string; params: Record<string, unknown> };

export type IssueOf<Code extends IssueCode> = Extract<ValidationIssue, { code: Code }>;

// What a validator may return: an issue of its own needs only a message. Its
// path is relative to the field the validator belongs to.
export interface IssueInput {
  code?: string;
  path?: PropertyKey | PropertyKey[];
  message: string;
  params?: Record<string, unknown>;
}

export type ValidationReturn =
  | boolean
  | string
  | IssueInput
  | Array<string | IssueInput>
  | ValidationResult
  | null
  | undefined
  | void;

// The messages of a locale: a renderer per issue code, from the params of the
// issue to the text that follows the field, and `field` for the location
// prefix of an error line. A partial table falls back to English.
export type Locale = {
  [Code in IssueCode]?: (params: IssueParams[Code], issue?: ValidationIssue) => string;
} & {
  field?: (path: string) => string;
};

export type Messages = Locale | ((issue: ValidationIssue) => string);

export interface CheckOptions {
  // The label the error lines start with: the schema name by default, '' for
  // none. Issue paths are relative to the value and do not include it.
  root?: string;
  // Stop collecting after this many issues (at least 1).
  maxErrors?: number;
  // How deep a value may nest through embedded references (an integer of at
  // least 1, 128 by default): a record deeper than that is a `depth` issue.
  maxDepth?: number;
  // What to do with keys the schema does not have: report them as one
  // `unexpected` issue per struct, or ignore them. The default is the
  // schema's own `unknown` metadata, 'reject' unless it says otherwise.
  unknown?: 'reject' | 'ignore';
  // How a reference is checked: as its target's kind says ('kind', the
  // default: a stored kind as an id, a memory kind as the record), every
  // reference as the record ('embed') or every reference as an id ('id').
  references?: 'kind' | 'embed' | 'id';
  // The locale of the messages, or a function that renders every message.
  messages?: Messages;
}

// The options of parse: those of check, and `strip` for the keys the schema
// does not have, which the output then leaves out.
export interface ParseOptions extends Omit<CheckOptions, 'unknown'> {
  unknown?: 'reject' | 'ignore' | 'strip';
}

// What parse returns: the output only for a valid value, the issues always.
export type ParseResult<T> =
  | { valid: true; value: T; issues: [] }
  | { valid: false; value: undefined; issues: ValidationIssue[] };

// The options of serialize: `check` validates the result with the other
// options as the options of check.
export interface SerializeOptions extends CheckOptions {
  check?: boolean;
}

export interface Serialized<T> {
  value: T;
}

export interface SerializeChecked<T> {
  valid: boolean;
  value: T;
  issues: ValidationIssue[];
}

export interface ResultOptions {
  // The label the error lines start with (the schema name in a check).
  root?: string;
  messages?: Messages;
}

// Messages by dotted path: `formErrors` for the value itself, `fieldErrors`
// for its fields.
export interface FlatIssues {
  formErrors: string[];
  fieldErrors: Record<string, string[]>;
}

// Messages as a tree that follows the value.
export interface IssueTree {
  errors: string[];
  properties?: Record<string, IssueTree>;
  items?: IssueTree[];
}

export class ValidationResult {
  issues: ValidationIssue[];
  readonly valid: boolean;
  // The messages with their location, rendered on first use.
  readonly errors: string[];
  readonly summary: string;
  constructor(options?: ResultOptions);
  add(error: ValidationReturn, code?: IssueCode): this;
  flatten(): FlatIssues;
  tree(): IssueTree;
  static issuesOf(error: ValidationReturn, path?: PropertyKey[], code?: IssueCode): ValidationIssue[];
  static isInstance(error: unknown): boolean;
}

// The state of one check, threaded through the `check` of every field.
export interface CheckContext {
  issues: ValidationIssue[];
  count: number;
  limit: number;
  // How many embedded records the check is inside, and how many it may be
  // before a record is a `depth` issue (128 by default).
  depth: number;
  maxDepth: number;
  path: PropertyKey[];
  seen: Set<object> | null;
  // The value the check started from, when the schema can reach it again
  // through a reference; null otherwise.
  source: unknown;
  // 'strip' in a parse, where the check behind it treats it as 'ignore'.
  unknown: 'reject' | 'ignore' | 'strip';
  references: 'kind' | 'embed' | 'id';
  root: string;
  messages: Messages;
  // The validators that returned a promise, settled after the walk by
  // checkAsync and parseAsync; null in a synchronous check.
  async: unknown[] | null;
  // The context parse tries the branches of a plain union in; null in a check.
  scratch: CheckContext | null;
}

// A validator may return a promise of its result to checkAsync and parseAsync;
// to check and parse a promise is a TypeError with the code ERR_ASYNC_VALIDATOR.
export type Validator = (value: any, path: string) => ValidationReturn | Promise<ValidationReturn>;

export type CalculatedField = (value: any) => unknown;

// A field of a struct: an instance of the type's class. Keys of the
// definition the type does not use (`unique`, `default`, ...) are kept on it.
export interface FieldType {
  readonly type: string;
  required: boolean;
  // The value may be null; the key is still required unless `required` is false.
  nullable?: boolean;
  // On a reference: check and render it as the record (true) or its id
  // (false) whatever the kind of its target.
  embed?: boolean;
  validate?: Validator;
  // The decoder parse runs on the validated value, and the serializer
  // serialize runs on the value of the program, when the definition gave them.
  parse?: (value: any) => unknown;
  serialize?: (value: any) => unknown;
  // What parse fills a missing key with: a value, or a function called for one.
  default?: unknown;
  // The keys the field is also read from, in a struct: check accepts a value
  // under an alias in place of the field's key, parse renames it. The keys
  // of the value the schema accepts (`Infer`) and the generated documents
  // name the field's own key only.
  aliases?: string[];
  // Records the problems of a value into the context of the current check.
  check(value: unknown, context: CheckContext): void;
  toJSON(): object;
  [key: string]: unknown;
}

export type Fields = Record<string, FieldType | CalculatedField>;

export interface TypeConstructor {
  readonly type: string;
  readonly kind: 'scalar' | 'struct';
  metadata: Record<string, unknown>;
  new (def: object, preprocessor: object): FieldType;
}

export type TypeTable = Record<string, TypeConstructor>;

// What `sample` of the `@alexify/metaschema/model` subpath draws for a
// custom type: the value `metadata.sample` holds, or what the function it
// holds returns for the field and the seeded generator of the draw.
export type SampleHook = (field: FieldType, random: () => number) => unknown;

// The metadata of a type: anything, read by the programs built on the
// model; `sample` is the one key the package reads (see `SampleHook`).
export interface TypeMetadata {
  sample?: SampleHook | {} | null;
  [key: string]: unknown;
}

// An entry of the table passed to Model: metadata for a built-in, an alias
// (`js`), or a prototype with its own `construct` and `checkType`.
export interface TypeEntry {
  js?: string;
  metadata?: TypeMetadata;
  kind?: 'scalar' | 'struct';
  // The rules the type accepts in a field definition (`length`, `min`, `max`).
  rules?: string[];
  construct?(def: object, preprocessor: object): void;
  checkType?(value: any, path: string): ValidationReturn | Promise<ValidationReturn>;
  [key: string]: unknown;
}

export interface ModelOptions {
  // 'shared' (the default) registers the types into the process-wide registry;
  // 'isolated' gives the model its own copy of the built-in types to register into.
  registry?: 'shared' | 'isolated';
}

export interface KindMetadata {
  kind: Kind;
  scope: Scope;
  store: Store;
  allow: Allow;
  parent?: string;
  // The default of `check` for keys the schema does not have.
  unknown?: 'reject' | 'ignore';
  [key: string]: unknown;
}

export interface SchemaOptions {
  validate: Validator | null;
  format: ((value: any) => unknown) | null;
  parse: ((value: any) => unknown) | null;
  serialize: ((value: any) => unknown) | null;
}

export type DefinitionErrorCode =
  | 'ERR_INVALID_DEFINITION'
  | 'ERR_UNKNOWN_TYPE'
  | 'ERR_MISSING_SCHEMA'
  | 'ERR_INVALID_TUPLE'
  | 'ERR_INVALID_UNION'
  | 'ERR_PROJECTION'
  | 'ERR_INVALID_CUSTOM_TYPE'
  | 'ERR_INVALID_ENUM'
  | 'ERR_INVALID_LENGTH'
  | 'ERR_INVALID_RULE'
  | 'ERR_INVALID_REFERENCE'
  | 'ERR_RESERVED_KEY'
  | 'ERR_TYPE_REGISTERED'
  | 'ERR_UNKNOWN_JS_TYPE'
  | 'ERR_INVALID_OPTIONS'
  | 'ERR_UNREPRESENTABLE'
  // Thrown by `fromJSONSchema` of the generators subpath for a keyword the
  // subset has no form for.
  | 'ERR_UNSUPPORTED_SCHEMA'
  // Thrown by `fromJSON` and `diff` of the `@alexify/metaschema/model`
  // subpath for a value that is not a snapshot of a model.
  | 'ERR_INVALID_SNAPSHOT'
  // Thrown by `sample` of the same subpath: a field no value satisfies, a
  // pattern it cannot read, a custom type without `metadata.sample`.
  | 'ERR_UNSATISFIABLE'
  | 'ERR_SAMPLE_PATTERN'
  | 'ERR_SAMPLE_TYPE'
  // Thrown by `merge` of the same subpath for what no value can satisfy.
  | 'ERR_MERGE_CONFLICT'
  // Thrown by `infer` of the same subpath: a sample nested deeper than
  // `maxDepth`, and a definition that rejects a sample it was inferred from
  // (a bug of the inference, to report).
  | 'ERR_INFER_DEPTH'
  | 'ERR_INFER_MISMATCH'
  // Thrown by `compile` and `register` of the `@alexify/metaschema/compile`
  // subpath with `jit: true` where code generation from strings is not allowed.
  | 'ERR_NO_EVAL'
  // The check of a schema could not be generated (the generator's error is the
  // `cause`): thrown with `jit: true`, reported as `error` and to `onFallback`
  // in the default mode.
  | 'ERR_JIT_BUILD';

export class SchemaDefinitionError extends TypeError {
  code: DefinitionErrorCode;
  schema: string;
  field: string;
  constructor(code: DefinitionErrorCode, reason: string);
  locate(schema: string, field: string): this;
}

// The code of the TypeError a synchronous check or parse throws when a
// validator, a custom checkType or a decoder returns a promise: the call,
// not the definition, is wrong, so it is a plain TypeError with `code`.
// `ERR_INVALID_TARGET` is the same kind of error from a function of a subpath
// given something other than what it takes (a Schema, a Model, a snapshot, a
// list of changes).
export type RuntimeErrorCode = 'ERR_ASYNC_VALIDATOR' | 'ERR_INVALID_TARGET' | 'ERR_INVALID_RECORD';

// ---------------------------------------------------------------------------
// The snapshot: `model.toJSON()`, what JSON.stringify(model) writes. The
// entities in dependency order with a fixed key order, the types the
// entities use, and the `database` metadata as given. A function is
// `{ $function: true }` wherever it stands, a bigint `{ $bigint }`, a Date
// `{ $date }`, a RegExp its source (or `{ source, flags }` with flags beyond
// `u`). `fromJSON` of the `@alexify/metaschema/model` subpath reads it back.
// ---------------------------------------------------------------------------

export interface FunctionSnapshot {
  $function: true;
}

// A field of a snapshot: its type and whether it is required first, then
// the other keys of its definition, sorted (a nested struct under `schema`,
// an element under `value`, branches under `union`).
export interface FieldSnapshot {
  type: string;
  required: boolean;
  [key: string]: unknown;
}

// The fields of a struct in their order: a calculated field, the validate,
// parse or serialize of the struct are `{ $function: true }`.
export type FieldsSnapshot = Record<string, FieldSnapshot | FunctionSnapshot>;

export interface EntitySnapshot {
  kind: Kind;
  scope: Scope;
  store: Store;
  allow: Allow;
  // The parent of a projection, '' otherwise.
  parent: string;
  unknown: 'reject' | 'ignore';
  // The other keys of the kind metadata, as given.
  custom: Record<string, unknown>;
  // A struct's fields, with the schema-level functions among them, or
  fields?: FieldsSnapshot;
  // the type of a schema of one type.
  type?: FieldSnapshot;
  // The index definitions (`index`, `primary`, `unique` lists), as given.
  indexes: Record<string, object>;
  relations: Relation[];
}

// A type the entities use: an alias of a built-in (`js`), a type with a
// check of its own (`check: true`, its kind), or a built-in with metadata.
export interface TypeSnapshot {
  js?: string;
  kind?: 'scalar' | 'struct';
  check?: true;
  metadata: Record<string, unknown>;
}

export interface ModelSnapshot {
  format: 1;
  database: Record<string, unknown> | null;
  types: Record<string, TypeSnapshot>;
  entities: Record<string, EntitySnapshot>;
}

// The options of `fromJSON` of the `@alexify/metaschema/model` subpath.
export interface RestoreOptions {
  // Entries of the table Model takes, over the types of the snapshot: the
  // real custom types, where the restored model should validate as the
  // original did.
  types?: Record<string, TypeEntry>;
  // 'isolated' (the default) gives the restored model its own registry, so
  // the placeholders of its custom types never reach the shared one; a
  // 'shared' registry takes no placeholder type (`ERR_INVALID_SNAPSHOT`
  // unless `types` brings the real one).
  registry?: 'shared' | 'isolated';
}

// A model restored by `fromJSON`: a Model that lists the paths of the
// placeholders standing in for the functions of the snapshot (`Order.validate`,
// `Order.total` for a calculated field, `Order.address.parse`, `Order.when.default`,
// `types.hex.checkType`), invisibly to `toJSON`.
export interface RestoredModel extends Model {
  readonly placeholders: string[];
}

// ---------------------------------------------------------------------------
// The evolution of a model: `diff` and `compatibility` of the
// `@alexify/metaschema/model` subpath.
// ---------------------------------------------------------------------------

export type ChangeKind = 'entity' | 'field' | 'index' | 'relation' | 'type';

export type ChangeOp = 'added' | 'removed' | 'changed' | 'renamed';

// One change between two versions of a model: what changed (`kind`), how
// (`op`), in which entity ('' for a type), under which name (the entity, the
// field, the index, the target of a relation, the type), what it was
// (`from`) and is (`to`), and the detail: the keys that differ for a
// `changed` entity, field, index or type; the old key (`renamed`) and the
// keys that differ beyond `aliases` for a field renamed through an alias;
// `deprecated: true` for a removed field that was marked so.
export interface SchemaChange {
  kind: ChangeKind;
  op: ChangeOp;
  entity: string;
  name: string;
  from?: unknown;
  to?: unknown;
  detail?: { keys?: string[]; renamed?: string; deprecated?: true };
}

// 'backward': a reader with the new model reads data written with the old
// one; 'forward': a reader with the old model reads data written with the
// new one; 'full': both; 'none': neither.
export type Compatibility = 'full' | 'backward' | 'forward' | 'none';

// The options of `merge` of the `@alexify/metaschema/model` subpath.
export interface MergeOptions {
  // The name of the merged schema: the first schema's by default.
  name?: string;
  // The kind metadata of the merged schema, over the first schema's: `kind`,
  // `scope`, `store`, `allow`, `unknown` and any other key.
  metadata?: Partial<KindMetadata>;
}

// The options of `infer` of the `@alexify/metaschema/model` subpath (the
// name sits beside the type `Infer<D>`: the function reads samples, the type
// reads a definition).
export interface InferOptions {
  // What comes back: the definition ('definition', the default), or a Schema
  // built from it ('schema').
  as?: 'definition' | 'schema';
  // The name of the Schema, and of the error locations ('').
  name?: string;
  // The kind of a root that is a struct ('struct'); a stored kind adds its
  // id field, which wins over an inferred field of that name.
  kind?: string;
  // The most distinct strings a place may hold to be an enum (8), each
  // value seen twice on average over at least four samples; 0 or false never.
  enum?: number | false;
  // Whether whole numbers are `integer` (true) rather than `number`.
  integer?: boolean;
  // The distinct keys past which records of a place read as a dictionary
  // (16) when every key is missing from some record and the values are of
  // one kind; keys that are not names are a dictionary from one sample on;
  // false keeps every record a struct.
  map?: number | false;
  // How deep a sample may nest (128, the most); past it `ERR_INFER_DEPTH`.
  maxDepth?: number;
}

// The options of `sample` of the `@alexify/metaschema/model` subpath.
export interface SampleOptions {
  // The seed of the generator (1): the same seed gives the same value.
  seed?: number;
  // The letters of free strings: 'en' (the default) or 'uk'.
  locale?: 'en' | 'uk';
  // How a reference is held, as in check: an id for a stored kind and the
  // record for a memory kind ('kind', the default), always the record
  // ('embed'), always an id ('id').
  references?: 'kind' | 'embed' | 'id';
  // How deep embedded records nest (3): an optional reference deeper than
  // that is left out, a required one is an error.
  maxDepth?: number;
}

// The options of `checkEach` and `checkEachAsync` of the
// `@alexify/metaschema/stream` subpath: those of `check`, and how many invalid
// records end the iteration (no limit by default).
export interface EachOptions extends CheckOptions {
  maxInvalid?: number;
}

// The options of `parseEach` and `parseEachAsync`: those of `parse`, and
// `maxInvalid`.
export interface ParseEachOptions extends ParseOptions {
  maxInvalid?: number;
}

// The option of the async pair: how many records are in flight at once (1).
export interface EachAsyncOptions {
  concurrency?: number;
}

// The options of `transform`: those of `parse` (or of `check`, with
// `mode: 'check'`), `maxInvalid`, and what the stream does with an invalid
// record.
export interface TransformOptions extends ParseOptions {
  // What goes on down the stream: the parsed value ('parse', the default) or
  // the record as it is ('check').
  mode?: 'parse' | 'check';
  // Whether the stream runs `parseAsync`/`checkAsync` (false).
  async?: boolean;
  // Told of every invalid record, which is then dropped; without it the
  // stream ends with the error at the first one.
  onInvalid?: (record: unknown, result: ValidationResult | ParseResult<unknown>, index: number) => void;
  // After that many invalid records the stream ends with the error even with
  // `onInvalid` (no limit by default).
  maxInvalid?: number;
}

// What `checkEach` and its kin yield for a record: its position in the
// sequence, the record as given, and the result of `check` or `parse`.
export interface RecordEntry<R> {
  index: number;
  record: unknown;
  result: R;
}

export const KIND: Array<string>;
export const KIND_STORED: Array<string>;
export const KIND_MEMORY: Array<string>;
export const SCOPE: Array<string>;
export const STORE: Array<string>;
export const ALLOW: Array<string>;

export function getKindMetadata(
  kind: Kind,
  meta?: Record<string, unknown>,
  root?: Schema,
): { defs: Record<string, unknown>; metadata: KindMetadata };
// ---------------------------------------------------------------------------
// The generators: JSON Schema and TypeScript. The functions live in the
// `@alexify/metaschema/generators` subpath (`toJSONSchema`, `toTypeScript`,
// `saveTypes`); its `register()` installs the methods declared on `Schema`
// and `Model` below and the Standard JSON Schema converter. The option
// types are here so that the core and the subpath share them.
// ---------------------------------------------------------------------------

// The options of `toTypeScript`, `toInterface` and `saveTypes`.
export interface InterfaceOptions {
  // Give a nested struct and an enum a type of their own, named after the
  // entity and the field (`interface AccountFullName`, `type IdentifierStorage`),
  // rendered before the interface that uses them.
  named?: boolean;
}

// The JSON Schema export renders the rules of `check` as a document of a
// target dialect; see the JSON Schema guide for the mapping.
export type JSONSchemaTarget = 'draft-2020-12' | 'draft-07' | 'openapi-3.0' | 'mongodb';

export type JSONSchema = Record<string, unknown>;

export interface JSONSchemaOptions {
  // The dialect of the document: JSON Schema draft 2020-12 (the default) or
  // draft-07, an OpenAPI 3.0 schema object, or a MongoDB `$jsonSchema`
  // (`bsonType`, no `$ref`, references inline).
  target?: JSONSchemaTarget;
  // 'strict' renders the dialect of LLM structured outputs (OpenAI, Anthropic):
  // an object at the root, every property listed as required (an optional one
  // accepts null), `additionalProperties: false` on every object, and the
  // structure only (no `length`, `pattern`, `min` or `max`). For the
  // draft-2020-12 and draft-07 targets.
  profile?: 'strict';
  // Which side of the wire the document describes: 'input' (the default) is
  // the JSON a value is parsed from (a `date` is a date-time string), 'output'
  // the value itself (a `date`, `set` or `map` has no JSON form).
  io?: 'input' | 'output';
  // What to do with a type that has no form in the target: throw
  // `ERR_UNREPRESENTABLE` (the default), or render it as `{}`.
  unrepresentable?: 'throw' | 'any';
  // How a reference renders, as in `check`: by the kind of its target ('kind',
  // the default: a stored kind as an id, a memory kind as a `$ref` to its
  // definition), every reference as the record ('embed') or as an id ('id').
  references?: 'kind' | 'embed' | 'id';
  // The pointer the `$ref` of a definition starts with, and where the
  // definitions are placed in the document: '#/$defs/' for draft-2020-12,
  // '#/definitions/' for draft-07, '#/components/schemas/' for openapi-3.0.
  definitions?: string;
}

export interface ModelJSONSchemaOptions extends JSONSchemaOptions {
  // The entity at the root of the document, with the definitions it needs;
  // without it the document holds every entity as a definition, in
  // dependency order (one document per entity for the mongodb target).
  root?: string;
}

// The options of `fromJSONSchema` of the generators subpath.
export interface FromJSONSchemaOptions {
  // The name of the schema: what `$ref: '#'` refers to, and the name of the
  // Schema built with `as: 'schema'`.
  name?: string;
  // What comes back: the definition (the default), or a Schema built from it.
  as?: 'definition' | 'schema';
  // A `$ref` into the definitions of the document: the definition in place
  // ('inline', the default; a cycle has no form), or a reference to an
  // entity of that name ('name'), to resolve through a Model.
  references?: 'inline' | 'name';
  // A keyword the subset has no form for: `ERR_UNSUPPORTED_SCHEMA` with its
  // place in the document ('throw', the default), or dropped ('ignore').
  unsupported?: 'throw' | 'ignore';
  // Told of every drop of `unsupported: 'ignore'`: what was dropped, as the
  // error of the throw mode names it (`The keyword "multipleOf"`), and its
  // place in the document as a JSON pointer. Not called in the throw mode,
  // where the error carries both.
  onUnsupported?: (reason: string, pointer: string) => void;
}

// Standard JSON Schema (https://standardschema.dev/json-schema): the converter
// `schema['~standard'].jsonSchema`, whose `input` and `output` take the
// target and the other options of `toJSONSchema` as `libraryOptions`. The
// mongodb target is not a JSON Schema and is refused here. Installed by
// `register()` of the generators subpath.
export interface StandardJSONSchemaOptions {
  readonly target: 'draft-2020-12' | 'draft-07' | 'openapi-3.0' | ({} & string);
  readonly libraryOptions?: Omit<JSONSchemaOptions, 'target' | 'io'> | undefined;
}

export interface StandardConverter {
  readonly input: (options: StandardJSONSchemaOptions) => JSONSchema;
  readonly output: (options: StandardJSONSchemaOptions) => JSONSchema;
}

// ---------------------------------------------------------------------------
// Static inference: the TypeScript type of a value a definition accepts.
//
// `Infer<D>` reads a definition type the way `Schema` reads the definition
// object, so the literal types matter: write the definition inline in
// `Schema.from(...)` / `new Schema(...)` (const type parameters keep them) or
// declare it `as const`. A definition object has no key order in TypeScript,
// so where the runtime reads the first key, `Infer` reads the keys that are
// there: an object with a kind key is a struct, one with a `type` string is
// the long form, one with a collection key (`array`, `set`, `object`, `map`,
// `enum`, `tuple`, `union`, `schema`, `one`, `many`) is that shorthand, and
// anything else is a struct. A struct with a field named like one of those
// says so with a kind (`{ Struct: {}, ... }`), as the runtime needs it to.
// ---------------------------------------------------------------------------

// The value types of custom types, by type name, for module augmentation:
//   declare module '@alexify/metaschema' { interface CustomTypes { datetime: string } }
// A type name that is neither built in nor declared here infers as `unknown`.
export interface CustomTypes {}

type IsAny<T> = 0 extends 1 & T ? true : false;

type IsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never;

// The value a definition describes is read twice: as `check` and `parse`
// accept it ('input') and as `parse` gives it ('output'), where a decoder
// replaces the value of its field and a default makes its key present.
type Mode = 'input' | 'output';

type ScalarName =
  | 'string'
  | 'number'
  | 'integer'
  | 'bigint'
  | 'boolean'
  | 'date'
  | 'null'
  | 'any'
  | 'unknown'
  | 'json';

// The types whose shorthand is `{ <name>: <argument> }`.
type CompoundName =
  | 'array'
  | 'set'
  | 'object'
  | 'map'
  | 'enum'
  | 'tuple'
  | 'union'
  | 'schema'
  | 'one'
  | 'many';

type TypeName = ScalarName | CompoundName | 'reference' | keyof CustomTypes;

type ScalarOf<N extends string> = N extends 'string'
  ? string
  : N extends 'number' | 'integer'
    ? number
    : N extends 'bigint'
      ? bigint
      : N extends 'boolean'
        ? boolean
        : N extends 'date'
          ? Date
          : N extends 'null'
            ? null
            : N extends 'any'
              ? any
              : N extends 'unknown' | 'json'
                ? unknown
                : N extends keyof CustomTypes
                  ? CustomTypes[N]
                  : unknown;

// Whether the first character is an uppercase letter: a reference when it is
// the first character of a type name, a kind when it is the first of a key.
type IsCapitalized<K> = K extends `${infer C}${string}`
  ? C extends Uppercase<C>
    ? C extends Lowercase<C>
      ? false
      : true
    : false
  : false;

type StoredKind =
  | 'entity'
  | 'registry'
  | 'dictionary'
  | 'journal'
  | 'details'
  | 'relation'
  | 'view';

type KindKey<D> = { [K in keyof D]: IsCapitalized<K> extends true ? K : never }[keyof D];

// The store of an entity definition: its kind metadata, else the default of
// its kind; a definition without a kind is a struct, held in memory.
type StoreOf<Def> =
  Def extends Schema<infer X>
    ? StoreOf<X>
    : KindKey<Def> extends infer K
      ? [K] extends [never]
        ? 'memory'
        : K extends keyof Def
          ? Def[K] extends { store: infer S extends string }
            ? S
            : Lowercase<K & string> extends StoredKind
              ? 'persistent'
              : 'memory'
          : 'memory'
      : never;

// A reference holds the record (the graph view) when the field says `embed:
// true` or its target is a memory kind, else its id (the storage view): the
// rule of `check` and of the generated dts. The record is known only through
// the entity map `E`; without the target it is `unknown`.
type Embedded<Name extends string, Embed, E> = Embed extends boolean
  ? Embed
  : Name extends keyof E
    ? StoreOf<E[Name]> extends 'persistent'
      ? false
      : true
    : false;

type Referenced<Name extends string, Embed, E, M extends Mode> =
  Embedded<Name, Embed, E> extends true
    ? Name extends keyof E
      ? Value<E[Name], E, M>
      : unknown
    : string;

type EmbedOf<D> = D extends { embed: infer B } ? B : undefined;

type KeyTypeOf<N> = N extends 'string'
  ? string
  : N extends 'number'
    ? number
    : N extends 'symbol'
      ? symbol
      : N extends 'bigint'
        ? bigint
        : N extends 'boolean'
          ? boolean
          : PropertyKey;

// The key and value definitions of an `object` or `map`: `{ object: { string:
// 'number' } }` or the long form's `key` and `value`.
type Pair<D, N extends string> = D extends { [P in N]: infer Short }
  ? Short extends object
    ? [keyof Short & string, Short[keyof Short]]
    : never
  : D extends { key: infer K; value: infer V }
    ? [K, V]
    : never;

type ArgOf<D, N extends string, Alt extends string> = D extends { [P in N]: infer X }
  ? X
  : D extends { [P in Alt]: infer X }
    ? X
    : never;

type ElementsOf<D, N extends string, Alt extends string> =
  ArgOf<D, N, Alt> extends infer X ? (X extends readonly unknown[] ? X : never) : never;

type TupleOf<T extends readonly unknown[], E, M extends Mode> = {
  -readonly [I in keyof T]: Element<T[I], E, M>;
};

type UnionOf<T extends readonly unknown[], E, M extends Mode> = {
  [I in keyof T]: Value<T[I], E, M>;
}[number];

// A one-key object holding a type name names a tuple element (`{ x: 'number'
// }`); the key must not itself be `type`, a type name or a kind.
type NamedKey<T> = keyof T extends infer K
  ? [K] extends [string]
    ? IsUnion<K> extends true
      ? never
      : K extends `${infer F}?`
        ? F extends TypeName | 'type'
          ? never
          : IsCapitalized<F> extends true
            ? never
            : K
        : K extends TypeName | 'type'
          ? never
          : IsCapitalized<K> extends true
            ? never
            : K
    : never
  : never;

type Element<T, E, M extends Mode> = T extends string
  ? Value<T, E, M>
  : T extends readonly unknown[]
    ? Value<T, E, M>
    : T extends object
      ? NamedKey<T> extends infer K
        ? [K] extends [never]
          ? Value<T, E, M>
          : K extends keyof T
            ? T[K] extends string
              ? K extends `${string}?`
                ? Value<T[K], E, M> | null | undefined
                : Value<T[K], E, M>
              : Value<T, E, M>
            : Value<T, E, M>
        : never
      : Value<T, E, M>;

// The value type of a type by name, with the definition it is read from.
type TypeOf<N extends string, D, E, M extends Mode> =
  IsCapitalized<N> extends true
    ? Referenced<N, EmbedOf<D>, E, M>
    : N extends 'array'
      ? Value<ArgOf<D, 'array', 'value'>, E, M>[]
      : N extends 'set'
        ? Set<Value<ArgOf<D, 'set', 'value'>, E, M>>
        : N extends 'object'
          ? Pair<D, 'object'> extends [infer K, infer V]
            ? Record<KeyTypeOf<K> & PropertyKey, Value<V, E, M>>
            : Record<string, unknown>
          : N extends 'map'
            ? Pair<D, 'map'> extends [infer K, infer V]
              ? Map<KeyTypeOf<K>, Value<V, E, M>>
              : Map<unknown, unknown>
            : N extends 'enum'
              ? D extends { enum: readonly (infer V)[] }
                ? V
                : unknown
              : N extends 'tuple'
                ? TupleOf<ElementsOf<D, 'tuple', 'value'>, E, M>
                : N extends 'union'
                  ? UnionOf<ElementsOf<D, 'union', 'union'>, E, M>
                  : N extends 'schema'
                    ? D extends { schema: infer S }
                      ? Value<S, E, M>
                      : unknown
                    : N extends 'one'
                      ? D extends { one: infer T extends string }
                        ? Referenced<T, EmbedOf<D>, E, M>
                        : unknown
                      : N extends 'many'
                        ? D extends { many: infer T extends string }
                          ? Referenced<T, EmbedOf<D>, E, M>[]
                          : unknown
                        : N extends keyof CustomTypes
                          ? CustomTypes[N]
                          : N extends ScalarName
                            ? ScalarOf<N>
                            : D extends { schema: infer S extends object }
                              ? Value<S, E, M>
                              : unknown;

// On the output side a decoder (`parse`) gives the value of its field; a
// promise of one is awaited.
type Decoded<T, D, M extends Mode> = M extends 'output'
  ? D extends { parse: (...args: never[]) => infer R }
    ? Awaited<R>
    : T
  : T;

type Nullable<T, D> = D extends { nullable: true } ? T | null : T;

type Optional<T, D> = D extends { required: false } ? T | null | undefined : T;

// `{ type: 'name', ... }`: the type, `| null` for `nullable: true`, and `|
// null | undefined` for `'?name'` or `required: false`.
type LongForm<T extends string, D, E, M extends Mode> = T extends `?${infer N}`
  ? Nullable<Decoded<TypeOf<N, D, E, M>, D, M>, D> | null | undefined
  : Optional<Nullable<Decoded<TypeOf<T, D, E, M>, D, M>, D>, D>;

type Shorthand<D, E, M extends Mode> = D extends { array: unknown }
  ? LongForm<'array', D, E, M>
  : D extends { set: unknown }
    ? LongForm<'set', D, E, M>
    : D extends { object: object }
      ? LongForm<'object', D, E, M>
      : D extends { map: object }
        ? LongForm<'map', D, E, M>
        : D extends { enum: readonly unknown[] }
          ? LongForm<'enum', D, E, M>
          : D extends { tuple: readonly unknown[] }
            ? LongForm<'tuple', D, E, M>
            : D extends { union: readonly unknown[] }
              ? LongForm<'union', D, E, M>
              : D extends { schema: object }
                ? LongForm<'schema', D, E, M>
                : D extends { one: string }
                  ? LongForm<'one', D, E, M>
                  : D extends { many: string }
                    ? LongForm<'many', D, E, M>
                    : Decoded<Struct<D, E, M>, D, M>;

// What is not a field of a struct: a function (a calculated field, or the
// schema-level validate/parse/serialize/format) and an index definition.
type IsIndex<X> = X extends
  | { index: readonly unknown[] }
  | { primary: readonly unknown[] }
  | { unique: readonly unknown[] }
  ? true
  : false;

type IsField<X> = X extends (...args: never[]) => unknown
  ? false
  : IsIndex<X> extends true
    ? false
    : true;

type IsOptionalDef<X> = X extends `?${string}`
  ? true
  : X extends { type: `?${string}` }
    ? true
    : X extends { required: false }
      ? true
      : false;

// Whether a key is optional by its name (`'key?'`) or its definition.
type IsOptionalKey<K, X> = K extends `${string}?` ? true : IsOptionalDef<X>;

// Whether parse fills the key when it is missing.
type Defaulted<X> = X extends { default: infer V } ? ([V] extends [undefined] ? false : true) : false;

type FieldKeys<D> = { [K in keyof D]: IsField<D[K]> extends true ? K : never }[keyof D];

// The keys that may be left out: the optional ones, and on the input side
// those with a default, which parse fills; on the output side a defaulted
// key is always there.
type OptionalKeys<D, M extends Mode> = {
  [K in FieldKeys<D>]: M extends 'output'
    ? Defaulted<D[K]> extends true
      ? never
      : IsOptionalKey<K, D[K]> extends true
        ? K
        : never
    : IsOptionalKey<K, D[K]> extends true
      ? K
      : Defaulted<D[K]> extends true
        ? K
        : never;
}[FieldKeys<D>];

type RequiredKeys<D, M extends Mode> = Exclude<FieldKeys<D>, OptionalKeys<D, M>>;

// An optional property accepts null and undefined, as check does; a key that
// is optional only through its default accepts a missing value.
type OptionalProperty<K, X, E, M extends Mode> =
  IsOptionalKey<K, X> extends true ? Value<X, E, M> | null | undefined : Value<X, E, M>;

// On the output side a defaulted key is present: null stays where the key
// was optional, undefined is gone.
type RequiredProperty<K, X, E, M extends Mode> =
  Defaulted<X> extends true
    ? Exclude<Value<X, E, M>, undefined> | (IsOptionalKey<K, X> extends true ? null : never)
    : Value<X, E, M>;

type FieldName<K> = K extends `${infer F}?` ? F : K;

type Simplify<T> = { [K in keyof T]: T[K] };

// The fields of a struct: optional ones (`'key?'`, `'?type'`, `required:
// false`) are optional properties that accept null and undefined, as `check`
// does.
type Struct<D, E, M extends Mode> = Simplify<
  {
    -readonly [K in RequiredKeys<D, M> as FieldName<K>]-?: RequiredProperty<K, D[K], E, M>;
  } & {
    -readonly [K in OptionalKeys<D, M> as FieldName<K>]?: OptionalProperty<K, D[K], E, M>;
  }
>;

// A projection copies fields from its parent, known only through `E`.
type Projection<D, E, M extends Mode> = D extends {
  Projection: { schema: infer S extends string; fields: readonly (infer F)[] };
}
  ? S extends keyof E
    ? Pick<Value<E[S], E, M>, Extract<F, keyof Value<E[S], E, M>>>
    : unknown
  : unknown;

type WithKind<D, K extends keyof D, E, M extends Mode> = K extends 'Projection'
  ? Projection<D, E, M>
  : Struct<Omit<D, K>, E, M>;

type ObjectDef<D, E, M extends Mode> =
  KindKey<D> extends infer K
    ? [K] extends [never]
      ? D extends { type: infer T extends string }
        ? LongForm<T, D, E, M>
        : Shorthand<D, E, M>
      : K extends keyof D
        ? Decoded<WithKind<D, K, E, M>, D, M>
        : never
    : never;

// The id field a stored kind adds, named after the entity.
type IdOf<Name extends string, Def> =
  StoreOf<Def> extends 'persistent' ? { [K in `${Uncapitalize<Name>}Id`]?: string } : {};

type Value<D, E, M extends Mode> =
  IsAny<D> extends true
    ? any
    : D extends string
      ? D extends `?${infer N}`
        ? Value<N, E, M> | null | undefined
        : IsCapitalized<D> extends true
          ? Referenced<D, undefined, E, M>
          : ScalarOf<D>
      : D extends Schema<infer X>
        ? Value<X, E, M>
        : D extends readonly unknown[]
          ? TupleOf<D, E, M>
          : D extends object
            ? ObjectDef<D, E, M>
            : unknown;

// The type of a value `check` and `parse` accept for the definition `D` (a
// key with a `default` may be left out, parse fills it). `E` is an optional
// map of entity definitions by name (the second argument of `Model` as an
// object): with it a reference to a memory kind is the record and a
// projection has its parent's fields; without it a memory reference is
// `unknown` and a stored one is its id. A stored kind's own id field depends
// on the entity's name, which a definition does not carry: `InferEntity`
// adds it.
export type Infer<D, E = {}> = Value<D, E, 'input'>;

// The type of the value `parse` gives for the definition `D`: `Infer<D, E>`
// with the result of every `parse` function (a decoder of a field, the
// schema's own) in place of the value it decodes, and every defaulted key
// present.
export type InferOutput<D, E = {}> = Value<D, E, 'output'>;

// The value type of a `Schema<D>` instance: `InferSchema<typeof schema>`.
export type InferSchema<S> = S extends Schema<infer D> ? Infer<D> : never;

// The value type of the entity `Name` of the entity map `E`, with the id
// field its kind adds (`accountId?: string` for a stored `Account`).
export type InferEntity<E, Name extends keyof E & string> = Simplify<
  Infer<E[Name], E> & IdOf<Name, E[Name]>
>;

// Standard Schema v1 (https://standardschema.dev): the interface every schema
// exposes as `schema['~standard']`, so tRPC, TanStack Form, Hono and the other
// consumers of the specification accept it without an adapter. The shape is
// written out here because this file cannot import `@standard-schema/spec` (a
// devDependency); tests/types/standard.test-d.ts pins that a `Schema<D>` is a
// `StandardSchemaV1<Infer<D>, Infer<D>>` of that package.

// The vendor-specific options of a `validate` call are the options of `parse`.
export interface StandardOptions {
  readonly libraryOptions?: ParseOptions | undefined;
}

// The result of parse as the specification reads it: the value parse gives
// (the value given, when there was nothing to apply), or the issues of an
// invalid one, the result's own (`message` and `path`, as the specification
// reads them, plus `code` and `params`).
export type StandardResult<T> =
  | { readonly value: T; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<ValidationIssue> };

export interface StandardProps<D = string | object> {
  readonly version: 1;
  readonly vendor: 'alexify.metaschema';
  // `parse` with the policies of the schema; a promise of the result for a
  // schema with an async validator, decoder or custom type.
  readonly validate: (
    value: unknown,
    options?: StandardOptions,
  ) => StandardResult<InferOutput<D>> | Promise<StandardResult<InferOutput<D>>>;
  // Standard JSON Schema: `input(options)` and `output(options)` by target.
  // Present once `register()` of the generators subpath has run.
  readonly jsonSchema: StandardConverter;
  // What parse accepts and what it gives. Type-level only: no property of
  // the object holds it.
  readonly types?: { readonly input: Infer<D>; readonly output: InferOutput<D> } | undefined;
}

// `D` is the definition the schema was built from, kept as a type only (no
// instance property holds it): `Schema.from({ name: 'string' })` is a
// `Schema<{ readonly name: 'string' }>`, and `InferSchema` reads `D` from it.
// The const type parameter keeps the literal types of an inline definition.
export class Schema<const D extends string | object = string | object> {
  readonly '~definition'?: D;
  // Standard Schema v1, built on first use; see `StandardProps`.
  readonly '~standard': StandardProps<D>;

  static from<const D extends string | object>(raw: D, namespaces?: Array<Model>): Schema<D>;
  static extractSchema(def: object): Schema | null;
  // A definition (or a Schema) from a JSON Schema document: exists once
  // `register()` of the generators subpath has run; its `fromJSONSchema` is
  // the same without it.
  static fromJSONSchema(
    document: JSONSchema | true,
    options: FromJSONSchemaOptions & { as: 'schema' },
  ): Schema;
  static fromJSONSchema(document: JSONSchema | true, options?: FromJSONSchemaOptions): object | string;
  // The schema two schemas describe, by unification: exists once `register()`
  // of the `@alexify/metaschema/model` subpath has run; its `merge(a, b)` is
  // the same without it.
  static merge(a: Schema, b: Schema, options?: MergeOptions): Schema;
  // A definition (or a Schema) that accepts every sample: exists once
  // `register()` of the `@alexify/metaschema/model` subpath has run; its
  // `infer(samples, options)` is the same without it.
  static infer(samples: Iterable<unknown>, options: InferOptions & { as: 'schema' }): Schema;
  static infer(samples: Iterable<unknown>, options?: InferOptions): object | string;

  kind: Kind;
  scope: Scope;
  store: Store;
  allow: Allow;
  parent: string;
  // What `check` does with keys the schema does not have unless the call says
  // otherwise: `{ Struct: { unknown: 'ignore' } }` sets it.
  unknown: 'reject' | 'ignore';
  indexes: Record<string, object>;
  options: SchemaOptions;
  custom: Record<string, unknown>;
  // For a schema whose definition is a single type (`Schema.from('string')`,
  // `Schema.from({ array: 'number' })`) this is that FieldType itself.
  fields: Fields;
  name: string;
  namespaces: Set<Model>;
  references: Set<string>;
  relations: Set<Relation>;
  // Lint warnings of the definition, `Warning [code]: text`: unknown field
  // options, a pattern without length.max, an index over a missing field.
  // Computed on first use.
  readonly warnings: Array<string>;

  constructor(name: string, raw: D, namespaces?: Array<Model>);
  get types(): TypeTable;
  checkConsistency(): Array<string>;
  findReference(name: string): Schema | null;
  check(value: unknown, options?: CheckOptions): ValidationResult;
  // The same check, with the validators that return a promise settled after
  // the walk, in field order.
  checkAsync(value: unknown, options?: CheckOptions): Promise<ValidationResult>;
  // Validates a value and builds the value of the program from it: defaults,
  // the check, `unknown: 'strip'`, the decoders of the fields (parts before
  // the whole) and the schema's own `parse`. The value given is never
  // written to; it is the output itself when there was nothing to apply.
  parse(value: unknown, options?: ParseOptions): ParseResult<InferOutput<D>>;
  parseAsync(value: unknown, options?: ParseOptions): Promise<ParseResult<InferOutput<D>>>;
  // The other direction: the schema's own `serialize`, then the serializers
  // of the fields, from the value down to its parts; with `check` the
  // verdict of check over the result as well.
  serialize(
    value: InferOutput<D>,
    options: SerializeOptions & { check: true },
  ): SerializeChecked<Infer<D>>;
  serialize(value: InferOutput<D>, options?: SerializeOptions): Serialized<Infer<D>>;
  // A value the schema accepts, the same for a seed: exists once `register()`
  // of the `@alexify/metaschema/model` subpath has run; its `sample(schema,
  // options)` is the same without it.
  sample(options?: SampleOptions): Infer<D>;
  // The five members below exist once `register()` of the
  // `@alexify/metaschema/stream` subpath has run; its `checkEach(schema,
  // records, options)` and kin are the same without it.
  checkEach(
    records: Iterable<unknown>,
    options?: EachOptions,
  ): Generator<RecordEntry<ValidationResult>, void, undefined>;
  parseEach(
    records: Iterable<unknown>,
    options?: ParseEachOptions,
  ): Generator<RecordEntry<ParseResult<InferOutput<D>>>, void, undefined>;
  checkEachAsync(
    records: Iterable<unknown> | AsyncIterable<unknown>,
    options?: EachOptions & EachAsyncOptions,
  ): AsyncGenerator<RecordEntry<ValidationResult>, void, undefined>;
  parseEachAsync(
    records: Iterable<unknown> | AsyncIterable<unknown>,
    options?: ParseEachOptions & EachAsyncOptions,
  ): AsyncGenerator<RecordEntry<ParseResult<InferOutput<D>>>, void, undefined>;
  transform(options: TransformOptions & { mode: 'check' }): TransformStream<unknown, Infer<D>>;
  transform(options?: TransformOptions): TransformStream<unknown, InferOutput<D>>;
  // The two methods below exist once `register()` of the generators subpath
  // has run; the subpath's `toJSONSchema(schema)` and `toTypeScript(schema)`
  // are the same without it.
  // The schema as a JSON Schema document of the target dialect.
  toJSONSchema(options?: JSONSchemaOptions): JSONSchema;
  // The schema as a TypeScript interface, the description of a field as JSDoc.
  toInterface(options?: InterfaceOptions): string;
  attach(...namespaces: Array<Model>): void;
  detach(...namespaces: Array<Model>): void;
  toString(): string;
  toJSON(): object;
  validate(value: unknown, path?: string): ValidationResult | null;
}

export class Model {
  types: TypeTable;
  entities: Map<string, Schema>;
  database: Record<string, unknown> | null;
  order: Set<string>;
  // The warnings of every entity, plus references that do not resolve
  // (missing-reference) and recursive dependencies (recursive-reference).
  // Computed on first use.
  readonly warnings: Array<string>;

  constructor(
    types: Record<string, TypeEntry>,
    entities: Iterable<readonly [string, object]>,
    database?: Record<string, unknown> | null,
    options?: ModelOptions,
  );
  // The model as plain JSON, what JSON.stringify(model) writes; see
  // `ModelSnapshot`.
  toJSON(): ModelSnapshot;
  // The four statics below exist once `register()` of the
  // `@alexify/metaschema/model` subpath has run; its `fromJSON`, `diff`,
  // `compatibility` and `compatibilityOf` are the same without it.
  static fromJSON(snapshot: ModelSnapshot, options?: RestoreOptions): RestoredModel;
  static diff(prev: Model | ModelSnapshot, next: Model | ModelSnapshot): SchemaChange[];
  static compatibility(changes: SchemaChange[]): Compatibility;
  static compatibilityOf(change: SchemaChange): Compatibility;
  // The members below exist once `register()` of the generators subpath has
  // run; the subpath's `toJSONSchema(model)` and `toTypeScript(model)` are the
  // same without it.
  // Every entity as a JSON Schema definition (`$defs`, `definitions` or
  // `components.schemas` by target), or the document of `options.root`.
  toJSONSchema(options?: ModelJSONSchemaOptions): JSONSchema;
  // The interfaces of every entity in dependency order; `dts` is the same
  // without options.
  toTypeScript(options?: InterfaceOptions): string;
  get dts(): string;
}
