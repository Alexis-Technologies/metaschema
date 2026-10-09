# Exports

Everything is exported from the package root, in Node.js and in the browser.

```js
const {
  KIND, KIND_STORED, KIND_MEMORY, SCOPE, STORE, ALLOW,
  getKindMetadata, saveTypes, Schema, Model, SchemaDefinitionError,
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

### `saveTypes(outputFile, model)`

Writes `model.dts` to `outputFile`. Returns `Promise<void>`. Rejects in the browser. See
[TypeScript](/guide/typescript#writing-the-file).

## `Schema`

| Member | Description |
| --- | --- |
| `Schema.from(definition, namespaces?)` | an anonymous schema |
| `new Schema(name, definition, namespaces?)` | a named schema; returns `definition` as is when it is already a `Schema` |
| `Schema.extractSchema(def)` | `def` or `def.schema` when it is a `Schema`, else `null` |
| `schema.check(value, path?)` | validates a value; returns `ValidationResult` |
| `schema.validate(value, path)` | runs only the schema-level `validate`; `null` without one |
| `schema.toInterface()` | the schema as a TypeScript interface |
| `schema.checkConsistency()` | warnings about references that cannot be resolved |
| `schema.findReference(name)` | the entity `name` from the attached models, or `null` |
| `schema.attach(...models)` / `schema.detach(...models)` | add or remove namespaces |
| `schema.types` | the type table in effect |
| `schema.toJSON()` / `schema.toString()` | serialized fields |

Metadata properties: `name`, `kind`, `scope`, `store`, `allow`, `parent`, `fields`, `indexes`,
`options`, `custom`, `references`, `relations`, `namespaces`.

## `Model`

| Member | Description |
| --- | --- |
| `new Model(types, entities, database?)` | builds every entity; `entities` is an iterable of `[name, definition]` |
| `model.entities` | `Map<string, Schema>` |
| `model.types` | the type table |
| `model.database` | the `database` argument or `null` |
| `model.order` | `Set` of entity names, dependencies first |
| `model.warnings` | consistency warnings |
| `model.dts` | TypeScript interfaces for every entity |

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
| `ERR_INVALID_TUPLE` | a tuple element that is not a scalar type |
| `ERR_PROJECTION` | a projection without `schema`/`fields`, with an unknown parent, or naming a field the parent does not have |
| `ERR_INVALID_CUSTOM_TYPE` | a custom type entry without `construct` and `checkType` functions |
| `ERR_INVALID_ENUM` | the `enum` type without a non-empty `enum` list |
| `ERR_INVALID_LENGTH` | a `length` rule that is not a number, `[min, max]` or `{ min, max }` |
| `ERR_INVALID_REFERENCE` | `one` or `many` without an entity name |

## Types

`index.d.ts` also exports `Kind`, `Scope`, `Store`, `Allow`, `Cardinality`, `Relation`,
`ValidationResult` and `DefinitionErrorCode`.
