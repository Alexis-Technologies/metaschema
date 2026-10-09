# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

**metaschema** (npm package `@alexify/metaschema`) is a metadata schema and interface definition
language for JavaScript. Data structures and domain models are declared as plain objects; the
package validates values against them (`Schema#check`), assembles them into domain models
(`Model`), and renders TypeScript interfaces (`model.dts`). It has zero runtime dependencies and
runs in Node.js ≥ 18 and browsers.

It is a fork of [`metarhia/metaschema`](https://github.com/metarhia/metaschema) 2.2.2, maintained
by Alexis Technologies and set up like the sibling libraries `@alexify/kerberos` and
`@alexify/migronaut`. The git remote `upstream` points at metarhia; `origin` at
`Alexis-Technologies/metaschema`. The schema language and validation semantics are upstream's.
The package around them (no loader, no dependencies, tooling, layout) is ours.

Package manager is **pnpm** (pinned in `packageManager`).

## Commands

```bash
pnpm test                          # node --test tests/unit/*.test.js
node --test tests/unit/schema.test.js   # a single file
node --test --test-name-pattern="Tuple" tests/unit/*.test.js   # filter by name
pnpm run test:coverage             # c8 over src/, gated at 98 lines/statements, 90 branches, 100 functions
pnpm run test:types                # tsd: tests/types/*.test-d.ts against index.d.ts
pnpm run check:dts                 # tsc --noEmit --strict over index.d.ts on its own
pnpm run lint                      # oxlint src tests scripts bench
pnpm run format                    # oxfmt src tests scripts bench (format:check in CI)
pnpm size [--max-gzip <KB>]        # esbuild bundle sizes for index.js and browser.js; CI gates at 13 KB min+gzip
pnpm bench [filter] [--json] [--save] [--compare]   # ops/sec harness, manual only; --save writes bench/baseline.json
pnpm run docs:dev                  # VitePress dev server for docs/ (docs:build, docs:preview)
```

`prepublishOnly` runs lint + format:check + test:coverage + test:types + check:dts. Treat it as the
pre-merge gate. There is no build step.

## No build step: CommonJS + hand-written types

- `src/` is plain CommonJS (`require`/`module.exports`) and ships as is. No TypeScript syntax, no
  `import`/`export`, no `'use strict'`.
- The root `index.js` is a one-line shim over `src/index.js`. `browser.js` intentionally mirrors
  it. Do not deduplicate the two (see "Platform split").
- `src/index.js` lists every export **by name** (`module.exports = { KIND, …, Schema, Model }`),
  never by spreading module objects. cjs-module-lexer only sees named keys, and ESM
  `import { Schema } from '@alexify/metaschema'` depends on it.
- `index.d.ts` is the only source of the public types, written by hand, plus the two one-line
  `src/locales/*.d.ts` that type the locale subpath exports through it. A public API change touches
  `src/index.js`, `index.d.ts` and a test together. `tests/unit/export-parity.test.js` compares
  runtime exports with the declared value exports for both entries, imports every name from ESM
  and resolves the locale subpaths. `tests/types/*.test-d.ts` (tsd) pin signatures. `check:dts`
  needs `--target es2022` because there is no tsconfig.
- `package.json` has a closed `exports` map (`.` with `types` first, then `browser`, then
  `default`; `./locales/en` and `./locales/uk`) and a `files` allowlist: `index.js`, `index.d.ts`,
  `browser.js`, `src`, README, CHANGELOG, LICENSE and SECURITY.

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
their own `require`. `saveTypes` (writing `model.dts`) stays.

## Repository layout

```
index.js  browser.js  index.d.ts   root entry shims + hand-written types
src/
  index.js          public barrel (explicit named exports)
  kinds.js          KIND/KIND_STORED/KIND_MEMORY/SCOPE/STORE/ALLOW, getKindMetadata
  metadata.js       SchemaMetadata (kind, scope, indexes, options, …)
  schema.js         Schema (extends SchemaMetadata): check, Schema[RUN], dts rendering
  struct.js         createStruct: null-prototype field dictionary with its plan, known keys and compiled check
  context.js        createContext: the state of one check ({ issues, count, limit, path, seen, unknown, root, messages })
  issues.js         issue constructors by code, toDotPath, absorb (the validator contract), runValidate/runCheckType
  result.js         ValidationResult: valid, issues, lazy errors, summary, flatten, tree, add, issuesOf
  rules.js          rules per type: FORMAT (length, min, max, pattern), compileRules, code points
  lint.js           lintSchema: schema.warnings (unknown-option, unbounded-pattern, missing-index-field)
  locales/          en.js (built in) and uk.js (subpath export), one renderer per issue code
  preprocessor.js   Preprocessor: turns a definition into { Type, defs, kindMeta }; the first key decides
  types.js          TYPES registry, createType (static rules/options per type), typeFactory
  model.js          Model: entities, ordering, warnings (lazy), dts
  util.js           BRAND/hasBrand identity brand, RUN, shorten, formatters (type '?x', key 'x?', length)
  errors.js         SchemaDefinitionError (code, schema, field) for broken definitions
  metautil.js       helpers copied from metautil v5.5.2
  prototypes/       type prototypes: abstract, scalars (string, number, integer, bigint, boolean, date,
                    null, any/unknown, enum), collections, reference, schema, tuple, union, json
  runtime/          node.js (saveTypes via node:fs) and browser.js (same interface, rejects)
tests/
  unit/*.test.js    node:test suites, one per area
  types/*.test-d.ts tsd assertions
  fixtures/schemas/ a domain model as CJS modules; index.js assembles { database, types, ...entities }
scripts/size.js     bundle-size report and budget gate (CI smoke)
bench/              zero-dependency ops/sec harness; baseline.json is a snapshot for --compare
docs/               VitePress site (metaschema.vercel.app), not published
.claude/skills/     metaskills v1.0.5 skills (js-conventions, npm-publish adapted)
```

## Architecture

Module graph (no cycles): `locales/en → issues → rules/result/context`, then
`kinds → metadata → struct → prototypes/* → types → preprocessor → lint → schema → model`;
`util.js` and `errors.js` are leaves required from several of them, `issues.js` is required by
`struct`, `rules`, `result`, `context`, `schema` and every prototype; `schema.js` also requires
`prototypes/reference.js` for `embeds` (the one rule shared by `check` and the dts). `src/index.js`
adds `runtime/node.js`. `util.js` must not require `issues.js` (the locales require `util.js` for
`shorten`).

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
`ERR_INVALID_OPTIONS`, `ERR_INVALID_RULE`, `ERR_INVALID_UNION`), `schema` and `field`. A definition
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
`{ plan, known, check }`. The struct check is an index loop over the plan: a keyed load per field,
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
`context.js`: `{ issues, count, limit, path, seen, unknown, references, root, messages }`, one
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
the same function for the dts (`asId`/`tsReference`): a stored target renders as `<key>Id:
string`, a memory target as its interface name (inline when the target is anonymous, the name when
it cannot be resolved and `embed: true`, the id form when it cannot be resolved otherwise).

The order inside a field is type → rules → `validate`; a type failure cancels the rest, and
`validate` (field or schema level) runs only when nothing before it failed. Validators and
`checkType` may return (`absorb` in `issues.js` normalises it):

- `null`, `undefined` or `true`: valid
- `false`: `'validation error'` (`custom`), or `not of expected type: <name>` from a `checkType`
- a string, or `{ code, message, path?, params? }` (`path` relative to the field: a key or keys)
- an array of those
- a `ValidationResult` (its issues, relative to the field)

`runValidate`/`runCheckType` are the only `try/catch` blocks: an exception is an `exception`
issue. `context.count >= context.limit` is how every loop over fields, elements and records
stops early. `ValidationResult` (`result.js`) keeps `add()`/`issuesOf()` for results built by
validators, plus `summary`, `flatten()` and `tree()`.

**Model.** `new Model(types, entities, database = null)`:

1. registers types;
2. builds every entity as a `Schema` with the model as its namespace (projections are deferred to
   a second pass);
3. orders entities with `Identifier` first, dependencies before dependents, and records recursive
   dependencies;
4. `model.warnings` (a getter, computed on first use) is every entity's `warnings`, its
   `checkConsistency()` (missing references and types) and the recursive dependencies.

`model.dts` joins `toInterface()` of each entity in that order. `entities` is any iterable of
`[name, definition]`.

## Budgets

`pnpm size --max-gzip 13` is the CI gate (13 KB = 13312 bytes min+gzip per entry). After
Workstream B the entries are at 12755 bytes (`index.js`) and 12775 bytes (`browser.js`), 12.5 KB,
up from 9.9 KB after Workstream A: union, date/null/any/integer, pattern and min/max, the
references rule and the lint cost about 2.6 KB together. ROADMAP.md §5.8 planned 12 KB for 2.1
with the JSON Schema export; that budget has to be revised again when D2 lands. `pnpm bench` on
Node 24 (this machine, `bench/baseline.json` is still the Workstream A snapshot): flat valid
≈ 10.7 M ops/s, flat invalid ≈ 3.6 M, nested ≈ 2.7 M / 1.5 M, `Schema.from` and `new Model` at the
1.0 level (`new Model` about 8% under A: every field now checks its rules against its type and a
projection re-parses its parent's fields). The moltar strict modes are at ≈ 16.8 M, the loose
modes (an options object on every call) at ≈ 14.8 M against ≈ 17 M after A, in the full run only;
run alone (`pnpm bench moltar`) both modes are within a few percent of A, and the gap did not
reproduce in an A/B of the two trees in one process. It is a per-call effect of about 3 ns tied
to how V8 optimizes `check` after the plain path was hot first, not to the walk, and is the one
open performance question of Workstream B. The roadmap's 2.0 targets were 12 M / 6 M: the valid
path is within reach of the closure backend, the invalid path is bounded by the cost of plain
issue objects (a params object, a path array and a rendered message each) and is where the JIT
backend of Workstream E picks up.

## Platform split

`src/runtime/node.js` is the **only** file allowed to require a Node builtin
(`tests/unit/platform.test.js` enforces this). `src/runtime/browser.js` exports the identical
interface. Today that is just `saveTypes`, which rejects in the browser. The swap happens through
the `package.json` `browser` field (`./index.js → ./browser.js`,
`./src/runtime/node.js → ./src/runtime/browser.js`) plus the `browser` condition in `exports`.
`pnpm size` bundles `browser.js` with `platform: 'browser'`, so a leaked builtin fails CI. Renaming
a runtime file means updating the `browser` map keys.

## Conventions (oxlint/oxfmt + review)

- Formatting: 2 spaces, single quotes, semicolons, trailing commas, **100 columns**, LF
  (`.oxfmtrc.json`, `.editorconfig`). Lint: `.oxlintrc.json` (from kerberos: the explicit rule
  list, plus the `correctness` and `suspicious` categories as errors and `no-console` everywhere
  but `scripts/` and `bench/`). Suppress a rule only for an intentional construct, with a
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
  relative requires). Its naming, best-practice and optimization rules are upstream's.
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
- `tests/unit/bundle.test.js` builds `browser.js` and `index.js` with esbuild in memory (minified
  and not) and validates through the result, so a class-name-based identity check cannot come
  back unnoticed. It runs in `pnpm test` on every matrix leg; esbuild supports Node 18.
- New behavior needs a test that fails without the change.
- `tests/unit/result.test.js` and `check-options.test.js` cover the issue shape, locales and
  `check` options; `tests/unit/context.test.js` pins the context shape and the absence of global
  state. The locale tables are compared key by key, so a new issue code needs a renderer in every
  locale.
- Workstream B suites: `syntax.test.js` (the first key), `numbers.test.js` (min/max, integer,
  rules per type, unicode length), `pattern.test.js`, `nullable.test.js`, `values.test.js` (date,
  null, any), `union.test.js`, `references.test.js` (storage view, graph view, dts) and
  `lint.test.js`; `tuple.test.js` has the any-element cases.
- `tests/fixtures/schemas/Account.js` marks `birth` with `Struct: {}` because its first field is
  called `date`; without the marker the fixture is a `date` field and the lint says so.
- Doc example outputs were checked against the code; a scratch script that prints them is the
  quickest way to re-verify after a message change.

## Things that look like bugs but aren't

- **There is no global validation state.** `ancestors` and `limits` are gone from `util.js`:
  every check gets its own context, and a validator may start another check (even of the same
  value) without touching the outer one.
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
