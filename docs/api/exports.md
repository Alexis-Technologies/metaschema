# Exports

The core is exported from the package root, in Node.js and in the browser; the half of it that
builds schemas without validating, the generators, the JIT backend, the model tools, the record
tools, the string formats, the derive tools, the converters of coercion, the MongoDB tools and
the locales are subpaths (see [Architecture](/guide/architecture#the-packages)).

```js
const {
  KIND, KIND_STORED, KIND_MEMORY, SCOPE, STORE, ALLOW,
  getKindMetadata, Schema, Model, SchemaDefinitionError, ValidationResult,
} = require('@alexify/metaschema');

const { toJSONSchema, toTypeScript, saveTypes, fromJSONSchema, register } = require('@alexify/metaschema/generators');
const jit = require('@alexify/metaschema/compile'); // compile, compiled, register, canEval
const tools = require('@alexify/metaschema/model'); // fromJSON, diff, compatibility, compatibilityOf, sample, merge, infer, register
const records = require('@alexify/metaschema/stream'); // checkEach, parseEach, checkEachAsync, parseEachAsync, transform, register
const formats = require('@alexify/metaschema/formats'); // register, FORMATS
const derive = require('@alexify/metaschema/derive'); // pick, omit, partial, required, extend, keyof, register
const coercion = require('@alexify/metaschema/coerce'); // COERCIONS, coerce, register
const bson = require('@alexify/metaschema/mongodb'); // types, register, toDocument, fromDocument, fromDocumentAsync, indexesOf, checkUpdate, toUpdate
const definition = require('@alexify/metaschema/definition'); // KIND, KIND_STORED, KIND_MEMORY, SCOPE, STORE, ALLOW, getKindMetadata, Schema, Model, SchemaDefinitionError
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

`saveTypes` moved to the [generators subpath](#alexify-metaschema-generators) in 3.0.

## `Schema`

| Member | Description |
| --- | --- |
| `Schema.from(definition, namespaces?)` | an anonymous schema, a `Schema<D>` whose `D` is the definition's type |
| `new Schema(name, definition, namespaces?)` | a named schema, a `Schema<D>` as well; a `definition` that is already a `Schema` is returned as is (keeping its own name) with `namespaces` attached |
| `Schema.extractSchema(def)` | `def` or `def.schema` when it is a `Schema`, else `null` |
| `Schema.fromJSONSchema(document, options?)` | after `register()` of the generators subpath: `fromJSONSchema(document, options)`, a definition or a `Schema` from a [JSON Schema document](/guide/json-schema#importing-a-document) |
| `Schema.merge(a, b, options?)` | after `register()` of the model subpath: `merge(a, b, options)`, the [schema both schemas describe](/guide/schema-syntax#merging-schemas) |
| `Schema.infer(samples, options?)` | after `register()` of the model subpath: `infer(samples, options)`, a [definition the samples pass](/guide/infer), or a `Schema` with `as: 'schema'` |
| `schema.check(value, options?)` | validates a value; returns `ValidationResult`. `options`: `root` (the label of the error lines, the schema name by default), `maxErrors` (a whole number), `maxDepth` (embedded records, 128 by default), `unknown` (`'reject'` or `'ignore'`), `references` (`'kind'`, `'embed'` or `'id'`), `messages` (a locale or a function); see [Validation](/guide/validation#options). A validator that returns a promise is a `TypeError` with the code `ERR_ASYNC_VALIDATOR` |
| `schema.checkAsync(value, options?)` | the same check as a promise, with the validators and custom `checkType`s that return a promise in flight together and settled after the walk, in field order, a validator over a promise waiting for it; see [Async](/guide/parse#async) |
| `schema.parse(value, options?)` | validates a value and returns `{ valid, value, issues }`: the `default` of every missing key filled in, the check, `unknown: 'strip'`, the `parse` function of every field (the parts of a value before the value) and the schema's own `parse`; `value` is `undefined` when invalid and the value given when there was nothing to apply. `options`: those of `check`, with `unknown` also `'strip'`, and `coerce` (a boolean: convert the input to the types of the fields first, the schema's `coerce` metadata by default; see [Coercion](/guide/coercion)); see [Parse and serialize](/guide/parse) |
| `schema.parseAsync(value, options?)` | the same as a promise; validators and decoders may return promises |
| `schema.serialize(value, options?)` | the other direction, `{ value }`: the schema's own `serialize`, then the `serialize` function of every field from the value down to its parts; with `options.check` the result is validated and `{ valid, value, issues }` comes back, the other options being those of `check` |
| `schema.validate(value, path?)` | runs only the schema-level `validate`; `null` without one |
| `schema['~standard']` | the [Standard Schema v1](/guide/standard-schema) props `{ version: 1, vendor: 'alexify.metaschema', validate }`, built on first use; `validate(value, options?)` is `parse(value, options?.libraryOptions)` read as `{ value }` or `{ issues }`, or a promise of one when the schema has an `async function` among its validators, decoders and custom types. After `register()` of the generators subpath the props carry `jsonSchema` too: `input(options)` and `output(options)` are `toJSONSchema` for `options.target` (`draft-2020-12`, `draft-07` or `openapi-3.0`) with `options.libraryOptions` |
| `schema.toJSONSchema(options?)` | after `register()` of the generators subpath: `toJSONSchema(schema, options)`, the schema as a [JSON Schema](/guide/json-schema) document |
| `schema.toInterface(options?)` | after `register()`: `toTypeScript(schema, options)`, the schema as a TypeScript interface |
| `schema.coerce(value, options?)` | after `register()` of the coerce subpath: `coerce(schema, value, options)`, the value converted and its defaults filled, nothing checked |
| `schema.pick(keys, options?)`, `schema.omit(keys, options?)`, `schema.partial(options?)`, `schema.required(options?)`, `schema.extend(extension, options?)`, `schema.keyof(options?)` | after `register()` of the derive subpath: the functions of the subpath, so they chain (`schema.omit(['id']).partial()`) |
| `schema.sample(options?)` | after `register()` of the model subpath: `sample(schema, options)`, a [value the schema accepts](/guide/samples), the same for `options.seed` |
| `schema.checkEach(records, options?)` | after `register()` of the stream subpath: `checkEach(schema, records, options)`, a generator of `{ index, record, result }` over an iterable of [records](/guide/streaming); `options`: those of `check` and `maxInvalid` |
| `schema.parseEach(records, options?)` | after `register()`: `parseEach(schema, records, options)`, the same with `parse` |
| `schema.checkEachAsync(records, options?)` | after `register()`: `checkEachAsync(schema, records, options)`, an async generator over a sync or async iterable, `checkAsync` on each record, up to `options.concurrency` in flight |
| `schema.parseEachAsync(records, options?)` | after `register()`: `parseEachAsync(schema, records, options)`, the same with `parseAsync` |
| `schema.transform(options?)` | after `register()`: `transform(schema, options)`, a `TransformStream` that passes the valid records on as their parsed values (or as they are with `mode: 'check'`) and hands the others to `options.onInvalid`, or ends with `ERR_INVALID_RECORD` |
| `schema.checkConsistency()` | `Warning [missing-reference]`/`[missing-type]` strings for references and types that cannot be resolved through the attached models |
| `schema.warnings` | lint warnings of the definition, `Warning [code]: text`; see [Domain Models](/guide/model#warnings) |
| `schema.findReference(name)` | the entity `name` from the attached models, else the schema itself when `name` is its own, else `null` |
| `schema.attach(...models)` / `schema.detach(...models)` | add or remove namespaces |
| `schema.types` | the type table in effect |
| `schema.toJSON()` / `schema.toString()` | serialized fields |
| `schema.toSnapshot()` | the schema as plain JSON: the [snapshot](/guide/model#the-snapshot-of-one-schema) of format 1 holding the schema and every entity it reaches through its references, with the name of the schema as `root` |

Metadata properties: `name`, `kind`, `scope`, `store`, `allow`, `parent`, `unknown`, `fields`,
`indexes`, `options`, `custom`, `references`, `relations`, `namespaces`.

## `Model`

| Member | Description |
| --- | --- |
| `new Model(types, entities, database?, options?)` | builds every entity; `entities` is an iterable of `[name, definition]`; `options.registry` is `'shared'` (default) or `'isolated'`; `options.coercions` the [converters of coercion](/guide/coercion#converters-of-a-model) for the model's own type names, read before the process-wide table |
| `model.entities` | `Map<string, Schema>` |
| `model.types` | the type table |
| `model.coercions` | the frozen table of converters the model was given, or `null` |
| `model.database` | the `database` argument or `null` |
| `model.order` | `Set` of entity names, dependencies first |
| `model.warnings` | the `warnings` of every entity, their unresolved references and the recursive dependencies, as `Warning [code]: text`; see [Domain Models](/guide/model#warnings) |
| `model.dts`, `model.toTypeScript(options?)` | after `register()` of the generators subpath: `toTypeScript(model, options)`, the interfaces of every entity in dependency order |
| `model.toJSONSchema(options?)` | after `register()`: `toJSONSchema(model, options)`, every entity as a [JSON Schema](/guide/json-schema#models) definition, or the document of the entity `options.root` |
| `model.toJSON()` | the model as plain JSON, what `JSON.stringify(model)` writes: `{ format: 1, database, types, entities }`, the entities in dependency order with a fixed key order, a function as `{ $function: true }`; see [The snapshot](/guide/model#the-snapshot) |
| `Model.fromJSON(snapshot, options?)` | after `register()` of the model subpath: `fromJSON(snapshot, options)`, a model back from its snapshot |
| `Model.diff(prev, next)`, `Model.compatibility(changes)`, `Model.compatibilityOf(change)` | after `register()` of the model subpath: `diff`, `compatibility` and `compatibilityOf` of the subpath |

## `@alexify/metaschema/definition`

The half of the core that builds schemas and models and reads them, on its own (9.7 KB
min+gzip); see [The definition entry](/guide/definition). Its exports are the core's own:
`Schema`, `Model`, `getKindMetadata`, `SchemaDefinitionError` and the six constants. Until the
core entry is loaded too, `check`, `checkAsync`, `parse`, `parseAsync`, `serialize`,
`validate`, `checkConsistency`, `warnings`, the `check` of a field and `model.warnings` are a
`TypeError` with `code: 'ERR_NOT_REGISTERED'` (the async pair rejects with it), and a schema has
no `~standard`.

## `@alexify/metaschema/generators`

The generators of JSON Schema and TypeScript, and the import of a JSON Schema document, in a
subpath so that the core entry (20.3 KB min+gzip) does not carry them (7.6 KB more); see
[The generators subpath](/guide/json-schema#the-generators-subpath).

| Export | Description |
| --- | --- |
| `toJSONSchema(target, options?)` | the [JSON Schema](/guide/json-schema) document of a `Schema`, or of a `Model` (every entity as a definition, or `options.root`); `options`: `target` (`'draft-2020-12'`, `'draft-07'`, `'openapi-3.0'`, `'mongodb'`), `profile` (`'strict'`), `io` (`'input'`, `'output'`), `unrepresentable` (`'throw'`, `'any'`), `references` (`'kind'`, `'embed'`, `'id'`), `ids` (`'string'`, `'objectId'`: the mongodb target only, the ids of stored records and references as the database holds them), `definitions` (a pointer), `root` (a model) |
| `toTypeScript(target, options?)` | the TypeScript interface of a `Schema`, or the interfaces of every entity of a `Model` in dependency order; the `description` of a field as JSDoc, `deprecated: true` as `@deprecated`; `options.named` gives enums and nested structs types of their own; see [TypeScript](/guide/typescript#generating-interfaces-from-a-model) |
| `saveTypes(outputFile, target, options?)` | writes `toTypeScript(target, options)` to `outputFile`; returns `Promise<void>`; rejects in the browser |
| `fromJSONSchema(document, options?)` | a definition (or a `Schema` with `as: 'schema'`) from a [JSON Schema document](/guide/json-schema#importing-a-document); `options`: `name`, `as` (`'definition'`, `'schema'`), `references` (`'inline'`, `'name'`), `unsupported` (`'throw'`, `'ignore'`), `onUnsupported(reason, pointer)` (told of every drop in the ignore mode) |
| `register()` | installs `schema.toJSONSchema`, `schema.toInterface`, `model.toJSONSchema`, `model.toTypeScript`, `model.dts`, `Schema.fromJSONSchema` and `schema['~standard'].jsonSchema` on the classes, once per process |

A target that is neither a `Schema` nor a `Model` is a `TypeError`.

## `@alexify/metaschema/model`

The model as the source of truth, in a subpath of its own (12.4 KB min+gzip on top of the
core); see [Model evolution](/guide/evolution), [Sample values](/guide/samples) and
[Schema inference](/guide/infer).

| Export | Description |
| --- | --- |
| `fromJSON(snapshot, options?)` | a `Model` from the snapshot `model.toJSON()` gave, with placeholders for the functions; `options.types` brings the real custom types, `options.registry` is `'isolated'` unless `'shared'`; a value that is not a snapshot is `ERR_INVALID_SNAPSHOT` |
| `diff(prev, next)` | the changes from one `Model` or snapshot to another, as `{ kind, op, entity, name, from?, to?, detail? }` in the order of the new model; a field renamed through its `aliases` is `renamed`, a removed `deprecated` field carries `detail.deprecated` |
| `compatibility(changes)` | `'full'`, `'backward'`, `'forward'` or `'none'` by the [rules](/guide/evolution#compatibility) of the Confluent Schema Registry |
| `compatibilityOf(change)` | the class of one change of `diff`, by the same rules |
| `sample(schema, options?)` | a value the schema accepts, the same for `options.seed`; `options`: `seed`, `locale` (`'en'`, `'uk'`), `references`, `maxDepth`; a field no value satisfies is `ERR_UNSATISFIABLE`, a pattern it cannot read `ERR_SAMPLE_PATTERN`, a custom type without `metadata.sample` `ERR_SAMPLE_TYPE` |
| `merge(a, b, options?)` | the schema both schemas describe, by unification; `options`: `name`, `metadata`; what no value can satisfy is `ERR_MERGE_CONFLICT` |
| `infer(samples, options?)` | a definition (or a `Schema` with `as: 'schema'`) that accepts every sample of an iterable: the kinds of every place, records fused into one struct with optional keys, `enum`, dictionaries, `integer`, a registered [format](/guide/formats) every string passes; `options`: `as`, `name`, `kind`, `enum`, `integer`, `map`, `maxDepth`, `formats`; a sample nested past `maxDepth` is `ERR_INFER_DEPTH`, a definition that rejects a sample `ERR_INFER_MISMATCH` |
| `register()` | installs `Model.fromJSON`, `Model.diff`, `Model.compatibility`, `Model.compatibilityOf`, `Schema.merge`, `Schema.infer` and `schema.sample` on the classes, once per process |

A `sample` or `merge` target that is not a `Schema` is a `TypeError` with `code:
'ERR_INVALID_TARGET'`, as is a `compatibility` argument that is not a list and an `infer`
argument that is not a non-empty iterable.

## `@alexify/metaschema/compile`

The JIT backend, in a subpath of its own (4.4 KB min+gzip on top of the core); see
[The JIT backend](/guide/compile).

| Export | Description |
| --- | --- |
| `compile(target, options?)` | replaces the check of a `Schema`, or of every entity of a `Model`, with one function generated from the schema and built with `new Function`; the issues are the ones the closures record; returns `{ accelerated, error }`: `accelerated` is `false` where code generation from strings is not allowed (the closures stay, no `error`) and where a check could not be generated (`error` is the `ERR_JIT_BUILD` error with the generator's error as `cause`); `options.jit`: `'auto'` (the default: fall back), `true` (throw `ERR_NO_EVAL` or `ERR_JIT_BUILD` instead; a model all or nothing), `false` (never generate code; restores the closures of a compiled schema) |
| `register(options?)` | compiles every schema built from then on with these options; a later call replaces them, `{ jit: false }` stops it; a schema built before the call is not touched; `options.onFallback(schema, error)` is told of every schema whose check could not be generated |
| `canEval()` | whether this environment allows code generation from strings, probed once |
| `compiled(target)` | whether the check of a `Schema` (of every entity of a `Model`) runs generated code now: `false` for a schema built before `register()` and after `{ jit: false }` |

A target that is neither a `Schema` nor a `Model` is a `TypeError`; an option with a value it
does not accept is `ERR_INVALID_OPTIONS`. The types of the subpath are `CompileOptions`
(`{ jit?: 'auto' | boolean; onFallback?: (schema, error) => void }`) and `Compiled`
(`{ accelerated: boolean; error?: SchemaDefinitionError }`).

## `@alexify/metaschema/stream`

A schema over a sequence of records, in a subpath of its own (0.9 KB min+gzip on top of the
core); see [Records and streams](/guide/streaming).

| Export | Description |
| --- | --- |
| `checkEach(schema, records, options?)` | a generator over an iterable of records: `check` on each, yielding `{ index, record, result }` in order; `options`: those of `check`, and `maxInvalid` (the number of invalid records after which the iteration ends) |
| `parseEach(schema, records, options?)` | the same with `parse`; `result` is `{ valid, value, issues }`; `options`: those of `parse`, and `maxInvalid` |
| `checkEachAsync(schema, records, options?)` | an async generator over a sync or async iterable: `checkAsync` on each record, up to `options.concurrency` records in flight (1), the entries in the order of the records; the promises in flight when the iteration ends early are observed, never awaited |
| `parseEachAsync(schema, records, options?)` | the same with `parseAsync` |
| `transform(schema, options?)` | a `TransformStream` (a global since Node.js 18, and in browsers) that passes every valid record on as its parsed value (`mode: 'parse'`) or as it is (`mode: 'check'`), hands an invalid one to `options.onInvalid(record, result, index)` and drops it, or ends the stream with a `TypeError` of `code: 'ERR_INVALID_RECORD'` (carrying `index`, `record` and `result`) when there is no `onInvalid` or `maxInvalid` is reached; `async: true` runs the async methods, one record at a time |
| `register()` | installs `schema.checkEach`, `schema.parseEach`, `schema.checkEachAsync`, `schema.parseEachAsync` and `schema.transform` on the class, once per process |

A target that is not a `Schema`, or a source that is not iterable (a string included), is a
`TypeError` with `code: 'ERR_INVALID_TARGET'`; a wrong option of the subpath is a `TypeError`
with `code: 'ERR_INVALID_OPTION'`, like a wrong option of `check` (`maxInvalid must be an
integer of at least 1, got 0`).

## `@alexify/metaschema/formats`

The formats a string field may name with the [`format`](/guide/formats) rule, in a subpath of
its own (3.9 KB min+gzip on top of the core); the rule is the core's, the table of formats the
subpath's, empty until `register()` ran.

| Export | Description |
| --- | --- |
| `register(custom?)` | registers the 35 [built-in formats](/guide/formats#the-built-in-formats) and the program's own (`{ phone: { test, examples, infer?, pattern? } }`), once per name, process-wide; the same `test` again is nothing, another under a name the program registered `ERR_FORMAT_REGISTERED`, the program's own under the name of a built-in takes its place, an entry that is not a format `ERR_INVALID_FORMAT`; returns the names of the built-in formats the call replaced (`[]` otherwise) |
| `FORMATS` | the table of the registered formats by name, `{ test, examples, infer, pattern? }` each, to read |

A schema that names a format the table lacks is `ERR_INVALID_RULE` when it is built. The type
of an entry is `FormatDefinition`.

## `@alexify/metaschema/derive`

Schemas made from a schema of a struct, in a subpath of its own (2.0 KB min+gzip on top of the
core); see [Deriving schemas](/guide/derive). Each builds a new `Schema` from the definition the
source was built from, with `options.name` (the source's by default) and `options.metadata`
(over the source's; a stored kind or a projection is a struct, keeping `unknown`).

| Export | Description |
| --- | --- |
| `pick(schema, keys, options?)` | the fields named, in the order of the schema; the id of a stored kind only when named; the schema's own functions are left out |
| `omit(schema, keys, options?)` | every field but the ones named |
| `partial(schema, options?)` | every field (or `options.keys`) optional, without its `default` unless `options.defaults`; `options.deep` goes into nested structs, not into collections, tuples, unions or references; the schema's own functions are left out |
| `required(schema, options?)` | every field (or `options.keys`) required, the defaults kept; `options.deep` |
| `extend(schema, extension, options?)` | the fields of `extension` (an object of fields or a Schema of a struct) over the schema's: one of the same name in its place, the others after |
| `keyof(schema, options?)` | a schema of an `enum` of the names of the fields a value carries; `options.name` only (a schema of an enum has no kind: a `metadata` is `ERR_INVALID_OPTIONS`) |
| `register()` | installs the six as methods of `Schema`, once per process |

A key the schema has no field of is `ERR_UNKNOWN_FIELD`, located in the schema; keys that are
not a list of names and options that are not an object are a `TypeError` with
`code: 'ERR_INVALID_OPTION'` (the call is wrong), a `metadata` that is not an object
`ERR_INVALID_OPTIONS` (a definition is); a target that is not a Schema of a struct is a
`TypeError` with `code: 'ERR_INVALID_TARGET'`.

## `@alexify/metaschema/coerce`

The converters of [coercion](/guide/coercion), in a subpath of its own (1.8 KB min+gzip on top
of the core); the policy (`coerce` of a parse call, of the kind metadata, of a field) and the
step in the pass before the check are the core's.

| Export | Description |
| --- | --- |
| `register(custom?, options?)` | installs the built-in converters (`string`, `number`, `integer`, `bigint`, `boolean`, `date`, `enum`, `array`, `set`, `map`) and the program's own by type name (`{ point: (value, field) => value }`), once per name, process-wide, every entry checked before any is written; another function under a registered name is `ERR_COERCION_REGISTERED`, a name that is not one of a type or an entry that is not a function `ERR_INVALID_COERCION`; `options.onError(error, field)` is told of a converter that threw; adds `schema.coerce` |
| `coerce(schema, value, options?)` | the pass parse runs before its check with coercion on: the value converted and its defaults filled, nothing checked; `options`: `references`, `maxDepth`, `report` (an array given the path of every key the pass changed) |
| `COERCIONS` | the table of the converters by type name, to read |

A parse that coerces (by the call, the kind metadata or a field's own `coerce: true`) before
`register()` ran is a `TypeError` with `code: 'ERR_NOT_REGISTERED'`, thrown as the pass
enters the schema, whatever the value holds. The type of a converter is `Coercion`.

## `@alexify/metaschema/mongodb`

The schema side of a MongoDB program, in a subpath of its own (3.6 KB min+gzip on top of the
core and `./coerce`, which it requires), without a dependency on the driver and without I/O;
see [MongoDB](/guide/mongodb).

| Export | Description |
| --- | --- |
| `types` | the BSON types `objectId`, `decimal128`, `binary` to give a model (`new Model({ ...types }, entities)`); a value is one by its `_bsontype` and a method, never by `instanceof` |
| `register({ bson })` | keeps the module of the driver (or of bson) and installs the converters of the BSON types the module can build (`Decimal128`, `Binary` when it has them) into `./coerce`; another module after the first is a `TypeError` |
| `toDocument(target, value, options?)` | the document of a value: serializers run, the id of a stored record as `_id` (an `_id` beside it in the value is left out), ids of references as ObjectIds; `options`: `ids` (`'objectId'`, `'string'`), `references`, `maxDepth` (128: a record deeper is left as it is for the check); a value of a class at the root is `ERR_INVALID_TARGET` |
| `fromDocument(target, document, options?)`, `fromDocumentAsync(…)` | `_id` back to the id field, ObjectIds to hex strings, then `parse` (`parseAsync`) with `coerce: true` unless the options say otherwise; `null` (what `findOne` gives for nothing) is a `type` issue |
| `indexesOf(target)` | the indexes of a schema for `createIndexes`, or of every stored entity of a model by name |
| `checkUpdate(target, update, options?)` | the issues of an update of the driver (`$set`, `$unset`, `$inc`, `$push`, …) against the schema, as a `ValidationResult`; `options`: those of `check` (`unknown` decides a key a struct does not have; a path with an empty segment, into a part a field cannot have, or to the `_id` of the document is `unexpected` whatever it says, one through more records than `maxDepth` a `depth` issue) |
| `toUpdate(target, update, options?)` | the update as the database takes it: values serialized, ids as ObjectIds, the id as `_id` |

`toDocument` and `toUpdate` with `ids: 'objectId'` (the default) before `register()` are a
`TypeError` with `code: 'ERR_NOT_REGISTERED'`: an ObjectId is built by the driver. Reading a
document needs no driver (`fromDocument` parses with `coerce: true`, which needs `register()`
of `./coerce`, the one `register({ bson })` runs too). A target that is not a Schema of a
struct (or a Model, for `indexesOf`) and an update that is not an object of operators are
`ERR_INVALID_TARGET`.

## Runtime errors

Validation of data never throws because of the value. A synchronous `check` or `parse` throws a
`TypeError` with `code: 'ERR_ASYNC_VALIDATOR'` when a `validate` function, a custom type's
`checkType` or a field's `parse` function returns a promise; `checkAsync` and `parseAsync` await
them. A `transform` of the stream subpath ends its stream with a `TypeError` with
`code: 'ERR_INVALID_RECORD'` for an invalid record it was not told to drop. A parse that
coerces before `register()` of the coerce subpath (as it enters the schema, whatever the value
holds), a document or an update written with ObjectIds before `register({ bson })` of the
mongodb subpath, and a schema of the [definition entry](/guide/definition) asked to validate
before the core entry was loaded, is a `TypeError` with `code: 'ERR_NOT_REGISTERED'`. An option of a call that
is not what it must be (`maxErrors`, `references`, the `coerce` of a parse, the options of the
stream, derive and mongodb subpaths) is a `TypeError` with `code: 'ERR_INVALID_OPTION'`; the
kind metadata and the `metadata` of `merge` and `derive` are definitions, and a wrong one is a
`SchemaDefinitionError` with `ERR_INVALID_OPTIONS`. The type of the codes is
`RuntimeErrorCode`.

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
| `result.toJSON()` | `{ valid, issues }`: what `JSON.stringify(result)` writes |
| `result.add(error, code?)` | adds `false`, a string, a `{ code, message, path?, params? }` object, an array of them or another result, with `code` (default `custom`) for entries that carry none; `true`, `null` and `undefined` add nothing |
| `ValidationResult.issuesOf(error, path?, code?)` | the issues `add` would produce, under the `path` keys |
| `ValidationResult.isInstance(value)` | whether `value` is a result, from any copy of the package |

## Locales

`@alexify/metaschema/locales/en` and `@alexify/metaschema/locales/uk` export a locale each: a
table with one renderer per issue code (`required`, `type`, `unexpected`, `enum`, `length`,
`range`, `pattern`, `format`, `union`, `reference`, `circular`, `depth`, `exception`, `custom`) and `field(path)` for the location prefix. Pass one
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
| `ERR_INVALID_DEFINITION` | a field definition that is not a string, object, array or function, or `flags` without a list of distinct names |
| `ERR_UNKNOWN_TYPE` | a lowercase type name that is not registered |
| `ERR_MISSING_SCHEMA` | the `schema` type, or an alias of it, without `{ schema: { ... } }` |
| `ERR_INVALID_TUPLE` | a tuple whose definition is not an array, or an element that is a function |
| `ERR_INVALID_UNION` | a `union` without branches, a branch that is a function, or a `discriminator` that is not a field name, that a branch lacks or does not hold as an `enum`, or whose value two branches share |
| `ERR_PROJECTION` | a projection without `schema`/`fields`, with an unknown parent, or naming a field the parent does not have |
| `ERR_INVALID_CUSTOM_TYPE` | a custom type entry without `construct` and `checkType` functions |
| `ERR_INVALID_ENUM` | the `enum` type without a non-empty `enum` list |
| `ERR_INVALID_LENGTH` | a `length` rule that is not a number, `[min, max]` or `{ min, max }`, or whose `min` is above its `max` |
| `ERR_INVALID_RULE` | a rule on a type that does not accept it (`length` on a number, `min` on a string, `decimals` on anything but a number), a `min`/`max` that is not a number or a bigint, a `max` below `min`, `decimals` that is not an integer from 0 to 15, or a `pattern` that is not a string or `RegExp` or does not compile, a `format` the table does not have (the [formats subpath](/guide/formats) registers them) or on a type other than `string` |
| `ERR_INVALID_REFERENCE` | `one` or `many` without an entity name |
| `ERR_TYPE_REGISTERED` | a custom type entry that redefines a registered name (only `{ metadata }` may be added) |
| `ERR_UNKNOWN_JS_TYPE` | a `js` alias that names no registered type |
| `ERR_INVALID_OPTIONS` | a `Model` option, the `unknown` or `coerce` metadata of a schema, an option of `toJSONSchema` (an unknown target, the strict profile with another target or a root that is no struct, a root entity the model does not have, `ids` with a target other than mongodb), an option of `sample` or `infer`, the keys or options of a derive function, or the `jit` option of `compile`/`register` with a value it does not accept |
| `ERR_NO_EVAL` | `compile` or `register` of the compile subpath with `jit: true` where code generation from strings is not allowed; see [The JIT backend](/guide/compile#the-jit-option) |
| `ERR_JIT_BUILD` | the check of a schema could not be generated (the generator's error is the `cause`): thrown with `jit: true`, returned as `compile().error` and given to `onFallback` in the default mode |
| `ERR_UNREPRESENTABLE` | two schemas of one name in what `schema.toSnapshot()` reaches; a type with no form in the JSON Schema target (a `bigint`, a `date`, `bytes`, `set` or `map` on the output side, a custom type without metadata, a tuple for openapi-3.0, a cycle for mongodb, a value without a type in the strict profile) when `unrepresentable` is `'throw'`; see [JSON Schema](/guide/json-schema#input-and-output) |
| `ERR_UNSUPPORTED_SCHEMA` | a keyword of a JSON Schema document outside the subset `fromJSONSchema` reads, with its place as a JSON pointer, when `unsupported` is `'throw'`; see [Importing a document](/guide/json-schema#importing-a-document) |
| `ERR_INVALID_SNAPSHOT` | `fromJSON` or `diff` of the model subpath given a value that is not a snapshot of format 1, a snapshot with a broken entity, field or type, or a `root` that names none of its entities |
| `ERR_UNSATISFIABLE` | `sample` found a field no draw satisfies (an object with number keys, a pattern a length contradicts, a `validate` that rejects everything, a reference the model does not have, a required reference nested deeper than `maxDepth`); the message names the field and the reason |
| `ERR_SAMPLE_PATTERN` | a `pattern` outside the subset `sample` reads (a lookaround, a back reference, a word boundary, another Unicode property) |
| `ERR_SAMPLE_TYPE` | a custom type with a check of its own and no `metadata.sample` |
| `ERR_MERGE_CONFLICT` | `merge` met what no value can satisfy: two types, two patterns, bounds or enums with nothing in common, two defaults, two decoders, two unions, two formats, a calculated field or an index that differs; the message names the field |
| `ERR_INFER_DEPTH` | `infer` met a sample nested deeper than `maxDepth` (a cycle, most likely); the message names the sample and the place |
| `ERR_INFER_MISMATCH` | the definition `infer` built rejects one of its samples (the id field of a stored kind, or a bug of the inference); `error.index` is the sample |
| `ERR_INVALID_FORMAT` | an entry given to `register` of the formats subpath is not a format (no `test` function, no example strings, an `infer` that is not a boolean, a `pattern` that is not a string or does not compile under the `u` flag) |
| `ERR_FORMAT_REGISTERED` | a format name the program registered, registered again with another `test` |
| `ERR_UNKNOWN_FIELD` | a function of the derive subpath was given a key the schema has no field of; the message names the schema and the key |
| `ERR_INVALID_COERCION` | an entry given to `register` of the coerce subpath is not a converter of a type (a name not led by a lowercase letter, a value that is not a function) |
| `ERR_COERCION_REGISTERED` | a converter name registered again with another function |
| `ERR_RESERVED_KEY` | a field definition key that names a method of the field (`check`, `construct`, `constructor`, …) or `__proto__`/`prototype` |

## Types

`index.d.ts` exports the static inference of value types from definitions; see
[TypeScript](/guide/typescript#inferring-types-from-a-schema):

| Type | Meaning |
| --- | --- |
| `Infer<D, E?>` | the type of a value `check` and `parse` accept for the definition type `D` (a key with a `default` may be left out); `E` is an optional entity map (an object of definitions by name) that resolves references to memory kinds and projections |
| `InferOutput<D, E?>` | the type of the value `parse` gives: `Infer` with the result of every `parse` function in place of the value it decodes and every defaulted key present; see [TypeScript](/guide/typescript#the-output-of-parse) |
| `ParseResult<T>` | what `parse` returns: `{ valid: true, value: T, issues: [] }` or `{ valid: false, value: undefined, issues }` |
| `ParseOptions` | the options of `parse`: `CheckOptions` with `unknown` also `'strip'`, and `coerce` (whether the input is converted before the check; the kind metadata's default) |
| `CoerceOptions` | the options of `coerce` of the coerce subpath: `references`, `maxDepth` |
| `SerializeOptions`, `Serialized<T>`, `SerializeChecked<T>` | the options of `serialize` (`CheckOptions` and `check`) and its two results |
| `RuntimeErrorCode` | `'ERR_ASYNC_VALIDATOR'` (a synchronous call met a promise), `'ERR_INVALID_TARGET'` (a function of a subpath was given something other than what it takes), `'ERR_INVALID_OPTION'` (an option of a call is not what it must be), `'ERR_INVALID_RECORD'` (a stream met an invalid record), `'ERR_NOT_REGISTERED'` (a converter or a driver that was not registered, or a schema of the definition entry asked to validate without the core) |
| `InferSchema<S>` | `Infer<D>` of a `Schema<D>` instance type: `InferSchema<typeof schema>` |
| `InferEntity<E, Name>` | the entity `Name` of the map `E`, with the id field a stored kind adds (`personId?: string`) |
| `CustomTypes` | an empty interface to augment with the value type of each custom type (`interface CustomTypes { datetime: string }`); an unknown name infers as `unknown` |
| `Schema<D>` | the class, generic over its definition; `Schema` on its own is any schema |
| `StandardProps<D>` | the type of `schema['~standard']` of a `Schema<D>`: `version`, `vendor`, `validate` and the type-level `types` (`input: Infer<D>`, `output: InferOutput<D>`); see [Standard Schema](/guide/standard-schema#typescript) |
| `StandardResult<T>` | what `validate` returns, or a promise of: `{ value: T }` or `{ issues: ReadonlyArray<ValidationIssue> }` |
| `StandardOptions` | the options of `validate`: `libraryOptions`, the `ParseOptions` of the call |
| `StandardConverter` | the type of `schema['~standard'].jsonSchema`: `input` and `output`, from `StandardJSONSchemaOptions` (`target` and `libraryOptions`) to `JSONSchema` |
| `JSONSchema` | what `toJSONSchema` returns: `Record<string, unknown>` |
| `JSONSchemaOptions`, `ModelJSONSchemaOptions`, `JSONSchemaTarget` | the options of `schema.toJSONSchema`, those of `model.toJSONSchema` (plus `root`), and the four targets |
| `InterfaceOptions` | the options of `toTypeScript`, `toInterface` and `saveTypes`: `named` |
| `FromJSONSchemaOptions` | the options of `fromJSONSchema`: `name`, `as`, `references`, `unsupported`, `onUnsupported` |
| `ModelSnapshot`, `EntitySnapshot`, `FieldSnapshot`, `FieldsSnapshot`, `FunctionSnapshot`, `TypeSnapshot` | what `model.toJSON()` returns and its parts; `FieldSnapshot` is a union that narrows on `type` (`StringFieldSnapshot`, `NumberFieldSnapshot`, `IntegerFieldSnapshot`, `ScalarFieldSnapshot`, `EnumFieldSnapshot`, `FlagsFieldSnapshot`, `ListFieldSnapshot`, `KeyedFieldSnapshot`, `TupleFieldSnapshot`, `StructFieldSnapshot`, `UnionFieldSnapshot`, `ReferenceFieldSnapshot`, `CustomFieldSnapshot`), over `FieldSnapshotBase`, with `LengthSnapshot`, `BigintSnapshot`, `DateSnapshot` and `TupleElementSnapshot` |
| `SchemaSnapshot` | what `schema.toSnapshot()` returns: a `ModelSnapshot` with `root` and no `database` |
| `RestoreOptions` | the options of `fromJSON`: `types`, `registry` |
| `SchemaChange`, `ChangeKind`, `ChangeOp`, `Compatibility` | a change of `diff`, its `kind` and `op`, and the class `compatibility` returns |
| `SampleOptions`, `MergeOptions`, `InferOptions` | the options of `sample` (`seed`, `locale`, `references`, `maxDepth`), of `merge` (`name`, `metadata`) and of `infer` (`as`, `name`, `kind`, `enum`, `integer`, `map`, `maxDepth`, `formats`) |
| `FormatDefinition` | an entry of the formats subpath: `{ test: (value: string) => boolean; examples: readonly string[]; infer?: boolean; pattern?: string }` |
| `Coercion`, `RegisterOptions` | a converter of the coerce subpath: `(value: unknown, field: FieldType) => unknown`; the options of its `register` (`onError`) |
| `BSONModule`, `ObjectIdLike`, `Decimal128Like`, `BinaryLike` | the mongodb subpath: the module of the driver `register` takes (`ObjectId`, and `Decimal128`, `Binary` when it has them) and what the subpath reads of their values (`_bsontype` and a method) |
| `DocumentOptions`, `IndexDescription`, `Update`, `UpdateOperator` | the mongodb subpath: the options of `toDocument`/`toUpdate` (`ids`, `references`), an index as `createIndexes` takes it, an update of the driver and its operators |
| `EachOptions`, `ParseEachOptions`, `EachAsyncOptions` | the options of `checkEach` (`CheckOptions` and `maxInvalid`), of `parseEach` (`ParseOptions` and `maxInvalid`) and the one the async pair adds (`concurrency`) |
| `TransformOptions` | the options of `transform`: `ParseOptions`, `mode`, `async`, `onInvalid`, `maxInvalid` |
| `RecordEntry<T, R>` | what the generators of the stream subpath yield: `{ index, record: T, result: R }`, `T` the type of the records of the source |

It also exports `Kind` (the known kinds plus any custom name), `KnownKind`, `Scope`,
`Store`, `Allow`, `Cardinality`, `Relation`, `Fields`, `FieldType`, `CalculatedField`,
`TypeTable`, `TypeConstructor`, `TypeEntry` (an entry of the table passed to `Model`),
`KindMetadata`, `SchemaOptions`, `ModelOptions`, `CheckOptions`, `CheckContext`, `ResultOptions`, `StandardJSONSchemaOptions`,
`Validator`, `ValidationReturn`, `ValidationIssue` (a union by code), `IssueOf<Code>`,
`IssueParams`, `IssueInput`, `IssueCode`, `Locale`, `Messages`, `FlatIssues`, `IssueTree` and
`DefinitionErrorCode`.
