# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

**metaschema** (npm package `@alexify/metaschema`) is a metadata schema and interface definition
language for JavaScript. Data structures and domain models are declared as plain objects; the
package validates values against them (`Schema#check`), assembles them into domain models
(`Model`), renders TypeScript interfaces and JSON Schema through the
`@alexify/metaschema/generators` subpath (`toTypeScript`, `toJSONSchema`), and compiles checks
into generated code through the `@alexify/metaschema/compile` subpath (`compile`, `register`,
with a fallback to the closures where `new Function` is not allowed). It has zero runtime
dependencies and runs in Node.js ≥ 18 and browsers.

It is a fork of [`metarhia/metaschema`](https://github.com/metarhia/metaschema) 2.2.2, maintained
by Alexis Technologies and set up like the sibling libraries `@alexify/kerberos` and
`@alexify/migronaut`. The git remote `upstream` points at metarhia; `origin` at
`Alexis-Technologies/metaschema`. The schema language is upstream's; 2.0 settled its semantics
(ROADMAP.md §5.1–5.4, CHANGELOG "Upgrading from 1.x": issues as data, the first key, `min`/`max`,
references by kind, `union`, `nullable`, `Infer`, Standard Schema). The package around it (no
loader, no dependencies, tooling, layout) is ours.

Package manager is **pnpm** (pinned in `packageManager`).

## Commands

```bash
pnpm test                          # node --test tests/unit/*.test.js
pnpm run test:jit                  # the same suite with every schema compiled by ./compile (tests/helpers/jit.js)
pnpm run test:nojit                # the same under --disallow-code-generation-from-strings: the fallback
node --test tests/unit/schema.test.js   # a single file
node --test --test-name-pattern="Tuple" tests/unit/*.test.js   # filter by name
pnpm run test:coverage             # c8 over src/, gated at 98 lines/statements, 90 branches, 100 functions
pnpm run test:types                # tsd: tests/types/*.test-d.ts against index.d.ts
pnpm run check:dts                 # tsc --noEmit --strict over index.d.ts on its own
pnpm run lint                      # oxlint index.js browser.js src tests scripts bench
pnpm run format                    # oxfmt index.js browser.js src tests scripts bench (format:check in CI)
pnpm size [--max-gzip <KB>] [--max-gzip-generators <KB>] [--max-gzip-compile <KB>]   # esbuild bundle sizes; CI gates at 17 KB per core entry, 5 KB for ./generators and 4 KB for ./compile on top
pnpm bench [filter] [--json] [--save] [--compare] [--compare-libs]   # ops/sec harness (closures and JIT), manual only; --save writes bench/baseline.json, --compare-libs runs zod/valibot/ajv/typebox (bench/libs.js)
pnpm run docs:dev                  # VitePress dev server for docs/ (docs:build, docs:preview)
```

`prepublishOnly` runs lint + format:check + test:coverage + test:types + check:dts. The full gate
before a merge adds what CI also runs: `pnpm run test:jit`, `pnpm run test:nojit`,
`pnpm size --max-gzip 17 --max-gzip-generators 5 --max-gzip-compile 4` and `pnpm docs:build`.
There is no build step.

## No build step: CommonJS + hand-written types

- `src/` is plain CommonJS (`require`/`module.exports`) and ships as is. No TypeScript syntax, no
  `import`/`export`, no `'use strict'`.
- The root `index.js` is a one-line shim over `src/index.js`. `browser.js` intentionally mirrors
  it. Do not deduplicate the two (see "Platform split").
- `src/index.js` lists every export **by name** (`module.exports = { KIND, …, Schema, Model }`),
  never by spreading module objects. cjs-module-lexer only sees named keys, and ESM
  `import { Schema } from '@alexify/metaschema'` depends on it.
- `index.d.ts` is the only source of the public types, written by hand, plus the two one-line
  `src/locales/*.d.ts` that type the locale subpath exports through it and the two subpath
  typings `src/generators/index.d.ts` and `src/compile/index.d.ts`, which import the shared
  types from it. A public API change touches
  `src/index.js`, `index.d.ts` and a test together. The static inference (`Infer<D, E>`,
  `InferSchema<S>`, `InferEntity<E, Name>`, `CustomTypes`, and `Schema<D>` with its phantom
  `'~definition'` member) lives in `index.d.ts` only, has no runtime counterpart, and is pinned
  by `tests/types/infer.test-d.ts`, which also compiles the examples of
  `docs/guide/typescript.md` and README. `tests/unit/export-parity.test.js` compares
  runtime exports with the declared value exports for both entries, imports every name from ESM
  and resolves the locale subpaths. `tests/types/*.test-d.ts` (tsd) pin signatures. `check:dts`
  needs `--target es2022` because there is no tsconfig.
- `package.json` has a closed `exports` map (`.` with `types` first, then `browser`, then
  `default`; `./locales/en`, `./locales/uk`, `./generators` and `./compile`, each with its own
  `types`) and a
  `files` allowlist: `index.js`, `index.d.ts`, `browser.js`, `src`, README, CHANGELOG, LICENSE
  and SECURITY. `src/generators/index.d.ts` types the subpath and imports the option types from
  the root `index.d.ts`, which also declares the methods `register()` installs on `Schema` and
  `Model` (with a comment saying so): a type-level claim, like `types` of the Standard props.

## Zero dependencies

There is no `dependencies` key in `package.json`, and there won't be one. `src/metautil.js` holds
the helpers metaschema used from metautil (`inRange`, `isFirstUpper`, `isFirstLower`,
`isFirstLetter`, `toLowerCamel`, `firstKey`), copied from metautil v5.5.2 with an
attribution header. It is ordinary project code now: formatted, linted and covered like the rest of
`src/`. If another small helper is needed, copy it into `src/` with attribution rather than adding
a dependency. devDependencies are fine.

## Out of scope by design

Upstream's loader is **deliberately gone**: `createSchema(name, src)`, `loadSchema`,
`readDirectory` and `loadModel`, together with the `metavm` sandbox they ran schema sources in.
metaschema does not read schema files, evaluate source strings or create `node:vm` contexts. Do not
reintroduce any of that. Callers pass schema objects to `Schema` and `Model`, loading them with
their own `require`. `saveTypes` (writing the generated dts) stays, in the generators subpath.

**The core entry validates; what a schema is rendered into lives in `./generators`.** JSON
Schema and TypeScript generation were in the core until 3.0 and were moved out (Alex's decision,
2026-10-10: a program that only validates should not carry them). The subpath exports functions
(`toJSONSchema`, `toTypeScript`, `saveTypes`) and an explicit `register()` that installs the
methods and the `~standard.jsonSchema` converter; nothing is registered by importing. A new
emitter goes there too, never into `src/index.js`. Standard Schema (`~standard.validate`)
stays in the core because consumers detect a schema with `'~standard' in schema`.

**The JIT lives in `./compile`, and the core never calls `new Function`.** `compile(target,
{ jit })` and `register(options)` of the subpath replace `schema[RUN]` with a generated
function; the only thing the core knows about it is the `Schema[HOOK]` slot (`util.js`), read
once per construction, that `register()` fills. A new backend goes there too.

## Repository layout

```
index.js  browser.js  index.d.ts   root entry shims + hand-written types
src/
  index.js          public barrel (explicit named exports)
  kinds.js          KIND/KIND_STORED/KIND_MEMORY/SCOPE/STORE/ALLOW, getKindMetadata
  metadata.js       SchemaMetadata (kind, scope, indexes, options, …)
  schema.js         Schema (extends SchemaMetadata): check, Schema[RUN], ~standard
  struct.js         createStruct: null-prototype field dictionary with its plan, known keys and compiled check
  context.js        createContext: the state of one check ({ issues, count, limit, depth, maxDepth, path, seen, source, unknown, references, root, messages, async, scratch })
  issues.js         issue constructors by code, toDotPath, absorb (the validator contract), runValidate/runCheckType, settle (the async drain)
  codec.js          the passes of parse and serialize over the built types: defaults, strip, decoders, serializers, hasAsync
  result.js         ValidationResult: valid, issues, lazy errors, summary, flatten, tree, add, issuesOf
  rules.js          rules per type: FORMAT (length, min, max, pattern), compileRules, code points
  lint.js           lintSchema: schema.warnings (unknown-option, unbounded-pattern, missing-index-field)
  locales/          en.js (built in) and uk.js (subpath export), one renderer per issue code
  preprocessor.js   Preprocessor: turns a definition into { Type, defs, kindMeta }; the first key decides
  types.js          TYPES registry, createType (static rules/options per type), typeFactory
  model.js          Model: entities, ordering, warnings (lazy); branded 'Model'
  util.js           BRAND/hasBrand identity brand, RUN, shorten, formatters (type '?x', key 'x?', length)
  errors.js         SchemaDefinitionError (code, schema, field) for broken definitions; asyncReturn (ERR_ASYNC_VALIDATOR)
  metautil.js       helpers copied from metautil v5.5.2
  prototypes/       type prototypes: abstract, scalars (string, number, integer, bigint, boolean, date,
                    null, any/unknown, enum), collections, reference, schema, tuple, union, json
  runtime/          node.js (writeFile via node:fs) and browser.js (same interface, rejects)
  generators/       the ./generators subpath: index.js (toJSONSchema, toTypeScript, saveTypes, register),
                    index.d.ts, jsonschema.js (targets, strict profile, mongodb, the ~standard converter),
                    typescript.js (toInterface, modelToTypeScript: JSDoc, named types)
  compile/          the ./compile subpath: index.js (compile, register, canEval), index.d.ts,
                    code.js (the source builder: quote, prop, literal, the scope), emit.js (an emitter per prototype)
tests/
  unit/*.test.js    node:test suites, one per area
  types/*.test-d.ts tsd assertions
  helpers/jit.js    --require'd by test:jit and test:nojit: register({ jit }) of ./compile before the suites
  fixtures/schemas/ a domain model as CJS modules; index.js assembles { database, types, ...entities }
scripts/size.js     bundle-size report and budget gate (CI smoke)
bench/              zero-dependency ops/sec harness (closures and JIT); libs.js compares with zod, valibot,
                    ajv and typebox (--compare-libs); baseline.json is a snapshot for --compare
docs/               VitePress site (metaschema.vercel.app), not published
.claude/skills/     metaskills v1.0.5 skills (js-conventions, npm-publish adapted)
```

## Architecture

Module graph (no cycles; nothing checks this automatically, so look at the `require`s when adding
an edge). The leaves are `util.js`, `errors.js` and `metautil.js`. From there:

- `locales/en.js` and `uk.js` require only `util.js` (`shorten`); `issues.js` requires `util`,
  `errors` and `locales/en`; `rules.js` (+ `errors`), `result.js` (+ `util`, `locales/en`) and
  `context.js` (+ `locales/en`) require `issues`. `util.js` must not require `issues.js`.
- `kinds → metadata` (+ `result`, `errors`, `issues`); `struct` (`util`, `issues`, `errors`) →
  `prototypes/schema`; `prototypes/abstract` (`rules`, `issues`) and the other prototypes
  (`issues`, `errors`, `util`, `metautil`) → `types`; `preprocessor` (`metautil`, `util`, `errors`,
  `issues` for `typeOf`) and `lint` (`util`) stand alone. `util.js` also holds `define`,
  `IDENTIFIER`, `ENUM_SET_SIZE` and `safeString`, shared by the core, the generators and the JIT.
- `codec.js` requires `util`, `issues`, `context`, `struct`, `errors` and the prototypes
  (`collections`, `schema`, `tuple`, `union`, `reference`: it tells a node's shape by the
  identity of its `compile`, as `compile/emit.js` does) and never `schema.js`: a reference is
  followed through `root.findReference` at parse time.
- `schema.js` requires all of `context`, `types`, `preprocessor`, `metadata`, `result`, `issues`,
  `struct`, `lint` and `codec`; `model.js` requires `schema`, `types`, `lint`, `util`;
  `src/index.js` requires nothing else (no runtime).
- `generators/jsonschema.js` and `generators/typescript.js` require `util`, `struct`, `errors`,
  `metautil` and `prototypes/reference.js` (`embeds`, the one rule shared by `check` and both
  generators), never `schema.js` or `model.js`: they take the instances and read `fields`,
  `unknown`, `name`, `findReference` and the kind metadata. `generators/index.js` requires
  `schema.js` and `model.js` (for `register()`), `runtime/node.js` (for `saveTypes`) and the two
  generators; nothing in the core requires `generators/`.
- `compile/code.js` requires `util` (`IDENTIFIER`); `compile/emit.js` requires `util`
  (`ENUM_SET_SIZE`), `issues`, `rules` (`codePoints`, `lengthOf`, `ruleNames`), `struct`
  (`STRUCT`, `isStruct`), the prototypes (for the identity of their `compile` methods; `union`
  also for `nameOf` and `tableOf`) and `code.js`; `compile/index.js` requires `util` (`RUN`, `HOOK`),
  `schema.js`, `errors` and the two. Nothing in the core requires `compile/`.

**Parsing a definition: the first key decides.** `new Schema(name, raw, namespaces)` builds a
`Preprocessor`, and `Preprocessor#parse(source)` picks parsers by source type (`PARSERS` in
`preprocessor.js`), reading the first key of an object once (`firstKey`, the first key that starts
with a letter) and handing it to the parsers:

- string → `stringShorthand`: `'?string'`, or a capitalized name → reference
- object → tried in order:
  - `schemaInstance` (a bare `Schema`; `{ schema: Schema }` and the long form reach the schema
    prototype through the next parsers, and its `construct` accepts the instance)
  - `typeInstance` (a built field, re-parsed from `toJSON()`: a projection copies its parent's
    fields this way, so the copies belong to the projection)
  - `schemaWithKind` (capitalized first key = kind)
  - `typeLongForm` (**only when `type` is the first key**)
  - `typeShorthand` (first key is a type name, e.g. `{ array: 'number' }`)
  - `kindlessSchema` (any other first key: a nested struct)
- function → `functionField`: a calculated field, kept as is and never validated
- array → `tupleShorthand`; an element may be any definition, except that a one-key object holding
  a type name (`{ x: 'number' }`) is a *named* scalar element, as upstream

It returns `{ Type, defs, kindMeta }`. Unknown lowercase type names **throw**, because a broken
definition is a programming error. Capitalized names become `reference` fields. `{ name:
'string', type: 'string' }` is a struct; `{ required: false, type: 'string' }` is
`ERR_INVALID_DEFINITION`; a struct whose first field is called `type` or named like a type needs a
kind or the `schema` shorthand.

**Definition errors** are `SchemaDefinitionError` (`src/errors.js`), a `TypeError` with `code`
(`ERR_UNKNOWN_TYPE`, `ERR_INVALID_DEFINITION`, `ERR_MISSING_SCHEMA`, `ERR_INVALID_TUPLE`,
`ERR_PROJECTION`, `ERR_INVALID_CUSTOM_TYPE`, `ERR_INVALID_ENUM`, `ERR_INVALID_LENGTH`,
`ERR_INVALID_REFERENCE`, `ERR_RESERVED_KEY`, `ERR_TYPE_REGISTERED`, `ERR_UNKNOWN_JS_TYPE`,
`ERR_INVALID_OPTIONS`, `ERR_INVALID_RULE`, `ERR_INVALID_UNION`, `ERR_UNREPRESENTABLE` of the
generators, `ERR_NO_EVAL` and `ERR_JIT_BUILD` of the compile subpath), `schema` and `field`. A
definition
that can never validate correctly (an `enum` without values, a `length` that is not numeric or
whose min is above its max, a `max` below `min`, a rule on a type that does not accept it, a
pattern that does not compile, a union that cannot discriminate, a projection naming a field its
parent does not have) is rejected when the schema is built, never discovered inside `check`. What
is merely suspicious (an option the type does not read, a pattern without `length.max`, an index
over a missing field) is a `Warning [code]: text` string in `schema.warnings` (`src/lint.js`, run on
first use), and `model.warnings` adds `missing-reference`, `missing-type` and
`recursive-reference`. Throw sites do not know where
they are; `createStruct` catches on the way up and calls `error.locate(root.name, field)`, which
prepends nested keys, so the message ends with `in "Order.address.city"`. Never throw a bare
`Error` for a definition problem.

**Types.** `types.js` creates one class per prototype (`createType`): `class Type extends
AbstractType` with static `type`, `kind`, `metadata`, `rules` (the rules the type accepts, from
`prototype.rules`) and `options` (the definition keys it reads, for the lint). A field's `check`
is **compiled when the field is built**: the `AbstractType` constructor copies the definition
keys (a rule key goes through its `FORMAT` in `rules.js`, and a rule the type does not accept
throws `ERR_INVALID_RULE`), calls `construct`, then `compile()` returns the type check as a closure
over the field (`(value, context, key) => void`), `withRules` wraps it only when the field has
rules (`length`, `pattern`, `min`/`max` compiled into one closure) or a `validate`, and
`nullable: true` wraps the result once more so `null` returns before anything else. Each
built-in prototype has its own `compile` (one `typeof` for a scalar, a `Set` for an enum with more
than 8 values, `Map`/`Set` iterated directly, `object` through `for...in` + `Object.hasOwn`,
tuple by index, the struct's compiled check for `schema`, a lookup plus cycle tracking for a
reference); a custom type has `checkType(value, path)` instead, which the generic `compile`
runs through the validator contract (`runCheckType`). The compiled closure is a private field
behind the `check` getter, so it stays out of `toJSON`/`util.inspect`. `TYPES` is a
**module-global registry**: `typeFactory(customTypes)` (called by `Model`) mutates it. It adds
metadata to built-ins, aliases (`{ js: 'string' }`) or new prototypes with
`construct`/`checkType`. Registration is process-wide, by design (see below).

**Structs.** `createStruct` settles `required` from the key (`'tags?'`) and the definition
(`'?string'`, `required: false`) *before* building the field (the closure captures it), then
records a frozen **plan** entry `{ key, type, required, own, check }` per validated field and the
key in a null-prototype `known` dictionary; `fields[STRUCT]` (a global symbol) holds
`{ plan, known, calculated, check }` (`calculated`: the keys of the calculated fields, read by the
strip pass; a nested struct's `validate`, `parse` and `serialize` functions stay in `fields` but
are neither known keys nor calculated). The struct check is an index loop over the plan: a keyed
load per field,
`Object.hasOwn` only when the value is `undefined` and the field is required, or when the field
name is a member of `Object.prototype` (`own`); then `for...in` counts the keys and scans for
unknown ones only when the count differs from what the plan found. A leaf check receives its key
and never touches `context.path`; a container pushes its own key before its children.

**Kinds.** A capitalized first key sets kind and metadata via `getKindMetadata`; the metadata
may carry `unknown: 'reject' | 'ignore'`, the default of that schema's `check`:

- Stored kinds (`entity`, `registry`, `dictionary`, `journal`, `details`, `relation`, `view`)
  default to `application`/`persistent` and add an optional `<lowerCamelName>Id` field (`id` for
  anonymous schemas).
- Memory kinds and unknown/custom kinds default to `local`/`memory`.
- `projection` copies `fields` from `schema` via `root.findReference`.

Index keys (`index`/`primary`/`unique` arrays) and `many` fields are collected into
`schema.indexes`. Top-level `validate`/`format`/`parse`/`serialize` functions go to
`schema.options`; only `validate` is called by metaschema.

**Validation.** `schema.check(value, options)` creates a **context** (`createContext` in
`context.js`: `{ issues, count, limit, depth, maxDepth, path, seen, source, unknown, references,
root, messages, async, scratch }`, one
shape, with `options.root` defaulting to the schema name, `maxErrors` clamped to a small integer,
`unknown` `'reject'`/`'ignore'` defaulting to the schema's metadata, `references` `'kind'`/
`'embed'`/`'id'`, `messages` a locale or a function; the option parsing lives in `configure` so
that `createContext` stays small enough for V8 to inline into `check`), runs
`this[RUN](value, context)` (the
compiled schema check: the struct or type check, then `options.validate` only if nothing failed)
and returns `new ValidationResult(context)`. Issues are **data**, recorded without text by the
constructors in `issues.js` (`issues.type(context, expected, value, key)`, …):
`{ code, path: PropertyKey[], message: '', params }`, `path` built from `context.path` plus the
key, relative to the value (the root is a label only). Messages are rendered **once, at the end**
(`finalize`) through the locale (`render`: `messages[code] || en[code]`, or the function); a
validator's own text is kept. `result.errors` is a lazy view: `Field "<root><dotted path>"
<message>` (`describe`/`toDotPath`, identifiers dotted, other keys bracketed and JSON-quoted,
keys over 100 characters truncated), kept as is when the message already starts with `Field`.
Codes: `required`, `type` (`{ expected, received, key? }`), `unexpected` (`{ keys }`, one per
struct), `enum`, `length`, `range` (`{ min, max, actual }`), `pattern` (`{ pattern }`), `union`
(`{ expected, discriminator }`), `reference`, `circular`, `exception` (`{ error }`), `custom`.

**References.** `prototypes/reference.js` resolves the target at check time
(`root.findReference`) and `embeds(target, field.embed, context.references)` decides between the
graph view (the record, run through the target's `Schema[RUN]` with cycle tracking) and the
storage view (an id: `typeof value === 'string'`, no recursion): the call's `references` when it
is not `'kind'`, else the field's `embed`, else `target.store !== 'persistent'`. `schema.js` uses
the same function for the dts (`asId`/`tsReference` in `generators/typescript.js`): a stored
target renders as `<key>Id:
string`, a memory target as its interface name (inline when the target is anonymous, the name when
it cannot be resolved and `embed: true`, the id form when it cannot be resolved otherwise).

**Parse.** `schema.parse(value, options)` is the check between two passes of `src/codec.js`
and returns `{ valid, value, issues }` (`value` undefined when invalid; `issues` always an
array): `prepare` fills the `default` of every missing or `undefined` struct key (a function is
a factory, called per parse), at any depth; then `this[RUN]` (whichever backend is installed:
the passes never validate, so the JIT needs no second generator); then, on a valid value,
`finish` rebuilds every struct from its known keys under `unknown: 'strip'` (the check behind
it treats `strip` as `ignore`; `createContext` takes a fourth argument, `parsing`, to accept
it) and runs the decoders, a field's `parse(value)`, from the parts of a value up to the value
(elements before the collection, fields before the nested struct's own `parse`, the record of an
embedded reference through its entity), and the schema's `options.parse` last. A decoder's
exception is an `exception` issue at the field and makes the result invalid; after the first
failure no decoder runs. `serialize(value, { check })` is one pass the other way (the schema's
`options.serialize`, then the fields' `serialize` top down; `format` is collected and never
called). The passes are one `walk` over the built types, dispatched on the shape of a node
(Schema, struct dictionary, nested struct, list, keyed, tuple, union, reference, leaf) with a
memoized info per node (`infoOf`, a WeakMap: the bits of what a subtree carries, so a schema
without defaults, decoders or serializers is returned as it is after one bit test, and the root
info is cached on the schema in `#codec`), copy-on-write output (a container is copied at the
first part that changed; the value given is never written to), a cycle guard in the passes that
run before the check (`context.seen` as the stack, cleared before the check; a looped value is
checked as given), and a scratch context to pick the branch of a plain union as the check
does. `~standard.validate` is `parse` with the schema's policies.

**Async.** `checkAsync`/`parseAsync` set `context.async = []`; `guarded` in `issues.js`, the one
place where user code runs (field and schema `validate`, custom `checkType`, on both backends,
the JIT reaching it through `runValidate` in the scope), keeps a promise it gets with the path
it was met at, and every validator met after it as a deferred call, so that "a validator runs
only when nothing under it failed" holds across promises; `settle` runs the list after the walk,
in field order, each entry under its path, skipping a deferred call when an issue recorded since
lies under its path, and stops at `maxErrors`. The sync `check`/`parse` throw a `TypeError`
with `code: 'ERR_ASYNC_VALIDATOR'` (`asyncReturn` in `errors.js`) for a promise. Decoders that
return promises are awaited by `parseAsync` inside the `finish` pass (`Promise.all` over the
parts of a container, then the container's own decoder). `hasAsync(schema)` (an `AsyncFunction`
among the validators, decoders and `checkType`s, the referenced entities included) decides, on
the first use of `~standard`, that `validate` returns a promise.

The order inside a field is type → rules → `validate`; a type failure cancels the rest, and
`validate` (field or schema level) runs only when nothing before it failed. Validators and
`checkType` may return (`absorb` in `issues.js` normalises it):

- `null`, `undefined` or `true`: valid
- `false`: `'validation error'` (`custom`), or `not of expected type: <name>` from a `checkType`
- a string, or `{ code, message, path?, params? }` (`path` relative to the field: a key or keys)
- an array of those
- a `ValidationResult` (its issues, relative to the field)

`guarded` (behind `runValidate`/`runCheckType`), `settle` and the decoder call in `codec.js` are
the `try/catch` blocks of a check (the others are build time: `createStruct`, `formatPattern`,
`SchemaMetadata#validate`): an exception is an `exception`
issue. `context.count >= context.limit` is how every loop over fields, elements and records
stops early. `ValidationResult` (`result.js`) keeps `add()`/`issuesOf()` for results built by
validators, plus `summary`, `flatten()` and `tree()`.

**The JIT backend** (`src/compile/`) renders the same plan into one function per schema,
`(v, c, k)`, installed as `schema[RUN]`; `Schema#check` is unchanged. `emit.js` dispatches on
the identity of a field's `compile` method (so an alias of a built-in compiles like its base,
and a prototype with a `compile` of its own is not guessed at): a built-in type is inlined,
anything else (a reference, a custom `checkType`) is the field's own closure called from the
scope. Three rules keep the issues byte-identical. The issue constructors of `issues.js`,
`runValidate` and the closures are reached through the scope, never reimplemented. The keys a
container would push on `context.path` are known at generation time and pushed only around a
statement that records or calls out, so a valid value never touches the path; the root's key
`k` is pushed at entry when the schema is reached through a reference. And the error limit is
checked right after every such statement, with a `break` to the nearest union branch or to the
root label, which is where the closures' per-field `count >= limit` tests come out the same (a
plain union truncates what a failed branch recorded and tries the next, so a branch has a label
of its own). Generated code holds identifiers, numbers, booleans and JSON strings only
(`code.js`: `quote` escapes U+2028/2029, `prop` picks `.key` or `["key"]`, `literal` leaves
NaN, -0, Infinity and objects to the scope). `canEval()` probes `new Function('')` once;
`jit: 'auto'` falls back silently (`compile()` returns the `ERR_JIT_BUILD` error of the first
check it could not generate as `error`, `register({ onFallback })` is told of every one),
`true` throws `ERR_NO_EVAL` (from `register` at the call) or `ERR_JIT_BUILD` (a model all or
nothing),
`false` never generates code.

**Standard Schema.** `Schema.prototype['~standard']` is a class accessor in `schema.js` (so
non-enumerable: `toJSON`, `inspect` and `Object.keys` never see it) that builds
`{ version: 1, vendor: 'alexify.metaschema', validate }` once per instance (`#standard`).
`validate(value, options)` is `parse(value, options?.libraryOptions)` read as the specification
does: `{ value }` (the output of `parse`: the same reference when nothing applied) when valid,
else `{ issues }`, the issue objects themselves (each has `message` and `path: PropertyKey[]`,
which is all the specification reads), no copies; a promise of that, through `parseAsync`, for
a schema `hasAsync` finds an `async function` in (decided on the first use of the props). It
closes over the schema because consumers call it unbound. The shape is typed inline in
`index.d.ts` (`StandardOptions`, `StandardResult<T>`, `StandardProps<D>`, with `types.input` =
`Infer<D>` and `types.output` = `InferOutput<D>`) because `index.d.ts`
cannot import a devDependency; `tests/types/standard.test-d.ts` pins the assignability to
`StandardSchemaV1` of `@standard-schema/spec`. `~standard.jsonSchema` is D2 (3.0, the generators subpath).

**Model.** `new Model(types, entities, database = null)`:

1. registers types;
2. builds every entity as a `Schema` with the model as its namespace (projections are deferred to
   a second pass);
3. orders entities with `Identifier` first, dependencies before dependents, and records recursive
   dependencies;
4. `model.warnings` (a getter, computed on first use) is every entity's `warnings`, its
   `checkConsistency()` (missing references and types) and the recursive dependencies.

`toTypeScript(model)` of the generators subpath (`model.dts` once its `register()` ran) joins the
interface of each entity in that order. `entities` is any iterable of `[name, definition]`.

## Budgets

**The 3.0 bundle budgets are 17 KB min+gzip per core entry, 5 KB for the generators and 4 KB
for the compile subpath on top of it** (`pnpm size --max-gzip 17 --max-gzip-generators 5
--max-gzip-compile 4` in CI). The core gate moved from 16 KB to 17 KB during the review of
3.0 (2026-10-11): the fixes of the async union, of thenable data, of the abandoned promises
and of the union trial, the lazy cycle set, the one scratch per parse and `maxDepth` cost
about 900 bytes together, the loops and the shared tables gave about 300 back, and the entries
sit at 16.1 KB after them. The core entries are at about 16530 bytes (`index.js` and
`browser.js`), 16.1 KB, about 0.9 KB of headroom; the `./generators` subpath adds about 4.5 KB
and the `./compile` subpath about 3.9 KB to a bundle of the core, each
measured as the difference between a bundle of `index.js` plus the subpath's `index.js` and
`index.js` alone (a subpath requires the core for `register()`, so on its own it would bundle
the core again). The figures are quoted in README, `docs/index.md`, `docs/guide/why.md`,
`docs/guide/browser.md`, `docs/guide/json-schema.md`, `docs/guide/compile.md`,
`docs/api/exports.md` and `docs/public/llms.txt`; change them together from `pnpm size`. History: 1.0 shipped under 8 KB with an 8 KB gate; Workstream A took
the entries to 9.9 KB (gate 10 KB); Workstream B to 12.5 KB (union, date/null/any/integer,
pattern and min/max, the references rule and the lint cost about 2.6 KB together; gate 13 KB);
`~standard` added 174 bytes (2.0 shipped at 12.6 KB with a 13 KB gate); Workstream D2/D3 first
added 3122 bytes to the core (16051 bytes, gate 16 KB), then the generators (JSON Schema and
the whole TypeScript rendering, about 3.9 KB) moved to the subpath, which took the core to 12.0
KB (Alex's decision: the core validates, see "Out of scope by design"; the move is a breaking
change, so the release is 3.0.0, planned as 2.1.0); Workstream E added 37 bytes to the core
(the `Schema[HOOK]` slot and the `lengthOf` export) and the `./compile` subpath at 3.5 KB
with a 4 KB gate; Workstream F added 3146 bytes to the core (`src/codec.js` is 2.7 KB of it,
the rest is `parse`/`parseAsync`/`checkAsync`/`serialize` in `schema.js` and the async drain in
`issues.js`), which took it to 15.1 KB with a 16 KB gate: parse is core behaviour, not a
subpath, because `~standard.validate` is parse (Alex's instruction). ROADMAP.md §5.8 planned
10 KB for 2.0 and 12 KB for the release after it.

**`pnpm bench` measures `check` as a callee.** The scenarios that validate call `check` through
`callCheck` in `bench/helpers.js`: the schema under measurement sits in a holder that `bench()`
writes, so the receiver is never a constant V8 can fold the method out of, and the call site is
primed once with five `check` methods on objects of five shapes, so the load and the call are
megamorphic and V8 calls `check` generically, the way any program does. Before that (until
2026-10-10) the scenario closure, `check`, `createContext`, the walk and `ValidationResult` were
inlined into one optimized loop, where a few bytes of bytecode in `check` (a third argument to
`createContext`, a private-field read, frame size 32 → 40) swung the moltar scenarios by 10–20%
in either direction, scenario by scenario, which is what the "loose-mode gap" of Workstream B was;
swapping only `src/context.js` between the trees moved the whole gap, and with the loop and the
closures unoptimized every shape was at parity. With the new harness the same swap moves the
moltar numbers by 3–5%, this machine's run-to-run band. Two shapes of `createContext` do cost real
time and are documented in the file: a string literal inside the context literal (`references:
'kind'`, 12–16% on its own, because V8 tracks the field as a constant) and writing the object after
it is allocated. Two more were found by an A/B against the commit before the 3.0 review
(bisected in a scratch worktree, `check — flat struct, valid`): a private method between `check`
and `createContext` (`this.#context(options)`) keeps V8 from inlining the context allocation into
`check` and costs 7%; an object made by `Object.create(null)` that the compiled check reads on
every call (`schema.options.validate` was one for a day) is in dictionary mode and costs 4%, so
`options` is a plain object and only `indexes`, read at build time, is a dictionary. Verify a
harness change with
`node --trace-turbo-inlining bench/bench.js moltar | grep "Inlining .*check.* into"`: nothing
from `src/` may be inlined into `bench` or into a scenario closure.

`bench/baseline.json` (Node 24, this machine, 2026-10-10, the branch of Workstream F): on the
closures flat valid ≈ 10.4 M ops/s, flat invalid ≈ 3.4 M, nested ≈ 2.5 M / 1.4 M, the moltar
modes ≈ 7.1–7.4 M flat and 4.2–4.4 M nested; on the JIT (`check (jit) — …`, a second schema
compiled by `./compile`) flat ≈ 30.0 M / 5.6 M, nested ≈ 17.4 M / 2.0 M, moltar ≈ 30.2–33.0 M
flat and 24.1–30.2 M nested (the strict modes count the keys of the value, the loose ones skip
it); `parse — …` of a plain schema ≈ 9.6 M flat / 2.5 M nested on the closures and 26.8 M /
14.7 M on the JIT (the two passes return after one bit test each on the root info the schema
caches; the rest of the gap to `check` is the result object and the `strip` test), and
`parse — flat struct, defaults and a decoder` ≈ 2.1 M / 2.9 M, where the two copies of the
object and `new Date(text)` in the decoder are most of the time (the struct info keeps, per
phase, the indexes of the fields that carry something, and the infos of its children, so a
pass never looks a field up in the WeakMap nor visits a field with nothing to apply);
`Schema.from` ≈ 263 K / 88 K, `new Model` ≈ 16 K (about 8% under A: every field checks
its rules against its type and a projection re-parses its parent's fields), `model.dts` ≈ 83 K
(102 K in a run of the same code earlier that day: the allocation-heavy scenarios move by a
fifth on this machine). **The moltar schema carries `Struct: {}` since E**: its first key is
`number`, so until then it was a number field with five unknown options, every check failed
at the root, and the 14.1–14.7 M of the 2.0 baseline (and the "no strict/loose asymmetry")
measured that. The roadmap's 2.0 targets were 12 M / 6 M on the closures; the 3.0 JIT target of
25 M on flat valid is met at 30.9 M, the 8 M on flat invalid is not (5.6 M): the invalid path is
bounded by the issue objects (a params object, a path array and a rendered message each, about
40 ns an issue), which both backends build with the same constructors. `pnpm bench
--compare-libs` (`bench/libs.js`) runs the moltar scenarios through zod 4, valibot, ajv and
typebox beside both backends; the tables are in `docs/guide/performance.md`.

## Platform split

`src/runtime/node.js` is the **only** file allowed to require a Node builtin
(`tests/unit/platform.test.js` enforces this). `src/runtime/browser.js` exports the identical
interface. Today that is just `writeFile`, behind `saveTypes` of the generators subpath, which
rejects in the browser; the core entry requires no runtime at all. The swap happens through the
`package.json` `browser` field (`./index.js → ./browser.js`,
`./src/runtime/node.js → ./src/runtime/browser.js`) plus the `browser` condition in `exports`;
the `browser` map applies to the subpath too, since bundlers resolve it for every file of the
package. `pnpm size` bundles `browser.js` with `platform: 'browser'`, and the bundle test builds
the core with the subpath for both platforms, so a leaked builtin fails CI. Renaming a runtime
file means updating the `browser` map keys.

## Conventions (oxlint/oxfmt + review)

- Formatting: 2 spaces, single quotes, semicolons, trailing commas, **100 columns**, LF
  (`.oxfmtrc.json`, `.editorconfig`). Lint: `.oxlintrc.json` (from kerberos: the explicit rule
  list, plus the `correctness` and `suspicious` categories as errors and `no-console` everywhere
  but `scripts/` and `bench/`); `forEach` and `reduce` are errors through
  `no-restricted-properties` (index loops instead; `map`/`filter`/`find` stay in `tests/` and
  `bench/` where they render or set up, and are loops in `src/`). Suppress a rule only for an
  intentional construct, with a
  targeted `// oxlint-disable-next-line <rule>`. `valid-typeof` is disabled at the two places that
  compare `typeof` with a type name held in a property.
- Keep metaschema's code style:
  - module-level functions are arrow functions assigned to `const`; classes and prototype objects
    use method shorthand; no `function` declarations;
  - `Object.create(null)` for dictionaries;
  - hot loops avoid destructuring: `for (const pair of Object.entries(x)) { const key = pair[0]; … }`;
    use index loops, not `forEach`;
  - prefer `const`; no `var`;
  - private class members with `#`;
  - `value == null` for "null or undefined" (`eqeqeq` ignores `null`), nothing else loose;
  - in the hot path (`check` closures): no closures or regexes created per call, one object
    shape per kind of object (context, issue, plan entry), `try/catch` only around user code,
    and functions chosen at build time instead of lookups in the definition.
- Built-ins with the `node:` prefix; relative requires always end in `.js`.
- Validators return messages; `throw` only for definition errors, always a
  `SchemaDefinitionError` with a code.
- Self-descriptive code; comments explain *why*, not what.
- Conventional Commits (`feat(scope):`, `fix:`, `docs:`, `chore:`, `ci:`, `test:`, `refactor!:`).

## Skills

`.claude/skills/` holds the seven [metaskills](https://github.com/metarhia/metaskills) v1.0.5
skills: `js-conventions`, `js-data-structures`, `data-structures`, `metautil-data-structures`,
`js-gof`, `error-handling` and `npm-publish`.

- **`js-conventions` is adapted to this toolchain:** oxlint/oxfmt instead of ESLint/Prettier,
  pnpm, 100 columns, plus a Modules section (CommonJS, no `'use strict'`, `node:` prefix, `.js` in
  relative requires) and the loop rule (`forEach` and `reduce` are lint errors; `map`, `filter`
  and `find` outside `src/` only). Its naming and optimization rules are upstream's.
- **`npm-publish` is adapted to the release process below:** pnpm commands, the `prepublishOnly`
  gates, this CHANGELOG's format (including the upstream-history section), docs and `pnpm pack`
  checks, and `pnpm run release`.
- **The other five are verbatim copies.**

Keep the two adapted skills in sync with this file when conventions or the release process
change. **This file wins** if they ever disagree.

## Testing notes

- Runner: Node's built-in `node:test` + `node:assert`. Existing suites use flat
  `test('Area: description', …)`; keep that style in those files.
- `pnpm test` passes the glob unquoted (`tests/unit/*.test.js`) so the shell expands it on Node
  18/20; Node ≥ 22 expands it itself, which is why CI runs Windows only on 22/24.
- `tests/fixtures/schemas/` are plain CJS modules. `index.js` exports
  `{ database, types, ...entities }` in file-name order, the order `Model` used to receive them
  from the old loader. The model test builds `new Model(types, new Map(Object.entries(entities)), database)`
  from it.
- The type registry is process-global, but `node --test` runs each test file in its own process,
  so files do not leak custom types into each other. Within one file, tests do share it.
- `tests/unit/bundle.test.js` builds `browser.js` and `index.js` together with
  `src/generators/index.js` (one stdin entry, minified and not) and validates through the
  result, so a class-name-based identity check cannot come back unnoticed. It runs in `pnpm test`
  on every matrix leg; esbuild supports Node 18. It also calls the generator functions, then
  `register()` and the methods, through the bundles, and `saveTypes` (rejects in the browser
  build, writes into a temp directory in the node build).
- `tests/unit/generators.test.js` covers the subpath: the functions on a Schema and a Model, the
  `TypeError` for anything else, the core without `register()` (no methods, `~standard` with
  three keys, no `saveTypes` export) and `register()` (idempotent, non-enumerable members, the
  converter joining props built before the call). The other suites that use the methods
  (`model`, `schema`, `references`, `dts`, `jsonschema`, ... ) call `register()` at the top;
  `standard.test.js` does not, so it pins the core alone.
- `tests/unit/jsonschema.test.js` pins every form of the language by target (a `fieldOf(def,
  options)` helper renders `{ x: def }` and reads `properties.x`), the strict profile, the
  mongodb target, the error locations, the fixture model and the Standard converter. The type
  registry is process-wide, so a custom type registered in one test must not share a name with
  a field that starts a struct in another (a `text` type turned `{ text: {...} }` into a
  shorthand once).
- `pnpm run test:jit` runs the same suite with `--require ./tests/helpers/jit.js`, which calls
  `register({ jit: true })` of `./compile` (`'auto'` where eval is not allowed), so every
  schema the suites build is compiled at construction; `pnpm run test:nojit` runs it under
  `--disallow-code-generation-from-strings`, where the helper registers the fallback. The helper
  sets `process.env.METASCHEMA_BACKEND` to `jit` or `closure` for a test that must pin one
  backend; none needs it today. `tests/unit/compile.test.js` calls `register({ jit: false })`
  first and compiles explicitly, so it compares the closures with the generated code in every
  run; it holds the two backends to the same issues, errors and verdicts over every form of the
  language, the fixture model, references by kind, custom types, every check option
  (`maxErrors` 1 to 5, `unknown`, `references`, `messages`, `root`) and a schema of keys and
  values that look like code, and covers the code builder, the modes, the errors, `register()`
  and, in a child process, the no-eval environment. `jsonschema-ajv.test.js` is skipped without
  eval (ajv generates code too); `bundle.test.js` bundles the subpath with the core for both
  platforms (the browser bundle runs in a vm context, which the flag does not bind, so it is
  held to its own `canEval()`); `export-parity.test.js`, `scripts.test.js` and
  `tests/types/compile.test-d.ts` cover the subpath export, the size row and the typings.
- `tests/unit/jsonschema-ajv.test.js` is the differential test: a deterministic generator
  (mulberry32, seed 42) produces 400 values per schema from the built fields (mostly valid, with
  mutations), and `check` and ajv (`ajv/dist/2020` and `ajv` for draft-07, strict mode with
  `allowUnionTypes` and `strictTuples: false`, `ajv-formats` for `date-time`) must agree on every
  verdict; each run asserts that both verdicts came up. The generator leaves out what cannot
  agree (documented at the top of the file): `date`/`set`/`map`/`bigint` fields, astral
  characters, number keys, `validate` and `checkType`. The strict profile is not differential
  (it drops the rules by design).
- `tests/unit/dts.test.js` covers the JSDoc and the named types; `save-types.test.js` the
  options of `saveTypes`.
- New behavior needs a test that fails without the change.
- `tests/unit/standard.test.js` covers `~standard`: the props, the pass-through of the result's
  issues, `libraryOptions`, non-enumerability, a consumer that reads only the specification
  (`standardValidate` from its README, awaiting a promise), the fixture model, `validate` as
  parse (defaults, decoders, the same reference when nothing applied, the schema's `unknown`)
  and the promise of an async schema; `bundle.test.js` reads it through the minified bundles;
  `tests/types/standard.test-d.ts` is the only place that imports `@standard-schema/spec`.
- Workstream F suites: `parse.test.js` (the value itself when nothing applied, defaults as
  values and factories at every depth, strip at every depth, decoders bottom up through every
  container and embedded references, decoder exceptions and their paths, keys named like
  `Object.prototype` members, `maxErrors`, the input never written to), `serialize.test.js`
  (top down, the round trip, `check: true`, a looping program value, `format` never called),
  `async.test.js` (`ERR_ASYNC_VALIDATOR` from the sync calls, the settle order, the "nothing
  under it failed" rule across promises, `maxErrors`, exceptions, async `checkType`, decoders
  in every container, references and unions), the compile suite's parse/async/serialize
  equivalence on both backends, the bundle test through the minified bundles and
  `tests/types/parse.test-d.ts` (`InferOutput`, defaults on both sides, the parse result, the
  serialize overloads, `RuntimeErrorCode`). The new suites run under `test`, `test:jit` and
  `test:nojit`.
- `tests/unit/result.test.js` and `check-options.test.js` cover the issue shape, locales and
  `check` options; `tests/unit/context.test.js` pins the context shape and the absence of global
  state. The locale tables are compared key by key, so a new issue code needs a renderer in every
  locale.
- Workstream C: `tests/types/infer.test-d.ts` covers every form `Infer` reads, with
  `tests/fixtures/schemas` mirrored as an `as const` object (a JS module widens its literals, so
  the fixtures cannot be imported for inference) and the interfaces `toTypeScript(model)` renders
  for it.
- Workstream D2/D3 suites: `generators.test.js`, `jsonschema.test.js`, `jsonschema-ajv.test.js`,
  `dts.test.js` (see above) and `tests/types/jsonschema.test-d.ts`, which pins the assignability
  to `StandardJSONSchemaV1` of `@standard-schema/spec`, the option types and the subpath's
  functions (`tsd` resolves `src/generators/index.d.ts` next to the entry).
- Workstream B suites: `syntax.test.js` (the first key), `numbers.test.js` (min/max, integer,
  rules per type, unicode length), `pattern.test.js`, `nullable.test.js`, `values.test.js` (date,
  null, any), `union.test.js`, `references.test.js` (storage view, graph view, dts) and
  `lint.test.js`; `tuple.test.js` has the any-element cases.
- `tests/fixtures/schemas/Account.js` marks `birth` with `Struct: {}` because its first field is
  called `date`; without the marker the fixture is a `date` field and the lint says so. The
  fixture model is the one the migration guide (`docs/guide/migrating-from-1.md`) was run
  against: it builds with no warnings, validates rows (ids) by default and the graph with
  `{ references: 'embed' }`.
- `bench/bench.js` has no test. Its scenarios are `Schema.from` flat/nested, `check` flat/nested
  valid/invalid, the eight moltar modes on both backends (`bench/helpers.js`), the `parse`
  scenarios and `new Model`/`model.dts` over the
  fixture; `pnpm bench moltar` filters by name. `tests/unit/scripts.test.js` covers
  `scripts/size.js` (both entries, the budget flag, a bad flag).
- Doc example outputs were checked against the code (every `// ...` output in `docs/guide`,
  README and the migration guide, the 1.x column of the latter against a checkout of `main`); a
  scratch script that prints them is the quickest way to re-verify after a message change.
  `docs/guide/performance.md` quotes `bench/baseline.json`; update the table when the baseline is
  re-saved.

## Things that look like bugs but aren't

- **`default` is applied by `parse` only.** `check` reports a missing required key as `required`
  whatever its `default`; `parse` fills it (and an `undefined` one) before the check, at any
  depth, calling a function default on every parse. `Infer` therefore makes a defaulted key
  optional and `InferOutput` makes it present. A default is validated like any value.
- **`parse` returns the value itself when nothing applied, and never writes to it.** Copy-on-write:
  a container is copied at the first part a default, a decoder or `strip` changed, so
  `parse(value).value === value` for a plain schema (what `~standard.validate` returned in 2.0),
  while under `strip` every struct of the output is new. Pinned in `tests/unit/parse.test.js`.
- **`format` is collected and never called.** `schema.options.format` exists for code that
  builds on the schema; `parse` and `serialize` call `options.parse` and `options.serialize`
  only, and a field's `format` key is an `unknown-option` warning.
- **A field's `parse`/`serialize` key is a codec, and a nested struct's is that struct's.**
  `{ a: 'string', parse: fn }` as a nested definition makes `fn` the decoder of the struct value
  (as a nested `validate` is its validate); it is also a calculated field in `fields`, as
  `validate` always was. A struct whose *field* is named `parse` (`{ parse: 'string' }`) is a
  struct. A non-function `parse`/`serialize` on a field is `ERR_INVALID_DEFINITION`.
- **A validator's promise throws from the synchronous calls.** `check`/`parse` throw a
  `TypeError` with `code: 'ERR_ASYNC_VALIDATOR'` (not a `SchemaDefinitionError`: the call is
  wrong, not the definition) for a promise from a `validate`, a `checkType` or a decoder;
  `checkAsync`/`parseAsync` settle them after the walk, in field order, and `~standard.validate`
  returns a promise only for a schema with an `async function` among them (detected on first
  use through `hasAsync`), so a plain function that returns a promise throws there too.
- **A plain union's branch is found by a second check of the union value in the passes.**
  `codec.js` tries the branches with a scratch context (limit 1, the policies of the call,
  pending promises set aside as the check sets them aside) only when the union's subtree
  carries something for the phase; a `discriminator` picks the branch in one lookup. In
  `serialize` that second check runs on the program value, so a plain union is entered only
  while the value still has the form of a branch.
- **A plain union picks the first branch whose synchronous checks pass.** In `checkAsync` and
  `parseAsync` a validator of a branch that returns a promise is set aside; the branch is taken
  if nothing else in it failed, the deferred validator settles after the walk and may still fail
  the value, and no further branch is tried. A branch that fails drops the validators it set
  aside with its issues (both backends). Where branches carry async validators, a
  `discriminator` is the answer.
- **A value with a `then` function is data.** The passes of parse treat as pending only a
  `Promise` instance made by a decoder in an async parse (`isPending` in `codec.js`); a thenable
  a decoder returns is adopted into a real promise, and every promise of the passes resolves to
  a box `{ value }`, never the value itself, so a field called `then` is never adopted by the
  chain or by the `await` in `parseAsync`. A `Promise` instance in the data under a subtree
  with an async decoder in `parseAsync` is the one case that is awaited; the synchronous `parse`
  awaits nothing.
- **The trial that picks a plain union's branch in `parse` runs the branch's validators a
  second time.** `codec.js` tries the branches with the one scratch context of the parse
  (`context.scratch`: the root and the live path of the parse, limit 1, a promise list reset per
  branch and abandoned after it) only when the union's subtree carries something for the phase;
  a validator in such a branch runs in the trial and again in the check, with the same path.
  Use a `discriminator` to avoid it.
- **A failed trial, a stopped settle and a synchronous throw still observe their promises.**
  `abandon` in `issues.js` attaches a no-op rejection handler, so no promise metaschema leaves
  behind rejects unhandled.
- **A non-function `default` is shared by every parse output** (as in zod): `default: []` is the
  same array in every value; a function is a factory. A `default` factory or a field's
  `serialize` that throws is a programming error and throws out of `parse`/`serialize` (pinned by
  tests); only a decoder's exception is an issue.
- **A valid result's `issues` is a frozen empty array** (`NONE`), the same one every time: read
  it, never push into it.
- **`maxDepth` is 128 by default.** `runReferenced` counts the embedded records the check is
  inside (`context.depth`) and records a `depth` issue past `context.maxDepth`; `walkReference`
  leaves such a record as it is for the check to report. A valid graph deeper than that needs
  `maxDepth` on the call. The JIT calls the reference's closure, so both backends agree.
- **`schema.relations` is a `Set` of fresh `{ to, type }` objects**, so it behaves as a list
  (no deduplication by content); it is read by `#tracked` and the docs only.
- **A compiled schema's `check` is a function named `jit`, installed as `schema[RUN]`.**
  `compile()` of the `./compile` subpath replaces the own `[RUN]` property and returns
  `{ accelerated }`, not the schema; the plan entries, `field.check` and `fields[STRUCT].check`
  stay the closures, and a schema that references this one reaches the generated code through
  `schema[RUN]` at check time. `register()` compiles every schema built *after* it through the
  `Schema[HOOK]` slot, not the ones built before, and `Schema.from` in a hot path pays the code
  generation per construction once it is registered. Without eval, `'auto'` keeps the closures
  silently (`canEval()` says so) and `jit: true` throws `ERR_NO_EVAL`. A check the generator
  cannot build is `ERR_JIT_BUILD` (the cause attached): returned as `compile().error` and told
  to `register({ onFallback })` in `'auto'`, thrown with `true`. `compile(target, { jit: false })`
  restores the closure a schema was built with (kept in a `WeakMap` of the subpath). The
  generated source is strict and ends with `//# sourceURL=alexify-metaschema-jit/<name>`;
  `schema[Symbol.for('alexify.metaschema.run')].toString()` shows it. The tests tell the
  backends apart by that function name.
- **The moltar bench schema carries `Struct: {}`.** Its first key is `number`, a type name;
  without the marker it is a number field with five unknown options and every check fails at
  the root, which is what the 14 M ops/s quoted for 2.0 measured.
- **A validator may run another check, even of the same value.** Every check gets its own
  context (`createContext`), and nothing in the package is global to a check; only the type
  registry is process-wide. `tests/unit/context.test.js` pins it.
- **`result.errors` is lazy, and `issue.message` is filled in after the walk.** The constructors
  in `issues.js` record `message: ''`; `finalize` renders every message once at the end of
  `check` through the locale of that call, and `result.errors` (the lines with the location) is
  built on first use and cached (`#errors`), so a check nobody reads the lines of never renders
  them. `result.add` re-finalizes and drops the cache. A debugger showing an issue mid-walk shows
  an empty message; that is not a bug.
- **`schema['~standard']` is not an own property.** It is an accessor on `Schema.prototype`, so
  `Object.keys`, `JSON.stringify`, `toJSON` and `util.inspect` never show it, while
  `'~standard' in schema` is `true`, which is how Standard Schema consumers detect it. The props
  object is cached per instance (`#standard`) and `validate` is an arrow closure over the schema
  because consumers call it unbound. Since 3.0 `validate` is `parse` (defaults and decoders
  applied, the schema's `unknown` policy), not `check`, and its typings say
  `StandardResult | Promise<StandardResult>`.
- **The first key of an object decides what it is, and `type` must come first for the long
  form.** `{ name: 'string', type: 'string' }` is a struct with two fields; `{ type: 'string',
  name: 'string' }` is a string with a `name` option; `{ required: false, type: 'string' }`
  throws `ERR_INVALID_DEFINITION` (`false` is not a field definition). `Infer` cannot see key
  order and reads the keys that are there (see below); a kind settles both.
- **A string as the second argument of `check` throws.** `check(value, 'body')` was the 1.x
  signature; `context.js` turns it into a `TypeError` naming `options.root` on purpose, so a
  caller that was not migrated fails loudly instead of validating with the wrong options.
- **`field.check` is a getter over a private field.** The compiled closure is set once in the
  `AbstractType` constructor; assigning it as an own property would show up in `toJSON` and
  `util.inspect`, and `Object.defineProperty` cost 100 ns per field at construction. `check`,
  `checkType`, `compile` and `construct` are reserved definition keys whether the type has them.
- **`{ x: 'number' }` as a tuple element is a named number, not a struct.** Upstream's named
  elements (`[{ x: 'number' }, { y: 'number' }]`) are kept: a one-key object holding a type name
  names the element. A one-field struct element is `{ schema: { x: 'number' } }`.
- **`nullable` is not optional.** `'?string'` and `required: false` accept `undefined` and
  `null` and let the key be absent; `nullable: true` keeps the key required and only lets the value
  be `null`. The nullable wrapper is the outermost closure, so rules and `validate` never see
  `null`.
- **A reference to an Entity validates as an id by default.** `person.check({ employer: { name }
  })` fails with `not of expected type: string` when `Company` is a stored kind: that is the
  storage view (ROADMAP W11, the references guide's ADR). Validate a graph with `check(value, {
  references: 'embed' })` or mark the field `embed: true`; tests that embed use a `Struct` kind.
  Cycle detection therefore only happens where a record is embedded.
- **`date`, `null`, `any`, `unknown`, `integer` and `union` are type names.** A nested struct
  whose first field has one of these names (`birth: { date, place }` in the fixture) is read as
  that type with unknown options; the lint reports it, and `{ Struct: {}, ... }` or the `schema`
  shorthand says what was meant.
- **The `unknown` policy belongs to the check, not to the struct.** `{ Form: { unknown: 'ignore'
  } }` is the default of that schema's own `check` and covers the whole value; a lenient schema
  embedded in a strict one is checked strictly through the strict one.
- **`schema.warnings` and `model.warnings` are getters.** The lint runs on first use and is
  cached, so construction in a hot path (`Schema.from` in a request handler) never pays for it.
- **`Schema.extractSchema` is public but no longer used internally.** The schema prototype's
  `construct` accepts a `Schema` instance itself; the static stays for callers and the bundle
  test.
- **The JSON Schema of an optional field allows null, and a required `object` has
  `minProperties: 1`.** Both are what `check` does (`'?string'` accepts `null`; an empty
  required `object` or `map` is a `required` issue), and the differential test holds the export
  to it. The strict profile drops every value rule (`minLength`, `minimum`, `uniqueItems`,
  `minProperties`, ...) on purpose: the LLM dialects reject or ignore them, and `check` applies
  them to the model's answer afterwards.
- **A reference to the root schema is `{ $ref: '#' }`, and `model.toJSONSchema()` has no root.**
  A single schema is its own document, so a self-reference points at the document; through the
  model every entity is a definition and a reference is `<prefix><Name>`. OpenAPI consumers
  should export through the model (`components.schemas`), where `#` never appears.
- **The mongodb root allows `_id`.** A closed `$jsonSchema` root would reject every stored
  document otherwise; `_id: {}` is added only when the root is closed and the schema has no
  `_id` field of its own. Embedded documents do not get it.
- **`~standard.jsonSchema` refuses the mongodb target.** The specification asks a library to
  throw for a target it does not support, and a `$jsonSchema` is not a JSON Schema; it is
  reached through `toJSONSchema` only.
- **An array is not a struct.** `compileStruct` rejects an array with `not of expected type:
  object` (3.0); before, a struct with only optional fields accepted `[]` because `typeof [] ===
  'object'` and the walk found nothing to complain about.
- **`schema.toJSONSchema`, `model.dts` and `schema['~standard'].jsonSchema` do not exist until
  `register()` of the generators subpath ran.** The core typings declare them anyway (a
  type-level claim, commented), the functions of the subpath do the same job without the
  registration, and `register()` is idempotent and process-wide, like the type registry. The
  `~standard` props of a schema built before the registration gain `jsonSchema` on the next
  access (the override adds it to the cached object).
- **A missing optional field never calls `Object.hasOwn`.** `value[key]` is read first; `hasOwn`
  decides only between a missing required key (`required`) and one set to `undefined` (a `type`
  issue), and is asked first only for a field named after a member of `Object.prototype` (plan
  entry `own`), which would otherwise read the inherited function. An inherited enumerable
  property of a custom prototype is therefore validated like an own one.
- **Cycle detection lives at references only.** A schema without references is a finite tree, so
  a cyclic value cannot make the walk recurse: it is reported for what it is (unexpected keys,
  wrong types). The `seen` set is created on the first reference met, and `Schema#check` adds the
  root value only for a struct with relations (`#tracked`). Do not "fix" the nested-struct case
  by tracking every object: it costs a `Set` per check.
- **The schema-level `validate` runs after the fields and only when they all passed**, and a
  field's `validate` only after its type and rules passed. That is the 2.0 semantics (A5), not an
  ordering accident.
- **Unexpected keys are one issue per struct** (`unexpected { keys }` at the struct's path), and
  the scan runs only when `for...in` counts more keys than the plan found. `maxErrors` therefore
  counts them as one.
- **`issue.message` has no location.** The line with the location is `result.errors[i]`; forms
  use `flatten()`. The `Field` prefix rule (a message that already starts with `Field` is kept)
  exists for custom types written in the upstream style.
- **`TYPES` is mutated by `typeFactory`.** Custom types and metadata registered by one `Model` are
  visible to every schema in the process, including `Schema.from` without a namespace. This is
  upstream's design; do not "fix" it by cloning per model without discussing it first.
  Re-registering a name is accepted only for the same definition (`Type.source`: same `js`, same
  `construct`/`checkType` functions) or a metadata-only entry; anything else throws
  `ERR_TYPE_REGISTERED`, because the old silent no-op hid conflicting tables. A model that needs
  its own table passes `{ registry: 'isolated' }`: `createRegistry()` builds a fresh copy of the
  built-ins and `typeFactory(types, registry)` registers into it instead of `TYPES`.
- **Identity checks use a brand symbol, not `instanceof` or `constructor.name`.** `util.js`
  exports `BRAND = Symbol.for('alexify.metaschema.brand')` and `hasBrand(value, name)`;
  `AbstractType`, `Schema` and `ValidationResult` carry it on their prototypes, a struct as a
  non-enumerable own property. A global
  symbol works across realms and duplicate copies of the package (which `instanceof` does not) and
  survives bundlers renaming a class (`class _Schema`) and minifiers mangling it (which
  `constructor.name` does not). `tests/unit/bundle.test.js` validates through esbuild bundles of
  both entries, minified and not. Only built-ins are still recognised by name
  (`value?.constructor?.name === 'Map'`), since nothing renames those.
- **`schema.fields` is a null-prototype object, not a class instance.** `createStruct` builds it
  that way on purpose: a field may be called `check`, `name` or `constructor`, and input keys
  such as `__proto__` must come back as unexpected instead of resolving to `Object.prototype`.
  `fields[STRUCT].check` is the compiled check (`checkOf(fields)` in `struct.js`); `Schema`
  compiles `this[RUN]` from it, or from `fields.check` when `fields` is a `Type` for a non-struct
  schema (`Schema.from('string')`).
- **`Infer` reads keys, not key order.** TypeScript has no key order, so `Infer` reads a kind
  key as a struct, else a `type` string as the long form, else a collection key (`array`, `set`,
  `object`, `map`, `enum`, `tuple`, `union`, `schema`, `one`, `many`) as that shorthand, else a
  struct. `{ name: 'string', type: 'string' }` validates as a struct and infers as `string`; the
  documented fix is a kind. Do not try to recover the first key at the type level.
- **`Infer` keeps a stored reference under its own key and includes `null` in optional
  fields.** `check` reads `value.employer` (an id), so `Infer` types `employer: string` where the
  dts renders `employerId: string`; an optional field is `T | null | undefined` because `check`
  accepts `null`, where the dts renders `T | undefined`. Both differences are documented in the
  TypeScript guide; the dts is upstream's convention and is not changed by `Infer`.
- **`Infer<D>` has no id field for a stored kind.** The id is named after the entity, which a
  definition does not carry; `InferEntity<E, Name>` adds it from the map key.
- **`Model#preprocess` skips names starting with `.`**: a leftover of the old loader's
  `.database`/`.types` files. It is harmless.
- **Optional nested structs have two mechanisms.** Inside a struct, `createStruct` settles the flag
  before building the field: `typeDefs.required = (typeDefs.required ?? true) && required` (from
  `'key?'` or `required: false`), because the compiled check captures it. `prototypes/schema.js`
  keeps an explicit `required` with `required ?? true`, which is what makes a nested struct
  optional as a collection element. Upstream had `required || true`, which ignored `false`; do not
  bring it back. `tests/unit/structs.test.js` covers every form.
- **`relations` labels are read from the referencing side**: a `many` field is `'one-to-many'`
  (one record holds many targets), a single reference is `'many-to-one'`. Upstream had the two
  swapped; 2.0 uses the conventional direction.

## Documentation site

VitePress in `docs/`, deployed to Vercel (`vercel.json`) at `metaschema.vercel.app`. It is not
published to npm, and lint/format do not cover it.

- Only `docs/index.md` has frontmatter; links between pages are absolute and extensionless.
- `ignoreDeadLinks` is off, so `pnpm docs:build` failing on a dead link is a feature.
- The nav version label is read from `package.json`.
- The brand is the violet "braces" mark (`#7C5CFF`, `#9D85FF` on dark): `docs/public/logo-mark*.svg`,
  `favicon.svg` (follows `prefers-color-scheme`), `favicon.png` and `logo.png` (the 1200×630
  og:image).
- When behavior changes, update README and the matching docs page together. Example outputs in the
  docs were checked against the code, so keep them true.
- The 2.0 pages: `guide/unions.md` (union, discriminator, optional vs nullable vs `null`),
  `guide/performance.md` (the core, the baseline numbers, the JIT, the library comparison), `guide/migrating-from-1.md`
  (the CHANGELOG's "Upgrading from 1.x" with before-and-after examples; the 1.x outputs were
  produced by the code on `main`) and `guide/standard-schema.md`. The 3.0 pages are
`guide/parse.md` (the pipeline, defaults, codecs, strip, serialize, async, the boundaries),
`guide/json-schema.md` (options, targets, the mapping table, the strict profile with a tool
definition, the mongodb target, the boundaries) and `guide/compile.md` (compile, register,
canEval, the jit option, where there is no eval, what the generated code contains, the
boundaries). The sidebar is in `.vitepress/config.mts`; a new page goes there and into
`docs/public/llms.txt` if it is a key fact.

## Release process

Manual, as in the sibling repositories. The `npm-publish` skill walks through it step by step:

1. Bump `version` in `package.json`.
2. Turn `## [Unreleased]` in CHANGELOG.md into `## [X.Y.Z] - YYYY-MM-DD` and add its link
   reference.
3. Commit, then tag `vX.Y.Z`.
4. Run `pnpm run release` (`pnpm publish`, gated by `prepublishOnly`; `publishConfig.access` is
   public).

The upstream history (`metaschema` 2.2.2 and older) is kept under its own heading at the bottom of
the CHANGELOG with `upstream-*` link references.

## Upstream sync

`git fetch upstream` brings metarhia's changes, but nothing applies cleanly anymore: paths moved
(`lib/` → `src/`, `test/` → `tests/unit/*.test.js`), everything was reformatted by oxfmt at 100
columns, `'use strict'` and the loader are gone, and metautil is copied in. Port upstream fixes by
hand: reproduce them in a test first, then apply the change in the new layout. Skip anything that
touches the loader, `metavm` or dependencies.
