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
pnpm size [--max-gzip <KB>]        # esbuild bundle sizes for index.js and browser.js; CI gates at 8 KB min+gzip
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
- `index.d.ts` is the only source of the public types, written by hand. A public API change touches
  `src/index.js`, `index.d.ts` and a test together. `tests/unit/export-parity.test.js` compares
  runtime exports with the declared value exports for both entries and imports every name from ESM.
  `tests/types/index.test-d.ts` (tsd) pins signatures. `check:dts` needs `--target es2022` because
  there is no tsconfig.
- `package.json` has a closed `exports` map (`types` first, then `browser`, then `default`) and a
  `files` allowlist: `index.js`, `index.d.ts`, `browser.js`, `src`, README, CHANGELOG, LICENSE and
  SECURITY.

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
  metadata.js       ValidationResult, SchemaMetadata (kind, scope, indexes, options, …)
  schema.js         Schema (extends SchemaMetadata)
  struct.js         createStruct (null-prototype field dictionary) and checkStruct
  preprocessor.js   Preprocessor: turns a definition into { Type, defs, kindMeta }
  types.js          TYPES registry, createType, typeFactory
  model.js          Model: entities, ordering, warnings, dts
  util.js           BRAND/hasBrand identity brand, formatters (type '?x', key 'x?', length), checks
  errors.js         SchemaDefinitionError (code, schema, field) for broken definitions
  metautil.js       helpers copied from metautil v5.5.2
  prototypes/       type prototypes: abstract, scalars, collections, reference, schema, tuple, json
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

Module graph (no cycles): `kinds → metadata → struct → prototypes/* → types → preprocessor →
schema → model`; `util.js` and `errors.js` are leaves required from several of them.
`src/index.js` adds `runtime/node.js`.

**Parsing a definition.** `new Schema(name, raw, namespaces)` builds a `Preprocessor`, and
`Preprocessor#parse(source)` picks parsers by source type (`PARSERS` in `preprocessor.js`):

- string → `stringShorthand`: `'?string'`, or a capitalized name → reference
- object → tried in order:
  - `schemaInstance` (a `Schema`, or `{ schema: Schema }`)
  - `schemaWithKind` (capitalized first key = kind)
  - `typeLongForm` (`{ type }`)
  - `typeShorthand` (first key is a type name, e.g. `{ array: 'number' }`)
  - `kindlessSchema` (a nested struct)
- function → `functionField`: a calculated field, kept as is and never validated
- array → `tupleShorthand`

It returns `{ Type, defs, kindMeta }`. Unknown lowercase type names **throw**, because a broken
definition is a programming error. Capitalized names become `reference` fields.

**Definition errors** are `SchemaDefinitionError` (`src/errors.js`), a `TypeError` with `code`
(`ERR_UNKNOWN_TYPE`, `ERR_INVALID_DEFINITION`, `ERR_MISSING_SCHEMA`, `ERR_INVALID_TUPLE`,
`ERR_PROJECTION`, `ERR_INVALID_CUSTOM_TYPE`, `ERR_INVALID_ENUM`, `ERR_INVALID_LENGTH`,
`ERR_INVALID_REFERENCE`, `ERR_RESERVED_KEY`, `ERR_TYPE_REGISTERED`, `ERR_UNKNOWN_JS_TYPE`),
`schema` and `field`. A definition that can never validate correctly
(an `enum` without values, a `length` that is not numeric, a projection naming a field its parent
does not have) is rejected when the schema is built, never discovered inside `check`. Throw sites do not know where
they are; `createStruct` catches on the way up and calls `error.locate(root.name, field)`, which
prepends nested keys, so the message ends with `in "Order.address.city"`. Never throw a bare
`Error` for a definition problem.

**Types.** `types.js` creates one class per prototype (`createType`): `class Type extends
AbstractType` with static `type`, `kind`, `metadata`. `AbstractType#check` handles optional/null,
then runs `checkType`, the field's `validate`, and the rule checks (`length`). `TYPES` is a
**module-global registry**: `typeFactory(customTypes)` (called by `Model`) mutates it. It adds
metadata to built-ins, aliases (`{ js: 'string' }`) or new prototypes with
`construct`/`checkType`. Registration is process-wide, by design (see below).

**Kinds.** A capitalized first key sets kind and metadata via `getKindMetadata`:

- Stored kinds (`entity`, `registry`, `dictionary`, `journal`, `details`, `relation`, `view`)
  default to `application`/`persistent` and add an optional `<lowerCamelName>Id` field (`id` for
  anonymous schemas).
- Memory kinds and unknown/custom kinds default to `local`/`memory`.
- `projection` copies `fields` from `schema` via `root.findReference`.

Index keys (`index`/`primary`/`unique` arrays) and `many` fields are collected into
`schema.indexes`. Top-level `validate`/`format`/`parse`/`serialize` functions go to
`schema.options`; only `validate` is called by metaschema.

**Validation.** Errors are accumulated in `ValidationResult` (`{ valid, errors }`, private `#path`)
and never thrown for bad data. Validators and `checkType` may return:

- `null`, `undefined` or `true`: valid
- `false`: `'validation error'`
- a string
- an array of strings
- a `ValidationResult`

`ValidationResult.format` prefixes messages with `Field "<path>" ` unless they already start with
`Field`. Exceptions inside a type check are caught and reported as `validation failed <error>`.

**Model.** `new Model(types, entities, database = null)`:

1. registers types;
2. builds every entity as a `Schema` with the model as its namespace (projections are deferred to
   a second pass);
3. collects `checkConsistency()` warnings (missing references);
4. orders entities with `Identifier` first, dependencies before dependents, and recursive
   dependencies reported in `warnings`.

`model.dts` joins `toInterface()` of each entity in that order. `entities` is any iterable of
`[name, definition]`.

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
  - private class members with `#`.
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

## Things that look like bugs but aren't

- **`TYPES` is mutated by `typeFactory`.** Custom types and metadata registered by one `Model` are
  visible to every schema in the process, including `Schema.from` without a namespace. This is
  upstream's design; do not "fix" it by cloning per model without discussing it first.
  Re-registering a name is accepted only for the same definition (`Type.source`: same `js`, same
  `construct`/`checkType` functions) or a metadata-only entry; anything else throws
  `ERR_TYPE_REGISTERED`, because the old silent no-op hid conflicting tables.
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
  such as `__proto__` must come back as `is not expected` instead of resolving to
  `Object.prototype`. `checkStruct(fields, value, path)` is the check; `Schema#check` dispatches on
  the brand because `fields` is a `Type` for a non-struct schema (`Schema.from('string')`).
- **`Model#preprocess` skips names starting with `.`**: a leftover of the old loader's
  `.database`/`.types` files. It is harmless.
- **Optional nested structs have two mechanisms.** Inside a struct, `createStruct` lowers the flag with
  `child.required &&= required` (from `'key?'` or `required: false`). `prototypes/schema.js` keeps
  an explicit `required` with `required ?? true`, which is what makes a nested struct optional as a
  collection element. Upstream had `required || true`, which ignored `false`; do not bring it back.
  `tests/unit/structs.test.js` covers every form.
- **`relations` labels**: a `many` field is recorded as `'many-to-one'`, any other reference as
  `'one-to-many'`. That is upstream's naming.

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
