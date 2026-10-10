# Changelog

All notable changes to **`@alexify/metaschema`** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **JSON Schema export.** `schema.toJSONSchema(options)` renders the rules of `check` as a
  JSON Schema document and `model.toJSONSchema(options)` every entity of a model as a
  definition (`$defs`, `definitions` or `components.schemas` by target), or the document of
  `options.root`. Targets: `draft-2020-12` (the default), `draft-07`, `openapi-3.0` (a schema
  object: `nullable`, no type lists, `oneOf` with `discriminator` for a discriminated union)
  and `mongodb` (a `$jsonSchema` validator: `bsonType`, references inlined, no `$ref`,
  `format` or `default`, `_id` allowed at the root). A struct is a closed object with its
  required keys (open when the root says `unknown: 'ignore'`), an optional or nullable field
  accepts `null`, `length`/`pattern`/`min`/`max` are the matching keywords, a required
  `object` or `map` has `minProperties: 1` as `check` requires, a tuple is `prefixItems` (an
  `items` list before 2020-12), a union is `anyOf`, an enum of one value is `const`, and a
  reference follows the kind of its target (an id for a stored kind, a `$ref` for a memory
  kind; `references: 'kind' | 'embed' | 'id'` as in `check`). `title`, `description`,
  `default`, `examples` and `deprecated` pass through where the dialect has them; a custom type
  renders through `metadata.jsonSchema` (`metadata.bson` for mongodb) or the built-in it
  aliases. `io: 'input'` (the default) describes the JSON a value is parsed from (a `date` is a
  `date-time` string, a `set` an array of unique items, a `map` an object); `io: 'output'`
  describes the value itself, where those three have no form. What has no form in the target
  (`bigint`, a tuple for openapi-3.0, a cycle for mongodb, a custom type without metadata)
  throws `SchemaDefinitionError` with the new code `ERR_UNREPRESENTABLE`, located in the
  schema and the field, or renders as `{}` with `unrepresentable: 'any'`. `validate`
  functions, custom `checkType`s, calculated fields, indexes and kind metadata are not
  exported.
- **The strict profile.** `toJSONSchema({ profile: 'strict' })` renders the dialect of LLM
  structured outputs (OpenAI, Anthropic): an object at the root, every property listed as
  required (an optional one as `['T', 'null']`, an optional `$ref` as an `anyOf` with null),
  `additionalProperties: false` on every object, and the structure only: `minLength`,
  `maxLength`, `pattern`, `minimum`, `maximum`, `minItems`, `maxItems`, `uniqueItems` and
  `minProperties` are left out, and a value without a type (`any`, `json`, an `object` or
  `map` of free keys) has no form. For the `draft-2020-12` and `draft-07` targets.
- **Standard JSON Schema.** `schema['~standard'].jsonSchema` is the converter of the
  specification: `input(options)` and `output(options)` are `toJSONSchema` for the `target` the
  consumer names (`draft-2020-12`, `draft-07` or `openapi-3.0`; anything else throws, as the
  specification asks) with `libraryOptions` as the other options. A `Schema<D>` is a
  `StandardJSONSchemaV1<Infer<D>, Infer<D>>`; the typings add `StandardConverter` and
  `StandardJSONSchemaOptions`.
- **JSDoc and named types in the generated TypeScript.** The `description` of a field is the
  JSDoc of its member and `deprecated: true` adds `@deprecated`. `model.toTypeScript({ named:
  true })` and `schema.toInterface({ named: true })` give every enum a `type` and every nested
  struct an `interface`, named after the entity and the field (`type UserRole`, `interface
  UserName`) and rendered before the interface that uses them; `model.dts` is
  `model.toTypeScript()`, and `saveTypes(file, model, options)` passes the options on.
  `InterfaceOptions` is the type of the options.
- **Typings** for the export: `JSONSchema` (`Record<string, unknown>`), `JSONSchemaOptions`,
  `ModelJSONSchemaOptions`, `JSONSchemaTarget`, and `ERR_UNREPRESENTABLE` in
  `DefinitionErrorCode`.

### Changed

- **The bundle is 15.7 KB min+gzip** (2.0 was 12.6 KB): the JSON Schema export lives in the
  core, since `~standard.jsonSchema` has to be on the schema object, and costs 3 KB with the
  dts annotations. CI gates at 16 KB (`pnpm size --max-gzip 16`).

### Fixed

- **A struct rejects an array.** `check` accepted `[]` for a struct whose fields are all
  optional (`typeof [] === 'object'`, no keys to look at); an array is now `not of expected
  type: object`, as it is for a struct with required fields. Found by the differential test
  against ajv.

### Tooling

- `ajv` and `ajv-formats` are devDependencies, used by `tests/unit/jsonschema-ajv.test.js`: for
  values a deterministic generator produces from the schemas (every form of the language, the
  fixture model, references by kind, embedded and as ids), `check` and ajv over `toJSONSchema`
  must agree on every verdict, for draft 2020-12 and draft-07. The known differences (UTF-16
  units against code points, instances on the output side, number keys) are documented in the
  file and in the guide.
- New test suites: `jsonschema` (every form by target, the strict profile, the mongodb target,
  the fixture model, the Standard converter), `jsonschema-ajv`, `dts` (JSDoc and named types),
  `tests/types/jsonschema.test-d.ts`; the bundle and saveTypes tests cover the new API.

## [2.0.0] - 2026-10-10

2.0 rewrites the validation core and settles the semantics of the schema language. Every check
is compiled into a closure when the schema is built and runs in a context of its own; issues
are data (a code, the path as an array of keys, the params the message is made from), messages
are rendered through a locale at the end of a check, and `check` takes an options object. The
first key of a definition decides what it is, numbers are bounded by `min` and `max`, a
reference follows the kind of its target, and `integer`, `date`, `null`, `any`, `union`,
`nullable` and `pattern` join the language. TypeScript infers the type of a value from the
definition (`Infer`), and every schema is a Standard Schema. Everything that changes the shape
of a result or the meaning of a definition is listed under Upgrading; the rest is additive.

### Upgrading from 1.x

The same guide with before-and-after examples is
[Migrating from 1.x](https://metaschema.vercel.app/guide/migrating-from-1).

**Validation**

- **`check(value, path, options)` → `check(value, options)`.** The root label of the error
  lines is `options.root`: `schema.check(value, 'body', { maxErrors: 1 })` becomes
  `schema.check(value, { root: 'body', maxErrors: 1 })`, and a string in place of the options
  throws a `TypeError` that says so. The options are `root`, `maxErrors`, `unknown`,
  `references` and `messages`.
- **`issue.path` is an array of keys** (`['tags', 1, 'name']`, what Standard Schema expects),
  not a string, and it never includes the root. `issue.message` describes the problem without
  its location (`is required`) and `issue.params` carries what it was made from
  (`{ expected: 'number', received: 'string' }`); the line with the location is
  `result.errors[i]` (`Field "User.name" is required`), rendered on first use. A key that is
  not an identifier is bracketed (`o["a.b"]`, was `o.a.b`) and a tuple element is addressed by
  index (`point[1]`, was `point(item1)` or `point(y1)` for a named element). A `validate`
  function may return `{ code, message, path, params }` of its own; its `path` (a key or an
  array of keys) is relative to the field (`{ message, path: 'x' }` on `a` reports `a.x`; 1.x
  ignored it).
- **Unknown keys are one issue per struct**: `{ code: 'unexpected', params: { keys } }` at the
  path of the struct, rendered as `Field "" has unexpected keys: b, c` (was one
  `Field "b" is not expected` per key), and `maxErrors` counts them as one.
  `check(value, { unknown: 'ignore' })` accepts them, and `{ Form: { unknown: 'ignore' }, ... }`
  makes that the default of the schema.
- **A type failure cancels the rules and `validate` of the field.** A field is checked in the
  order type, rules, `validate`, each step only when the one before it passed; 1.x reported
  `not of expected type: string`, the `length` message and the validator's message together.
  The schema-level `validate` runs after the fields and only when every field passed (it used
  to run first, and always).
- **`new ValidationResult(path)` → `new ValidationResult(options?)`** (`{ root, messages }`). A
  result a `validate` function returns is relative to its field, so build it with no arguments
  and `add` messages. `ValidationResult.format` is gone;
  `ValidationResult.issuesOf(error, path?, code?)` takes the path as keys.
- **Cycle detection lives at references.** A value that refers back to itself is reported as
  `circular` where a reference (`'Category'`, `{ many }`) meets it again, as before; a schema
  without references cannot recurse, so such a value is walked as far as the schema goes and
  reported for what it is (unexpected keys, wrong types, or nothing) instead of as `circular`.
- **The tuple length message** is `exceeds the maximum length` with `params: { max, actual }`
  (was `value length is more than expected in tuple`). The wording of every other message is
  unchanged.
- **Warnings carry a code**: `Warning [missing-reference]: "Customer" referenced by "Order" is
  not found` (was `Warning: "Customer" ...`), `Warning [recursive-reference]: ...`, and the new
  lint adds `unknown-option`, `unbounded-pattern` and `missing-index-field` to `model.warnings`,
  which is computed on first use.
- **`field.check(value, context, key)`** is the compiled check of a field and records into the
  context of a check; call `schema.check`. `compile` joins the reserved keys of a field
  definition (`ERR_RESERVED_KEY`).

**The schema language**

- **The first key of an object decides what it is.** The long form is read only when `type` is
  the first key; a capitalized first key is a kind, a type name is that type's shorthand, and
  any other first key is a nested struct. `{ name: 'string', type: 'string' }` is a struct with
  two fields (1.x read it as a string); `{ required: false, type: 'string' }` throws
  `ERR_INVALID_DEFINITION`. A struct whose first field is called `type`, or named like a type
  (`date`, `null`, `any`, `unknown`, `integer` and `union` are type names now), needs a kind
  (`{ Struct: {}, ... }`) or the `schema` shorthand; `schema.warnings` reports the options such
  a struct would otherwise leave on the type.
- **`length` on a number is an error.** `number`, `bigint` and the new `integer` are bounded by
  `min` and `max`: `{ type: 'number', length: [18, 120] }` becomes
  `{ type: 'integer', min: 18, max: 120 }`. A `length` there throws `ERR_INVALID_RULE` with
  that hint, and a failed bound is a `range` issue (`is greater than 120`), not `length`
  (`exceeds the maximum length`). Every type lists the rules it accepts, so `min` on a string
  or `length` on a boolean throws too; a custom type opts in with `rules: [...]`, and an alias
  takes the rules of its base. A `length` whose `min` is above its `max` throws
  `ERR_INVALID_LENGTH` (1.x accepted it).
- **A reference follows the kind of its target.** A reference to a stored kind (`Entity`,
  `Registry`, ...) validates as an id (`employer: 'c1'`, `addresses: ['a1']`) and a reference
  to a memory kind (`Struct`, `Form`, ...) as the record; 1.x always expected the record and
  rejected an id as `not of expected type: object`. Validate a whole graph with
  `check(value, { references: 'embed' })`, rows with `{ references: 'id' }`, or fix one field
  with `embed: true`/`false`. An id never recurses, so a cyclic value through stored kinds is a
  type error, not `circular`. The generated TypeScript follows the same rule, so a memory-kind
  reference renders as its interface (`label: Tag`) instead of `labelId: string`.
- **`set` renders as `Set<T>`** in the generated TypeScript (it was `T[]` while `check`
  accepted only a `Set`; `map` was already `Map<K, V>`).
- **The `relations` labels are swapped** to the conventional direction, read from the
  referencing side: a `many` field is `'one-to-many'` and a single reference `'many-to-one'`.
- **A tuple element may be any definition**, not only a scalar. `[{ x: 'number' }]` is still a
  named number (one key holding a type name); `[{ x: 'number', y: 'number' }]` is a struct
  element (1.x read it as the named number `x` and reported `t(x0)`). `ERR_INVALID_TUPLE` is
  for a definition that is not an array or an element that is a function.
- **A `Schema` instance as a field keeps its schema-level `validate`** in every form (bare,
  `{ schema }`, the long form); 1.x dropped it, so a value that passed may now fail.

**Tooling**

- **The typings need TypeScript 5.0 or later.** `Schema` is generic over its definition
  (`Schema<D>`, a const type parameter); `Schema` written on its own is still any schema, and
  `Model.entities` is still a `Map<string, Schema>`.
- **The bundle is 12.6 KB min+gzip** (1.0 was under 8 KB), and CI gates at 13 KB.

### Added

- **Static inference.** `Infer<D>` is the TypeScript type of a value `check` accepts for the
  definition type `D`, over every form of the language: scalars (`integer` → `number`, `date`
  → `Date`, `json` → `unknown`), `'?T'`, `'key?'` and `required: false` as optional properties
  that accept `null`, `nullable: true` as `T | null`, the long form, `array`/`set`/`object`/`map`,
  `enum` as a union of literals, tuples (named elements included), nested structs, `schema`
  and `Schema` instances, `union`, and references as ids (`string`, `string[]`). A kind key,
  index definitions, calculated fields and the schema-level options are not fields. `Schema` is
  `Schema<D>` with a const type parameter, so `Schema.from({ ... })` keeps the literal types of
  an inline definition and `InferSchema<typeof schema>` reads them; a definition declared apart
  needs `as const`. `Infer<D, E>` takes an entity map and resolves a reference to a memory kind
  (or `embed: true`) as the record and a projection as its parent's fields;
  `InferEntity<E, 'Name'>` adds the id field of a stored kind. Custom types are declared for
  inference through module augmentation of `CustomTypes`; an unknown name infers as `unknown`.
- **Standard Schema v1.** Every `Schema` exposes `schema['~standard']`
  (`{ version: 1, vendor: 'alexify.metaschema', validate }`), the interface tRPC, TanStack Form,
  Hono and the other consumers of [standardschema.dev](https://standardschema.dev) accept
  without an adapter. `validate(value)` is `check(value)` read as the specification does:
  `{ value }` (the same reference) or `{ issues }`, the issues of the result themselves
  (`message` and an array `path`, plus `code` and `params`); the `libraryOptions` of a call are
  the options of `check`. The accessor lives on the prototype and stays out of `toJSON` and
  `Object.keys`. The typings declare it as `StandardProps<D>` (with `StandardResult<T>` and
  `StandardOptions`), and a `Schema<D>` is a `StandardSchemaV1<Infer<D>, Infer<D>>` of
  `@standard-schema/spec`, which the package does not depend on.
- **New built-in types.** `integer` (`Number.isInteger`), `date` (a `Date` with a valid time),
  `null`, `any` and `unknown` (one type under two names, differing in the TypeScript they
  render), and `union`: `{ union: ['string', 'number'] }` keeps the first branch that reports
  nothing; `{ union: [...], discriminator: 'kind' }` picks the branch from an enum field in one
  lookup, built when the schema is built, and reports an unknown value as one `union` issue at
  the discriminator's path. A definition that cannot discriminate throws `ERR_INVALID_UNION`.
- **`nullable: true`**: a required key whose value may be `null`, apart from optional (`'?type'`,
  `undefined` or `null`). It applies to any type, skips the rules and `validate` for `null`,
  and renders as `T | null`.
- **`min` and `max`** for `number`, `integer` and `bigint`, as numbers or bigints compared
  exactly (never through `Number`), with the `range` issue `{ min, max, actual }`.
- **`pattern`** for strings, a string or a `RegExp` compiled once with the `u` flag (and without
  `g`/`y`), with the `pattern` issue `{ pattern }`; the validation guide has a section on ReDoS.
- **`unicode: true`** measures a string's `length` in code points instead of UTF-16 units.
- **The unknown-keys policy as metadata**: `{ Form: { unknown: 'ignore' }, ... }` is the default
  of that schema's `check`; the option of a call still wins.
- **`check` options** `root`, `maxErrors`, `unknown` (`'reject'` | `'ignore'`), `references`
  (`'kind'`, `'embed'`, `'id'`) and `messages`, validated when the check starts, and the field
  option `embed` on a reference.
- **Issues with params.** `result.issues` is `{ code, path, message, params }`:
  `type { expected, received }` (plus `key` for a wrong key type in an `object` or `map`),
  `unexpected { keys }`, `enum { values }`, `length { min, max, actual }`,
  `range { min, max, actual }`, `pattern { pattern }`, `union { expected, discriminator }`,
  `reference { entity }`, `exception { error }`.
- **Locales.** Messages are rendered once, at the end of a check, from the code and params of
  each issue through `options.messages`: a locale table (partial tables fall back to English) or
  a function. English is built in, Ukrainian is exported as `@alexify/metaschema/locales/uk`
  (and English as `@alexify/metaschema/locales/en`).
- **`result.summary`, `result.flatten()` and `result.tree()`** for CLIs and forms, and
  `result.errors` as a lazy view rendered on first use.
- **Definition lint.** `schema.warnings` reports an option the field's type does not read
  (`unknown-option`; `default`, `unique`, `index`, `primary`, `title`, `description`, `examples`
  and `deprecated` are known annotations), a `pattern` without `length.max`
  (`unbounded-pattern`) and an index over a missing field (`missing-index-field`);
  `model.warnings` adds `missing-reference`, `missing-type` and `recursive-reference`. Both are
  computed on first use.
- **Definition error codes** `ERR_INVALID_RULE` and `ERR_INVALID_UNION`.
- **Types**: `Infer`, `InferSchema`, `InferEntity`, `CustomTypes`, `StandardProps`,
  `StandardResult`, `StandardOptions`, `IssueParams`, `IssueOf<Code>`, `Locale`, `Messages`,
  `ResultOptions`, `FlatIssues`, `IssueTree` and `CheckContext`; `ValidationIssue` is a union by
  code; `FieldType.nullable` and `embed`, `Schema.unknown` and `warnings`,
  `CheckOptions.references` and `KindMetadata.unknown`.
- **Benchmarks**: the four modes of the typescript-runtime-type-benchmarks suite (`parseSafe`,
  `parseStrict`, `assertLoose`, `assertStrict`) over its object, flat and nested, next to the
  `check`, `Schema.from` and `Model` scenarios.

### Changed

- **Validation is compiled.** `createStruct` builds a frozen plan and a dictionary of known keys
  and compiles the struct check as an index loop over the plan; every field's `check` is a
  closure chosen when the field is built (one `typeof` for a scalar without rules, a `Set` for
  an `enum` with more than eight values, `Map` and `Set` iterated directly, `object` through
  `for...in`, a lookup plus cycle tracking for a reference), and `Object.hasOwn` is consulted
  only for a required field set to `undefined` or a field named after a member of
  `Object.prototype`. A check runs in a context of its own
  (`{ issues, count, limit, path, seen, unknown, references, root, messages }`) instead of
  module globals, so two checks can no longer interfere and a validator may run another check.
  On the benchmark of the repository (Node 24, the same machine) `check` goes from 2.1 M to
  10.7 M ops/s for a valid flat value and from 0.87 M to 3.5 M for an invalid one, nested from
  0.33 M to 2.7 M; construction stays where it was. See
  [Performance](https://metaschema.vercel.app/guide/performance).
- **Generated TypeScript** follows the language: `integer` → `number`, `date` → `Date`, `null`,
  `any`, `unknown`, a `union` as `A | B`, a nullable field as `T | null`, a `set` as `Set<T>`, a
  reference by the kind of its target (see Upgrading).
- **Construction** reads the first key of a definition once, re-parses a projection's fields
  from their definitions so the copies belong to the projection, and lints on first use of
  `warnings`.

### Removed

- **The positional root path of `check`** and **`ValidationResult.format`** (see Upgrading).
- **`length` on `number` and `bigint`**, replaced by `min` and `max` (see Upgrading).
- **Module-level validation state.** Nothing in the package is global to a check any more; the
  type registry is still process-wide, as before.

### Fixed

- **A `Schema` instance used as a field lost its schema-level `validate`** (see Upgrading).
- **A `length` whose `min` is above its `max`**, which could never pass, is rejected when the
  schema is built instead of failing every value.
- **A `bigint` bound is compared exactly.** `length` on a `bigint` went through `Number` and
  lost precision past 2^53; `min` and `max` compare a bigint bound as a bigint.

### Tooling

- `pnpm size --max-gzip 13` is the CI gate (the entries are 12.6 KB min+gzip).
- `pnpm bench` reads the clock once per hundred calls and calls `check` through a megamorphic
  site, so it is measured as a callee instead of being inlined into the measuring loop;
  `bench/baseline.json` is the snapshot of this branch.
- `@standard-schema/spec` is a devDependency, used only by `tests/types/standard.test-d.ts`.
- New test suites: `context`, `issues`, `result`, `check-options`, `syntax`, `numbers`,
  `pattern`, `nullable`, `values`, `union`, `references`, `lint`, `standard`, and
  `tests/types/infer.test-d.ts`, which also compiles the examples of the TypeScript guide.

## [1.0.0] - 2026-10-09

The first release of `@alexify/metaschema`. It is a fork of
[`metaschema`](https://github.com/metarhia/metaschema) 2.2.2. The schema language and the
validation semantics are unchanged. The package around them now follows the other Alexis
libraries: zero runtime dependencies, one package for Node.js and browsers, and typings that match
the runtime.

### Upgrading from metaschema 2.x

Replace `metaschema` with `@alexify/metaschema`, then follow
[Migrating from metarhia](https://metaschema.vercel.app/guide/migrating-from-metarhia). The
breaking changes are the removed loader functions, the renamed `detouch`, the `exports` map,
`SchemaDefinitionError` for every broken definition, and the corrected and more precise
validation messages listed under Changed and Fixed.

### Added

- **`SchemaDefinitionError`.** Every broken definition throws this `TypeError` subclass with a
  `code` (`ERR_UNKNOWN_TYPE`, `ERR_INVALID_DEFINITION`, `ERR_MISSING_SCHEMA`, `ERR_INVALID_ENUM`,
  `ERR_INVALID_LENGTH`, `ERR_INVALID_TUPLE`, `ERR_INVALID_REFERENCE`, `ERR_RESERVED_KEY`,
  `ERR_PROJECTION`, `ERR_INVALID_CUSTOM_TYPE`, `ERR_TYPE_REGISTERED`, `ERR_UNKNOWN_JS_TYPE`,
  `ERR_INVALID_OPTIONS`) and the `schema` and `field` it was found in, and the message says
  where: `Unknown type "strng" in "Order.total"`. Previously a model with many
  entities threw a bare `Error: Unknown type strng` with no hint of the entity or field, and a
  `null` field definition threw `Cannot read properties of null`.
- **Structured issues.** `result.issues` holds `{ code, path, message }` for every message, with
  the codes `required`, `type`, `unexpected`, `enum`, `length`, `reference`, `circular`,
  `exception` and `custom`, so a form, a logger or an i18n layer need not parse the text. A
  `validate` function may return `{ code, message }` objects of its own.
- **`check(value, path, { maxErrors })`** stops collecting at that many messages and stops walking
  fields, elements and records as soon as the limit is reached.
- **An isolated type registry per model.** `new Model(types, entities, database, { registry:
  'isolated' })` gives the model its own copy of the built-in types to register into, so two
  models with conflicting custom types can live in one process. The default, `'shared'`, is the
  process-wide registry as before.
- **Readable `console.log`.** A schema or a field printed with `util.inspect` shows its definition
  (`Schema(User) { name: { required: true, type: 'string' } }`) instead of the whole graph with
  `[Circular]` markers.
- **`ValidationResult`** is exported, so a `validate` function can build the result it returns.
  The typings describe it as the class it is, with `add` and `ValidationResult.format`, instead of
  a two-property interface.
- **`Schema#detach`**, the correctly spelt replacement for `detouch`.
- **Exported types** for everything public: `Kind`, `KnownKind`, `Scope`, `Store`, `Allow`,
  `Cardinality`, `Relation`, `Fields`, `FieldType`, `CalculatedField`, `TypeTable`,
  `TypeConstructor`, `TypeEntry`, `KindMetadata`, `SchemaOptions`, `ModelOptions`,
  `CheckOptions`, `Validator`, `ValidationReturn`, `ValidationIssue`, `IssueInput`, `IssueCode`
  and `DefinitionErrorCode`.
- **Documentation site** at [metaschema.vercel.app](https://metaschema.vercel.app/).

### Changed

- **Package name** is `@alexify/metaschema`, published from `Alexis-Technologies/metaschema`.
- **Browser entry.** `dist.js` is replaced by `browser.js`, which exports the same names as the
  main entry. `saveTypes` lives in `src/runtime/node.js`, and its browser twin rejects. Both the
  `browser` field and the `browser` export condition point bundlers to it.
- **ESM named imports** work: the root barrel lists every export by name, so
  `import { Schema } from '@alexify/metaschema'` resolves.
- **`Model`** accepts any iterable of `[name, definition]` pairs, not only a `Map`.
- **Paths and coverage of messages.** An unexpected key inside a nested struct carries the parent
  path (`Field "nested.field2" is not expected`, was `Field "field2"`); records of a `many`
  reference carry their index (`Person.companies[1].name`, was `Person.companies.name`); every
  element of a tuple and every record of a `many` reference is reported instead of only the
  first; and a wrong key type in an `object` or `map` reads `Field "o" keys must be of type string`
  (was `Field "o" In object "o": type of key must be a string`).
- **`model.dts` keeps the shape of every field.** Arrays and sets render as `T[]`, an `enum` as
  a union of its values, `bigint` as `bigint`, a tuple as `[number, number]`, `object` as
  `Record<K, V>`, `map` as `Map<K, V>`, a nested struct inline and `json` as `unknown`; before,
  everything but `string`, `number` and `boolean` was rendered as `string`. References still
  become ids and custom scalar types still render as `string`.
- **Validation is faster.** A field chooses its rule checks once when it is built instead of
  scanning the rule table on every check, arrays are walked in place, and a schema caches the type
  table of its namespaces: `check` runs about 1.7× faster on flat values and 1.5× on nested ones
  than the 2.2.2 code on the same machine (`pnpm bench`).

### Removed

- **Loading schemas from files and strings.** `createSchema`, `loadSchema`, `readDirectory` and
  `loadModel` are gone, together with the `metavm` sandbox they ran schema sources in. Pass schema
  objects to `Schema` and `Model` directly.
- **Runtime dependencies.** `metautil`, `metavm` and `metaskills` are no longer installed. The
  `metautil` helpers metaschema uses are copied into `src/metautil.js`.
- **Deep imports.** The `exports` map exposes only the package root.
- **`Schema#detouch`.** It is renamed to `detach`, with no alias for the old spelling.

### Fixed

- **Error messages.** Typos and grammar in validation messages are fixed, with no compatibility
  for the old text:
  - `Filed "..." is required` → `Field "..." is required`;
  - `Filed "..." is not a object` (and `is not a map`) →
    `Field "..." not of expected type: object` (and `map`), like every other type error;
  - `more then expected in tuple` → `more than expected in tuple`.
- **Optional nested structs in collections.** A nested struct marked `required: false` (long form,
  `{ type: 'schema', schema, required: false }`) was still required as an array, set, object or map
  element, so `null` elements were rejected. It is now optional there too, like `{ array: '?string' }`.
  Optional nested struct fields (`'key?'`, `required: false`) already worked and are unchanged.
- **Silent and misleading type registration.** `{ string: { js: 'number' } }` was ignored without
  a word, and both an unknown alias (`{ js: 'strng' }`) and an alias of a custom type registered
  earlier in the table failed with `Custom type must contain "construct" and "checkType" methods`.
  Redefining a registered name now throws `ERR_TYPE_REGISTERED` (the same definition, or a
  metadata-only entry, is still accepted, so one table can serve every model), an unknown `js`
  throws `ERR_UNKNOWN_JS_TYPE`, and `js` may name any type registered earlier in the table.
- **Reserved keys in a field definition.** `{ type: 'string', constructor: 'x' }` silently
  switched validation of that field off, `check: 'x'` broke `check` with
  `type.check is not a function`, and a `__proto__` key (as `JSON.parse` produces) failed with
  `typeFormatters[key] is not a function`. A key that names a method of the field (`check`,
  `checkType`, `construct`, `isInstance`, `toJSON`, `constructor`, …) or `__proto__`/`prototype`
  is now rejected when the schema is built (`ERR_RESERVED_KEY`).
- **A validator returning more than ~110,000 messages lost all of them.** `ValidationResult#add`
  spread them into `push`, which throws past the engine's argument limit, and `check` reported a
  single `validation failed RangeError` instead. Every message is kept.
- **`JSON.stringify` of a schema whose definition is a single type** (`Schema.from('string')`,
  `Schema.from({ array: 'number' })`) threw `Schema cannot be serialized`. It serializes like a
  field now, and `toString()` is `JSON.stringify(schema)`.
- **A `Schema` instance passed to `new Schema(name, instance, namespaces)` lost the namespaces**,
  so a prebuilt schema given to a `Model` could not resolve its references through the model. The
  instance is still returned as is, keeping its own name; the namespaces are attached, and a
  different `name` is a definition error.
- **A huge input key made a huge message.** Key names taken from the value under check are
  truncated to 100 characters in `is not expected` messages and nested paths.
- **Circular values.** A value that referred back to itself through a reference, a nested struct
  or a collection was walked until the engine threw `RangeError`, reported as
  `validation failed RangeError` at whatever depth the stack ran out, with a path thousands of
  segments long. It is now reported where the cycle closes:
  `Field "Category.parent" is a circular reference`.
- **Ordinary bad input reported as an internal error.** `null` for a required `object` field
  produced `validation failed TypeError: Cannot convert undefined or null to object`, an array was
  accepted as an `object`, and a number for a `many` reference produced
  `validation failed TypeError: source is not iterable`. They are now type errors like any other:
  `Field "o" not of expected type: object` and
  `Field "Person.companies" not of expected type: array of Company`.
- **Broken definitions that only failed inside `check`.** `{ type: 'enum' }` without values
  reported `validation failed TypeError: Cannot read properties of undefined` for every value;
  `length: 'abc'` was silently ignored; `length: { max: 0 }` was ignored too because `0` is falsy;
  `{ many: 5 }` was accepted; and a projection naming a field its parent does not have failed with
  `Invalid definition: "undefined" of type undefined`. Each is now a `SchemaDefinitionError` when
  the schema is built (`ERR_INVALID_ENUM`, `ERR_INVALID_LENGTH`, `ERR_INVALID_REFERENCE`,
  `ERR_PROJECTION`), and `length: { max: 0 }` works.
- **Tuple fields in the short form were never required.** `point: ['number', 'number']` left
  `required` undefined, so a missing `point` passed validation and `model.dts` rendered it as
  optional; only the long form `{ type: 'tuple', value: [...] }` was required. The short form is now
  required by default like every other field, and `'point?': [...]` makes it optional.
- **Field names `check`, `name`, `constructor` and other `Object.prototype` names.** A struct was a
  class instance used as a dictionary, so a field named `check` replaced the method
  (`this.fields.check is not a function`), a field named `name` corrupted the message for a value
  that is not an object (`Field "[object Object]"`), and input keys such as `constructor`,
  `__proto__` or `check` were silently accepted instead of reported as not expected. Fields now
  live in a null-prototype dictionary. A value that is not an object is reported as
  `Field "<path>" not of expected type: object`, like every other type error (was
  `Value of "<path>" must be an object`).
- **Bundled and minified builds.** Schemas, fields and validation results were recognised by
  `constructor.name`. esbuild emits `class _Schema` for the self-referencing `Schema` class, so in
  any esbuild bundle (Vite, tsup, serverless builds) a `Schema` instance used as a field, or passed
  to `new Schema`, failed with `Unknown type struct`; with minification the `Type` class was
  renamed too and `check` accepted every value. Identity is now a global symbol brand
  (`Symbol.for`), which also recognises results from a second copy of the package.
  `tests/unit/bundle.test.js` validates through esbuild bundles of both entries, minified and not.
- **Reference cycles that do not pass through the first entity** (`A → B → C → B`) made `new Model`
  fail with `RangeError: Maximum call stack size exceeded`, and whether a cycle crashed or produced a
  warning depended on the order of the entities. Every cycle is now a warning, in the same format
  as a missing reference: `Warning: "C" depends on "B" recursively` (was
  `Recursive dependency: C.B`).
  `Model#preprocess` and `Model#reorderEntity` are constructor internals and are no longer public.
- **A schema type without a definition** (`data: 'schema'`, `{ type: 'schema' }`, or an alias
  such as `{ js: 'schema' }` used as `'address'`) failed with
  `Cannot convert undefined or null to object`, and a non-object `schema` with an unrelated
  `Unknown type` error. It now throws `SchemaDefinitionError` (`ERR_MISSING_SCHEMA`):
  `Type "address" needs a schema definition: { type: 'address', schema: { ... } } in "Order.delivery"`.
- **Typings.** `index.d.ts` matches the runtime:
  - the static `Schema.KIND`, `KIND_STORED`, `KIND_MEMORY`, `SCOPE`, `STORE` and `ALLOW` fields,
    which never existed, are removed;
  - `'system'` is removed from `Scope`;
  - `Schema.from` accepts strings and arrays;
  - `validate`, `findReference` and `Model#database` may be `null`;
  - `fields`, `indexes`, `custom`, the type table and the entries passed to `Model` are typed
    (`Fields`, `FieldType`, `TypeTable`, `TypeEntry`, ...) instead of `object` and `Function`;
  - `Cardinality` is the two values the runtime produces, and `Kind` admits a custom kind.

### Tooling

- pnpm, oxlint and oxfmt replace npm, ESLint and Prettier; c8, tsd and TypeScript (7.x) check
  coverage and the typings. oxlint runs with its `correctness` and `suspicious` categories on.
- Sources move to `src/`, tests to `tests/unit/` (with `tests/types/` for tsd), fixtures to
  `tests/fixtures/`.
- c8 coverage gate, tsd type tests, an export-parity test and a platform test that keeps Node
  builtins out of everything but `src/runtime/node.js`.
- CI runs lint, types, tests on Node 18–24 (Ubuntu) and 22–24 (Windows), coverage and the docs
  build, with a single `ci-success` check.
- `pnpm size` reports bundle sizes and, with `--max-gzip <KB>`, fails over budget (CI gates at
  8 KB; the bundles are under 8 KB). `pnpm bench` runs the benchmarks and, with `--json`, `--save`
  and `--compare`, snapshots them to `bench/baseline.json` and reports the change. The coverage
  table appears in the CI job summary.

## Upstream history (metarhia/metaschema)

Releases of [`metaschema`](https://github.com/metarhia/metaschema) before the fork, kept as
published.

### [metaschema 2.2.2][upstream-2.2.2] - 2025-05-24

- Add node.js 23 and 24 to CI
- Update dependencies

### [metaschema 2.2.1][upstream-2.2.1] - 2024-08-31

- Update eslint to 9.x and prettier with configs
- Add node.js 22 to CI

### [metaschema 2.2.0][upstream-2.2.0] - 2024-03-27

- Add browser support
- Rename `SchemaError` to `ValidationResult`
- Update dependencies

### [metaschema 2.1.5][upstream-2.1.5] - 2023-07-15

- Fix: remove debug output
- Update dependencies
- Package maintenance: AUTHORS, .prettierignore

### [metaschema 2.1.4][upstream-2.1.4] - 2023-05-01

- Drop node.js 14 support, add node.js 20
- Convert package_lock.json to lockfileVersion 2
- Update dependencies

### [metaschema 2.1.3][upstream-2.1.3] - 2023-03-13

- Add `BigInt` to known glabals
- Add `node:` prefix in require for built-in modules

### [metaschema 2.1.2][upstream-2.1.2] - 2023-02-18

- Update dependencies and security issues
- Package maintenance: json autoformatting, CI, license

### [metaschema 2.1.1][upstream-2.1.1] - 2022-08-16

- Non required fields can be `null`
- Using optional chaining operator

### [metaschema 2.1.0][upstream-2.1.0] - 2022-07-11

- Test fixups from <https://github.com/metarhia/metaschema/pull/420/commits/5732714114a14e0f8a71617c779d73eb4b345fb4>
- toJSON and toString methods implementation for Schema

### [metaschema 2.0.2][upstream-2.0.2] - 2022-06-25

- Hotfix: added missed exports to metaschema.js

### [metaschema 2.0.1][upstream-2.0.1] - 2022-06-24

- json type for any plain javascript object
- fix names issue while using built-in prototypes for custom types

### [metaschema 2.0.0][upstream-2.0.0] - 2022-06-22

- Struct implementation
- Refactoring and code quality improvement
- Metadata handled separetely
- Error handling improved now errors are chained
- Custom Kinds support implemented with custom metadata
  `{ CustomKind: { customMetadata: 'meta' } }`
- Update dependencies: "eslint", "eslint-config-metarhia"
- Custom types syntax changed. No more hardcoded `pg`.
  Now you must use `metadata` which is static property of Type constructor.
- Nested schema with relations bugfix
- Tuple type implementation
- Properly report error if trying to use `field: 'type'` shorthand for
  `'enum', 'array', 'set', 'map', 'object'` types
- Rewrite schemas and implement custom types
  - elegant syntax/format for custom types and internal types
  - custom types support
  - preprocessor to reduce Schema preprocess complexity
  - any kind of nested arrays, array of references https://github.com/metarhia/metaschema/issues/378
  - nested schemas with Schema instances support
  - any level of complex nested types support
  - custom validate for field
  - changed validate for schema, simplified for user
  - all user's validate functions support 4 types of syntax: boolean return, throw Error, error message as string return and array of error messages
  - reserved words permitted in schema if kind provided
  - function fields stored in schema
  - shorthand required key for collections support `{ 'array?': 'string' }`
  - many relation now checks in runtime
  - model now loads projections at the end, to fix bug
  - schema kinds moved to separate file and kinds now have logic to remove hardcoded projection from Schema
  - ts interfaces from schema now have relation ids as well
  - deps update metautil
  - nested object support https://github.com/metarhia/metaschema/issues/395
  - syntax for validate function changed
  - Model no more require metavm for browser compatibility: need `impress` update
  - loadModel moved to loader: need `impress` update
  - Model no more writes d.ts file to disk moved to loader as well: need `metasql` update
  - syntax for pg types changed a bit, no more not-working types: need `metasql` update

### [metaschema 1.4.1][upstream-1.4.1] - 2022-03-17

- Skip calculated fields in schemas
- Update dependencies
- Fix tests after update metatests to 0.8.1

### [metaschema 1.4.0][upstream-1.4.0] - 2022-02-23

- Fix nullable field long-form
- Optional for nested structures
- Shorthand for optional nested structure
- Fix paths in validation errors
- Unify nested schema fields to
  `{ type: 'schema', schema: Schema, /* other fields */ }`
- Support Schema#validate function

### [metaschema 1.3.4][upstream-1.3.4] - 2021-09-10

- Show path to the field in warnings
- Remove spread operator in `toLongForm`
- Update dependencies

### [metaschema 1.3.3][upstream-1.3.3] - 2021-07-19

- Improve code style
- Move types to package root
- Package maintenance: update dependencies, update engines, security

### [metaschema 1.3.2][upstream-1.3.2] - 2021-06-30

- Schema projection
- Schema.prototype.relations: Set<{ to: string, type: string }>

### [metaschema 1.3.1][upstream-1.3.1] - 2021-06-26

- Add namespaces to Schema.from factory
- Fix "not expected" warning

### [metaschema 1.3.0][upstream-1.3.0] - 2021-06-25

- Check schemas with references to schemas from attached models
- Add Schema.prototype.namespaces and attach/detouch methods to add/remove
- Add types to Schema.prototype.references (in addition to entities)
- Move Model.prototype.checkReferences to Schema.prototype.checkConsistency
- Fix lost json subfields checking
- Improve Schema kinds

### [metaschema 1.2.3][upstream-1.2.3] - 2021-05-22

- Restrict 'type' property in db schemas
- Simplify schema examples

### [metaschema 1.2.2][upstream-1.2.2] - 2021-05-17

- Fix unique alternative keys

### [metaschema 1.2.1][upstream-1.2.1] - 2021-05-15

- Move Identifier ahead of entity order
- Collect all references: Schema.prototype.references
- Improve check references for Model
- Reorder entities including many-to-many references
- Fix recursion detection on many-to-many and parent

### [metaschema 1.2.0][upstream-1.2.0] - 2021-05-13

- Change Schema metadata `{ kind, scope, store, allow }`
- Update dependencies and fix security issue

### [metaschema 1.1.2][upstream-1.1.2] - 2021-05-08

- Shorthand for optional (not required) fields
- Nested schema of json type (for pg json fields)

### [metaschema 1.1.1][upstream-1.1.1] - 2021-05-07

- Support nested schemas for Model class

### [metaschema 1.1.0][upstream-1.1.0] - 2021-05-06

- Move Schema.prototype.toInterface from metasql
- Move Directory loader from metasql
- Move Model class from metasql (previous name DomainModel)
- Move Reference checker from metasql
- Move Entity reordering algorithm from metasql
- Improve Model and Schema classes

### [metaschema 1.0.3][upstream-1.0.3] - 2021-04-13

- Add .d.ts typings
- Update metavm (added typings)

### [metaschema 1.0.2][upstream-1.0.2] - 2021-03-11

- Support enumerated type
- Fix single value validation
- Fix bugs in not required fields checking

### [metaschema 1.0.1][upstream-1.0.1] - 2021-03-06

- Fix database schema: index detection
- Add loaders from string and file

### [metaschema 1.0.0][upstream-1.0.0] - 2021-03-02

- See specs: https://github.com/metarhia/Contracts
- Moved implementation from impress
  - Implement schemas for structures and scalars
  - Schema field shorthand
  - Schema for collections: array, object, set, map
  - Schema custom validation method

### [metaschema 0.x][upstream-0.x] - First generation of metaschema

[unreleased]: https://github.com/Alexis-Technologies/metaschema/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/Alexis-Technologies/metaschema/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/Alexis-Technologies/metaschema/releases/tag/v1.0.0
[upstream-2.2.2]: https://github.com/metarhia/metaschema/compare/v2.2.1...v2.2.2
[upstream-2.2.1]: https://github.com/metarhia/metaschema/compare/v2.2.0...v2.2.1
[upstream-2.2.0]: https://github.com/metarhia/metaschema/compare/v2.1.5...v2.2.0
[upstream-2.1.5]: https://github.com/metarhia/metaschema/compare/v2.1.4...v2.1.5
[upstream-2.1.4]: https://github.com/metarhia/metaschema/compare/v2.1.3...v2.1.4
[upstream-2.1.3]: https://github.com/metarhia/metaschema/compare/v2.1.2...v2.1.3
[upstream-2.1.2]: https://github.com/metarhia/metaschema/compare/v2.1.1...v2.1.2
[upstream-2.1.1]: https://github.com/metarhia/metaschema/compare/v2.1.0...v2.1.1
[upstream-2.1.0]: https://github.com/metarhia/metaschema/compare/v2.0.2...v2.1.0
[upstream-2.0.2]: https://github.com/metarhia/metaschema/compare/v2.0.1...v2.0.2
[upstream-2.0.1]: https://github.com/metarhia/metaschema/compare/v2.0.0...v2.0.1
[upstream-2.0.0]: https://github.com/metarhia/metaschema/compare/v1.4.1...v2.0.0
[upstream-1.4.1]: https://github.com/metarhia/metaschema/compare/v1.4.0...v1.4.1
[upstream-1.4.0]: https://github.com/metarhia/metaschema/compare/v1.3.4...v1.4.0
[upstream-1.3.4]: https://github.com/metarhia/metaschema/compare/v1.3.3...v1.3.4
[upstream-1.3.3]: https://github.com/metarhia/metaschema/compare/v1.3.2...v1.3.3
[upstream-1.3.2]: https://github.com/metarhia/metaschema/compare/v1.3.1...v1.3.2
[upstream-1.3.1]: https://github.com/metarhia/metaschema/compare/v1.3.0...v1.3.1
[upstream-1.3.0]: https://github.com/metarhia/metaschema/compare/v1.2.3...v1.3.0
[upstream-1.2.3]: https://github.com/metarhia/metaschema/compare/v1.2.2...v1.2.3
[upstream-1.2.2]: https://github.com/metarhia/metaschema/compare/v1.2.1...v1.2.2
[upstream-1.2.1]: https://github.com/metarhia/metaschema/compare/v1.2.0...v1.2.1
[upstream-1.2.0]: https://github.com/metarhia/metaschema/compare/v1.1.2...v1.2.0
[upstream-1.1.2]: https://github.com/metarhia/metaschema/compare/v1.1.1...v1.1.2
[upstream-1.1.1]: https://github.com/metarhia/metaschema/compare/v1.1.0...v1.1.1
[upstream-1.1.0]: https://github.com/metarhia/metaschema/compare/v1.0.3...v1.1.0
[upstream-1.0.3]: https://github.com/metarhia/metaschema/compare/v1.0.2...v1.0.3
[upstream-1.0.2]: https://github.com/metarhia/metaschema/compare/v1.0.1...v1.0.2
[upstream-1.0.1]: https://github.com/metarhia/metaschema/compare/v1.0.0...v1.0.1
[upstream-1.0.0]: https://github.com/metarhia/metaschema/compare/v0.x...v1.0.0
[upstream-0.x]: https://github.com/metarhia/metaschema/releases/tag/v0.x
