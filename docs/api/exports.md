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

### `saveTypes(outputFile, model)`

Writes `model.dts` to `outputFile`. Returns `Promise<void>`. Rejects in the browser. See
[TypeScript](/guide/typescript#writing-the-file).

## `Schema`

| Member | Description |
| --- | --- |
| `Schema.from(definition, namespaces?)` | an anonymous schema |
| `new Schema(name, definition, namespaces?)` | a named schema; a `definition` that is already a `Schema` is returned as is (keeping its own name) with `namespaces` attached |
| `Schema.extractSchema(def)` | `def` or `def.schema` when it is a `Schema`, else `null` |
| `schema.check(value, options?)` | validates a value; returns `ValidationResult`. `options`: `root` (the label of the error lines, the schema name by default), `maxErrors`, `unknown` (`'reject'` or `'ignore'`), `messages` (a locale or a function); see [Validation](/guide/validation#options) |
| `schema.validate(value, path?)` | runs only the schema-level `validate`; `null` without one |
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
| `new Model(types, entities, database?, options?)` | builds every entity; `entities` is an iterable of `[name, definition]`; `options.registry` is `'shared'` (default) or `'isolated'` |
| `model.entities` | `Map<string, Schema>` |
| `model.types` | the type table |
| `model.database` | the `database` argument or `null` |
| `model.order` | `Set` of entity names, dependencies first |
| `model.warnings` | consistency warnings |
| `model.dts` | TypeScript interfaces for every entity |

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
`reference`, `circular`, `exception`, `custom`) and `field(path)` for the location prefix. Pass one
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
| `ERR_INVALID_TUPLE` | a tuple element that is not a scalar type |
| `ERR_PROJECTION` | a projection without `schema`/`fields`, with an unknown parent, or naming a field the parent does not have |
| `ERR_INVALID_CUSTOM_TYPE` | a custom type entry without `construct` and `checkType` functions |
| `ERR_INVALID_ENUM` | the `enum` type without a non-empty `enum` list |
| `ERR_INVALID_LENGTH` | a `length` rule that is not a number, `[min, max]` or `{ min, max }` |
| `ERR_INVALID_REFERENCE` | `one` or `many` without an entity name |
| `ERR_TYPE_REGISTERED` | a custom type entry that redefines a registered name (only `{ metadata }` may be added) |
| `ERR_UNKNOWN_JS_TYPE` | a `js` alias that names no registered type |
| `ERR_INVALID_OPTIONS` | a `Model` option with a value it does not accept |
| `ERR_RESERVED_KEY` | a field definition key that names a method of the field (`check`, `construct`, `constructor`, …) or `__proto__`/`prototype` |

## Types

`index.d.ts` also exports `Kind` (the known kinds plus any custom name), `KnownKind`, `Scope`,
`Store`, `Allow`, `Cardinality`, `Relation`, `Fields`, `FieldType`, `CalculatedField`,
`TypeTable`, `TypeConstructor`, `TypeEntry` (an entry of the table passed to `Model`),
`KindMetadata`, `SchemaOptions`, `ModelOptions`, `CheckOptions`, `CheckContext`, `ResultOptions`,
`Validator`, `ValidationReturn`, `ValidationIssue` (a union by code), `IssueOf<Code>`,
`IssueParams`, `IssueInput`, `IssueCode`, `Locale`, `Messages`, `FlatIssues`, `IssueTree` and
`DefinitionErrorCode`.
