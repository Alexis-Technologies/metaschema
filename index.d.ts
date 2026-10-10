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
  path: PropertyKey[];
  seen: Set<object> | null;
  unknown: 'reject' | 'ignore';
  references: 'kind' | 'embed' | 'id';
  root: string;
  messages: Messages;
}

export type Validator = (value: any, path: string) => ValidationReturn;

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

// An entry of the table passed to Model: metadata for a built-in, an alias
// (`js`), or a prototype with its own `construct` and `checkType`.
export interface TypeEntry {
  js?: string;
  metadata?: Record<string, unknown>;
  kind?: 'scalar' | 'struct';
  // The rules the type accepts in a field definition (`length`, `min`, `max`).
  rules?: string[];
  construct?(def: object, preprocessor: object): void;
  checkType?(value: any, path: string): ValidationReturn;
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
  | 'ERR_UNREPRESENTABLE';

export class SchemaDefinitionError extends TypeError {
  code: DefinitionErrorCode;
  schema: string;
  field: string;
  constructor(code: DefinitionErrorCode, reason: string);
  locate(schema: string, field: string): this;
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
export function saveTypes(
  outputFile: string,
  model: Model,
  options?: InterfaceOptions,
): Promise<void>;

// The options of `toInterface`, `toTypeScript` and `saveTypes`.
export interface InterfaceOptions {
  // Give a nested struct and an enum a type of their own, named after the
  // entity and the field (`interface AccountFullName`, `type IdentifierStorage`),
  // rendered before the interface that uses them.
  named?: boolean;
}

// ---------------------------------------------------------------------------
// JSON Schema export: `schema.toJSONSchema(options)` and
// `model.toJSONSchema(options)` render the rules of `check` as a document of
// a target dialect; see the JSON Schema guide for the mapping.
// ---------------------------------------------------------------------------

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

// Standard JSON Schema (https://standardschema.dev/json-schema): the converter
// `schema['~standard'].jsonSchema`, whose `input` and `output` take the
// target and the other options of `toJSONSchema` as `libraryOptions`. The
// mongodb target is not a JSON Schema and is refused here.
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

type Referenced<Name extends string, Embed, E> =
  Embedded<Name, Embed, E> extends true
    ? Name extends keyof E
      ? Infer<E[Name], E>
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

type TupleOf<T extends readonly unknown[], E> = { -readonly [I in keyof T]: Element<T[I], E> };

type UnionOf<T extends readonly unknown[], E> = { [I in keyof T]: Infer<T[I], E> }[number];

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

type Element<T, E> = T extends string
  ? Infer<T, E>
  : T extends readonly unknown[]
    ? Infer<T, E>
    : T extends object
      ? NamedKey<T> extends infer K
        ? [K] extends [never]
          ? Infer<T, E>
          : K extends keyof T
            ? T[K] extends string
              ? K extends `${string}?`
                ? Infer<T[K], E> | null | undefined
                : Infer<T[K], E>
              : Infer<T, E>
            : Infer<T, E>
        : never
      : Infer<T, E>;

// The value type of a type by name, with the definition it is read from.
type TypeOf<N extends string, D, E> =
  IsCapitalized<N> extends true
    ? Referenced<N, EmbedOf<D>, E>
    : N extends 'array'
      ? Infer<ArgOf<D, 'array', 'value'>, E>[]
      : N extends 'set'
        ? Set<Infer<ArgOf<D, 'set', 'value'>, E>>
        : N extends 'object'
          ? Pair<D, 'object'> extends [infer K, infer V]
            ? Record<KeyTypeOf<K> & PropertyKey, Infer<V, E>>
            : Record<string, unknown>
          : N extends 'map'
            ? Pair<D, 'map'> extends [infer K, infer V]
              ? Map<KeyTypeOf<K>, Infer<V, E>>
              : Map<unknown, unknown>
            : N extends 'enum'
              ? D extends { enum: readonly (infer V)[] }
                ? V
                : unknown
              : N extends 'tuple'
                ? TupleOf<ElementsOf<D, 'tuple', 'value'>, E>
                : N extends 'union'
                  ? UnionOf<ElementsOf<D, 'union', 'union'>, E>
                  : N extends 'schema'
                    ? D extends { schema: infer S }
                      ? Infer<S, E>
                      : unknown
                    : N extends 'one'
                      ? D extends { one: infer T extends string }
                        ? Referenced<T, EmbedOf<D>, E>
                        : unknown
                      : N extends 'many'
                        ? D extends { many: infer T extends string }
                          ? Referenced<T, EmbedOf<D>, E>[]
                          : unknown
                        : N extends keyof CustomTypes
                          ? CustomTypes[N]
                          : N extends ScalarName
                            ? ScalarOf<N>
                            : D extends { schema: infer S extends object }
                              ? Infer<S, E>
                              : unknown;

type Nullable<T, D> = D extends { nullable: true } ? T | null : T;

type Optional<T, D> = D extends { required: false } ? T | null | undefined : T;

// `{ type: 'name', ... }`: the type, `| null` for `nullable: true`, and `|
// null | undefined` for `'?name'` or `required: false`.
type LongForm<T extends string, D, E> = T extends `?${infer N}`
  ? Nullable<TypeOf<N, D, E>, D> | null | undefined
  : Optional<Nullable<TypeOf<T, D, E>, D>, D>;

type Shorthand<D, E> = D extends { array: unknown }
  ? LongForm<'array', D, E>
  : D extends { set: unknown }
    ? LongForm<'set', D, E>
    : D extends { object: object }
      ? LongForm<'object', D, E>
      : D extends { map: object }
        ? LongForm<'map', D, E>
        : D extends { enum: readonly unknown[] }
          ? LongForm<'enum', D, E>
          : D extends { tuple: readonly unknown[] }
            ? LongForm<'tuple', D, E>
            : D extends { union: readonly unknown[] }
              ? LongForm<'union', D, E>
              : D extends { schema: object }
                ? LongForm<'schema', D, E>
                : D extends { one: string }
                  ? LongForm<'one', D, E>
                  : D extends { many: string }
                    ? LongForm<'many', D, E>
                    : Struct<D, E>;

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

type FieldKeys<D> = { [K in keyof D]: IsField<D[K]> extends true ? K : never }[keyof D];

type OptionalKeys<D> = {
  [K in FieldKeys<D>]: K extends `${string}?` ? K : IsOptionalDef<D[K]> extends true ? K : never;
}[FieldKeys<D>];

type RequiredKeys<D> = Exclude<FieldKeys<D>, OptionalKeys<D>>;

type FieldName<K> = K extends `${infer F}?` ? F : K;

type Simplify<T> = { [K in keyof T]: T[K] };

// The fields of a struct: optional ones (`'key?'`, `'?type'`, `required:
// false`) are optional properties that accept null and undefined, as `check`
// does.
type Struct<D, E> = Simplify<
  { -readonly [K in RequiredKeys<D>]-?: Infer<D[K], E> } & {
    -readonly [K in OptionalKeys<D> as FieldName<K>]?: Infer<D[K], E> | null | undefined;
  }
>;

// A projection copies fields from its parent, known only through `E`.
type Projection<D, E> = D extends {
  Projection: { schema: infer S extends string; fields: readonly (infer F)[] };
}
  ? S extends keyof E
    ? Pick<Infer<E[S], E>, Extract<F, keyof Infer<E[S], E>>>
    : unknown
  : unknown;

type WithKind<D, K extends keyof D, E> = K extends 'Projection'
  ? Projection<D, E>
  : Struct<Omit<D, K>, E>;

type ObjectDef<D, E> =
  KindKey<D> extends infer K
    ? [K] extends [never]
      ? D extends { type: infer T extends string }
        ? LongForm<T, D, E>
        : Shorthand<D, E>
      : K extends keyof D
        ? WithKind<D, K, E>
        : never
    : never;

// The id field a stored kind adds, named after the entity.
type IdOf<Name extends string, Def> =
  StoreOf<Def> extends 'persistent' ? { [K in `${Uncapitalize<Name>}Id`]?: string } : {};

// The type of a value `check` accepts for the definition `D`. `E` is an
// optional map of entity definitions by name (the second argument of `Model`
// as an object): with it a reference to a memory kind is the record and a
// projection has its parent's fields; without it a memory reference is
// `unknown` and a stored one is its id. A stored kind's own id field depends
// on the entity's name, which a definition does not carry: `InferEntity`
// adds it.
export type Infer<D, E = {}> =
  IsAny<D> extends true
    ? any
    : D extends string
      ? D extends `?${infer N}`
        ? Infer<N, E> | null | undefined
        : IsCapitalized<D> extends true
          ? Referenced<D, undefined, E>
          : ScalarOf<D>
      : D extends Schema<infer X>
        ? Infer<X, E>
        : D extends readonly unknown[]
          ? TupleOf<D, E>
          : D extends object
            ? ObjectDef<D, E>
            : unknown;

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

// The vendor-specific options of a `validate` call are the options of `check`.
export interface StandardOptions {
  readonly libraryOptions?: CheckOptions | undefined;
}

// A verdict, not a transformation: a valid value comes back as it was given,
// and the issues of an invalid one are the result's own (`message` and
// `path`, as the specification reads them, plus `code` and `params`).
export type StandardResult<T> =
  | { readonly value: T; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<ValidationIssue> };

export interface StandardProps<D = string | object> {
  readonly version: 1;
  readonly vendor: 'alexify.metaschema';
  readonly validate: (value: unknown, options?: StandardOptions) => StandardResult<Infer<D>>;
  // Standard JSON Schema: `input(options)` and `output(options)` by target.
  readonly jsonSchema: StandardConverter;
  // Nothing is transformed, so the input type is the output type. Type-level
  // only: no property of the object holds it.
  readonly types?: { readonly input: Infer<D>; readonly output: Infer<D> } | undefined;
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
  // Every entity as a JSON Schema definition (`$defs`, `definitions` or
  // `components.schemas` by target), or the document of `options.root`.
  toJSONSchema(options?: ModelJSONSchemaOptions): JSONSchema;
  // The interfaces of every entity in dependency order; `dts` is the same
  // without options.
  toTypeScript(options?: InterfaceOptions): string;
  get dts(): string;
}
