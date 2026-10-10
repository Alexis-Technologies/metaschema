# metaschema: architecture review, alternatives and roadmap

> Review as of 2026-10-09 (metaschema 1.0.0). Sections 1–2 are based on reading the code and on measurements in this repository; sections 3–8 on research into the zod/valibot/arktype, ajv/typebox/typia code bases, Standard Schema, the academic literature and the IDL landscape. This file is not part of the npm package (`files` allowlist).

## Context

`@alexify/metaschema` 1.0.0 (released 2026-10-09) is a zero-dependency fork of `metarhia/metaschema` 2.2.2: schemas as plain objects, validation (`Schema#check`), a domain model (`Model`) and `.d.ts` generation. The task was to assess the architecture technically and as a product, compare it with the alternatives, collect ideas for performance and for removing the weak points, and lay out an implementation plan with a roadmap.

**Decisions agreed (answers to the clarifying questions):**
1. JIT through `new Function`: yes, but with an interpreter fallback (CSP, Cloudflare Workers, `--disallow-code-generation-from-strings`).
2. Static TypeScript inference `Infer<typeof def>`: yes, in full.
3. Breaking changes: **straight into 2.0**; the roadmap starts with 2.0.0.
4. "Model → database": metaschema ships exports only (JSON Schema, Mongo `$jsonSchema`, snapshot, diff); DDL and migrations live in migronaut or a separate package.

Constraints from CLAUDE.md that do not change: zero runtime dependencies, CommonJS with no build step, hand-written `index.d.ts`, Node ≥ 18, one package for Node and browsers, no loader and no `metavm`.

---

## 1. Technical review of the current architecture

### 1.1 How it works today

Pipeline: `kinds → metadata → struct → prototypes/* → types → preprocessor → schema → model` (no cycles, ~1,600 lines in `src/`).

1. **Parsing a definition.** `new Schema(name, raw)` creates a `Preprocessor` ([src/preprocessor.js](src/preprocessor.js)), which tries parsers by source type: `stringShorthand` → `schemaInstance` → `schemaWithKind` → `typeLongForm` → `typeShorthand` → `kindlessSchema` → `tupleShorthand`. The result is `{ Type, defs, kindMeta }`.
2. **Types.** [src/types.js](src/types.js) creates one class per prototype (`createType`); `TYPES` is a process-wide registry that `typeFactory` mutates. Every `Type` instance copies all keys of its definition onto its own properties ([src/prototypes/abstract.js:31-38](src/prototypes/abstract.js:31)) and picks its rules once (`#rules`).
3. **Validation.** A tree-walking interpreter: `Schema#check` → `checkStruct` ([src/struct.js:38-61](src/struct.js:38)) → `AbstractType#check` ([src/prototypes/abstract.js:48-70](src/prototypes/abstract.js:48)) → `checkType` + `validate` + rules. Every level creates a `ValidationResult`, builds a path string `${path}.${name}`, adds and removes the value in the global `ancestors` set (cycles), and wraps itself in `try/finally`. Messages are formatted immediately (`issue()` in [src/util.js:25](src/util.js:25)).
4. **Model.** `Model` registers types, builds the entities (projections in a second pass), collects warnings, orders by dependency and renders `.d.ts`.

### 1.2 Measurements (Node 24, this machine, `pnpm bench` + an inline experiment)

| Scenario | ops/sec | Comment |
| --- | --- | --- |
| `check`: flat struct (4 fields), valid | ~2.1 M | ≈ 475 ns per call, ≈ 120 ns per field |
| `check`: flat, invalid (3 errors) | ~0.87 M | 2.4× slower than valid: the cost of message strings |
| `check`: nested (struct+enum+array+matrix+tuple), valid | ~0.33 M | |
| `Schema.from`: flat / nested | 276 K / 94 K | construction is cheap, fine |
| `new Model` (6 entities) | 18 K | |

**Headroom experiment** (same flat schema, same semantics "all errors + unexpected keys", inline code in `node -e`):

| Implementation | valid | invalid |
| --- | --- | --- |
| metaschema 1.0.0 (interpreter, eager messages) | 2.1 M | 0.86 M |
| "compilation into closures" (one function per field, issues without text) | 15.9 M (**7.4×**) | 13.6 M (**15.7×**) |
| `new Function` (straight-line code, like zod 4 fastpass / ajv) | 33.0 M (**15.5×**) | 23.6 M (**27×**) |
| `JSON.stringify` of the same object (reference point) | 4.7 M | |

Conclusion: today's `check` is slower than `JSON.stringify` of the same value. Most of the time goes not into checks but into allocations (a `ValidationResult` per field, path strings, `Object.entries`), `try/finally` and `ancestors` on every object, and eager message formatting. The headroom is ~7× without `eval` and ~15× with it.

### 1.3 Strengths

- **A compact DSL on plain objects**: `'?string'`, `'tags?'`, `{ array: 'number' }`, `['number','number']`, `'Company'`. A schema is ordinary data: it serializes, travels over the network, is stored in a database, is edited by a UI.
- **A first-class domain model**: kinds (entity/registry/dictionary/journal/…), scope/store/allow, indexes, references, relations, projections, dependency ordering, warnings about missing references. None of the popular validation libraries has this.
- **Errors as data**: `check` never throws on bad data and returns every problem with a code and a path; `maxErrors`; `SchemaDefinitionError` with codes for broken definitions and a location `in "Order.address.city"`.
- **Engineering hygiene of the fork**: 0 dependencies, < 8 KB min+gzip (CI gate), Node 18–24 + Windows, 99.8% line coverage, bundle tests through esbuild (minified and not), a brand symbol instead of `instanceof`, null-prototype structs (`__proto__` → "is not expected"), `ERR_RESERVED_KEY`, protection against huge keys in messages, a bench harness with a baseline.
- **Extensibility**: custom types (`construct`/`checkType`), aliases (`js`), type metadata (`pg`), custom kinds, an isolated registry.
- **Documentation** (VitePress, 13 pages) and a clear CLAUDE.md.

### 1.4 Weaknesses (with evidence)

**Validator / performance**
- W1. An interpreter that allocates at every node (see 1.2). `checkStruct` builds `nestedPath` and a `ValidationResult` even for valid fields; `object`/`map` call `Object.entries`/`[...map.entries()]` ([src/prototypes/collections.js:19-37](src/prototypes/collections.js:19)); a `set` is copied into an array.
- W2. Megamorphic call sites: every `createType` creates a **separate class**, so `type.check(...)` in `checkStruct` sees many hidden classes; field instances also differ in shape (definition keys are copied onto `this`).
- W3. Global mutable state: `ancestors` and `limits.maxErrors` ([src/util.js:15-20](src/util.js:15)). It works only because validation is synchronous; it blocks async validators and concurrent checks.
- W4. Messages are built eagerly in English in `issue()`; `issues` carry no `params` (expected type, min/max, enum values), so i18n or another format is impossible without parsing the text.
- W5. The path is a string (`User.name.first`, `tags[0]`, `point(x0)`), ambiguous for keys with dots (verified: the key `"a.b"` yields the path `.a.b`) and incompatible with Standard Schema (`path: PropertyKey[]`).

**Schema language semantics**
- W6. Parser ambiguities (verified in `node -e`): a nested struct with a field named `type` (`{ name: 'string', type: 'string' }`) **silently** becomes a field of type string; a nested struct whose first key equals a type name (`{ array: 'string', count: 'number' }`) becomes an array. The escape hatch (`{ type: 'schema', schema: {...} }`) exists, but the mistake is silent.
- W7. `length` on `number`/`bigint` is really a range check with the message "exceeds the maximum length"; `Number(bigint)` loses precision ([src/util.js:72-84](src/util.js:72)). There is no `min`/`max`/`integer`/`pattern`/`format`.
- W8. Missing: union / discriminated union, literal, a `null` type, `nullable` separate from `optional` (`?` accepts both `null` and `undefined`), `Date`, `any`/`unknown` for primitives (`json` accepts only objects, but also `Date` and arrays, verified), readonly, recursive structs without a `Model`.
- W9. The unknown-keys policy is "strict" only (every extra key is an error). There is no strip/passthrough, which gets in the way of HTTP bodies with forward compatibility.
- W10. Dead metadata: `default` is stored but never applied; `parse`/`serialize`/`format` are collected into `schema.options` but never called ([src/metadata.js:78-92](src/metadata.js:78)). There is no "parse" (an output value): `check` returns only a verdict.
- W11. References have **two incompatible representations**: `check` expects an embedded object (`company: { name }`) while `dts` renders `companyId: string`; an id value `'c1'` is rejected (verified). This is upstream's intent (validating a graph vs. storing rows), but it is formalized nowhere.
- W12. `enum.includes` is O(n); fine for small enums, but without a Set.

**TypeScript / DX**
- W13. No static type inference from a schema (`Infer<typeof def>`), the headline feature of zod/valibot/arktype/typebox. The `.d.ts` is generated as text at runtime (a different, useful, but not interchangeable scenario).
- W14. In the `.d.ts` custom scalars become `string`, enums and nested structs are inlined without named types; no JSDoc/`description`.

**Integrations**
- W15. No Standard Schema (`~standard`), no export to JSON Schema / OpenAPI / Mongo `$jsonSchema`, no import from JSON Schema. This blocks use with Fastify/Ajv, wrpc, vee-validate v5, TanStack, the AI SDK and LLM tool schemas.
- W16. `Model` has no "model → database" consumer (upstream `metasql` generates PG DDL exactly from `metadata.pg`, kinds, `indexes`, `many`), and `database` is merely stored.

**Other**
- W17. `Schema#types` merges the namespace tables with `Object.assign`, fine, but `reference.checkType` calls `root.findReference` on every check.
- W18. `tuple` allows scalars only (verified in [src/prototypes/tuple.js:22](src/prototypes/tuple.js:22)).

---

## 2. Conceptual / product review

### 2.1 What metaschema really is

Three different products in one library:

| Layer | What exists | Competitors |
| --- | --- | --- |
| **Data validator** | `Schema#check` | zod, valibot, arktype, ajv, typebox, yup, joi |
| **IDL / domain model** | kinds, scope/store, indexes, references, `Model`, ordering | Prisma schema, Mongoose Schema, TypeSpec, Smithy, LinkML, upstream metasql |
| **Codegen** | `model.dts` | `wrpc types`, json-schema-to-ts, Prisma generate |

The "validator" niche is saturated and is won by performance + TS inference (where metaschema loses). The niche "an IDL for a domain model made of plain objects that serializes and drives validation, the database, types and transport alike" is almost empty in JS. Hence the strategic focus: **single source of truth**, with the validator as a must-have component that has to be "fast enough" (zod 4 class), not the fastest.

### 2.2 The Alexis ecosystem: where it hurts today (audit of the sibling repositories)

| Repository | How it validates today | What metaschema offers |
| --- | --- | --- |
| **kerberos** | three parallel copies of every policy schema: Zod, JSON Schema, TypeBox (~2,400 lines) + hand-written option checks | one schema → export to JSON Schema/Standard Schema/TS; option validation |
| **auth8** | ADR-005: TypeBox as the single source of truth (Fastify + Ajv + `Static<>`), BSON types through custom keywords | needs JSON Schema export with `bsonType` and TS inference; otherwise not a contender |
| **alioth-api / web / admin** | Zod 3/4 + `z.toJSONSchema` for Fastify, Prisma (MongoDB), vee-validate; a data-modeling SaaS with an ER editor (1,653 lines of hand-coded type rules) | metaschema as Alioth's data model (serializes to JSON, kinds/indexes/relations), export to Prisma/DDL/`$jsonSchema` |
| **migronaut** | hand-written config checks in three copies (a JS table, a JSON Schema for the editor, a d.ts); `converge` declares collections with indexes and `validator: { $jsonSchema }` | `Model` → collection declarations (indexes from `schema.indexes`, `$jsonSchema` from the export), a config schema |
| **wrpc** | accepts Standard Schema or Ajv; its own mini-language `signature` (`{ args: { room: 'string', 'limit?': 'number' } }`), codegen `wrpc types` → d.ts/OpenAPI | `signature` almost coincides with metaschema's shorthand → unify; Standard Schema → `input`/`output` |
| **syncom** | `schema: { entities }` holds names only, records are not validated | `Model.entities` are structurally compatible |
| **protoarray** | positional serialization by schema; the schema format is an open question | metaschema as the IDL for field layout, optionality, versioning |
| **bestify** | Zod + zod-to-json-schema | as alioth |

Conclusion: no project uses metaschema because it lacks precisely the **integration outputs** (Standard Schema, JSON Schema, TS inference), not syntax. This sets the roadmap priorities.

### 2.3 SWOT

| | Positive | Negative |
| --- | --- | --- |
| **Internal** | **S**: a serializable DSL; domain kinds/indexes/relations; errors as data with codes; 0 deps, 8 KB; a high-quality fork; flexible custom types | **W**: a slow validator (7–15× below what is reachable); no TS inference; no union/literal/date/range/pattern; strict-only keys; silent parser ambiguities; global state; eager English messages; no integration outputs |
| **External** | **O**: Standard Schema has become the de facto interface (tRPC, TanStack, Hono, vee-validate 5, AI SDK); JSON Schema is mandatory for LLM tool calling, OpenAPI, the Mongo validator; the Alexis stack has 7 potential consumers; the "serializable IDL for JS" niche is empty | **T**: zod 4 / valibot / arktype have huge ecosystems and speed; typebox is already "JSON Schema + TS" (auth8 chose it); the risk of staying an internal tool; CSP/Workers forbid `eval`, so a JIT must have a fallback |

---

## 3. Scientific background (what in the literature affects the design)

| Source | Result | Consequence for metaschema |
| --- | --- | --- |
| Pezoa et al., *Foundations of JSON Schema*, WWW 2016 ([doi](https://doi.org/10.1145/2872427.2883029)) | the first formal semantics of JSON Schema; motivation: validators disagreed on under-specified corners | write down the semantics of every operator (`?`, `null`, unexpected key, `length`) in a doc/spec and pin it with tests before extending the language |
| Bourhis et al., PODS 2017 ([doi](https://doi.org/10.1145/3034786.3056120)) | validation of non-recursive schemas is O(\|J\|²·\|φ\|), **linear without `uniqueItems`**; recursive ones are PTIME-complete | the only source of quadratic cost is uniqueness in arrays; implement `set`/`unique` by hashing, not pairwise |
| Attouche et al., *Validation of Modern JSON Schema*, POPL 2024 ([doi](https://doi.org/10.1145/3632891)) | validation of Draft 2020-12 is **PSPACE-complete** because of `$dynamicRef`; annotation-dependent validation (`unevaluatedProperties`) on its own stays in P; a co-author: 2020-12 "can be exploited for DoS" | metaschema's language (static references by name, no `not`/conditional combinators) has **linear** validation; worth declaring as a guarantee, testing, and using as an argument against "full" JSON Schema inside |
| Attouche et al., *Witness Generation for JSON Schema*, VLDB 2022 ([doi](https://doi.org/10.14778/3565838.3565852)) | generating an example for a schema = a satisfiability check; catches contradictory definitions | `schema.sample({ seed })` + a lint for contradictions (`length: { min: 5, max: 3 }`) at build time |
| Habib et al., *JSON Subschema Checking*, ISSTA 2021 ([doi](https://doi.org/10.1145/3460319.3464796)) | checking `S1 ⊆ S2` found 43 real producer/consumer compatibility bugs | `Model.diff(prev, next)` and compatibility classes (BACKWARD/FORWARD/FULL as in the Confluent Schema Registry) as the formal input for migration generation |
| Baazizi et al., ER 2021 ([doi](https://doi.org/10.1007/978-3-030-89022-3_9)); Yannou-Medrala & Coelho 2024 ([hal](https://hal-anses.archives-ouvertes.fr/ENSMP_CRI/hal-04415517v1)) | in ~80k real schemas a small core is used (types, required, enum, arrays, refs); negation is rare; **>60% of public schemas are defective** (typos, misplaced keywords) | keep the language core small and codegen-shaped (like JTD, RFC 8927); lint definitions at build time (unknown field keys, unused references, indexes over missing fields) |
| Findler & Felleisen, ICFP 2002; Freeman & Pfenning, PLDI 1991; Wadler & Findler, ESOP 2009 | contracts with **blame**, refinement types, gradual typing | `validate` functions = refinement predicates (opaque, not exportable to JSON Schema/SQL); declarative constraints (`length`, `enum`, `required`) belong in the schema so emitters see them; error reports should say which side violated the contract (`parameters` vs `returns`) |
| Avro schema resolution; Protobuf "Updating a message type"; Confluent compatibility; Scherzinger et al. (NoSQL schema evolution, 2013/2020) | mature systems have: a compatibility relation between versions, resolution rules for old data (defaults, aliases, promotions), a migration history | evolution primitives in the language: `default`, `aliases`, `deprecated`/`reserved`; a model snapshot (`model.toJSON()`) as the baseline for diffs (Drizzle's database-less approach) |
| Baazizi et al., schema inference (EDBT 2017, VLDBJ 2019) | "data → schema" as the reverse direction of an IDL | `Schema.infer(samples)` to bootstrap models from existing JSON/documents (low priority) |
| Langdale & Lemire (VLDB J 2019), Keiser & Lemire (SP&E 2024), JSONSki (ASPLOS 2022) | the cost of "looking at every byte" is avoidable when the consumer declares what it needs | early stop (`maxErrors`), a single walk, and later record-wise validation of large arrays |

## 4. The landscape of alternatives

### 4.1 Validators

| Library | Approach | What it does well | What it lacks / trade-off |
| --- | --- | --- | --- |
| **zod 4** | fluent API, TS-first, `_zod` internals, a JIT "fastpass" for objects through `new Function` (disabled by `jitless`) | the ecosystem, `z.toJSONSchema`/`fromJSONSchema`, a metadata registry, codecs, locales, `zod/mini` for tree-shaking, Standard Schema | a schema is not data (classes with closures), no domain model, a large API |
| **valibot** | modular functions + `v.pipe`, tree-shakable | a minimal bundle, issues with `expected/received`, i18n, Standard Schema | the same "schema is code" |
| **arktype** | a set-theoretic type system, a string DSL (`"number >= 18"`), JIT with a fallback | the fastest of the runtime validators, TS inference from strings | a complex core, the power of the DSL is rarely needed |
| **ajv** | JSON Schema → generated JS code (`new Function`), `allErrors`, `strict`, `$data`, a keywords API, standalone code, JTD + serializers/parsers | the fastest JSON Schema validator, the standard in Fastify | needs `unsafe-eval`; JSON Schema is verbose; TS through `JSONSchemaType<T>` |
| **typebox** | JSON Schema objects as TS types (`Static<>`), `Value.Check` (interpreter) + `TypeCompiler` (JIT) | "one schema = JSON Schema + TS"; transform codecs; exactly what auth8 chose (ADR-005) | the schema is JSON Schema, i.e. verbose; no domain model |
| **typia** | an AOT TS transformer that generates validators at build time | the fastest overall; `random`, `json.stringify`, `llm.application` | needs a build step/transformer, incompatible with "no build step" |
| **effect/Schema** | bidirectional codecs (decode/encode), annotations | the strongest transformation model | a heavy dependency on Effect |
| **mongoose Schema** | a plain object with types/validators/`ref`/indexes/hooks/discriminators | metaschema's closest "relative" in style | tied to MongoDB |

### 4.2 IDLs / "schema as the source of truth"

| Tool | The idea worth taking |
| --- | --- |
| **JSON Type Definition (RFC 8927)** | eight mutually exclusive forms (type/enum/elements/properties/values/discriminator/ref); the goal is codegen and portable error indicators. metaschema is already almost JTD-like; what is missing is `discriminator` |
| **TypeSpec** (Microsoft) | a compiler with emitter plugins (`$onEmit`): OpenAPI, JSON Schema, Protobuf; one model → many artifacts |
| **Smithy** (AWS) | *traits* as cross-cutting metadata (`@required`, `@length`, `@pattern`) that every emitter interprets; model diff for incompatible changes. `metadata: { pg }` in metaschema is a trait in embryo |
| **Prisma / Drizzle** | schema diffs for migrations: Prisma through a shadow DB, Drizzle through a **committed JSON snapshot** (no database). The second approach fits `Model` + migronaut perfectly |
| **Mongoose** | `schema.index()`, discriminators (tagged unions in one collection), `timestamps`, hooks |
| **CUE** | composition by **unification** (merging fragments with conflict detection) instead of `allOf`/inheritance; version compatibility checks on the lattice |
| **Pkl** (Apple) | validation + defaults + codegen in one declaration; the constraint next to the type |
| **LinkML** | a YAML model → JSON Schema, SQL DDL, TS, OWL (30+ generators), the systematic version of what metaschema+metasql do in part |
| **GraphQL SDL** | runtime introspection of the contract (`model.toJSON()` for wrpc/syncom) |
| **metarhia metasql** (the upstream consumer) | PG DDL from `metadata.pg`, kinds, `indexes`, `many` → junction tables, `Identifier`/`Registry` registration; migrations only as versioned copies, no diff |
| **LLM structured outputs** (OpenAI, Anthropic `input_schema`, Vercel AI SDK, MCP SDK v2) | all accept JSON Schema in a **restricted dialect** (root object, `additionalProperties:false`, optional → `["T","null"]`, no `allOf/not/if`); MCP SDK v2: "any Standard Schema that can produce JSON Schema" |

### 4.3 What exactly to borrow (from the zod 4, ajv, typebox, arktype, valibot, schemasafe code bases)

| # | Idea | Where from (code) | Expected effect for metaschema |
| --- | --- | --- | --- |
| P1 | **The traversal plan is built once when the schema is built**; `check` never looks at the raw definition | zod `normalizeDef` (`allKeys/optionalKeys/keySet`), ajv `properties` iterates the *schema's* keys as literals, `alwaysValidSchema` removes no-ops | removes `Object.keys/entries`, `hasBrand`, `formatters` from the hot path |
| P2 | **A specialized `check` per type, chosen at build time** (`run = parse` alias when there are no checks) | zod `inst._zod.run = inst._zod.parse` when there are no checks; typebox TypeCompiler inlines `Policy.*` as strings | a scalar without rules = one `typeof` check, no loop over rules |
| P3 | **A validation context instead of globals**: `{ issues, count, limit, path[], seen, options }` | zod `ParsePayload`/`ParseContext`, valibot `dataset`+`config`, arktype `Traversal` (`path` as a push/pop stack) | removes `ancestors`/`limits` from `util.js`; opens the door to async and concurrent checks |
| P4 | **Raw issues, late messages**: `{ code, path[], params }`; text is produced at the end or lazily | zod `$ZodRawIssue` + `finalizeIssue`, a lazy `get error()`; arktype `message/expected/actual` as getters; ajv `vErrors === null` until there are errors, `errors++` | the valid path allocates no strings; i18n without parsing text |
| P5 | **The path is an array**, prefixed on the way up; the dotted form is rendered lazily with escaping | zod `prefixIssues`, `toDotPath`; valibot `path.unshift(pathItem)`; Standard Schema `path: PropertyKey[]` | removes W5, gives Standard Schema "for free" |
| P6 | **One `unexpected` issue with `keys: []`, the unknown-keys policy as a mode** | zod `strip/strict/loose` + `unrecognized_keys { keys }`; arktype `onUndeclaredKey: ignore/reject/delete`; ajv `removeAdditional`, ≤ 8 keys → a chain of `===`, otherwise a lookup | W9; fewer issues for "extra" keys |
| P7 | **A discriminator map for unions** | zod `propValues`→`Map.get(input[disc])`; arktype auto-discrimination + `switch`; ajv/JTD `discriminator` | O(1) branch selection instead of "try them all" |
| P8 | **Rules with a `when` predicate and `continue` semantics**: after a type failure do not run `length`/`validate` | zod `_whenHasLength`, `continue: !abort`, `aborted(payload, startIndex)` | fewer spurious cascading errors, less work on invalid data |
| P9 | **A JIT backend**: generated code contains only identifiers/numbers/JSON strings; real objects (RegExp, Set, nested schemas, custom `validate`) are passed through a `scope` | ajv `new Function('self','scope', code)` + `ValueScope`; zod `Doc.compile` with a closed-over `shape`; schemasafe `format('%j')`, escaping of U+2028/2029, `IDENTIFIER`-gated `.key` vs `["key"]` | ×2 over the closure backend; safety against injection into code |
| P10 | **Eval detection + a silent fallback** | zod `allowsEval` (jitless → the Cloudflare UA → `new Function("")`), arktype `envHasCsp()`, typebox 1.x `Environment.CanEvaluate()` + `IsAccelerated()` | identical semantics and errors in both backends; a test under `--disallow-code-generation-from-strings` |
| P11 | **Regexes are compiled at build time**, with an explicit `u` flag; ReDoS discipline | ajv `usePattern` + `unicodeRegExp`; typebox `Value.Check` as the anti-example (`new RegExp` on every call); schemasafe `complexityChecks` (a pattern requires `maxLength`) | once `pattern` exists |
| P12 | **Definition lints at build time** | ajv `strictTypes/strictTuples/strictRequired`, schemasafe `requireValidation`; ER 2021/2024 on defective schemas | W6: silent ambiguities become errors/warnings |
| P13 | **Error presentation helpers**: `treeify`, `flatten` (`formErrors/fieldErrors`), `prettify`, `summary` | zod `treeifyError/flattenError/prettifyError`, valibot `flatten/summarize`, arktype `byPath/summary` | forms (vee-validate, TanStack), CLI |
| P14 | **A message resolution chain + locales as separate modules** | zod `error` precedence + `zod/locales/uk`; valibot `lang` + `@valibot/i18n/uk`; ajv `messages:false` + ajv-i18n | `@alexify/metaschema/locales/uk` |
| P15 | **A cache by definition identity** | ajv `_cache: Map<schema, SchemaEnv>` | `Schema.from(sameObject)` without re-parsing |
| P16 | **A metadata bag per type** (`minimum/maximum/pattern/values`) read by dts, JSON Schema and the discriminator alike | zod `_zod.bag` + `onattach` | one source for every emitter |

V8 hygiene (from the V8 blog, Meurer, mraleph): one shape for issue objects (fixed key order, numeric fields never `null`), no closures or `RegExp` created inside `check`, `const` bindings for constants, `try/catch` only around user code, calls through a function chosen in advance instead of `type.check` on different hidden classes (today every `createType` = a separate class → a megamorphic call site in `checkStruct`).

---

## 5. Implementation plan

Principle: **2.0.0 collects every breaking change into one release** (the new core + corrected semantics + the new issue shape); additive features ship in minors. Every item has a test that fails without the change (CLAUDE.md "Testing notes").

### 5.1 Workstream A: the new validation core (2.0)

**A1. A context instead of global state.** New `src/context.js`: `createContext(options)` → `{ issues: [], count: 0, limit, path: [], seen: null, unknown, root }`. Remove `ancestors` and `limits` from [src/util.js](src/util.js); `seen` is a `Set` created lazily at the first object (cycle detection stays, but local to the call).

**A2. A struct plan and specialized checks.** In [src/struct.js](src/struct.js) `createStruct` additionally builds a `plan` (a frozen array of `{ key, type, required, check }`) and `known` (a null-prototype dictionary of keys). `checkStruct` becomes an index loop over `plan` with `Object.hasOwn`, with no `hasBrand` and no path strings. In [src/prototypes/abstract.js](src/prototypes/abstract.js) the constructor picks `this.check` from a set of specializations (`checkScalarPlain`, `checkScalarWithRules`, `checkCollection`, …), i.e. "compilation into closures". Collection prototypes iterate `Map`/`Set` directly (no `[...entries()]`), `object` through `for...in` + `Object.hasOwn`.

**A3. Issues with params, array paths, lazy messages.** New `src/issues.js`: issue constructors per code (`required`, `type { expected, received }`, `unexpected { keys }`, `enum { values }`, `length { min, max, actual }`, `range { min, max }`, `pattern`, `reference`, `circular`, `exception`, `custom`, `union`), `toDotPath(path)` with escaping, an English message catalogue. `ValidationResult` (moved from [src/metadata.js](src/metadata.js) into `src/result.js`): `valid`, `issues` (`{ code, path: PropertyKey[], message, params }`), `errors` as a lazy getter; methods `flatten()`, `tree()`, `summary`; keep `add()`/`issuesOf()` for the custom validator contract. Messages are produced once at the end of `check` through `options.messages` (a function or a locale); `src/locales/en.js`, `src/locales/uk.js`, the subpath export `./locales/uk`.

**A4. The `check` signature.** `schema.check(value, options?)`, `options = { root?: string, maxErrors?, unknown?: 'reject' | 'ignore', references?: 'kind' | 'embed' | 'id', messages? }`. The old positional `path` → `options.root`. `abortEarly` = `maxErrors: 1`.

**A5. Rules with `when` semantics.** A `type` failure cancels the field's further rules (`length`, `validate`), like zod's `continue`; `validate` and a custom `checkType` are the only places with `try/catch`.

**A6. A benchmark gate.** Extend `bench/` with moltar-style scenarios (parseSafe/parseStrict/assertLoose/assertStrict) and a comparison with zod 4, valibot, ajv, typebox (devDependencies, only `pnpm bench --compare-libs`). Targets for 2.0 on the flat schema: valid ≥ 12 M ops/s, invalid ≥ 6 M (today 2.1 M / 0.86 M).

*Status (2026-10-10):* the moltar scenarios landed and `check` is measured as a callee (`bench/helpers.js`); the comparison with other libraries moves to 2.1 with the JIT. Measured on this machine (`bench/baseline.json`, Node 24): flat valid 10.7 M, flat invalid 3.5 M, nested 2.7 M / 1.5 M, moltar 14.1–14.7 M. The valid target is a closure-backend ceiling (megamorphic loads and calls in the plan loop); the invalid path is bounded by the issue objects and is what Workstream E addresses. See §6.

### 5.2 Workstream B: language semantics (2.0, breaking)

| # | Change | Files | Details |
| --- | --- | --- | --- |
| B1 | **The "first key decides" rule** for every parser | [src/preprocessor.js](src/preprocessor.js) `typeLongForm` | the long form only when `firstKey(source) === 'type'`; otherwise a nested struct. Removes W6 (`{ name: 'string', type: 'string' }` → struct). Unknown keys in a field definition → a lint warning (B8) |
| B2 | **Numbers: `min`/`max`/`integer`** instead of `length` | `src/util.js` (`checks`), `prototypes/scalars.js` | `length` on `number`/`bigint` → `ERR_INVALID_RULE`; new rules `min`, `max` (bigint-safe comparison), the type `integer`; `length` stays for strings/collections (UTF-16 units, option `unicode: true`) |
| B3 | **New built-in types**: `integer`, `date` (a valid `Date` instance), `null`, `any`/`unknown`, `union` (`{ union: [...], discriminator?: 'kind' }`) | `src/prototypes/` | `union` without a discriminator: the first branch with no issues; with one: a `Map` over the `enum`/literal values of the branches (P7); `tuple` allows any elements, not only scalars (W18) |
| B4 | **`nullable`** separate from optional | `prototypes/abstract.js` | `'?string'` = optional (undefined \| null), as upstream; `{ type: 'string', nullable: true }` = a required key whose value may be `null` |
| B5 | **The unknown-keys policy** | `struct.js`, kinds metadata | `check({ unknown: 'reject' })` by default; `'ignore'`; at schema level `Struct: { unknown: 'ignore' }`; one `unexpected { keys }` issue (P6) |
| B6 | **Formalizing references (W11)**: "storage view" vs "graph view" | `prototypes/reference.js`, `schema.js` (dts), `kinds.js` | by default a reference to a **stored kind** validates as an id (`string`), a reference to a **memory kind** (struct/form/scalar/projection) as an embedded object; override per field with `embed: true/false` and globally with `check({ references })`; `dts`, `Infer` and JSON Schema use the same rule |
| B7 | **`set` ↔ `Set`** in dts/Infer (today dts says `T[]` while check accepts only a `Set`); `map` → `Map<K,V>`; `relations` labels in the conventional direction (`many` → `'one-to-many'`) | `schema.js`, `reference.js` | |
| B8 | **Definition lint** (`SchemaDefinitionError` + `schema.warnings`) | new `src/lint.js`, `model.js` | unknown field options, `length` with `min > max`, indexes over missing fields, unused/missing references, `pattern` without `length.max` |
| B9 | **`pattern`** for strings | `prototypes/scalars.js` | the RegExp is compiled at build time with `u`; documentation about ReDoS (P11) |

### 5.3 Workstream C: TypeScript inference (2.0)

- [index.d.ts](index.d.ts): `type Infer<D>` over the DSL forms: `'string' | 'number' | 'boolean' | 'bigint' | 'integer' | 'date' | 'null' | 'any' | 'json'`, `'?T'`, `'key?'`, `{ type, required?, nullable? }`, `{ array: X }` → `Infer<X>[]`, `{ set: X }` → `Set<…>`, `{ object: { K: V } }` → `Record`, `{ map }` → `Map`, `{ enum: [...] }` → a union of literals, tuples, nested structs, `{ union: [...] }`, references `'Name'` → `string` (storage view), function fields excluded. Extension for custom types through module augmentation: `interface CustomTypes { datetime: Date }`.
- `class Schema<D = unknown>`: `static from<const D>(def: D)` (a const type parameter, TS ≥ 5.0; the devDependency is TS 7), `new Schema<const D>(name, def)`, `check(value: unknown)`, `parse(...)` → `Infer<D>` (2.2), `~standard.types`.
- Tests: `tests/types/infer.test-d.ts` (tsd `expectType` for every form), `check:dts` stays.

### 5.4 Workstream D: integrations (2.0 → 2.1)

- **D1. Standard Schema v1 (2.0).** A lazy getter `Schema.prototype['~standard']` → `{ version: 1, vendor: 'alexify.metaschema', validate(value) → { value } | { issues: [{ message, path }] }, types }`. Tested through the `@standard-schema/spec` types (devDependency) and a real consumer (wrpc `input`/`output` in a fixture test, or a vee-validate-like call).
- **D2. JSON Schema export (2.1).** New `src/jsonschema.js`: `schema.toJSONSchema({ target: 'draft-2020-12' | 'draft-07' | 'openapi-3.0' | 'mongodb', profile?: 'strict', io?: 'input' | 'output' })`, `model.toJSONSchema()` with `$defs` per entity. Mapping: string (+`length`→`minLength/maxLength`, `pattern`), number/integer (`min/max`→`minimum/maximum`), boolean, bigint (unrepresentable → `throw | any`), enum, array/set (`uniqueItems`), object/map (`additionalProperties`), tuple (`prefixItems`), struct (`properties/required/additionalProperties:false`), reference (`$ref` or `{ type: 'string' }` per B6), union (`anyOf`/`oneOf` + `discriminator` for openapi), `date` (`format: date-time` in output / `type: string` in input), custom types through `metadata.jsonSchema` or the `js` alias; `validate` functions are not exported (a documented boundary). The `strict` profile for LLMs: root object, optional → `["T","null"]` + everything in `required`, no `allOf/not/if`. The `mongodb` target: `bsonType` from `metadata.bson`, no `$ref`/`format`/`default`, inline definitions. The keys `title`/`description`/`examples`/`deprecated` from a field definition pass through; `~standard.jsonSchema.input/output`.
- **D3. Annotations in dts (2.1).** `description` → JSDoc, named types for `enum` (`type UserRole = 'admin' | …`) and for nested structs behind an option.

### 5.5 Workstream E: the JIT backend (2.1)

- `src/compile/code.js` (a minimal builder: strings + a name counter, `quote()` with U+2028/2029 escaping, `prop(key)` with an `IDENTIFIER` check), `src/compile/jit.js` (`canEval()` with a cache, `compile(schemaOrModel, { jit: 'auto' | true | false })`), generators per prototype (struct, array/set, object/map, scalar, enum, union, reference). Real values go through a `scope` (P9). A failing `new Function` → a silent fallback to the closure backend; `compiled.accelerated` reports the mode.
- The subpath export `./compile` in `package.json` (`exports`; no `browser` map entry needed), a separate size budget in `scripts/size.js`.
- Tests: the whole validation suite runs on both backends (a loop in the tests or the env `METASCHEMA_BACKEND`), a separate `node --disallow-code-generation-from-strings --test` run in CI; eval-injection tests (keys with quotes, `__proto__`, U+2028, `constructor`).
- Target: flat valid ≥ 25 M ops/s (experiment: 33 M).

### 5.6 Workstream F: parse / codecs / async (2.2)

- `schema.parse(value, options)` → `{ valid, value, issues }`: applies `default`, `unknown: 'strip'`, field-level `parse` (decode) and the schema's `options.parse`; `schema.serialize(value)` is the reverse direction (`serialize`/`format`). Finally uses the dead metadata of W10.
- `schema.checkAsync`/`parseAsync` through the context of A1 (a validator may return a Promise; the synchronous `check` throws a clear error, like zod's `$ZodAsyncError`).

### 5.7 Workstream G: the model as the source of truth (2.2 → 2.3)

- **G1. Snapshot.** `model.toJSON()`: a stable, serialized description (entities in `order`, fields with types/rules/metadata, kinds, indexes, relations, database). This is the contract for migronaut (`converge` collection declarations: indexes from `schema.indexes`, the validator from `toJSONSchema({ target: 'mongodb' })`), for Alioth (model import/export), for wrpc (introspection).
- **G2. Diff and compatibility.** `Model.diff(prev, next)` → a list of changes (entity/field/index/type/required/default) + a compatibility class `full | backward | forward | none` by the Confluent rules (a field with a `default` is a fully compatible change). Evolution primitives in the language: `default`, `aliases: []`, `deprecated: true`.
- **G3. Example generation.** `schema.sample({ seed })`: a deterministic witness (catches contradictory definitions; for tests and LLM examples).
- **G4. JSON Schema import / unification.** `Schema.fromJSONSchema` (a subset: types/required/enum/arrays/refs, what is actually used) for the kerberos migration; `Schema.merge(a, b)` with conflicts as `SchemaDefinitionError` (CUE-style).

### 5.8 Workstream H: documentation, tooling, maintenance

- CHANGELOG 2.0 with a migration guide 1.x → 2.0 (`check` options, `issue.path` as an array, `length` → `min/max`, the first key, references by kind, `set`→`Set`); update README, docs (new pages: Performance, Standard Schema, JSON Schema, Unions, Migrating from 1.x), CLAUDE.md ("Things that look like bugs" without globals; the module graph; budgets), the `npm-publish` skill.
- `scripts/size.js`: budgets `index` ≤ 10 KB (2.0) / ≤ 12 KB (2.1 with JSON Schema), `./compile` ≤ 4 KB; update after measuring.
- A cross-check test: for random values `metaschema.check(x).valid === ajv.validate(toJSONSchema(schema), x)` (ajv in devDependencies), i.e. differential testing of the export.

*Status (2026-10-10):* done for 2.0 in Workstream H, with two revisions. The entries measured 12.6 KB min+gzip after D1 (A alone was 9.9 KB; union, the new types, pattern, min/max, references by kind and the lint cost about 2.6 KB), so the 2.0 budget is **13 KB per entry** (`pnpm size --max-gzip 13` in CI, CLAUDE.md "Budgets"); D2 has to measure first and either fit into it or move it. The `./compile` budget and the ajv differential test are deferred to 2.1, since they need E and D2.

*Status (2026-10-10, later, branch `feature/v2.1`):* D2 measured 3.0 KB (the export with four targets and the strict profile, plus the D3 annotations) and the entries are at 15.7 KB, so the 2.1 budget is **16 KB per entry** (`pnpm size --max-gzip 16`, 0eb1a37); the export stays in the core because `~standard.jsonSchema` has to be on the schema object (the subpath alternative is in the D2 hand-over note). The ajv differential test exists (`tests/unit/jsonschema-ajv.test.js`, 307ea8c) for draft 2020-12 and draft-07, and found one bug in `check` (a struct accepted an array, 94bb1e3). The `./compile` budget still waits for E.

---

## 6. Roadmap

| Release | Theme | Contents | Breaking |
| --- | --- | --- | --- |
| **2.0.0** | A new core + honest semantics | A1–A6 (context, plan, specialization, issues with `params`, array paths, lazy messages, `uk`), B1–B9 (first key, `min/max/integer`, `union`/`date`/`null`/`any`, `nullable`, the unknown policy, references by kind, `Set`, lint, `pattern`), C (`Infer`, `Schema<D>`), D1 (Standard Schema), H (migration guide) | yes |
| **2.1.0** | Speed and outputs | E (JIT `./compile` with a fallback), D2 (JSON Schema: 2020-12/07/openapi-3.0/mongodb + the strict profile + `~standard.jsonSchema`), D3 (annotations in dts), bench comparison with zod/valibot/ajv/typebox | no |
| **2.2.0** | Data, not only a verdict | F (`parse`/`serialize`, defaults, strip, codecs, async), G1 (the `model.toJSON()` snapshot), G2 (`Model.diff` + compatibility, `aliases`/`deprecated`), `model.toJSONSchema()` | no |
| **2.3.0** | Ecosystem | G3 (`sample`), G4 (`fromJSONSchema`, `merge`), adapters in the sibling repositories: wrpc `signature` ↔ metaschema, migronaut `converge` from a `Model`, protoarray layout from field order, kerberos on one schema | no |
| later | — | record-wise/streaming validation of large arrays; `Schema.infer(samples)`; more locales | — |

### Status (2026-10-10, branch `feature/v2`)

| Workstream | State | Where |
| --- | --- | --- |
| A (§5.1) validation core | done | merge 3032ce9, 2026-10-09 |
| B (§5.2) language semantics | done | merge 67a8f41, 2026-10-10 |
| C (§5.3) `Infer`, `Schema<D>` | done | cc8f392 + 7506c40, 2026-10-10 (no `Model<E>`: `InferEntity<E, Name>` instead, see CLAUDE.md) |
| D1 (§5.4) Standard Schema | done | 41d3801 + b25619b, 2026-10-10 |
| H (§5.8) docs, budgets, migration guide | done | the `docs`/`chore(ci)` commits after D1, 2026-10-10 |
| D2 (§5.4) JSON Schema export, `~standard.jsonSchema` | done, 2.1 | 30c0426 + 90ae650 (branch `feature/v2.1`, 2026-10-10), the ajv differential test 307ea8c, the 16 KB budget 0eb1a37, the `fix(check)` 94bb1e3 it found |
| D3 (§5.4) dts annotations | done, 2.1 | c1f6caf: JSDoc from `description`/`deprecated`, `toTypeScript({ named: true })` |
| E (§5.5) JIT | next, 2.1 | with the `./compile` budget and the library comparison bench |

What 2.0 delivers against the plan: all of A1–A6 except the library comparison; all of B1–B9 except "unused references" in B8 (no well-defined meaning, dropped); C without `Model<E>`; D1 with `types.input = Infer<D>`; H in full. The bundle budget is 13 KB (§5.8) and the measured `check` numbers are below the A6 targets (§5.1 status, §7).

What D2/D3 deliver against §5.4 (2.1): the four targets, the strict profile, `model.toJSONSchema` with `$defs` per entity (and `root`), `~standard.jsonSchema`, the annotations, `metadata.jsonSchema`/`metadata.bson` for custom types, and the dts JSDoc and named types. Decisions beyond the plan, each held by the differential test or a dialect's rules: an optional field allows `null` in every mode (as `check` does), a required `object`/`map` has `minProperties: 1`, the strict profile emits structure only (no `minLength`/`minimum`/`uniqueItems`/..., which the LLM dialects reject), a tuple has no form in OpenAPI 3.0 (`items` must be an object there), the mongodb root allows `_id`, and `~standard.jsonSchema` refuses the mongodb target. `model.toJSONSchema()` moved from 2.2 (§6 table) into 2.1 with D2.

Prioritization inside 2.0 (if something has to be cut): A1–A4 and B1/B6/B7 (the fixes that change the result shape) are mandatory for 2.0; B3 `union`/`date`, B9 `pattern` and C `Infer` can ship in 2.0.x as additive if the core takes longer. D1 is cheap (≈ 20 lines) and stays in 2.0.

Product consequences in the Alexis stack (outside this repository, after 2.1): kerberos keeps one schema instead of three copies (JSON Schema for Ajv, Standard Schema, `Infer`); wrpc accepts a `Schema` as `input`/`output` and generates `signature`/OpenAPI from `toJSONSchema`; migronaut runs `converge` from a `Model` (indexes, `$jsonSchema`, versioning) and validates its config through a schema instead of three copies; protoarray uses it as the IDL for the positional layout; alioth uses the metaschema snapshot as its data-model format.

---

## 7. Verification

1. `pnpm test`, `pnpm run test:coverage` (thresholds 98/98/90/100, not relaxed), `pnpm run test:types` (new `infer.test-d.ts`, `standard.test-d.ts`), `pnpm run check:dts`, `pnpm lint`, `pnpm run format:check`, `pnpm size` with the new budgets, `pnpm docs:build` (dead links).
2. Both backends pass one test suite; separately `node --disallow-code-generation-from-strings --test tests/unit/*.test.js` (the fallback) and the bundle test through esbuild (minified and not) for `index.js`, `browser.js`, `src/compile`.
3. `pnpm bench --compare` against the saved baseline: check the targets (2.0: ≥ 12 M / ≥ 6 M ops/s flat valid/invalid, measured 10.7 M / 3.5 M, see §5.1 status; 2.1 JIT: ≥ 25 M) and no regressions in `Schema.from`/`new Model`.
4. Differential tests: `check` ↔ ajv over `toJSONSchema` (done in 2.1, `tests/unit/jsonschema-ajv.test.js`); `Infer` ↔ `model.dts` (tsd: the generated interface is assignable to `Infer<def>` and vice versa).
5. Integration fixture tests: `~standard` through the `@standard-schema/spec` types; `toJSONSchema({ target: 'mongodb' })` is accepted by the `$jsonSchema` validator (a syntactic check of the keys); `toJSONSchema({ profile: 'strict' })` meets the OpenAI/Anthropic constraints (root object, `additionalProperties: false`, everything `required`).
6. A manual pass over the documentation: the example outputs in docs are verified against the code (as today), the migration guide is run against `tests/fixtures/schemas`.

## 8. Risks

- **The size of 2.0.** Mitigation: the order A → B → C → D1, every workstream a separate PR with a bench; the decision to move `union`/`pattern`/`Infer` into 2.0.x is taken on the facts.
- **The size budget.** JSON Schema and union may push `index` past 8 KB; the budget is revised by measurement, the JIT always stays a separate entry. *Revised:* 2.0 is at 12.6 KB with a 13 KB gate (§5.8 status).
- **JIT and security.** Generated code never contains values from a schema other than through JSON quoting/scope; injection tests are mandatory; `new Function` is never called without an explicit `compile()`.
- **Reference semantics (B6).** The most "conceptual" change; write it up as a separate ADR paragraph in the docs with stored/memory kind examples before implementing.
- **Compatibility with upstream ports.** After 2.0, porting metarhia fixes becomes even more manual (CLAUDE.md "Upstream sync"); this is a conscious price.
