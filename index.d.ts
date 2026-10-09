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
  // `unexpected` issue per struct (the default) or ignore them.
  unknown?: 'reject' | 'ignore';
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
  | 'ERR_PROJECTION'
  | 'ERR_INVALID_CUSTOM_TYPE'
  | 'ERR_INVALID_ENUM'
  | 'ERR_INVALID_LENGTH'
  | 'ERR_INVALID_RULE'
  | 'ERR_INVALID_REFERENCE'
  | 'ERR_RESERVED_KEY'
  | 'ERR_TYPE_REGISTERED'
  | 'ERR_UNKNOWN_JS_TYPE'
  | 'ERR_INVALID_OPTIONS';

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
export function saveTypes(outputFile: string, model: Model): Promise<void>;

export class Schema {
  static from(raw: string | object, namespaces?: Array<Model>): Schema;
  static extractSchema(def: object): Schema | null;

  kind: Kind;
  scope: Scope;
  store: Store;
  allow: Allow;
  parent: string;
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

  constructor(name: string, raw: string | object, namespaces?: Array<Model>);
  get types(): TypeTable;
  checkConsistency(): Array<string>;
  findReference(name: string): Schema | null;
  check(value: unknown, options?: CheckOptions): ValidationResult;
  toInterface(): string;
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
  warnings: Array<string>;

  constructor(
    types: Record<string, TypeEntry>,
    entities: Iterable<readonly [string, object]>,
    database?: Record<string, unknown> | null,
    options?: ModelOptions,
  );
  get dts(): string;
}
