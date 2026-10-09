export type Scope = 'global' | 'local' | 'application';

export type Allow = 'read' | 'write' | 'append';

export type Store = 'persistent' | 'memory';

export type Kind =
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

export type Cardinality =
  'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many';

export interface Relation {
  to: string;
  type: Cardinality;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
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
  | 'ERR_RESERVED_KEY';

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
  meta?: object,
  root?: Schema,
): { defs: object; metadata: object };
export function saveTypes(outputFile: string, model: Model): Promise<void>;

export class Schema {
  static from(raw: string | object, namespaces?: Array<Model>): Schema;
  static extractSchema(def: object): Schema | null;

  kind: Kind;
  scope: Scope;
  store: Store;
  allow: Allow;
  parent: string;
  indexes: object;
  options: {
    validate: Function | null;
    format: Function | null;
    parse: Function | null;
    serialize: Function | null;
  };
  custom: object;
  fields: object;
  name: string;
  namespaces: Set<Model>;
  references: Set<string>;
  relations: Set<Relation>;

  constructor(name: string, raw: string | object, namespaces?: Array<Model>);
  get types(): object;
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
  types: object;
  entities: Map<string, Schema>;
  database: object | null;
  order: Set<string>;
  warnings: Array<string>;

  constructor(
    types: object,
    entities: Iterable<readonly [string, object]>,
    database?: object | null,
  );
  get dts(): string;
}
