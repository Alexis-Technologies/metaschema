# Exports

Everything is exported from the package root, in Node.js and in the browser.

```js
const {
  KIND, KIND_STORED, KIND_MEMORY, SCOPE, STORE, ALLOW,
  getKindMetadata, saveTypes, Schema, Model,
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

## Types

`index.d.ts` also exports `Kind`, `Scope`, `Store`, `Allow`, `Cardinality`, `Relation` and
`ValidationResult`.
