# Exports

Everything is exported from the package root, in Node.js and in the browser.

```js
const {
  KIND, KIND_STORED, KIND_MEMORY, SCOPE, STORE, ALLOW,
  getKindMetadata, saveTypes, Schema, Model, SchemaDefinitionError, ValidationResult,
} = require('@alexify/metaschema');
```

## Constants

| Export | Value |
| --- | --- |
| `KIND` | every built-in kind: `KIND_MEMORY` followed by `KIND_STORED` |
| `KIND_STORED` | `['entity', 'registry', 'dictionary', 'journal', 'details', 'relation', 'view']` |
| `KIND_MEMORY` | `['struct', 'scalar', 'form', 'projection']` |
| `SCOPE` | `['application', 'global', 'local']` |
| `STORE` | `['persistent', 'memory']` |
| `ALLOW` | `['write', 'append', 'read']` |

## Functions

### `getKindMetadata(kind, meta?, root?)`

Returns `{ defs, metadata }` for a kind: the default `scope`, `store` and `allow` merged with
`meta`, and the fields the kind adds (the id field of stored kinds). Used internally when a
definition starts with a kind; see [Kinds and Metadata](/guide/kinds-and-metadata).

### `saveTypes(outputFile, model, options?)`

Writes `model.toTypeScript(options)` to `outputFile`. Returns `Promise<void>`. Rejects in the
browser. See [TypeScript](/guide/typescript#writing-the-file).

## `Schema`

| Member | Description |
| --- | --- |
| `Schema.from(definition, namespaces?)` | an anonymous schema, a `Schema<D>` whose `D` is the definition's type |
| `new Schema(name, definition, namespaces?)` | a named schema, a `Schema<D>` as well; a `definition` that is already a `Schema` is returned as is (keeping its own name) with `namespaces` attached |
| `Schema.extractSchema(def)` | `def` or `def.schema` when it is a `Schema`, else `null` |
| `schema.check(value, options?)` | validates a value; returns `ValidationResult`. `options`: `root` (the label of the error lines, the schema name by default), `maxErrors`, `unknown` (`'reject'` or `'ignore'`), `references` (`'kind'`, `'embed'` or `'id'`), `messages` (a locale or a function); see [Validation](/guide/validation#options) |
| `schema.validate(value, path?)` | runs only the schema-level `validate`; `null` without one |
| `schema['~standard']` | the [Standard Schema v1](/guide/standard-schema) props `{ version: 1, vendor: 'alexify.metaschema', validate, jsonSchema }`, built on first use; `validate(value, options?)` is `check(value, options?.libraryOptions)` read as `{ value }` or `{ issues }`; `jsonSchema.input(options)` and `jsonSchema.output(options)` are `toJSONSchema` for `options.target` (`draft-2020-12`, `draft-07` or `openapi-3.0`) with `options.libraryOptions` |
| `schema.toJSONSchema(options?)` | the schema as a [JSON Schema](/guide/json-schema) document; `options`: `target` (`'draft-2020-12'`, `'draft-07'`, `'openapi-3.0'`, `'mongodb'`), `profile` (`'strict'`), `io` (`'input'`, `'output'`), `unrepresentable` (`'throw'`, `'any'`), `references` (`'kind'`, `'embed'`, `'id'`), `definitions` (a pointer) |
| `schema.toInterface(options?)` | the schema as a TypeScript interface, the `description` of a field as JSDoc; `options.named` gives enums and nested structs types of their own; see [TypeScript](/guide/typescript#jsdoc-and-named-types) |
| `schema.checkConsistency()` | `Warning [missing-reference]`/`[missing-type]` strings for references and types that cannot be resolved through the attached models |
| `schema.warnings` | lint warnings of the definition, `Warning [code]: text`; see [Domain Models](/guide/model#warnings) |
| `schema.findReference(name)` | the entity `name` from the attached models, or `null` |
| `schema.attach(...models)` / `schema.detach(...models)` | add or remove namespaces |
| `schema.types` | the type table in effect |
| `schema.toJSON()` / `schema.toString()` | serialized fields |

Metadata properties: `name`, `kind`, `scope`, `store`, `allow`, `parent`, `unknown`, `fields`,
`indexes`, `options`, `custom`, `references`, `relations`, `namespaces`.

## `Model`

| Member | Description |
| --- | --- |
| `new Model(types, entities, database?, options?)` | builds every entity; `entities` is an iterable of `[name, definition]`; `options.registry` is `'shared'` (default) or `'isolated'` |
| `model.entities` | `Map<string, Schema>` |
| `model.types` | the type table |
| `model.database` | the `database` argument or `null` |
| `model.order` | `Set` of entity names, dependencies first |
| `model.warnings` | the `warnings` of every entity, their unresolved references and the recursive dependencies, as `Warning [code]: text`; see [Domain Models](/guide/model#warnings) |
| `model.dts` | TypeScript interfaces for every entity, `model.toTypeScript()` |
| `model.toTypeScript(options?)` | the interfaces of every entity in dependency order; `options` are those of `schema.toInterface` |
| `model.toJSONSchema(options?)` | every entity as a [JSON Schema](/guide/json-schema#models) definition, or the document of the entity `options.root`; the other options are those of `schema.toJSONSchema` |

## `ValidationResult`

What `schema.check` returns, and what a `validate` function may build and return itself.

| Member | Description |
| --- | --- |
| `new ValidationResult(options?)` | an empty, valid result; `options.root` labels its error lines, `options.messages` is its locale |
| `result.valid` | `true` while there are no issues |
| `result.issues` | `{ code, path, message, params }` per problem, `path` being the keys from the root of the value; see [Validation](/guide/validation#the-result) for the codes |
| `result.errors` | one line per issue, `Field "<root><path>" <message>`, rendered on first use; a message that already starts with `Field` is kept as it is |
| `result.summary` | the error lines joined with newlines |
| `result.flatten()` | `{ formErrors, fieldErrors }`: messages by dotted path |
| `result.tree()` | `{ errors, properties?, items? }`: messages as a tree that follows the value |
| `result.add(error, code?)` | adds `false`, a string, a `{ code, message, path?, params? }` object, an array of them or another result, with `code` (default `custom`) for entries that carry none; `true`, `null` and `undefined` add nothing |
| `ValidationResult.issuesOf(error, path?, code?)` | the issues `add` would produce, under the `path` keys |
| `ValidationResult.isInstance(value)` | whether `value` is a result, from any copy of the package |

## Locales

`@alexify/metaschema/locales/en` and `@alexify/metaschema/locales/uk` export a locale each: a
table with one renderer per issue code (`required`, `type`, `unexpected`, `enum`, `length`,
`range`, `pattern`, `union`, `reference`, `circular`, `exception`, `custom`) and `field(path)` for the location prefix. Pass one
to `check` as `messages`; see [Messages and locales](/guide/validation#messages-and-locales).

## `SchemaDefinitionError`

Thrown, as a `TypeError` subclass, when a definition is broken. Validation of data never throws
it; see [Validation](/guide/validation#the-result).

| Property | Contents |
| --- | --- |
| `message` | the problem, ending with `in "<Entity>.<field>"` when a field is known |
| `code` | one of the codes below |
| `schema` | the schema name (`''` for an anonymous schema) |
| `field` | the field path inside the schema (`address.city`), `''` for the schema itself |

| Code | Raised for |
| --- | --- |
| `ERR_INVALID_DEFINITION` | a field definition that is not a string, object, array or function |
| `ERR_UNKNOWN_TYPE` | a lowercase type name that is not registered |
| `ERR_MISSING_SCHEMA` | the `schema` type, or an alias of it, without `{ schema: { ... } }` |
| `ERR_INVALID_TUPLE` | a tuple whose definition is not an array, or an element that is a function |
| `ERR_INVALID_UNION` | a `union` without branches, a branch that is a function, or a `discriminator` that is not a field name, that a branch lacks or does not hold as an `enum`, or whose value two branches share |
| `ERR_PROJECTION` | a projection without `schema`/`fields`, with an unknown parent, or naming a field the parent does not have |
| `ERR_INVALID_CUSTOM_TYPE` | a custom type entry without `construct` and `checkType` functions |
| `ERR_INVALID_ENUM` | the `enum` type without a non-empty `enum` list |
| `ERR_INVALID_LENGTH` | a `length` rule that is not a number, `[min, max]` or `{ min, max }`, or whose `min` is above its `max` |
| `ERR_INVALID_RULE` | a rule on a type that does not accept it (`length` on a number, `min` on a string), a `min`/`max` that is not a number or a bigint, a `max` below `min`, or a `pattern` that is not a string or `RegExp` or does not compile |
| `ERR_INVALID_REFERENCE` | `one` or `many` without an entity name |
| `ERR_TYPE_REGISTERED` | a custom type entry that redefines a registered name (only `{ metadata }` may be added) |
| `ERR_UNKNOWN_JS_TYPE` | a `js` alias that names no registered type |
| `ERR_INVALID_OPTIONS` | a `Model` option, the `unknown` metadata of a schema, or an option of `toJSONSchema` with a value it does not accept (an unknown target, the strict profile with another target or a root that is no struct, a root entity the model does not have) |
| `ERR_UNREPRESENTABLE` | a type with no form in the JSON Schema target (a `bigint`, a `date`, `set` or `map` on the output side, a custom type without metadata, a tuple for openapi-3.0, a cycle for mongodb, a value without a type in the strict profile) when `unrepresentable` is `'throw'`; see [JSON Schema](/guide/json-schema#input-and-output) |
| `ERR_RESERVED_KEY` | a field definition key that names a method of the field (`check`, `construct`, `constructor`, …) or `__proto__`/`prototype` |

## Types

`index.d.ts` exports the static inference of value types from definitions; see
[TypeScript](/guide/typescript#inferring-types-from-a-schema):

| Type | Meaning |
| --- | --- |
| `Infer<D, E?>` | the type of a value `check` accepts for the definition type `D`; `E` is an optional entity map (an object of definitions by name) that resolves references to memory kinds and projections |
| `InferSchema<S>` | `Infer<D>` of a `Schema<D>` instance type: `InferSchema<typeof schema>` |
| `InferEntity<E, Name>` | the entity `Name` of the map `E`, with the id field a stored kind adds (`personId?: string`) |
| `CustomTypes` | an empty interface to augment with the value type of each custom type (`interface CustomTypes { datetime: string }`); an unknown name infers as `unknown` |
| `Schema<D>` | the class, generic over its definition; `Schema` on its own is any schema |
| `StandardProps<D>` | the type of `schema['~standard']` of a `Schema<D>`: `version`, `vendor`, `validate` and the type-level `types` (`input` and `output`, both `Infer<D>`); see [Standard Schema](/guide/standard-schema#typescript) |
| `StandardResult<T>` | what `validate` returns: `{ value: T }` or `{ issues: ReadonlyArray<ValidationIssue> }` |
| `StandardOptions` | the options of `validate`: `libraryOptions`, the `CheckOptions` of the call |
| `StandardConverter` | the type of `schema['~standard'].jsonSchema`: `input` and `output`, from `StandardJSONSchemaOptions` (`target` and `libraryOptions`) to `JSONSchema` |
| `JSONSchema` | what `toJSONSchema` returns: `Record<string, unknown>` |
| `JSONSchemaOptions`, `ModelJSONSchemaOptions`, `JSONSchemaTarget` | the options of `schema.toJSONSchema`, those of `model.toJSONSchema` (plus `root`), and the four targets |
| `InterfaceOptions` | the options of `toInterface`, `toTypeScript` and `saveTypes`: `named` |

It also exports `Kind` (the known kinds plus any custom name), `KnownKind`, `Scope`,
`Store`, `Allow`, `Cardinality`, `Relation`, `Fields`, `FieldType`, `CalculatedField`,
`TypeTable`, `TypeConstructor`, `TypeEntry` (an entry of the table passed to `Model`),
`KindMetadata`, `SchemaOptions`, `ModelOptions`, `CheckOptions`, `CheckContext`, `ResultOptions`, `StandardJSONSchemaOptions`,
`Validator`, `ValidationReturn`, `ValidationIssue` (a union by code), `IssueOf<Code>`,
`IssueParams`, `IssueInput`, `IssueCode`, `Locale`, `Messages`, `FlatIssues`, `IssueTree` and
`DefinitionErrorCode`.
