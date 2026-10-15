# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

**metaschema** (npm package `@alexify/metaschema`) is a metadata schema and interface definition
language for JavaScript. Data structures and domain models are declared as plain objects; the
package validates values against them (`Schema#check`), assembles them into domain models
(`Model`), renders TypeScript interfaces and JSON Schema through the
`@alexify/metaschema/generators` subpath (`toTypeScript`, `toJSONSchema`), and compiles checks
into generated code through the `@alexify/metaschema/compile` subpath (`compile`, `register`,
with a fallback to the closures where `new Function` is not allowed). Since 3.3 `parse`
coerces the input when asked (the converters are the `./coerce` subpath's), schemas are
derived from schemas through `./derive`, and `./mongodb` is the schema side of a MongoDB
program without the driver. Since 3.4 a schema writes its own snapshot (`schema.toSnapshot()`,
the contract `@alexify/protoarray` builds its codecs from), `bytes`, `flags` and the `decimals`
rule are built in, the checks are compiled on their first use, and the core is two halves over
the same classes, the first of which is the `./definition` subpath (build and read, no
validation). It has zero runtime dependencies and runs in Node.js ≥ 18 and browsers.

It is a fork of [`metarhia/metaschema`](https://github.com/metarhia/metaschema) 2.2.2, maintained
by Alexis Technologies and set up like the sibling libraries `@alexify/kerberos` and
`@alexify/migronaut`. The git remote `upstream` points at metarhia; `origin` at
`Alexis-Technologies/metaschema`. The schema language is upstream's; 2.0 settled its semantics
(CHANGELOG "Upgrading from 1.x": issues as data, the first key, `min`/`max`,
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
pnpm size [--max-gzip <KB>] [--max-gzip-generators <KB>] [--max-gzip-compile <KB>] [--max-gzip-model <KB>] [--max-gzip-stream <KB>] [--max-gzip-formats <KB>] [--max-gzip-derive <KB>] [--max-gzip-coerce <KB>] [--max-gzip-mongodb <KB>]   # esbuild bundle sizes; CI gates at 19 KB per core entry, 7.5 KB for ./generators, 5 KB for ./compile, 13 KB for ./model, 1.5 KB for ./stream, 5 KB for ./formats, 2.5 KB for ./derive, 2 KB for ./coerce on top, 4 KB for ./mongodb on top of the core and ./coerce
pnpm bench [filter] [--json] [--save] [--compare]   # ops/sec harness (closures and JIT), manual only; --save writes bench/baseline.json
pnpm bench:compare [--only zod,valibot] [--scenarios nested,invalid]   # 11 libraries, a fresh process per pair → bench/results/compare.json
node bench/releases.js [--src <checkout or node_modules/metaschema>]   # release over release → bench/results/releases.json
pnpm size:compare [--json]         # the comparison's schema bundled per library, verified, min+gzip → bench/results/size.json
pnpm bench:report                  # the charts (docs/public/benchmarks/*.svg) and the generated tables of README and docs/guide/benchmarks.md
pnpm docs:comparison               # the feature matrix of README and docs/guide/comparison.md from docs/comparison.json
pnpm run docs:dev                  # VitePress dev server for docs/ (docs:build, docs:preview)
```

`prepublishOnly` runs lint + format:check + test:coverage + test:types + check:dts. The full gate
before a merge adds what CI also runs: `pnpm run test:jit`, `pnpm run test:nojit`,
`pnpm size --max-gzip 21 --max-gzip-generators 8 --max-gzip-compile 5 --max-gzip-model 13 --max-gzip-stream 1.5 --max-gzip-formats 5 --max-gzip-derive 2.5 --max-gzip-coerce 2 --max-gzip-mongodb 4 --max-gzip-definition 11`
and `pnpm docs:build`.
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
  `src/locales/*.d.ts` that type the locale subpath exports through it and the subpath
  typings `src/generators/index.d.ts`, `src/compile/index.d.ts`, `src/model/index.d.ts`,
  `src/stream/index.d.ts`, `src/formats/index.d.ts`, `src/derive/index.d.ts`,
  `src/coerce/index.d.ts`, `src/mongodb/index.d.ts` and `src/definition/index.d.ts`, which
  import the shared types from it (the mongodb one also augments `CustomTypes` with the BSON
  types; the definition one re-exports the root's classes, which export-parity reads as
  `export { … } from`). A public API change touches
  `src/index.js`, `index.d.ts` and a test together. The static inference (`Infer<D, E>`,
  `InferSchema<S>`, `InferEntity<E, Name>`, `CustomTypes`, and `Schema<D>` with its phantom
  `'~definition'` member) lives in `index.d.ts` only, has no runtime counterpart, and is pinned
  by `tests/types/infer.test-d.ts`, which also compiles the examples of
  `docs/guide/typescript.md` and README. `tests/unit/export-parity.test.js` compares
  runtime exports with the declared value exports for both entries, imports every name from ESM
  and resolves the locale subpaths. `tests/types/*.test-d.ts` (tsd) pin signatures. `check:dts`
  needs `--target es2022` because there is no tsconfig.
- `package.json` has a closed `exports` map (`.` with `types` first, then `browser`, then
  `default`; `./locales/en`, `./locales/uk`, `./generators`, `./compile`, `./model`,
  `./stream`, `./formats`, `./derive`, `./coerce`, `./mongodb` and `./definition`, each with
  its own `types`), `sideEffects` listing the entries and `src/validation.js` only (loading the
  core installs the validation half into the classes, so `import '@alexify/metaschema'` for that
  alone must survive a bundler; nothing else registers on import, so a bundler may drop a subpath
  a program imports and never calls; the size script exports what it bundles for that reason;
  `bundle.test.js` bundles the bare import as ES modules) and a
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

**The model as data lives in `./model`; the core writes the snapshot and reads the aliases.**
`model.toJSON()` (`src/snapshot.js`) is in the core because `JSON.stringify(model)` must work
without an import and the snapshot is the contract other programs read the model through
(migronaut, Alioth, wrpc); `aliases` and `deprecated` are in the core because `check`, `parse`
and the lint read them. Everything that reads a snapshot or builds on it (`fromJSON`, `diff`,
`compatibility`), and everything that builds values or schemas from schemas or from values (`sample`,
`merge`, `infer`), is the `@alexify/metaschema/model` subpath (`src/model/`): functions plus an
explicit `register()` that installs `Model.fromJSON`, `Model.diff`, `Model.compatibility`,
`Schema.merge`, `Schema.infer` and `schema.sample` non-enumerably; importing registers nothing. `Model.fromJSON`
was planned for the core and moved to the subpath on 2026-10-11 because the
restore is 0.8 KB that validation never needs and the core had 14 bytes of headroom left.
`fromJSONSchema` is the other direction of `toJSONSchema` and lives beside it in
`./generators`. Nothing in the core requires `model/` or `generators/`.

**A sequence of records is the `./stream` subpath (3.2).** `checkEach`, `parseEach`, their
async twins and `transform` (a `TransformStream`) run the methods of the core on each record
of an iterable and yield `{ index, record, result }`; `register()` installs them on `Schema`.
It is iteration glue and an adapter to the Web Streams, not validation semantics, so it is a
subpath (Alex's decision, 2026-10-11) and the core did not grow for it; it requires `util`,
`issues` (`abandon`), `errors` and `schema.js` only, never `codec`.

**A string format is a rule of the core with a table the `./formats` subpath fills (3.2).**
`{ type: 'string', format: 'email' }` is a rule beside `length` and `pattern`: `rules.js`
holds the rule and an empty null-prototype table `FORMATS`, read when a field is built (a name
the table lacks is `ERR_INVALID_RULE` with the hint), and `register(custom)` of
`@alexify/metaschema/formats` fills it with nine built-in formats (the expressions of
ajv-formats' fast mode, copied with attribution; the date and time ranges checked) and the
program's own `{ test, examples, infer }`, once per name, process-wide like `TYPES`. A format
is a rule and not a type on purpose (Alex's decision, 2026-10-11): a type named `email` makes
`{ email: 'string', name: 'string' }` read as the shorthand of that type (the first key
decides), which was reproduced before the design was changed. The generators, `sample` and
`infer` read `FORMATS` of the core; the subpath requires `rules.js` and `errors.js` only.
Since 3.3 it registers 35 formats (ajv-formats', zod's, valibot's and semver.org's
expressions, held to those libraries value by value in `formats.test.js`), an entry may carry
a `pattern` the JSON Schema export writes beside a name JSON Schema does not know, and the
program's own format under the name of a built-in takes its place (Alex's decision,
2026-10-13: a 3.2 program that registered `ulid` keeps working).

**Coercion is a policy of parse with a slot in the core and converters in `./coerce` (3.3).**
`parse(value, { coerce: true })`, the kind metadata `{ Form: { coerce: true } }` (in `custom`,
read once into `schema[COERCES]`: an own property would shadow the `coerce` method) and
a field's `coerce: true|false` (its subtree) decide; `check` never converts. The core has the
`COERCE` bit of the pass before the check and the `COERCION` slot in `codec.js` (its `convert`
throws `ERR_NOT_REGISTERED` until `register()` of `@alexify/metaschema/coerce` installs the
dispatcher); the converters by type name, the program's own included, are the subpath's
`COERCIONS` (Alex's decision, 2026-10-13, like the formats). The converters are strict (Alex's
decision): decimal strings, `'true'`/`'false'`/`'1'`/`'0'` and 1/0, ISO dates with a zone or
epoch ms, never `''`. `coerce(schema, value)` of the subpath is the pass before the check with
coercion on, conversions **and defaults** (Alex's decision), nothing checked. `Infer` does not
change.

**Deriving a schema is the `./derive` subpath (3.3).** `pick`, `omit`, `partial`, `required`,
`extend`, `keyof` build a new Schema from `structDefinitionOf` of the source (shared with
`merge` in `model/data.js`); the core and `./model` did not grow. A stored kind or a
projection becomes a struct without the id of its kind (unless the call names it), `partial`
drops defaults (a patch keeps what is stored) and, with `pick` and `omit`, the schema's own
functions; `extend` replaces where `merge` unifies.

**`./mongodb` does no I/O and has no driver dependency (3.3).** The program registers the
module of its driver (`register({ bson })`), which also installs the converters of the BSON
types into `./coerce`; a value of bson is recognized by `_bsontype` and a method, never by
`instanceof`. `bson` is a devDependency (since the review of 3.3) for the differential test
`mongodb-bson.test.js`, never a dependency. The program keeps ids as strings, `toDocument` writes `_id` and references as
ObjectIds, `fromDocument` reads them back and parses with coercion, `indexesOf` and
`checkUpdate`/`toUpdate` are data. A persistence layer with a `mongodb` peer dependency is a
separate package, planned (Alex's decision, 2026-10-13); Mongoose stays the recommendation for
an ODM (populate, middleware, change tracking).

**The core is two halves over the same classes, and `./definition` is the first alone (3.4).**
The definition half (`schema.js`, `model.js`, `types.js`, `preprocessor.js`, `kinds.js`,
`metadata.js`, `struct.js`, `rules.js`, `snapshot.js`, the prototypes) builds a schema and
reads it; the validation half (`validation.js`, `checks.js`, `codec.js`, `context.js`,
`issues.js`, `result.js`, `lint.js`, `locales/en.js`) installs into those classes, once, when
the core entry requires `validation.js`: `check`, `checkAsync`, `parse`, `parseAsync`,
`serialize`, `validate`, `~standard`, `warnings` and `checkConsistency` on `Schema.prototype`,
`warnings` on `Model.prototype`, the `compile` of every built-in on its prototype object (from
`COMPILE` of `checks.js`), the generic `compile` of a custom type on `AbstractType.prototype`,
and the builders the lazy checks call (`BUILD.field`, `BUILD.schema` of
`prototypes/abstract.js`). Until then the definition half's stubs throw `ERR_NOT_REGISTERED`
(`noValidation` of `errors.js`) and a schema has no `~standard`. The lint is the validation
half's (Alex's decision, 2026-10-15: it is about 700 bytes the definition entry does without).
The plan asked for 8 KB for `./definition` and at most 100 bytes of growth of the core; the
definition half alone is 9.7 KB and the split costs the core about 610 bytes (the installation,
the stubs, the state under symbols, the chain of the prototypes), which Alex accepted with the
gates at the next whole KB (10 KB, 21 KB). A subpath that validates, renders or converts
(`./generators`, `./compile`, `./model`, `./stream`, `./coerce`, `./mongodb`) requires
`validation.js` for its Schema, so it brings the validation half along; `./derive` and
`./formats` work beside the definition entry alone. `graph.test.js` pins that the definition
half reaches no module of the other.

## Repository layout

```
index.js  browser.js  index.d.ts   root entry shims + hand-written types
src/
  index.js          public barrel (explicit named exports): the classes with validation.js installed
  validation.js     the validation half: installs check, checkAsync, parse, parseAsync, serialize, validate,
                    ~standard, warnings and checkConsistency on Schema, warnings on Model, the compile of every
                    prototype and the builders of the lazy checks (BUILD); exports Schema, ValidationResult
  checks.js         the checks of the types: COMPILE (the type check of each built-in by name, the identity
                    codec.js and emit.js dispatch on), custom (a checkType through the validator contract),
                    compileField (rules, validate, nullable around it), checkOf/aliasOf (the struct loop),
                    compileRules/ruleNames/patternLimit/decimalsOff/codePoints/lengthOf, nameOf/tableOf (unions)
  kinds.js          KIND/KIND_STORED/KIND_MEMORY/SCOPE/STORE/ALLOW, getKindMetadata, idFieldOf (the one rule
                    of the id field a stored kind adds, read by derive, mongodb and the generators)
  metadata.js       SchemaMetadata (kind, scope, indexes, options, …)
  schema.js         Schema (extends SchemaMetadata), the definition half: construction, the lazy stub of
                    Schema[RUN], types, findReference, attach/detach, toJSON, toSnapshot; the stubs of the
                    validation methods (ERR_NOT_REGISTERED until validation.js installs them)
  struct.js         createStruct: null-prototype field dictionary with its plan and known keys
  context.js        createContext: the state of one check ({ issues, count, limit, depth, maxDepth, path, seen, source, unknown, references, root, messages, async, scratch })
  issues.js         issue constructors by code, toDotPath, absorb (the validator contract), runValidate/runCheckType, settle (the async drain)
  codec.js          the passes of parse and serialize over the built types: defaults, strip, decoders, serializers, hasAsync
  result.js         ValidationResult: valid, issues, lazy errors, summary, flatten, tree, add, issuesOf
  rules.js          the rules as a definition reads them: FORMAT (length, min, max, pattern, format,
                    decimals), FORMATS (the table the formats subpath fills), formatOf (the entry a field's
                    format named when it was built), checkBounds, notApplicable
  lint.js           lintSchema: schema.warnings (unknown-option, unbounded-pattern, missing-index-field, dead-aliases, dead-coerce)
  snapshot.js       snapshotOf: model.toJSON(), the model as JSON (format 1, a function as { $function: true });
                    schemaSnapshotOf: schema.toSnapshot() (the entities a schema reaches, `root`);
                    orderOf (the iterative order of a model and of a snapshot), usesOf (every name
                    the fields of a schema use, with the root that resolves it)
  locales/          en.js (built in) and uk.js (subpath export), one renderer per issue code
  preprocessor.js   Preprocessor: turns a definition into { Type, defs, kindMeta }; the first key decides
  types.js          TYPES registry, createType (static rules/options per type), typeFactory, baseTypeOf (the
                    type at the end of the alias chain of a field, read by the generators, sample and mongodb)
  model.js          Model: entities, ordering (the cycles as data under CYCLES); branded 'Model'
  util.js           BRAND/hasBrand identity brand, RUN, HOOK, the state symbols of a schema (TRACKED,
                    COERCES, CODEC, STANDARD) and of a model (CYCLES), isMap/isSet/isDate/isBytes, typeOf,
                    shorten, formatters (type '?x', key 'x?', length)
  errors.js         SchemaDefinitionError (code, schema, field) for broken definitions; asyncReturn (ERR_ASYNC_VALIDATOR),
                    invalidTarget, notRegistered, noValidation (the definition half without the other), invalidOption
  metautil.js       helpers copied from metautil v5.5.2
  prototypes/       the definition half of the types (what a definition gives a field; their checks are in
                    checks.js): abstract (AbstractType, the lazy check getter, BUILD), scalars (string,
                    number, integer, bigint, boolean, date, bytes, null, any/unknown, enum), collections,
                    reference (embeds), schema, tuple, union, json, flags
  runtime/          node.js (writeFile via node:fs) and browser.js (same interface, rejects)
  generators/       the ./generators subpath: index.js (toJSONSchema, toTypeScript, saveTypes, fromJSONSchema,
                    register), index.d.ts, jsonschema.js (targets, strict profile, mongodb, the ~standard
                    converter), typescript.js (toInterface, modelToTypeScript: JSDoc, named types),
                    fromjsonschema.js (the subset of JSON Schema read back into a definition)
  compile/          the ./compile subpath: index.js (compile, register, canEval), index.d.ts,
                    code.js (the source builder: quote, prop, literal, the scope), emit.js (an emitter per prototype)
  model/            the ./model subpath: index.js (fromJSON, diff, compatibility, sample, merge, register),
                    index.d.ts, data.js (readSnapshot, same, capitalize, definitionOf: what the subpath shares),
                    restore.js (fromJSON: definitions from a snapshot, placeholders for functions),
                    diff.js (diff, compatibility: the Confluent rules as bits),
                    sample.js (the seeded witness: mulberry32, per-field verification), pattern.js (the regex
                    subset: a parser into nodes once per RegExp, a string drawn from the nodes),
                    merge.js (unification of two schemas, ERR_MERGE_CONFLICT),
                    infer.js (a definition from samples: the summary of every place, fused records,
                    the dictionary and enum heuristics, the self-check, ERR_INFER_DEPTH/ERR_INFER_MISMATCH)
  stream/           the ./stream subpath: index.js (checkEach, parseEach, checkEachAsync, parseEachAsync,
                    transform, register), index.d.ts
  formats/          the ./formats subpath: index.js (the 35 built-in formats, register, FORMATS of the
                    core re-exported), index.d.ts
  derive/           the ./derive subpath: index.js (pick, omit, partial, required, extend, keyof, register),
                    index.d.ts
  coerce/           the ./coerce subpath: index.js (the strict converters, COERCIONS, coerce, register:
                    the dispatcher into COERCION of codec.js), index.d.ts
  mongodb/          the ./mongodb subpath: bson.js (types, register, the driver, idOf, binaryBytes), document.js
                    (toDocument, fromDocument, the walk), update.js (checkUpdate, toUpdate, the dotted
                    paths), indexes.js (indexesOf), index.js, index.d.ts
  definition/       the ./definition subpath: index.js (the core's Schema, Model, getKindMetadata,
                    SchemaDefinitionError and constants, the definition half alone), index.d.ts
tests/
  unit/*.test.js    node:test suites, one per area
  types/*.test-d.ts tsd assertions
  helpers/jit.js    --require'd by test:jit and test:nojit: register({ jit }) of ./compile before the suites
  fixtures/schemas/ a domain model as CJS modules; index.js assembles { database, types, ...entities }
  fixtures/snapshot.json  the committed snapshot of the fixture model (the format 1 contract, pinned by snapshot.test.js)
  fixtures/forms.js a definition of every form of the language as a function (definition.test.js, in two processes)
  fixtures/schema-snapshot.json  the committed text of toSnapshot() of the schemas of fixtures/forms-snapshot.js
                    (the 3.4 forms, the tags, a schema that names itself; compared as text by snapshot.test.js)
scripts/size.js     bundle-size report and budget gate (CI smoke)
scripts/size-compare.js  the comparison's schema per library, bundled for the browser and verified
scripts/comparison.js    renders docs/comparison.json (the feature matrix) into README and the docs
bench/              zero-dependency ops/sec harness (closures and JIT); baseline.json is a snapshot for
                    --compare; compare.js + compare/ (adapters per library, scenarios, measure.js,
                    the workers) and releases.js run the cross-library and release benchmarks into
                    results/*.json; report.js + report/ (model.mjs: the chart models shared by the
                    docs components and svg.mjs, the README images) render them
docs/               VitePress site (metaschema.vercel.app), not published
.claude/skills/     metaskills v1.0.5 skills (js-conventions, npm-publish adapted)
```

## Architecture

Module graph (no cycles; nothing checks this automatically, so look at the `require`s when adding
an edge). The leaves are `util.js`, `errors.js` and `metautil.js`. From there:

- `locales/en.js` and `uk.js` require only `util.js` (`shorten`); `issues.js` requires `util`
  (`typeOf` among them), `errors` and `locales/en`; `result.js` (+ `util`, `locales/en`) and
  `context.js` (+ `locales/en`, `errors` for `invalidOption`) require `issues`; `rules.js`
  requires `errors` only. `util.js` must not require `issues.js`. `tests/unit/graph.test.js` walks
  the relative requires of `src/` and fails on a cycle (oxlint's `import/no-cycle` does not
  see a CommonJS require).
- The definition half: `kinds → metadata` (+ `errors`); `struct` (`util`, `errors`) →
  `prototypes/schema`; `prototypes/abstract` (`util`, `rules`, `errors`) and the other
  prototypes (`errors`, `util`, `metautil`; `json` nothing) → `types`; `preprocessor`
  (`metautil`, `util`, `errors`) stands alone; `snapshot` requires `metautil`, `util`,
  `errors`; `schema.js` requires `types`, `preprocessor`, `metadata`, `errors`, `struct`,
  `prototypes/abstract` (`BUILD`), `snapshot` and `util`; `model.js` requires `schema`,
  `types`, `util`, `errors`, `snapshot`. None of them requires a module of the validation half
  (`graph.test.js`).
- The validation half: `checks.js` requires `util`, `issues`, `rules` (`formatOf`), `struct`
  and `prototypes/reference` (`embeds`); `lint` requires `util` and `prototypes/reference`
  (`embeds`, to tell a reference checked as an id for `dead-coerce`); `validation.js` requires
  `metautil`, `util`, `schema`, `model`, `lint`, `prototypes/abstract`, `types` (`PROTOTYPES`),
  `checks`, `struct`, `context`, `result`, `issues`, `errors` and `codec`; `src/index.js`
  requires `validation.js`, `model.js`, `kinds`, `errors` (no runtime). `util.js` also holds `define`,
  `IDENTIFIER`, `ENUM_SET_SIZE` and `safeString`, shared by the core, the generators and the JIT.
- `codec.js` requires `util`, `issues`, `context`, `struct`, `errors`, `prototypes/reference`
  (`embeds`) and `checks` (`COMPILE`: it tells a node's shape by the identity of its
  `compile`, as `compile/emit.js` does; `aliasOf`, `tableOf`) and never `schema.js`: a
  reference is followed through `root.findReference` at parse time.
- `generators/jsonschema.js` and `generators/typescript.js` require `util`, `struct`, `errors`
  and `prototypes/reference.js` (`embeds`, the one rule shared by `check` and both
  generators), `typescript.js` also `metautil` and `types` (`baseTypeOf`, to tell `flags` by
  its type), `jsonschema.js` also `rules` (`FORMATS`, the pattern of a format), `kinds`
  (`idFieldOf`, for `ids: 'objectId'`) and `types` (`baseTypeOf`), never `schema.js` or `model.js`: they take the instances and read `fields`,
  `unknown`, `name`, `findReference` and the kind metadata. `generators/index.js` requires
  `validation.js` and `model.js` (for `register()`, which wraps the `~standard` accessor the
  validation half installs), `runtime/node.js` (for `saveTypes`) and the two generators;
  nothing in the core requires `generators/`.
- `compile/code.js` requires `util` (`IDENTIFIER`); `compile/emit.js` requires `util`
  (`ENUM_SET_SIZE`, `isBytes`), `issues`, `rules` (`formatOf`), `struct` (`STRUCT`,
  `isStruct`), `prototypes/collections` (`set.isInstance`), `checks` (`COMPILE` for the
  identity of the type checks, `decimalsOff`, `codePoints`, `lengthOf`, `ruleNames`, `patternLimit`,
  `nameOf`, `tableOf`) and `code.js`; `compile/index.js` requires `util` (`RUN`, `HOOK`),
  `validation.js`, `errors` and the two. Nothing in the core requires `compile/`.
- `generators/fromjsonschema.js` requires `metautil`, `util` (`define`, `shorten`), `schema.js`
  (for `as: 'schema'`), `types` (`readsAsStruct`, to tell a struct key that reads as a type),
  `rules` (`FORMATS`, to read a registered `format` back) and `errors`.
- `model/data.js` requires `util`, `snapshot` (`FORMAT`), `errors` and `struct` (`isStruct`,
  for `definitionOf`); `model/restore.js` requires `util`, `schema.js`, `model.js`, `errors`
  and `data`;
  `model/diff.js` requires `errors` and `data`; `model/pattern.js` requires `errors` only;
  `model/sample.js` requires `util`, `context` (`createContext`, for the verification of a
  draw), `errors`, `struct`, `prototypes/reference` (`embeds`), `issues` (`toDotPath`,
  `finalize`), `locales/en`, `rules` (`FORMATS`, the examples of a format) and `pattern`;
  `model/merge.js` requires `util`, `schema.js`, `struct`, `issues` (`isThenable`), `errors`
  and `data`; `model/infer.js` requires `util` (`define`, `IDENTIFIER`, `shorten`),
  `schema.js`, `errors`, `types` (`readsAsStruct`), `rules` (`FORMATS`), `issues`
  (`toDotPath`, `finalize`), `locales/en` and `data` (`DEPTH`, `capitalize`); `model/index.js`
  requires `validation.js`, `model.js` and the six (`infer.js` the same `validation.js`, for
  its self-check). Nothing in the core requires `model/`.
- `stream/index.js` requires `util` (`hasBrand`), `issues` (`abandon`), `errors`
  (`invalidTarget`, `invalidOption`) and `validation.js` (for `register()`); it calls the public
  methods of a schema and never `codec` or the prototypes. Nothing in the core requires
  `stream/`.
- `formats/index.js` requires `rules` (`FORMATS`) and `errors` only. Nothing in the core
  requires `formats/`; the `install` helper of `register()` is a copy per subpath (generators,
  model, stream, derive, coerce) rather than a helper of the core, which is measured on its own.
- `codec.js` holds the `COERCION` slot (`installed`, `convert`), the `COERCE` bit of a pass
  and the `POLICY` bit of a subtree with a field's own `coerce: true`; `coerce/index.js`
  requires `util`, `metautil`, `validation.js`, `context`, `codec` (`COERCE`, `COERCION`,
  `PREPARE`, `infoOf`, `apply`, `wantOf`, `looped`) and `errors`.
- `derive/index.js` requires `util`, `metautil`, `schema.js`, `struct`, `kinds` (`KIND_STORED`),
  `errors` and `model/data.js` (`structDefinitionOf`, `metadataOf`, `structDefinition`,
  `atSchema`): one of the two subpath-to-subpath edges, pinned in `graph.test.js` with the
  other, `mongodb/bson.js` → `coerce/index.js`. The rest of `mongodb/` requires core modules
  (`util`, `struct`, `prototypes/reference`, `codec` for `infoOf`/`apply`/`SERIALIZE`,
  `context` for `createContext`/`referencesOf`, `issues`, `result`, `errors`, `kinds` for
  `idFieldOf`, `types` for `baseTypeOf`) and its own files; it tells the shape of a node by
  `infoOf(node).shape` with the numbers of `codec.js`, named once in `document.js`
  (`SHAPES`, which `mongodb.test.js` holds to `infoOf` of the core). Nothing in the core
  requires a subpath (`graph.test.js`).

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
`ERR_INVALID_OPTIONS`, `ERR_INVALID_RULE`, `ERR_INVALID_UNION`, `ERR_UNREPRESENTABLE` and
`ERR_UNSUPPORTED_SCHEMA` of the generators, `ERR_NO_EVAL` and `ERR_JIT_BUILD` of the compile
subpath, `ERR_INVALID_SNAPSHOT`, `ERR_UNSATISFIABLE`, `ERR_SAMPLE_PATTERN`, `ERR_SAMPLE_TYPE`,
`ERR_MERGE_CONFLICT`, `ERR_INFER_DEPTH` and `ERR_INFER_MISMATCH` of the model subpath,
`ERR_INVALID_FORMAT` and `ERR_FORMAT_REGISTERED` of the formats subpath, `ERR_UNKNOWN_FIELD` of
the derive subpath, `ERR_INVALID_COERCION` and `ERR_COERCION_REGISTERED` of the coerce
subpath), `schema` and `field`. A function of a subpath
given something other than what it takes (a Schema, a Model, a snapshot, a list of changes, a
JSON Schema document) throws a plain `TypeError` with `code: 'ERR_INVALID_TARGET'`
(`invalidTarget` in `errors.js`, a `RuntimeErrorCode` like `ERR_ASYNC_VALIDATOR`): the call is
wrong, not a definition. `ERR_INVALID_OPTION` (`invalidOption` in `errors.js`) is the same
kind of error for an option of a call that is not what it must be (`maxErrors`, `references`,
the `coerce` of a parse, the options of the stream, derive and mongodb subpaths): the kind
metadata and the `metadata` of `merge` and `derive` are definitions, so a wrong one is
`ERR_INVALID_OPTIONS`, a `SchemaDefinitionError`. `ERR_NOT_REGISTERED` (`notRegistered` in
`errors.js`) is the same kind of error for a call that needs what `register()` of a subpath
installs before it ran: a
parse that coerces without `./coerce` (thrown as the pass enters the schema, whatever the
value holds: an empty body in a test must not hide it), a document written with ObjectIds
without `register({ bson })` of `./mongodb`, and a schema of `./definition` asked to validate
before the core entry was loaded (`noValidation` in `errors.js`). A
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
`prototype.rules`) and `options` (the definition keys it reads, for the lint). The class's
prototype **inherits from the prototype object** of its kind (`scalars.string`, made to inherit
from `AbstractType.prototype` once, in `types.js`; an alias from its base's class; a custom type
from a copy of its entry, `parentOf`), so the `compile` the validation half installs on the
prototype object later reaches every class made from it, in every registry. The `AbstractType`
constructor copies the definition keys (a rule key goes through its `FORMAT` in `rules.js`,
given the field: the `format` formatter records the entry the name had, `formatOf`; a rule the
type does not accept throws `ERR_INVALID_RULE`), checks the bounds (`checkBounds`), calls
`construct`, and compiles nothing: a field's `check` is **compiled on its first read**
(`BUILD.field`, `compileField` of `checks.js`): `compile()` returns the type check as a closure
over the field (`(value, context, key) => void`), `withRules` wraps it only when the field has
rules (`length`, `pattern`, `format`, `decimals`, `min`/`max` compiled into one closure each) or
a `validate`, and `nullable: true` wraps the result once more so `null` returns before anything
else. Each built-in prototype has its own `compile` (`COMPILE` of `checks.js`: one `typeof` for
a scalar, a `Set` for an enum with more than 8 values, `Map`/`Set` iterated directly, `object`
through `for...in` + `Object.hasOwn`, tuple by index, the struct's compiled check for `schema`,
a lookup plus cycle tracking for a reference, the own keys of `flags`); a custom type has
`checkType(value, path)` instead, which the generic `compile` (`custom` of `checks.js`, on
`AbstractType.prototype`) runs through the validator contract (`runCheckType`). The compiled
closure is a private field behind the `check` getter, so it stays out of
`toJSON`/`util.inspect`. Nothing a definition must reject may be thrown from a `compile`: it
runs on the first check, not when the schema is built. `TYPES` is a
**module-global registry**: `typeFactory(customTypes)` (called by `Model`) mutates it. It adds
metadata to built-ins, aliases (`{ js: 'string' }`) or new prototypes with
`construct`/`checkType`. Registration is process-wide, by design (see below).

**Structs.** `createStruct` settles `required` from the key (`'tags?'`) and the definition
(`'?string'`, `required: false`) *before* building the field (the closure captures it), then
records a frozen **plan** entry `{ key, type, required, own, aliases }` per validated
field (`aliases` the list of the field's `aliases`, `[]` without; an alias is a known key, and
one that is a field, a calculated field or another alias is `ERR_INVALID_DEFINITION`) and the
key in a null-prototype `known` dictionary; `fields[STRUCT]` (a global symbol) holds the frozen
`{ plan, known, calculated }` (`calculated`: the keys of the calculated fields, read by the
strip pass; a nested struct's `validate`, `parse` and `serialize` functions stay in `fields` but
are neither known keys nor calculated). The struct check (`checkOf(fields)` of `checks.js`,
compiled on its first use and kept in a WeakMap beside the plan: an object literal with a
getter under `Object.freeze` per struct cost `Schema.from` 16%) is an index loop over entries
of the same shape as the plan's plus the field's `check` (`{ key, type, required, own,
aliases, check }`, built then: a load of `entry.check` is what the loop did before 3.4, and
`checks[index]` from an array of its own cost the closures 3 to 5%): a keyed load per field,
`Object.hasOwn` only when the value is `undefined` and the field is required, or when the field
name is a member of `Object.prototype` (`own`); a field with nothing under its own key is read
from the first alias the value carries (`aliasOf`), and its check gets that key; then `for...in`
counts the keys and scans for unknown ones only when the count differs from what the plan found.
A leaf check receives its key and never touches `context.path`; a container pushes its own key
before its children.

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

**References.** The check of a reference (`COMPILE.reference` of `checks.js`) resolves the
target at check time (`root.findReference`: an entity of the attached models first, else the
schema itself when the name is its own, so `parent: '?Category'` needs no model and a schema
derived from an entity, which keeps its name, still reaches the entity) and `embeds(target, field.embed, context.references)` decides between the
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
embedded reference through its entity), and the schema's `options.parse` last; a field read
from an alias is written under its own key by `finish` (the struct info carries a `DECODERS`
bit for it), and `prepare` fills no default over it. A decoder's exception is an `exception`
issue at the field and makes the result invalid; after the first failure no decoder runs. `serialize(value, { check })` is one pass the other way (the schema's
`options.serialize`, then the fields' `serialize` top down; `format` is collected and never
called). The passes are one `walk` over the built types, dispatched on the shape of a node
(Schema, struct dictionary, nested struct, list, keyed, tuple, union, reference, leaf) with a
memoized info per node (`infoOf`, a WeakMap: the bits of what a subtree carries, so a schema
without defaults, decoders or serializers is returned as it is after one bit test, and the root
info is cached on the schema under `CODEC`), copy-on-write output (a container is copied at the
first part that changed; the value given is never written to), a cycle guard in the passes that
run before the check (`context.seen` as the stack, cleared before the check; a looped value is
checked as given), and a scratch context to pick the branch of a plain union as the check
does. `~standard.validate` is `parse` with the schema's policies.

**Async.** `checkAsync`/`parseAsync` set `context.async = []`; `guarded` in `issues.js`, the one
place where user code runs (field and schema `validate`, custom `checkType`, on both backends,
the JIT reaching it through `runValidate` in the scope), keeps a promise it gets with the path
it was met at, and keeps a validator met later as a deferred call only when the **last entry of
the list lies under the validator's path** (`under`): the walk is depth first and every
container pushes its key before its children, so the entries under a validator's path are a
contiguous suffix of the list, and one prefix test against the last entry is the whole
dependency test (3.2; until then every validator after the first promise was deferred and the
latency was the sum of the waits). Every other validator runs at once, as in `check`, its
promise in flight with the rest. "A validator runs only when nothing under it failed" holds
across promises; `settle` runs the list after the walk, in field order, each entry under its
path, awaiting a promise and calling a deferred entry unless an issue recorded since lies under
its path (`failedUnder`, through `under`), and stops at `maxErrors` with `release` over the
rest (the promises are observed, never awaited; `release` is also what a failed union branch
and the trial of parse drop their entries with, on both backends). Under a low `maxErrors` a
validator may be called whose result is dropped: the limit decides what is recorded. The sync `check`/`parse` throw a `TypeError`
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

**Standard Schema.** `Schema.prototype['~standard']` is an accessor `validation.js` installs (so
non-enumerable: `toJSON`, `inspect` and `Object.keys` never see it; absent from a schema of
`./definition` alone) that builds `{ version: 1, vendor: 'alexify.metaschema', validate }` once
per instance (`schema[STANDARD]`, reset by `attach`/`detach`).
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
   dependencies (as `[entity, reference]` pairs under `model[CYCLES]`);
4. `model.warnings` (a getter of the validation half, computed on first use and kept in a
   WeakMap) is every entity's `warnings`, its `checkConsistency()` (missing references and
   types) and the recursive dependencies.

`model.toJSON()` and `schema.toSnapshot()` share the walk of `snapshot.js`: `entitiesOf` writes
the entities by name, `typesOf(entities, tableOf)` the types they use (and the custom types an
alias names down the chain), and `gather` collects what a schema reaches through `references`
and `parent`, after its references, one entity per name (`ERR_UNREPRESENTABLE` otherwise), with
`Identifier` moved first, as a model orders them.

`toTypeScript(model)` of the generators subpath (`model.dts` once its `register()` ran) joins the
interface of each entity in that order. `entities` is any iterable of `[name, definition]`.

## Budgets

**The 3.4 bundle budgets are 21 KB min+gzip per core entry, 8 KB for the generators, 5 KB for
the compile subpath, 13 KB for the model subpath, 1.5 KB for the stream subpath, 5 KB for the
formats subpath, 2.5 KB for the derive subpath and 2 KB for the coerce subpath on top of it,
4 KB for the mongodb subpath on top of it and `./coerce`, and 10 KB for the definition subpath
on its own** (`pnpm size --max-gzip 21 --max-gzip-generators 8 --max-gzip-compile 5
--max-gzip-model 13 --max-gzip-stream 1.5 --max-gzip-formats 5 --max-gzip-derive 2.5
--max-gzip-coerce 2 --max-gzip-mongodb 4 --max-gzip-definition 11` in CI). In 3.4
(2026-10-15) the entries measure 20833 / 20844 bytes (20.3 KB), the generators 7781 (7.6 KB),
the compile subpath 4499, the model subpath 12656, the stream subpath 917, the formats subpath
3973, the derive subpath 2099, the coerce subpath 1880, the mongodb subpath 3681 on top of the
core and `./coerce`, and `./definition` 9957 bytes (9.7 KB) on its own, a bundle for the browser
(`ALONE` in `scripts/size.js`: measured by itself, not as a difference). 3.4 cost the core about
1760 bytes: `decimals`, `bytes`, `flags` and the self-reference about 680 (19073 → 19752),
`toSnapshot` with the shared walk about 300, the lazy checks about 170 and the split about 610
(the installation of `validation.js`, the stubs, the state under symbols, the prototype chain of
`types.js`; ten modules of `checks/` merged into `checks.js` saved 577 of the 1124 a module per
prototype cost, and moving the lint out of the definition half took `./definition` from 10850
to 9955 bytes). The generators gate moved to 8 KB for the two types and the rule (+270), and the
core gate to 21 KB (Alex's decision, 2026-10-15, with the measured gates of the split). The
plan of 3.4 had asked for 8 KB for `./definition` and at most 100 bytes of growth of the core
for the split; neither is reachable with the definition half as it is (see "Out of scope by
design"). The numbers that follow are those of 3.3.

**The 3.3 bundle budgets were 19 KB min+gzip per core entry, 7.5 KB for the generators,
5 KB for the compile subpath, 13 KB for the model subpath, 1.5 KB for the stream subpath,
5 KB for the formats subpath, 2.5 KB for the derive subpath and 2 KB for the coerce subpath on
top of it, and 4 KB for the mongodb subpath on top of it and `./coerce`** (`pnpm size
--max-gzip 19 --max-gzip-generators 7.5 --max-gzip-compile 5 --max-gzip-model 13
--max-gzip-stream 1.5 --max-gzip-formats 5 --max-gzip-derive 2.5 --max-gzip-coerce 2
--max-gzip-mongodb 4` in CI). **A gate is raised to the next whole KB when a fix needs it,
and never sits a few bytes over a subpath** (Alex's decision, 2026-10-13, at the review of
3.3: the compile and model gates moved from 4.25 and 12 KB to 5 and 13 KB because the two
subpaths were 10 and 28 bytes under them and a change of the core alone, which shifts the
difference of two gzips, could fail CI on code that did not change; the formats gate from 4 to
5 KB for the scanners of the review; the mongodb gate from 3.5 to 4 KB for the depth limit and
the markers of the paths). After the review of 3.3 (2026-10-13) the entries measure 19073
bytes (18.6 KB) each, 383 bytes under the 19 KB gate, the generators 7507 bytes (7.3 KB), the
compile subpath 4331, the model subpath 12270, the stream subpath 1027, the formats subpath
4072 (4.0 KB, 35 formats, six of them scanners), the derive subpath 1927 (1.9 KB, of which
`model/data.js` is about 600), the coerce subpath 1762 (1.7 KB) and the mongodb subpath 3629
bytes on top of the core and `./coerce` (3.5 KB). The review cost the core about 560 bytes in
all: phase 0 about 70 (`notRegistered` in `errors.js`, the `POLICY` bit and the check at the
entry of `walkSchema`), phase 1 about 160 (`dead-coerce` with its require of
`prototypes/reference`, `Object.hasOwn` for the policy at two places), phase 2 about 90
(`idFieldOf`, `baseTypeOf`, the code of `invalidOption`, `referencesOf` exported), phase 3
about 60 (the converter kept on the info under a version) and phase 4 about 180 (the branches
of a union prepared before the trial, `coercions` of a model). The formats subpath took about
480 (the scanners of `email`, the two JSON pointers, `uri-template`, `slug` and `semver`, the
cap of `regex`, the names `register` returns), the coerce subpath about 420 (`isPlain` of
`toMap`, the atomic `register`, `onError`, the converter resolved per node with the indexed
enum, the `report` of `coerce()`, the converters of a model) and the mongodb subpath about
290 (`rootOf`, the `_id` of a body left out, the driver read only when ObjectIds are written,
`maxDepth` of the walks, the `NONE` and `DEEP` markers of a path, the converters a slim module
can build, the strict `decimal128`, an element of a list of ids), while the generators, the
derive and the mongodb subpaths gave a little back to `idFieldOf` and `baseTypeOf`.
Before the review the entries measured 18509 / 18528 bytes (18.1 KB; 18145 / 18153 before
3.3, not the 18137 quoted below), the generators 7553 bytes (7.4 KB: the patterns of the
formats and `ids` added about 250), the compile subpath 4342, the model subpath 12260 (12276
before 3.3), the stream subpath 1010, the formats subpath 3564 (3.5 KB), the derive subpath
1918, the coerce subpath 1343 and the mongodb subpath 3342. Coercion cost the core about 360
bytes (the `COERCE` bit and the `COERCION` slot, the conversions in the walkers, the flag
check of a field, the option and the metadata check, the pass before the check written out in
`parse` and `parseAsync`); the core gate moved from 17.75 to 19 KB for it (Alex's decision,
2026-10-13). The plan gave `./mongodb` 3 KB; it came out about 270 bytes over after the
obvious trims, so its gate was 3.5 KB (4 KB after the review). `scripts/size.js` measures a
subpath with a `base` (the subpaths it requires) as (core + base + subpath) − (core + base).
**The inlining budget of `parse`:** the first version of coercion put the pass before the
check in `#prepare` and the conversion in `apply`, and `parse (jit)` lost 13% (flat) and 8%
(nested): `--trace-turbo-inlining` showed `#prepare` no longer inlined into `parse`, then the
second `apply` not inlined. The pass is written out in `parse` and `parseAsync`, `apply` is
what it was but for the dispatch (`info.walk`, the walker of the shape or `walkPolicy` for a
field with a `coerce` of its own, in place of `WALKERS[info.shape]`; the conversion is in the
walkers of a leaf, a list and a dictionary), and an A/B of 11 `parse`/`check` rows against
the commit before coercion is at parity (−0.2% to +2.6%, `Schema.from` −3.2%). Check the
inlining of `parse` (`pass` of `validation.js`, `apply` and `wantOf` twice each) after touching its path. The
check for a missing `register()` of `./coerce` sits at the entry of `walkSchema` (one bit test
per schema node of a pass), not in `parse`, for the same budget. **The converter of a node is
resolved once and kept on its info** (`info.convert`, under `info.version` against
`COERCION.version`, which every `register()` bumps; the subpath's `resolve(node)` closes the
converter over the node with its `try/catch`, and indexes the members of an enum in a Set and
their written forms in a Map): an A/B against the WeakMap lookup per leaf it replaced (review
of 3.3, the two files stashed in turn, same process) gave `parse (jit) — flat struct, coerce:
nothing to convert` 4.93 → 5.48 M (+11%), the closures 3.68 → 3.92 M (+6.5%), `parse — enums
of 32 members, coerce` 1.41 → 3.23 M, nested +4%, plain unions and the alternating row within
the band, and the plain `parse` rows at parity (−0.4 to −1.7%).
After the review of 3.2 (2026-10-11, before the tag) the entries
measure 18137 bytes (17.7 KB) each, the generators 7286 bytes (7.1 KB), the compile subpath
4298 bytes (4.2 KB), the model subpath 12245 bytes (12.0 KB, 43 bytes under its gate: the
formats cost `infer` and `sample` about 260 bytes), the stream subpath 978 bytes (1.0 KB) and
the formats subpath 1348 bytes (1.3 KB). The review cost the core 396 bytes: the predicates
`isMap`/`isSet`/`isDate` and the pattern bound (+199, the first on the path of a Map, Set or
Date field only, the second one integer comparison per pattern field), the cap of the
`unexpected` message, `walkAsync` and `release` (the rest of 0.A), the `format` rule with its
issue and the renderer of `en` (+150), `toJSON`, the inspect of `Model`, `shorten` and
`define` at three places (+47); the core gate moved from 17.5 KB to 17.75 KB for it (Alex's
decision, 2026-10-11: a gate the next fix cannot fit under is no gate, as in the review of
3.1), and a dedupe of the `install` helper into `util.js` was reverted because the core came
out one byte over the new gate with it. Before the review the entries measured 17741 bytes
(17.3 KB) each, the generators 7230 bytes (7.1 KB), the compile subpath 4132 bytes (4.0 KB),
the model subpath 11948 bytes (11.7 KB) and the stream subpath 1026 bytes (1.0 KB). 3.2
itself cost the core 115 bytes, none of them on the synchronous hot path: the `release`
helper, `readsAsStruct` and the guard that reads `{}` as a struct (+94), `under` in `guarded`
with `failedUnder` rewritten over it (+16), the walkers of `codec.js` without a state object
per container (+5); `infer` cost the model subpath 2.3 KB, which moved its gate from 10 KB to
12 KB (Alex's decision, 2026-10-11: the subpath is tooling, not the validation path, as for
the move from 8.5 to 10 KB in the review of 3.1; 340 bytes of headroom remain); the stream
subpath is new, with a gate of its own. After the review of 3.1 (2026-10-11) the entries
measured 17626 bytes (17.2 KB) each, the generators 7303 bytes (7.1 KB), the compile subpath
4124 bytes (4.0 KB) and the model subpath 9682 bytes (9.5 KB).
Workstream G (2026-10-11) added 850 bytes to the core (`src/snapshot.js`, the snapshot writer,
about 660 of them; the aliases in `struct.js`, `codec.js` and `lint.js` the rest), which took it
to 17394 bytes, 17.0 KB, 14 bytes under the 17 KB gate of 3.0 (the restore of a snapshot was
moved to the subpath for that reason, see "Out of scope by design"). The core gate moved from
17 KB to 17.5 KB and the compile gate from 4 KB to 4.25 KB during the review of 3.1
(2026-10-11, Alex's decision): the review's core fixes (the `renamed` flag of the context, the
copy without the alias key in `parse`, the ENCODERS pass without `aliasOf`, the `dead-aliases`
lint) need about 150 bytes, and a gate the next bug fix cannot fit under is no gate; they
cost 232 bytes in the end, with the two performance fixes of the same review. The aliases
cost the `./compile` subpath about 190 bytes, 4081 bytes, 15 bytes under the 4 KB gate, and
the `renamed` write in the generated code 43 more. `fromJSONSchema` took `./generators` to
6978 bytes (6.8 KB), and its hardening as untrusted input (the `$ref` cache and the full
pointers, the depth limit, `onUnsupported`, the pattern and type-list checks) 325 more.
`./model` was 8022 bytes (7.8 KB) under an 8.5 KB gate before the review, of which `sample.js`
was about 3 KB; the review's hardening of the subpath (a snapshot as untrusted input with
coded, located errors and depth limits, `placeholders`, `compatibilityOf`, the located merge
conflicts, the caps and the union fallback of `sample`) added about 1.6 KB, so the model gate
moved from 8.5 KB to 10 KB by the same reasoning as the core gate (the subpath is tooling, not
the validation path). The core gate had moved from
16 KB to 17 KB during the review of
3.0 (2026-10-11): the fixes of the async union, of thenable data, of the abandoned promises
and of the union trial, the lazy cycle set, the one scratch per parse and `maxDepth` cost
about 900 bytes together, the loops and the shared tables gave about 300 back, and the entries
sat at 16.1 KB after them (16530 bytes before G). A subpath is measured as the difference
between a bundle of `index.js` plus the subpath's `index.js` and `index.js` alone (a subpath
requires the core for `register()`, so on its own it would bundle the core again). The figures
are quoted in README, `docs/index.md`, `docs/guide/why.md`, `docs/guide/browser.md`,
`docs/guide/json-schema.md`, `docs/guide/evolution.md`, `docs/guide/architecture.md`,
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
subpath, because `~standard.validate` is parse (Alex's instruction). The plan of 2.0 had been
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

`bench/baseline.json` was re-saved on the 3.4 branch (2026-10-15, 74 rows): `Schema.from`
296 K / 95 K (+16% / +13% on 3.3, the lazy checks), `new Model` 16.6 K (+4%), every other row
within ±4% of 3.3. The two steps of the release were each an A/B of three alternating runs in
separate processes against the commit before (a worktree in the scratchpad): the lazy checks
at parity once the struct entries held the checks again (an array of checks cost the closures
3 to 5%, a getter on the frozen plan cost construction 16%), the split within ±2.7% with mixed
signs. `--trace-turbo-inlining` shows `parse` inlining `pass` (the module function that took
the place of `#pass`), `apply` and `wantOf` twice each, `createContext`, `looped` and
`parsed`, as before. The paragraph that follows is the re-save of 3.3.

`bench/baseline.json` was re-saved after the review of 3.3 (2026-10-13, 74 rows): the rows of
3.2 and the coercion rows of 3.3 moved within the band of the machine (a whole run sits a few
percent under the rows run alone), the new rows are a nested struct, plain unions, enums of 32
members and a plain and a coercing parse in turn under coercion (404 K, 1.2 M, 3.2 M and 4.0 M
on the closures) and `toDocument`/`fromDocument` of `./mongodb` (740 K / 467 K);
`docs/guide/performance.md` has the table. The paragraph that follows is the re-save of 3.2.

`bench/baseline.json` was re-saved on the 3.2 branch (2026-10-11): the rows of 3.1 moved by
less than the run-to-run band, the strip rows gained from the walkers without a state object
(100 records under `strip` 61 K → 66 K on the closures, 81 K → 95 K on the JIT, measured as
+16% and +24% in an A/B of scratch worktrees before the merge), the async rows are the settle
of 3.2 (four independent validators awaiting `setImmediate` 18 K → 65 K checks a second, 32
records with one each 2.2 K → 43 K, four awaiting `setTimeout(1)` 190 → 812; the sync and
resolved-promise rows unchanged), and `checkEach` costs about 20 ns a record over a loop of
`check` (7.6 K vs 9.2 K batches of 1 000 on the closures, 19 K vs 31 K on the JIT: the entry
and the iterator's result object); `docs/guide/performance.md` has the table. The figures that
follow are those of 3.1, kept for the history of the targets.
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
measured that. The 2.0 targets were 12 M / 6 M on the closures; the 3.0 JIT target of
25 M on flat valid is met at 30.9 M, the 8 M on flat invalid is not (5.6 M): the invalid path is
bounded by the issue objects (a params object, a path array and a rendered message each, about
40 ns an issue), which both backends build with the same constructors.

**`pnpm bench:compare` is the cross-library comparison (2026-10-11, replacing `bench/libs.js`
and `--compare-libs`), built like kerberos's.** One adapter per library in
`bench/compare/adapters/` translates a library-neutral shape of the moltar object into the
library's idiom (metaschema on the closures and the JIT, Metarhia's metaschema 2.2.2, zod,
valibot, ArkType, Effect Schema, TypeBox 1.x `Compile` and `Value`, Ajv, Yup, Joi,
Superstruct; all devDependencies); `bench/compare/scenarios.js` has the moltar flat and nested
objects in the suite's four modes, every issue of an invalid value (four wrong fields, the
paths compared) and building the strict nested schema. Every (library, scenario) pair runs in a
fresh process (`compare/worker.js`) that checks the verdicts before timing and measures through
one megamorphic call site (`compare/measure.js`), median of 5 × 1 s after a 1 s warmup; a cold
start (load, build, first check) is the median of 20 processes. `bench/releases.js --src <dir>`
runs metaschema's own scenarios against a checkout of another release (`git archive vX | tar
-x`) or `node_modules/metaschema`, so the release chart is one machine and one harness.
Metarhia's metaschema has no loose mode (the chart says why a row is missing), and its bundle
needs `keepNames` (its checks compare `constructor.name`; minified, it accepts everything).
`pnpm bench:report` renders `docs/public/benchmarks/*.svg` (README images, absolute URLs to the
docs site) and the tables between `<!-- bench:<name>:start/end -->` markers; the docs pages
render the same models interactively (`docs/.vitepress/theme/components/Bench*.vue`). Run the
comparison on a quiet machine, never beside other work.

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
- Workstream G suites (3.1): `snapshot.test.js` (the fixture model against the committed
  `tests/fixtures/snapshot.json`, the key order, every form of the language, the types, a
  schema of one type), `aliases.test.js` (check, parse, parseAsync, strip, defaults, nested,
  own-named fields, the definition errors, the lint, the generators ignoring them, the plan),
  `evolution.test.js` (`fromJSON` round trips and `placeholders`, every malformed snapshot
  with its code and location, the depth limits, a field named `__proto__` and one named
  `constructor`, the kind metadata over `custom`, an index named like a field, the shared
  registry rule, `diff` by kind and op, renames through aliases, the compatibility class of
  every rule of the table in `docs/guide/evolution.md`, one row per rule, `compatibilityOf`
  and a malformed change, `register()`), `sample.test.js` (the fixture
  entities and a schema of every form on both backends over several seeds, determinism, the
  locale (`uk` after `en` on one schema), examples, the pattern subset and its errors through
  `patternOf` of `pattern.js` directly (the `\u{` guard, the group depth, the repetition cap,
  the minimal length against `length.max` with a timing), a union with a branch that cannot
  be satisfied over many seeds, a field named `__proto__`, custom types, every
  `ERR_UNSATISFIABLE` case with the seed, the options), `fromjsonschema.test.js` (every
  keyword of the subset, the root forms, `$ref` inline and by name, a diamond of definitions
  in linear time with the converted target shared and nothing leaking between the places that
  inline it, hostile pointers (`#/__proto__`, `#foo`, a bad escape, two pointers with one last
  segment), the depth limit in both modes, a pattern invalid under `u`, a type list with an
  unknown name, `onUnsupported`, the unsupported keywords with their pointers, the export of
  the import on the subset, the import of the export checking as the schema does on both
  backends),
  `merge.test.js` (the constraints of both, composed validators, nested forms, every conflict
  with its location, the bounds of both sides, an alias that is a field of the other schema,
  a field named `__proto__`, `register()`). `compile.test.js` holds the two backends to the same issues over aliased
  fields; `bundle.test.js` bundles the model subpath with the core; `export-parity.test.js`
  and `scripts.test.js` cover the new subpath and the size row. A test of a rule of the
  compatibility table is a row of `RULES` in `evolution.test.js`; add the row with the docs.
- 3.4 suites: `definition.test.js` (the definition entry in a child process that requires
  nothing else, since every suite and the JIT helper load the core: building, reading,
  snapshots, the `ERR_NOT_REGISTERED` of every way to validate, the core loaded later
  validating the schemas built before it, the same snapshot and field tree in both processes
  over `tests/fixtures/forms.js` and the fixture model), `flags.test.js`, bytes in
  `values.test.js`, `decimals` in `numbers.test.js` (and the tolerance), the snapshot of one
  schema in `snapshot.test.js` (every entity of the fixture model, references of its own name,
  mutual, through a namespace and a projection, the clash, `Identifier` first, every form, the
  alias chain, anonymous schemas, `root` read and checked, unknown keys ignored, and the
  scenario of a consumer on both backends), the self-reference in `references.test.js`, the
  lazy checks in `structs.test.js` (a custom prototype counting its compiles; JIT-aware, since
  the JIT compiles at construction), the definition half's closure in `graph.test.js`, the
  definition bundles in `bundle.test.js` (alone in a bare context, and with the core, one copy
  of each module), the subpath in `export-parity.test.js` (which reads a re-export of the
  root), `scripts.test.js` (the `ALONE` row) and `tests/types/definition.test-d.ts`; the
  narrowing of `FieldSnapshot` and `SchemaSnapshot` in `index.test-d.ts`, `bytes`/`flags` in
  `infer.test-d.ts`; parity of both backends for `decimals`, `bytes` and `flags` in
  `compile.test.js`; `flags` in the ajv differential (`bytes` and `decimals` left out of it, as
  its header says); the base64 converter in `coerce.test.js`; a Binary of the real bson read
  back as bytes in `mongodb-bson.test.js`; `decimals` and `flags` rows of `RULES` in
  `evolution.test.js`.
- Review of 3.3 suites: `mongodb-bson.test.js` (the subpath against the real `bson`, a
  devDependency: the tag and the methods of its values, the strict converters of
  `decimal128`/`binary`/`objectId`, a document round-tripped through `bson.serialize`; a file
  of its own since the driver is kept per process), `mongodb-slim.test.js` (a module with
  `ObjectId` only: the converters of the types it cannot build are not installed), the
  hostile-input tests of `coerce.test.js` ("the converters are linear") and `formats.test.js`
  ("no built-in test overflows the stack", 20 million characters), the `report` and the model
  `coercions` tests of `coerce.test.js`, the `SHAPES` test and the paths of `checkUpdate` in
  `mongodb.test.js`, `dead-coerce` in `lint.test.js`, `idFieldOf` in `schema.test.js`,
  `baseTypeOf` in `types.test.js`, the `base` arithmetic of `scripts/size.js` in
  `scripts.test.js` (`extrasOf` with a fake measure), and the derive rows of
  `tests/types/derive.test-d.ts` (a wide extension, deep `required`, deep `partial` over the
  `{ schema }` form and a Schema field, the kind of a derived schema).
- 3.3 suites: `derive.test.js` (every operation over structs, nested structs, stored kinds,
  aliases, defaults, indexes, schema functions, references and unions on both backends; the
  kind and id rule, `deep` stopping at collections, the source never changed, `__proto__`,
  every error, `register()`), `coerce.test.js` (the before-`register()` block first, the
  converters row by row with what they leave, the three levels of the policy, `''`, unions as
  given first, containers, references, aliases, alias types, decoders, strip, async, streams,
  `~standard`, the input never written, cycles, the standalone `coerce()`, snapshots),
  `formats.test.js` (the 26 formats of 3.3 against ajv-formats, zod, valibot, a browser's URL
  and ArkType, the deliberate differences pinned with opposite verdicts, the hostile strings,
  infer, the patterns of the export) and `formats-override.test.js` (a format of the program
  over a built-in, its own process since the table is process-wide), `mongodb.test.js` (fake
  bson classes: a getter of `_bsontype`, bson 4's `ObjectID`, a JSON body that claims to be
  one, another realm; documents both ways over every container, embedded records, an own
  `_id`, an anonymous stored schema; the fixture's indexes; every operator of `checkUpdate`
  and `toUpdate`; the collection validator of `ids: 'objectId'` against `toDocument`), the
  `RULES` rows of `coerce` in `evolution.test.js` (full), and `tests/types/derive.test-d.ts`,
  `coerce.test-d.ts`, `mongodb.test-d.ts` (the `CustomTypes` augmentation included).
  `graph.test.js` pins that nothing in the core requires a subpath and the two allowed
  subpath-to-subpath edges.
- Review of 3.2 suites: `formats.test.js` (the rule before and after `register()`, the table
  of valid and invalid values of every built-in format cross-checked with ajv-formats' full
  mode on both backends, the issue and both locales, the order with `length` and `pattern`
  and the bound, custom formats and every error of `register`, a name `__proto__`, the JSON
  Schema round trip, `sample` and `infer` with formats, `merge` and `diff`, a snapshot
  restored, the linearity of every built-in test on hostile strings), `graph.test.js` (the
  module graph of `src/` without a cycle, the leaves pinned), the shape tests in
  `values.test.js` and `compile.test.js` (a value whose `constructor` key names a built-in),
  the bound in `pattern.test.js` (with a timing), the cap in `result.test.js`, the two
  unhandled-rejection tests in `async.test.js` and `stream.test.js`, `compiled()` in
  `compile.test.js`, `toJSON` in `result.test.js`, the inspect of a model in `model.test.js`,
  the shortened keys in `infer.test.js` and `fromjsonschema.test.js`, the `__proto__` index in
  `snapshot.test.js`, the thrown null in `schema.test.js`; `tests/types/formats.test-d.ts`
  pins the typings of the subpath.
- 3.2 suites: `infer.test.js` (every form of a value, optional/nullable/null, the enum and
  dictionary rules with their options, unions with the record last, nested fusion, the root
  forms and the id of a stored kind, every hostile key (`__proto__`, `constructor`, keys not
  led by a letter, keys named like types, `foo?`, symbol and inherited keys, the names of the
  methods of a field), the depth limit with a cycle, the call errors, `register()`, and the
  round trip with `sample` over the fixture entities and every form of the language, both
  backends throughout), `stream.test.js` (the generators over arrays, Sets and generators, `parseEach`
  with defaults/strip/decoders/aliases, `maxInvalid`, the async pair over sync and async
  sources with `concurrency` 1/3/100 and the count in flight observed, an iteration that ends
  early with promises in flight (no unhandled rejection, a parse that throws), `transform` in
  both modes and async, the stream that errors with `ERR_INVALID_RECORD`, the call errors,
  `register()`); `export-parity.test.js`, `bundle.test.js` (the subpath through both bundles,
  the browser context given `TransformStream`) and `scripts.test.js` cover the subpath export,
  the bundles and the size row; `tests/types/stream.test-d.ts` the typings.
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
- `bench/` has no tests (the compare adapters need the devDependencies, some of them ESM-only,
  which `require` loads on Node 22+ only); `pnpm size:compare` loads every bundle it measures
  and checks its verdicts, so a broken entry fails there. `bench/bench.js` has no test. Its scenarios are `Schema.from` flat/nested, `check` flat/nested
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

- **A schema of `./definition` throws `ERR_NOT_REGISTERED` from `check`, and validates once
  the core is loaded anywhere in the process.** The halves share the classes: `validation.js`
  installs the methods on `Schema.prototype` and the `compile` of the types on the prototype
  objects the classes inherit from, so a schema (and an isolated registry) built before the
  core loaded validates after it. Until then `'~standard' in schema` is false on purpose: a
  consumer of Standard Schema must not take it for a validator.
- **The checks are compiled on their first use, and a schema is not one closure until then.**
  `schema[RUN]` is a stub (`lazyRun` of `schema.js`) until the first check replaces it with
  the closures (or `register()` of `./compile` with generated code first); `field.check`
  compiles on its first read; the compiled struct check lives in a WeakMap of `checks.js`, not
  in `fields[STRUCT]`. A definition error is never thrown from a `compile` (the bounds are
  checked in the constructor, `checkBounds`), and the test of a format is the one the name
  had when the field was built (`formatOf`), so a format registered later does not reach it.
  `compiled()` of `./compile` tells generated code by a WeakSet of what it built.
- **`findReference` falls back to the schema itself after the models.** A name that no
  attached model resolves is the schema's own when it is its name, so a standalone
  self-reference works and a derived schema (which keeps the name of its entity) still reaches
  the entity of the model. A projection of its own name has no parent (`ERR_PROJECTION`). A
  schema derived or merged from one that names itself without a model gets a namespace holding
  the source (`namespacesOf` of `model/data.js`, an object with `entities` and `types`), so its
  reference reaches the source as the source's did, under any name.
- **`schema.toSnapshot()` of a schema that shares the name of an entity it references is
  `ERR_UNREPRESENTABLE`.** A snapshot holds one entity per name; a derived schema whose
  reference reaches the original entity is such a case.
- **`decimals` accepts the error of a sum and rejects a decimal too many below 10¹² units.**
  The tolerance is 256 ulps of the scaled value (`ULPS` and `decimalsOff` of `checks.js`, the
  one test of both backends); the plan's 1e-9 of
  the value would accept `12345678.123` as two decimals. A value large enough that every double
  is a whole number at that scale passes; NaN and the infinities are `decimals` issues. ajv
  divides by `multipleOf`, so the differential test leaves `decimals` out.
- **`flags` follows the unknown-keys policy** (Alex's decision, 2026-10-15): a name the list
  does not have is `unexpected` under `reject`, ignored under `ignore`, dropped by `parse`
  under `strip` (the `FLAGS` shape of `codec.js`, `walkFlags`); its JSON Schema is closed with
  the document. `{}` is a valid value of a required `flags` field (every flag off), unlike an
  empty required `object`.
- **The JSON Schema of `bytes` is base64 text on the input side and unrepresentable on the
  output side** (Alex's decision, 2026-10-15), as a `date` is: parse gives a `Uint8Array`, which
  is no JSON. `fromJSONSchema` reads `contentEncoding: 'base64'` back as a string (of the
  `base64` format when the formats are registered), never as `bytes`.
- **`bytes` and `flags` as the first key of a struct read as those types**, and a custom type
  of the program under either name is `ERR_TYPE_REGISTERED` (protoarray 1.2 gave a model both);
  the CHANGELOG says so.

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
  (no deduplication by content); it is read for `schema[TRACKED]` and by the docs only.
- **A compiled schema's `check` is a function named `jit`, installed as `schema[RUN]`.**
  `compile()` of the `./compile` subpath replaces the own `[RUN]` property and returns
  `{ accelerated }`, not the schema; `field.check` and `checkOf(fields)` stay the closures, and a schema that references this one reaches the generated code through
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
  object is cached per instance (`schema[STANDARD]`) and `validate` is an arrow closure over the schema
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
- **`field.check` is a getter over a private field.** The compiled closure is set on the first
  read (`BUILD.field`); assigning it as an own property would show up in `toJSON` and
  `util.inspect`, and `Object.defineProperty` cost 100 ns per field at construction. `check`,
  `checkType`, `compile` and `construct` are reserved definition keys whether the type has them,
  and so is `root` (the schema of the field; a definition, or a snapshot, that set it made every
  later read of the field throw a bare TypeError until the review of 3.4).
- **`{ x: 'number' }` as a tuple element is a named number, not a struct.** Upstream's named
  elements (`[{ x: 'number' }, { y: 'number' }]`) are kept: a one-key object holding a type name
  names the element. A one-field struct element is `{ schema: { x: 'number' } }`.
- **`nullable` is not optional.** `'?string'` and `required: false` accept `undefined` and
  `null` and let the key be absent; `nullable: true` keeps the key required and only lets the value
  be `null`. The nullable wrapper is the outermost closure, so rules and `validate` never see
  `null`.
- **A reference to an Entity validates as an id by default.** `person.check({ employer: { name }
  })` fails with `not of expected type: string` when `Company` is a stored kind: that is the
  storage view (the references guide's ADR). Validate a graph with `check(value, {
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
  root value only for a struct with relations (`schema[TRACKED]`). Do not "fix" the nested-struct case
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
  (`value?.constructor?.name === 'Map'`), since nothing renames those, **and by shape**
  (`isMap`/`isSet`/`isDate` in `util.js`: an iterator, `getTime`), since a value parsed from
  JSON can carry an own key `constructor` and did throw out of `check` before the review of
  3.2; the JIT inlines the same expression.
- **A `pattern` or a `format` is never run over a string longer than `length.max`**
  (`patternLimit` in `rules.js`, twice the bound in UTF-16 units under `unicode: true`): such
  a string is reported for its length alone, one issue where there were two before the review
  of 3.2, and that bound is what the ReDoS note promises. A field without `length.max` runs
  its pattern on every string.
- **The message of `unexpected` lists ten keys**; `params.keys` has them all. One issue per
  struct meant `maxErrors` never bounded that message.
- **`format` on a field is a rule with a name; `format` on a schema is a function.** The rule
  is read from `string` fields only and keeps the name (`field.format === 'email'`); the
  schema-level `format` is the collected, never called option of `src/metadata.js`. They do
  not meet: `extractOption` takes functions, the rule takes a string. The table is process-wide
  and read when the field is built, so a model restored with `fromJSON` needs the formats
  registered first, and an isolated type registry does not isolate the formats.
- **`compiled(schema)` of the compile subpath is the public way to tell the backend**; the
  name `jit` of the generated function and `//# sourceURL` stay what the tests and a debugger
  read. `JSON.stringify(result)` writes `{ valid, issues }` since the review of 3.2 (`toJSON`;
  `errors` is derived), and `RecordEntry<T, R>` types the record of a stream entry by its
  source.
- **`schema.fields` is a null-prototype object, not a class instance.** `createStruct` builds it
  that way on purpose: a field may be called `check`, `name` or `constructor`, and input keys
  such as `__proto__` must come back as unexpected instead of resolving to `Object.prototype`.
  `checkOf(fields)` of `checks.js` is the compiled check; the check of a schema
  (`compileSchema` of `validation.js`, on its first use) is built from it, or from
  `fields.check` when `fields` is a `Type` for a non-struct schema (`Schema.from('string')`).
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
- **An alias is read by `check` and renamed by `parse`; `serialize` never looks at it.** `check`
  reports an issue under the key it found the value under (`title` when the value carried the
  alias), `parse` reports the same and writes the output under the field's own key, in the
  place of the alias, and a value with the field's own key and an alias is read from its own
  key, the alias staying a known key (kept under `ignore`, dropped under `strip`). The pass
  that renames runs only when the check read a field from an alias: `compileStruct` and the
  generated code set `context.renamed`, aliases are a bit of their own in `codec.js`
  (`ALIASES`, not `DECODERS`), and the bits a pass wants are decided once per pass (`wantOf`:
  `STRUCTS` under `strip`, `ALIASES` under `renamed`) and handed down through `apply`, so a
  value that carries no alias comes back as it is, the same reference, whatever the schema's
  aliases, and the prologue of `apply` is the one bit test; a renamed struct is copied a
  second time (`renameKeys`) so that the output has fast properties and the field where the
  alias was, instead of a `delete`. The path of a field with nothing under its own key is
  `checkAbsent`, a function outside the loop of `compileStruct`: inside it, the loop body of
  the present-field path grew and `check — flat struct, valid` lost 8% (measured in the
  review of 3.1, back at parity once it moved out). The ENCODERS pass
  skips `aliasOf`: `serialize` reads the program's value, which carries the field keys, with
  or without a serializer beside the field. `Infer`, the JSON Schema and the dts name the
  field's own key only: an alias is a key of the input. `aliases` anywhere but on a field of
  a struct (an element, a branch, a schema of one type) is read by nothing and is a
  `dead-aliases` warning. Both backends do the same, held by `tests/unit/compile.test.js` and
  `tests/unit/aliases.test.js`.
- **A cyclic `default` makes `model.toJSON()` throw a RangeError.** `valueOf` in
  `snapshot.js` walks a `default` without a `seen` set on purpose: a default is a value of the
  program, not of a snapshot, and the set would cost every snapshot for a case no program
  has. A snapshot read back by `fromJSON` is untrusted input and is walked with a depth limit.
- **`fromJSONSchema` shares a converted `$ref` target between the places that inline it.**
  `def.a === def.b` when two properties refer to one definition: a deep copy per use would be
  as exponential as the walk it replaced (the output of an inlined diamond has 2^n leaves),
  and nothing in the core writes to a definition it is given (every parser of
  `preprocessor.js` copies or wraps the source; the `required` writes of `struct.js` and
  `tuple.js` land on those copies), which `fromjsonschema.test.js` pins. `new Schema` and
  `JSON.stringify` still unfold it; `references: 'name'` through a Model keeps a graph.
- **A pattern the regex engine cannot run is the engine's error.** `check` on a field with
  `pattern: /^(a{10000}){10000}$/u` throws the RangeError V8 throws for it (`rules.js`): a
  pattern is the programmer's, and the engine's limits are the engine's. `sample` caps a
  repetition it draws at 10000 (`ERR_SAMPLE_PATTERN`) and a pattern whose minimal length
  exceeds `length.max` at once (`ERR_UNSATISFIABLE`).
- **The snapshot has no functions, and the keys of a field are sorted.** `model.toJSON()`
  writes `{ $function: true }` for a `validate`, a `parse`, a `serialize`, a `default` factory,
  a calculated field and the functions of the schema itself (written among its fields, as a
  nested struct's are), so two snapshots with different validators compare equal in `diff`; a
  field's keys after `type` and `required` are sorted so that the order of a definition does
  not show, while the fields of a struct keep their order (it is the order of the check).
  `database`, `custom` and an index definition are written as copies, their values tagged as
  any value is (since the review of 3.4: protoarray reads the snapshot object, which shared
  them with the model). `types` lists the types
  the entities use, not the table the model was given: an unused custom type is not in it.
- **A model restored with `fromJSON` validates the structure only.** The placeholders (a
  validate that passes, codecs that return the value, a default factory that gives
  `undefined`, a custom type that accepts everything and every rule) are what a snapshot can
  say; `options.types` brings the real custom types, and `model.placeholders` (non-enumerable,
  so the snapshot of the restored model is the snapshot given) lists the paths of the
  functions that are placeholders. The registry is isolated by default so that a placeholder
  never reaches the shared registry where the real type may be (or come later:
  `ERR_TYPE_REGISTERED`), and `registry: 'shared'` refuses a placeholder type that
  `options.types` does not provide. A snapshot is untrusted input (Alex's decision,
  2026-10-11): what does not read is `ERR_INVALID_SNAPSHOT` located at the entity and the
  field, the walks have a depth limit of 128 (`DEPTH` in `model/data.js`), its keys are
  written with `define` and read with `Object.hasOwn`, the kind metadata wins over `custom`
  and an index named like a field is an error, so a snapshot cannot loosen what the model
  checks without saying so. The same holds for a JSON Schema document given to
  `fromJSONSchema` (`ERR_UNSUPPORTED_SCHEMA` with the pointer, the depth limit, own keys only
  in a `$ref`).
- **`compatibility` assumes a reader that ignores unknown keys** (the Confluent model;
  `unknown: 'ignore'` or `parse` with `strip`), so a field removed is backward compatible even
  though `check` rejects it under `reject`; and `required: false → true` is `forward`, `enum`
  values added `backward` (the new reader accepts more), which is what the definitions give
  even where a first reading of the rules has them the other way round. The classes are bits
  (`backward = 1`, `forward = 2`, `full = 3`) and a list's class is the AND.
- **`sample` draws a field up to 24 times and verifies every draw with the field's own check.**
  So a `validate` that rejects a draw costs another draw, not a wrong sample; `examples` are
  drawn half the time when a field has them, which is the hook for a validator the generator
  cannot read. The verification context is `createContext({ references, maxErrors: 1, maxDepth
  })`, one per draw. An unbounded quantifier of a pattern repeats up to `length.min` times.
- **`merge` keeps `nullable` only where both sides allow null and composes two `validate`
  functions into one that returns `[a, b]`** (`absorb` reads an array of returns; a promise
  from either makes it `Promise.all`). A key the other side lacks stands (`embed: true` on one
  side only is kept), and an annotation present on both sides is the first schema's. A
  nested struct's composed `validate` is put into the nested definition, since the field's own
  `validate` wins over the definition's (the fix of 2026-10-11).
- **`fromJSONSchema` drops `format` and a nested `additionalProperties`.** `format` is an
  annotation in JSON Schema unless a dialect asserts it, and closedness is a policy of the
  whole check that only the root decides (`additionalProperties: false` at the root is
  `{ Struct: {} }`, anything else `{ Struct: { unknown: 'ignore' } }`). A `date` exported on
  the input side comes back as a `string`, a `discriminator` exported to draft 2020-12 or
  draft-07 comes back as a plain union (only `openapi-3.0` writes it). A nested struct comes
  back as its fields unless its first key would read as a type or a kind, then as `{ schema }`.

- **`infer` makes a struct of records, never a union of two struct shapes**, and a
  dictionary of records whose keys are not names (ids, dates) from one sample on: both are
  Baazizi's record fusion and quicktype's map rule, with `map: false`/`enum: 0` to turn the
  heuristics off. It infers no bounds (`length`, `min`, `max`): the extremes of a sample are
  not the domain. A root of records and `null` is `{ union: [struct], required: false }`
  because the `schema` shorthand at the root is the struct itself and `required` means nothing
  there (`Schema.from({ schema: {...}, required: false }).check(null)` is a type issue). A key
  ending in `?` is written `'foo??'`; a key that is not a name makes the record a dictionary,
  so `{ 'foo?': 1 }` alone is `{ object: { string: 'integer' } }`.
- **The id field of a stored kind wins over a field of the same name in a definition.**
  `new Schema('Order', { Entity: {}, orderId: 'integer' })` has `orderId: '?string'`
  (`schema.js` spreads the kind's fields over the definition's). `infer` therefore defaults to
  `kind: 'struct'`, and its self-check names such a field (`ERR_INFER_MISMATCH`). Not changed
  in 3.2 (it is the kinds' semantics); documented in the inference guide.
- **The entries of `checkEach` carry the record and its index; the error lines carry the
  schema name.** `{ index, record, result }` is one shape for every entry: an iterator has no
  position and a stream cannot be read again. `root` is one label per call, not per record
  (a string per record would cost more than the check of a flat struct), so
  `result.errors` says `Field "Order.qty" ...` for every record and the index is in the entry.
- **`maxInvalid` ends a generator and errors a stream.** A generator that ends is read to its
  end; a stream that ends looks complete to `pipeTo`, so `transform` ends with
  `ERR_INVALID_RECORD` instead, after `onInvalid` was told of the n-th invalid record.
- **The async pair keeps the order of the records whatever `concurrency` is**, so a slow record
  holds the ones after it; the window overlaps the waits, it does not reorder. The queue is as
  long as `concurrency` (an array with `shift`), which is small by design.
- **`check` never coerces, and a value it accepts is never converted.** Coercion is a step of
  `parse` before its check; a plain union tries its branches as given (with their defaults)
  first and converts only when none accepts the value, so `{ union: ['number', 'string'] }`
  keeps `'3'`. A converter that throws leaves the value for the check.
- **The empty string is never converted**, not even to `null` for a nullable field or to the
  default of an optional one (Alex's decision: strict converters); a decoder or the program
  does that. `bytes` is the exception (Alex's decision at the review of 3.4): `''` is the
  base64 of no bytes, the text an encoder writes for them, and becomes an empty `Uint8Array`. A date-time without a zone is not converted either (it would depend on the zone of
  the server).
- **`coerce()` fills the defaults too**: it is the pass before the check of a coercing parse,
  so `check(coerce(s, v)).valid` is the verdict of `parse(v, { coerce: true })`.
- **The metadata `coerce` of an embedded or referenced schema is not read**: the policy is the
  parse's, as `unknown` is. The kind metadata lives in `schema.custom.coerce`, never as
  `schema.coerce`, which is the method `register()` of `./coerce` installs.
- **A change of `coerce` is `full` in `compatibility`**: neither what `check` accepts nor what
  `parse` gives changes (the plan said "like `nullable`"; the rule was corrected while
  implementing it).
- **A schema derived from a stored kind is a struct without the id field**, and `pick`, `omit`
  and `partial` leave the schema's own `validate`/`parse`/`serialize`/`format` out; `partial`
  drops the defaults of the fields it makes optional (`defaults: true` keeps them); `deep` stops
  at collections, tuples, unions and references. The name is the source's unless `name`, so a
  Model refuses a derived schema under another name without it.
- **The methods of `./derive` are typed through `this`, never through `D` of the class.** A
  member that maps `D` makes every comparison of two Schema types instantiate the mapping
  ("excessively deep", 10.7 s against 0.77 s for `tsd`).
- **A built-in format replaced by the program's own does not change the schemas built before**:
  the test is captured when a field is built.
- **`./mongodb` turns any string of 24 hex digits in an id or a reference into an ObjectId**,
  and `checkUpdate` cannot know the document stored (a length after `$push`, a bound after
  `$inc`): the collection validator is the last check. A deep partial is not the shape of an
  update (`$set` replaces what a path names whole).
- **A string is not a sequence of records.** It is iterable, over its characters, and
  `checkEach(schema, 'rows')` is `ERR_INVALID_TARGET`.
- **`toDocument` leaves out an `_id` beside the id field of a record.** The `_id` of a
  document is the id field (`accountId`) and nothing else: a body checked with `unknown:
  'ignore'` (or not checked) that carries `_id: { $gt: '' }` must not write it. A schema with
  an `_id` field of its own keeps it. `fromDocument(schema, null)` (what `findOne` gives for
  nothing) is a `type` issue, not a throw; a value of a class at the root (a model instance, a
  value of bson) is `ERR_INVALID_TARGET` rather than passed through with its id a string.
  Reading a document and `ids: 'string'` need no driver.
- **A `regex` longer than 4096 characters is not a regex** (`REGEX_MAX` in
  `formats/index.js`): compiling one costs memory in proportion to its text (a property
  escape expands as it is parsed, about 1 KB of heap per byte), and no program writes a
  pattern that long; `length.max` on the field bounds it further. Five built-in formats
  (`email`, `json-pointer`, `relative-json-pointer`, `uri-template`, `slug`, `semver`) are
  scanners over the string rather than one expression: a repeated group with an alternative
  in it (`(?:a|bc)*`) grows the stack of the engine by a frame per repetition and overflowed
  it out of `check` on a string of megabytes (`RangeError`), which `formats.test.js` now pins
  at 20 million characters. The expression stays as the `pattern` of the export.
- **A converter runs before the check, so `length.max` does not bound it.** The converters
  are linear on purpose (`DECIMAL` reads a run of digits one way; pinned on hostile strings in
  `coerce.test.js`); a converter of the program's own is the program's. `bytes` is the
  exception (review of 3.4): its converter leaves a text whose bytes would be over
  `length.max` undecoded (the check reports it as not bytes), since decoding is the one
  conversion that allocates in proportion to the input.
- **`toMap` converts a plain object or a list of pairs only**: a `Set`, a `Date` or a typed
  array is an object with entries of its own, which are not those of a map.
- **A plain union prepares every branch before it tries any** (`walkUnion`, the pass before
  the check): when no branch changes the value there is nothing to pick between, and the check
  picks the branch, so a parse over a union of records that nest unions is linear where nothing
  applies (a chain of 12 records: 59 → 14 ms, measured at the review of 3.3). Where a branch
  does change it (a default, a conversion below), the value is tried as given first, then the
  prepared values, and a trial is a check of the subtree: a leaf to convert deep in such a union
  is tried at every level, which the docs say a `discriminator` answers. The preparation of a
  branch that is not taken is discarded (its default factories were called).
- **`coerce()` reports by comparing the output with the input**, not from the converters: a
  container is copied only where a part changed, so what differs is what changed, and the
  trials of a union convert nothing that stays in the output. The paths are in the order of the
  keys of the output (a default filled in comes last). `parse` does not report.
- **A model's `coercions` are read through the namespaces of a schema** (`field.root.namespaces`,
  the models attached), before the process-wide table, by `converterOf` of the subpath; the
  core only validates and keeps the frozen table (`model.coercions`). The converter resolved is
  kept on the info of the node under the version of the process-wide table, so a model's table
  must be given at construction (it is), never changed after.

## Documentation site

VitePress in `docs/`, deployed to Vercel (`vercel.json`) at `metaschema.vercel.app`. It is not
published to npm, and lint/format do not cover it.

- Only `docs/index.md` has frontmatter; links between pages are absolute and extensionless. The
  comparison page gets its full width from `.VPDoc:has(.ms-matrix)` in `custom.css`, not from
  frontmatter.
- Diagrams are mermaid blocks (`vitepress-plugin-mermaid`). pnpm does not hoist mermaid's
  browser dependencies, so `@braintree/sanitize-url`, `cytoscape`, `cytoscape-cose-bilkent`,
  `dayjs`, `debug` and `fastdom` are devDependencies (as in kerberos) and `fastdom` is in
  `vite.optimizeDeps.include`; without them every page fails to load in the dev server. Keep a
  diagram narrow (top to bottom, short labels): a wide one is scaled down to unreadable text.
- Generated regions: the benchmark tables (`pnpm bench:report`) and the feature matrix
  (`pnpm docs:comparison`, from `docs/comparison.json`, every cell checked against the
  published source in October 2026) sit between markers in README and the docs; edit the data,
  then regenerate.
- `ignoreDeadLinks` is off, so `pnpm docs:build` failing on a dead link is a feature.
- The nav version label is read from `package.json`.
- The brand is the violet "braces" mark (`#7C5CFF`, `#9D85FF` on dark): `docs/public/logo-mark*.svg`,
  `favicon.svg` (follows `prefers-color-scheme`), `favicon.png` and `logo.png` (the 1200×630
  og:image).
- When behavior changes, update README and the matching docs page together. Example outputs in the
  docs were checked against the code, so keep them true.
- The 2.0 pages: `guide/unions.md` (union, discriminator, optional vs nullable vs `null`),
  `guide/performance.md` (the core, the baseline numbers and their chart, the JIT), `guide/migrating-from-1.md`
  (the CHANGELOG's "Upgrading from 1.x" with before-and-after examples; the 1.x outputs were
  produced by the code on `main`) and `guide/standard-schema.md`. The 3.0 pages are
`guide/parse.md` (the pipeline, defaults, codecs, strip, serialize, async, the boundaries),
`guide/json-schema.md` (options, targets, the mapping table, the strict profile with a tool
definition, the mongodb target, the import of a document, the boundaries) and
`guide/compile.md` (compile, register, canEval, the jit option, where there is no eval, what
the generated code contains, the boundaries). The 3.1 pages are `guide/evolution.md` (the
model subpath, `aliases` and `deprecated`, `diff`, the change shape, `compatibility` with the
rules table, the boundaries) and `guide/samples.md` (`sample`, the options, what is drawn per
type, the pattern subset, the unsatisfiable cases); `guide/model.md` has the snapshot format and
`fromJSON`, `guide/schema-syntax.md` the merge rules. The 3.3 pages are `guide/coercion.md`
(the policy, the converters, unions, `coerce()`, your own converters), `guide/derive.md` (the
six functions, the kind and the id, the schema's functions, indexes, names and models) and
`guide/mongodb.md` (the comparison with Mongoose, setup, collections, writing, reading,
updates, the BSON types, when Mongoose still fits); `guide/formats.md` has the five tables of
the 35 formats. The 3.4 page is `guide/definition.md` (the definition entry: what works, what is
`ERR_NOT_REGISTERED`, with the core, the boundaries); `guide/model.md` has the snapshot of one
schema and what format 1 guarantees, `guide/types.md` `bytes`, `flags` and `decimals`, and
`guide/architecture.md` the two halves of the core. The 3.2 pages are `guide/streaming.md`
(the stream subpath: the entries, `parseEach`, `maxInvalid`, the async pair and `concurrency`,
`transform`, the boundaries), `guide/infer.md` (`infer`, the options, what is inferred per
value, optional/nullable/null, the enum, format and dictionary rules, the keys, the root, the
self-check, the round trip with `sample`, the boundaries) and `guide/formats.md` (the `format`
rule, the built-in formats, `register` and the program's own, JSON Schema, samples and
inference, evolution, the boundaries); `guide/parse.md` describes the
settle of 3.2 and `guide/performance.md` its rows. Added with 3.2 as well:
`guide/benchmarks.md` (the comparison, cold start, bundle size, release over release, method),
`guide/comparison.md` (the feature matrix of twenty alternatives) and `guide/architecture.md`
(the mermaid diagrams of the pipeline). The sidebar is in
`.vitepress/config.mts`; a new page goes there and into `docs/public/llms.txt` if it is a key
fact.

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
