import type {
  InterfaceOptions,
  JSONSchema,
  JSONSchemaOptions,
  Model,
  ModelJSONSchemaOptions,
  Schema,
} from '../../index.js';

// The JSON Schema document of a schema, or of a model: every entity as a
// definition, or the document of the entity `options.root`.
export function toJSONSchema(target: Schema, options?: JSONSchemaOptions): JSONSchema;
export function toJSONSchema(target: Model, options?: ModelJSONSchemaOptions): JSONSchema;

// The TypeScript interface of a schema (a type alias for a schema of one
// type), or the interfaces of every entity of a model in dependency order.
export function toTypeScript(target: Schema | Model, options?: InterfaceOptions): string;

// Writes `toTypeScript(target, options)` to a file. Rejects in the browser.
export function saveTypes(
  outputFile: string,
  target: Schema | Model,
  options?: InterfaceOptions,
): Promise<void>;

// Installs `schema.toJSONSchema`, `schema.toInterface`, `model.toJSONSchema`,
// `model.toTypeScript`, `model.dts` and `schema['~standard'].jsonSchema`.
// Once per process; later calls do nothing.
export function register(): void;
