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

export type ValidationReturn =
  | boolean
  | string
  | string[]
  | ValidationResult
  | null
  | undefined
  | void;

export class ValidationResult {
  valid: boolean;
  errors: string[];
  constructor(path?: string);
  add(error: ValidationReturn): this;
  static format(error: ValidationReturn, path?: string): string[] | null;
  static isInstance(error: unknown): boolean;
}

export type Validator = (value: any, path: string) => ValidationReturn;

export type CalculatedField = (value: any) => unknown;

// A field of a struct: an instance of the type's class. Keys of the
// definition the type does not use (`unique`, `default`, ...) are kept on it.
export interface FieldType {
  readonly type: string;
  required: boolean;
  validate?: Validator;
  check(value: unknown, path: string): ValidationResult;
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
  check(value: unknown, path?: string): ValidationResult;
  toInterface(): string;
  attach(...namespaces: Array<Model>): void;
  detach(...namespaces: Array<Model>): void;
  toString(): string;
  toJSON(): object;
  validate(value: unknown, path: string): ValidationResult | null;
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
