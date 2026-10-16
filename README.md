# metaschema

[![npm](https://img.shields.io/npm/v/%40alexify%2Fmetaschema)](https://www.npmjs.com/package/@alexify/metaschema)
[![CI](https://github.com/Alexis-Technologies/metaschema/actions/workflows/ci.yml/badge.svg)](https://github.com/Alexis-Technologies/metaschema/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/%40alexify%2Fmetaschema)](#installation)
[![dependencies](https://img.shields.io/badge/runtime_dependencies-0-brightgreen)](#why-metaschema)
[![docs](https://img.shields.io/badge/docs-online-blue)](https://metaschema.vercel.app/)
[![license](https://img.shields.io/npm/l/%40alexify%2Fmetaschema)](./LICENSE)

**Fast, zero-dependency metadata schema and interface definition language for JavaScript.**
Declare data structures and domain models once as plain objects; validate and parse data against
them at tens of millions of checks a second, with every problem returned as data; and generate
TypeScript types and JSON Schema from the same definitions. Node.js and browsers.

```js
const { Schema } = require('@alexify/metaschema');

const user = new Schema('User', {
  name: { first: 'string', last: 'string' },
  email: { type: 'string', length: { min: 5, max: 64 } },
  age: '?number',
  roles: { array: { enum: ['admin', 'editor', 'viewer'] } },
});

const result = user.check({ name: { first: 'Marcus' }, email: 'm@r', roles: ['owner'] });

result.errors;
// [
//   'Field "User.name.last" is required',
//   'Field "User.email" value is too short',
//   'Field "User.roles[0]" value is not of enum: admin, editor, viewer'
// ]

result.issues;
// [
//   { code: 'required', path: ['name', 'last'], message: 'is required', params: {} },
//   { code: 'length', path: ['email'], message: 'value is too short', params: { min: 5, max: 64, actual: 3 } },
//   { code: 'enum', path: ['roles', 0], message: 'value is not of enum: admin, editor, viewer', params: { values: ['admin', 'editor', 'viewer'] } }
// ]

const event = Schema.from({
  name: 'string',
  'level?': { type: 'integer', default: 1 },
  when: { type: 'string', parse: (text) => new Date(text) },
});
event.parse({ name: 'deploy', when: '2026-10-10T12:00:00.000Z' }).value;
// { name: 'deploy', when: 2026-10-10T12:00:00.000Z, level: 1 }
```

### 📖 [Read the documentation →](https://metaschema.vercel.app/)

## Why metaschema

- **Compact syntax.** `'?string'` is an optional string, `'tags?'` an optional key,
  `{ array: 'number' }` an array, `['number', 'number']` a tuple, `'Company'` a reference. The
  long form (`{ type: 'string', length: [3, 32] }`) is there when a field needs options.
- **Errors, not exceptions.** `check` walks the whole value and returns every problem as data:
  a code, the path as an array of keys, the params it was made from, and a message rendered through
  a locale (English built in, `@alexify/metaschema/locales/uk` shipped). Only a broken definition
  throws.
- **Parse, not only a verdict.** `parse` runs the same check and gives the value of the program:
  defaults filled in, unknown keys stripped on request, a field's `parse` function decoding its
  value (a date-time string into a `Date`) and `serialize` the way back; `checkAsync` and
  `parseAsync` await validators and decoders that return promises.
- **String formats.** `{ type: 'string', format: 'email' }` is a rule beside `length` and
  `pattern`; `@alexify/metaschema/formats` registers 35 formats (`uuid`, `ulid`, `jwt`,
  `email`, `date-time`, `duration`, `ipv4`, `cidrv6`, `url`, `json-pointer`, `e164`, `iban`,
  `base64`, `semver`, …) and your own, and the name travels into JSON Schema, samples and
  inference.
- **Coercion.** `parse` with `coerce: true` (a call, a schema or a field) converts the text of a
  query string, a form or a CSV row to the types of the fields before the check (`'42'` to a
  number, an ISO string to a `Date`), strictly and never in `check`; `coerce()` of
  `@alexify/metaschema/coerce` is that step alone.
- **Deriving schemas.** `pick`, `omit`, `partial` (`deep` too), `required`, `extend` and `keyof`
  of `@alexify/metaschema/derive` make the create and update bodies and the views of an entity
  from the entity, typed by its definition.
- **MongoDB.** `@alexify/metaschema/mongodb` is the schema side of Mongoose without the driver
  dependency: BSON types, `_id` and ObjectId references written and read back, the indexes and
  the collection validator of a model, and the driver's updates checked against the schema.
- **Records and streams.** `checkEach` and `parseEach` of `@alexify/metaschema/stream` run a
  schema over an iterable of records, lazily and in order, yielding `{ index, record, result }`
  for each; the async pair keeps `concurrency` records in flight over a sync or async source,
  and `transform` is a `TransformStream` that lets the valid records through and reports the
  others.
- **Domain models.** Entities, registries, dictionaries and projections, with references,
  relations and indexes, ordered by dependency and checked for missing references.
- **TypeScript.** `InferSchema<typeof schema>` is the type of a value the schema accepts,
  computed from the definition with nothing generated, and a model renders its entities as
  interfaces. The package ships hand-written typings for its own API.
- **Standard Schema.** Every schema implements [Standard Schema v1](https://standardschema.dev)
  (`schema['~standard']`, which is `parse`), so tRPC, TanStack Form, Hono and any other consumer
  of the interface take it as they take a zod or valibot schema.
- **JSON Schema.** `toJSONSchema` renders a schema or a whole model as JSON Schema draft 2020-12
  or draft-07, an OpenAPI 3.0 schema object or a MongoDB `$jsonSchema`, with a strict profile for
  LLM structured outputs; `~standard.jsonSchema` is the Standard JSON Schema converter. The
  generators live in the `@alexify/metaschema/generators` subpath, so a program that only
  validates does not carry them.
- **Fast.** Every check is compiled into a closure on its first use and runs in a context
  of its own: about 10 million validations a second of a flat struct on Node 24, and about 30
  million through the JIT backend of `@alexify/metaschema/compile`, which generates the same
  check where `new Function` is allowed and keeps the closures where it is not. Against ten other
  validators see [Benchmarks](#benchmarks); how the core gets there is on the
  [Performance](https://metaschema.vercel.app/guide/performance) page.
- **The model as data.** `model.toJSON()` is a snapshot other programs read the model through
  (a migration tool, an introspecting service, a committed baseline), `schema.toSnapshot()` the
  same document for one schema and the entities it reaches (a codec built from it), with the
  guarantees of format 1 written down, and
  `@alexify/metaschema/model` tells two versions apart (`diff`), classifies the change by the
  Confluent rules (`compatibility`), draws a value every schema accepts (`sample`), unifies two
  schemas (`merge`) and infers a definition from the values that exist (`infer`); `aliases` and
  `deprecated` let a model carry its history, and `fromJSONSchema` of the generators reads a
  JSON Schema document back.
- **Zero dependencies, 21.3 KB min+gzip.** CommonJS with ESM named imports, no build step,
  one package for Node.js and browsers; the generators add 7.7 KB, the JIT backend 4.3 KB, the
  model tools 12.7 KB, the record tools 0.9 KB, the string formats 3.9 KB, the derive tools
  2.2 KB, the converters of coercion 1.9 KB and the MongoDB tools 3.6 KB (on top of the
  converters, which they require) where they are imported. A program that reads schemas
  without validating them (a client that encodes from their snapshots) imports
  `@alexify/metaschema/definition`, the half of the core that builds them: 10.3 KB.

## Benchmarks

metaschema on its two backends beside Metarhia's metaschema, Zod, Valibot, ArkType, Effect
Schema, TypeBox, Ajv, Yup, Joi and Superstruct: the object of the moltar suite in its four modes,
every issue of an invalid value and building a schema, each library in a fresh process and
checked for the right verdicts before it is timed. On the JIT metaschema validates 30 to 48
million objects a second, and in the strict modes (unknown keys rejected) only TypeBox's compiler
is faster; on its closures, with no `eval` at all, 4.6 to 9.8 million, ahead of every
interpreter in the set. Asked for every issue of an invalid value with its path, it is second
only to Ajv, and 6 to 100 times faster than the other TypeScript-first validators; a cold start
(load, build, first check) takes 5.7 ms.

<!-- bench:compare:start -->
<!-- generated by `pnpm bench:report` from bench/results — edit the results, not this block -->

<img src="https://metaschema.vercel.app/benchmarks/compare-nested-parseStrict.svg" alt="Nested object, parseStrict: A valid object of 6 fields and a nested object of 3. parseStrict: unknown keys rejected, the value returned. ops/s, log scale, higher is better." width="760" />

<details>
<summary>9 more scenarios</summary>

<img src="https://metaschema.vercel.app/benchmarks/compare-flat-parseSafe.svg" alt="Flat object, parseSafe: A valid object of 6 fields. parseSafe: unknown keys allowed, the value returned. ops/s, log scale, higher is better. Not shown, the mode cannot be expressed: Metarhia metaschema." width="760" />

<img src="https://metaschema.vercel.app/benchmarks/compare-flat-parseStrict.svg" alt="Flat object, parseStrict: A valid object of 6 fields. parseStrict: unknown keys rejected, the value returned. ops/s, log scale, higher is better." width="760" />

<img src="https://metaschema.vercel.app/benchmarks/compare-flat-assertLoose.svg" alt="Flat object, assertLoose: A valid object of 6 fields. assertLoose: unknown keys allowed, the verdict only. ops/s, log scale, higher is better. Not shown, the mode cannot be expressed: Metarhia metaschema." width="760" />

<img src="https://metaschema.vercel.app/benchmarks/compare-flat-assertStrict.svg" alt="Flat object, assertStrict: A valid object of 6 fields. assertStrict: unknown keys rejected, the verdict only. ops/s, log scale, higher is better." width="760" />

<img src="https://metaschema.vercel.app/benchmarks/compare-nested-parseSafe.svg" alt="Nested object, parseSafe: A valid object of 6 fields and a nested object of 3. parseSafe: unknown keys allowed, the value returned. ops/s, log scale, higher is better. Not shown, the mode cannot be expressed: Metarhia metaschema." width="760" />

<img src="https://metaschema.vercel.app/benchmarks/compare-nested-assertLoose.svg" alt="Nested object, assertLoose: A valid object of 6 fields and a nested object of 3. assertLoose: unknown keys allowed, the verdict only. ops/s, log scale, higher is better. Not shown, the mode cannot be expressed: Metarhia metaschema." width="760" />

<img src="https://metaschema.vercel.app/benchmarks/compare-nested-assertStrict.svg" alt="Nested object, assertStrict: A valid object of 6 fields and a nested object of 3. assertStrict: unknown keys rejected, the verdict only. ops/s, log scale, higher is better." width="760" />

<img src="https://metaschema.vercel.app/benchmarks/compare-invalid.svg" alt="Every issue of an invalid value: The nested object with four wrong fields, unknown keys rejected; every issue collected with its path. ops/s, log scale, higher is better." width="760" />

<img src="https://metaschema.vercel.app/benchmarks/compare-build.svg" alt="Build a schema: The strict nested schema built from its definition, ready to check. schemas/s, log scale, higher is better." width="760" />

</details>

| Library | Flat object, parseSafe<br><sub>ops/s</sub> | Flat object, parseStrict<br><sub>ops/s</sub> | Flat object, assertLoose<br><sub>ops/s</sub> | Flat object, assertStrict<br><sub>ops/s</sub> | Nested object, parseSafe<br><sub>ops/s</sub> | Nested object, parseStrict<br><sub>ops/s</sub> | Nested object, assertLoose<br><sub>ops/s</sub> | Nested object, assertStrict<br><sub>ops/s</sub> | Every issue of an invalid value<br><sub>ops/s</sub> | Build a schema<br><sub>schemas/s</sub> |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **metaschema**<br><sub>check() · compile(), JIT · v3.3.0</sub> | 48,400,000 | 38,900,000 | 49,700,000 | 40,800,000 | 42,000,000 | 29,900,000 | 44,100,000 | 30,300,000 | 6,650,000 | 32,300 |
| **metaschema**<br><sub>check() · closures · v3.3.0</sub> | 9,430,000 | 9,020,000 | 10,000,000 | 9,200,000 | 5,100,000 | 4,810,000 | 5,090,000 | 4,750,000 | 3,000,000 | 190,000 |
| Metarhia metaschema<br><sub>check() · strict only · v2.2.2</sub> | — | 958,000 | — | 959,000 | — | 550,000 | — | 546,000 | 428,000 | 282,000 |
| Zod<br><sub>safeParse() · v4.6.6</sub> | 26,500,000 | 12,800,000 | 27,800,000 | 12,700,000 | 16,700,000 | 7,340,000 | 16,900,000 | 7,160,000 | 445,000 | 82,100 |
| Valibot<br><sub>safeParse() · is() · v1.5.0</sub> | 3,570,000 | 2,950,000 | 3,620,000 | 3,010,000 | 2,130,000 | 1,800,000 | 2,080,000 | 1,780,000 | 1,150,000 | 2,050,000 |
| ArkType<br><sub>type(value) · allows() · v2.2.8</sub> | 50,500,000 | 7,400,000 | 171,000,000 | 8,640,000 | 38,100,000 | 4,020,000 | 134,000,000 | 4,430,000 | 68,000 | 14,600 |
| Effect Schema<br><sub>decodeUnknownResult() · is() · v4.0.3</sub> | 4,200,000 | 1,970,000 | 4,220,000 | 1,980,000 | 2,310,000 | 1,000,000 | 2,310,000 | 1,000,000 | 359,000 | 672,000 |
| TypeBox<br><sub>Compile(…).Check() · v1.3.36</sub> | 165,000,000 | 79,900,000 | 188,000,000 | 83,700,000 | 119,000,000 | 43,200,000 | 136,000,000 | 43,800,000 | 90,600 | 36,200 |
| TypeBox<br><sub>Value.Check() · v1.3.36</sub> | 263,000 | 191,000 | 264,000 | 192,000 | 170,000 | 118,000 | 167,000 | 114,000 | 89,400 | 422,000 |
| Ajv<br><sub>compile(…)(value), draft 2020-12 · v8.20.0</sub> | 65,700,000 | 34,600,000 | 71,900,000 | 35,300,000 | 51,500,000 | 23,500,000 | 55,400,000 | 24,100,000 | 15,000,000 | 1,840 |
| Yup<br><sub>validateSync() · isValidSync(), strict · v1.7.1</sub> | 313,000 | 298,000 | 314,000 | 295,000 | 184,000 | 175,000 | 185,000 | 168,000 | 11,800 | 53,900 |
| Joi<br><sub>validate(), convert: false · v18.2.9</sub> | 851,000 | 843,000 | 834,000 | 855,000 | 534,000 | 543,000 | 535,000 | 525,000 | 257,000 | 37,400 |
| Superstruct<br><sub>validate() · is() · v2.0.2</sub> | 492,000 | 453,000 | 496,000 | 443,000 | 304,000 | 266,000 | 299,000 | 257,000 | 100,000 | 1,770,000 |

_Apple M3 Max · 16 cores · Node v24.14.1 · median of 5 × 1 s samples, each library in a fresh process · 2026-10-13. Medians, rounded to three significant figures; — where the library cannot express the mode._

<!-- bench:compare:end -->

How to read these numbers and the method behind them are on the
[Benchmarks](https://metaschema.vercel.app/guide/benchmarks) page, where the charts are
interactive.

### Cold start

<!-- bench:coldstart:start -->
<!-- generated by `pnpm bench:report` from bench/results — edit the results, not this block -->

<img src="https://metaschema.vercel.app/benchmarks/coldstart.svg" alt="Cold start: Load the library, build the strict nested schema, check one value: a fresh process, median of 20 runs. Lower is better." width="760" />

| Library | Load | Build | First check | Total |
| --- | ---: | ---: | ---: | ---: |
| Superstruct<br><sub>validate() · is() · v2.0.2</sub> | 0.7 ms | 0.2 ms | 0.3 ms | 1.2 ms |
| Valibot<br><sub>safeParse() · is() · v1.5.0</sub> | 3.7 ms | 0.1 ms | 0.1 ms | 3.9 ms |
| Yup<br><sub>validateSync() · isValidSync(), strict · v1.7.1</sub> | 2.4 ms | 1.1 ms | 0.7 ms | 4.2 ms |
| **metaschema**<br><sub>check() · closures · v3.3.0</sub> | 4.7 ms | 1.0 ms | 0.4 ms | 6.1 ms |
| **metaschema**<br><sub>check() · compile(), JIT · v3.3.0</sub> | 5.9 ms | 1.7 ms | 0.2 ms | 7.8 ms |
| Metarhia metaschema<br><sub>check() · strict only · v2.2.2</sub> | 20.7 ms | 0.6 ms | 0.2 ms | 21.5 ms |
| Joi<br><sub>validate(), convert: false · v18.2.9</sub> | 23.1 ms | 1.2 ms | 0.6 ms | 25.0 ms |
| Zod<br><sub>safeParse() · v4.6.6</sub> | 27.7 ms | 1.5 ms | 1.2 ms | 30.3 ms |
| Ajv<br><sub>compile(…)(value), draft 2020-12 · v8.20.0</sub> | 14.6 ms | 24.4 ms | 0.2 ms | 39.3 ms |
| Effect Schema<br><sub>decodeUnknownResult() · is() · v4.0.3</sub> | 72.4 ms | 0.2 ms | 0.8 ms | 73.4 ms |
| TypeBox<br><sub>Value.Check() · v1.3.36</sub> | 96.6 ms | 0.1 ms | 1.1 ms | 97.8 ms |
| TypeBox<br><sub>Compile(…).Check() · v1.3.36</sub> | 96.9 ms | 1.9 ms | 0.0 ms | 98.9 ms |
| ArkType<br><sub>type(value) · allows() · v2.2.8</sub> | 107.8 ms | 1.4 ms | 0.1 ms | 109.3 ms |

<!-- bench:coldstart:end -->

### Bundle size

<!-- bench:size:start -->
<!-- generated by `pnpm bench:report` from bench/results — edit the results, not this block -->

<img src="https://metaschema.vercel.app/benchmarks/size.svg" alt="Bundle size: A browser bundle that builds the strict nested schema and checks a value (esbuild, minified, tree-shaken), min+gzip. Lower is better." width="760" />

| Library | min | min+gzip |  |
| --- | ---: | ---: | --- |
| Valibot<br><sub>safeParse() · is() · v1.5.0</sub> | 3.3 KB | 1.2 KB |  |
| Superstruct<br><sub>validate() · is() · v2.0.2</sub> | 3.5 KB | 1.5 KB |  |
| Metarhia metaschema<br><sub>check() · strict only · v2.2.2</sub> | 30.0 KB | 11.0 KB | minified with keepNames: its checks compare constructor names |
| Yup<br><sub>validateSync() · isValidSync(), strict · v1.7.1</sub> | 41.4 KB | 13.2 KB |  |
| **metaschema**<br><sub>check() · closures · v3.3.0</sub> | 52.6 KB | 18.9 KB |  |
| **metaschema**<br><sub>check() · compile(), JIT · v3.3.0</sub> | 65.2 KB | 23.1 KB |  |
| Effect Schema<br><sub>decodeUnknownResult() · is() · v4.0.3</sub> | 72.9 KB | 24.4 KB |  |
| Zod<br><sub>safeParse() · v4.6.6</sub> | 88.4 KB | 25.7 KB |  |
| TypeBox<br><sub>Value.Check() · v1.3.36</sub> | 146.7 KB | 37.5 KB |  |
| Ajv<br><sub>compile(…)(value), draft 2020-12 · v8.20.0</sub> | 130.9 KB | 39.5 KB |  |
| TypeBox<br><sub>Compile(…).Check() · v1.3.36</sub> | 161.5 KB | 40.8 KB |  |
| ArkType<br><sub>type(value) · allows() · v2.2.8</sub> | 151.9 KB | 46.4 KB |  |
| Joi<br><sub>validate(), convert: false · v18.2.9</sub> | 169.5 KB | 53.3 KB |  |

<!-- bench:size:end -->

### Release over release

<!-- bench:releases:start -->
<!-- generated by `pnpm bench:report` from bench/results — edit the results, not this block -->

<img src="https://metaschema.vercel.app/benchmarks/speedup.svg" alt="metaschema 3.3.0 against Metarhia's metaschema 2.2.2: How many times faster, scenario by scenario (1 = as fast). Higher is better." width="760" />

<details>
<summary>Every release, scenario by scenario</summary>

<img src="https://metaschema.vercel.app/benchmarks/releases-nested-valid.svg" alt="check — nested struct, valid, release over release: ops/s, linear scale, higher is better. The same harness and machine for every release." width="760" />

<img src="https://metaschema.vercel.app/benchmarks/releases-from-flat.svg" alt="Schema.from — flat struct, release over release: schemas/s, linear scale, higher is better. The same harness and machine for every release." width="760" />

<img src="https://metaschema.vercel.app/benchmarks/releases-from-nested.svg" alt="Schema.from — nested struct, release over release: schemas/s, linear scale, higher is better. The same harness and machine for every release." width="760" />

<img src="https://metaschema.vercel.app/benchmarks/releases-flat-valid.svg" alt="check — flat struct, valid, release over release: ops/s, linear scale, higher is better. The same harness and machine for every release." width="760" />

<img src="https://metaschema.vercel.app/benchmarks/releases-flat-invalid.svg" alt="check — flat struct, invalid, release over release: ops/s, linear scale, higher is better. The same harness and machine for every release." width="760" />

<img src="https://metaschema.vercel.app/benchmarks/releases-nested-invalid.svg" alt="check — nested struct, invalid, release over release: ops/s, linear scale, higher is better. The same harness and machine for every release." width="760" />

</details>

| Scenario | Metarhia 2.2.2 | 1.0.0 | 2.0.0 | 3.0.0 | 3.0.0<br><sub>JIT</sub> | 3.1.0 | 3.1.0<br><sub>JIT</sub> | 3.2.0 | 3.2.0<br><sub>JIT</sub> | 3.3.0 | 3.3.0<br><sub>JIT</sub> |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Schema.from — flat struct | 581,000 | 321,000 | 362,000 | 372,000 | — | 367,000 | — | 356,000 | — | 332,000 | — |
| Schema.from — nested struct | 156,000 | 95,600 | 104,000 | 99,000 | — | 98,400 | — | 98,600 | — | 91,100 | — |
| check — flat struct, valid | 1,440,000 | 2,180,000 | 10,800,000 | 10,700,000 | 38,600,000 | 11,700,000 | 37,900,000 | 11,600,000 | 37,900,000 | 11,600,000 | 38,200,000 |
| check — flat struct, invalid | 1,010,000 | 1,110,000 | 4,020,000 | 3,940,000 | 6,130,000 | 3,880,000 | 6,170,000 | 3,900,000 | 6,160,000 | 3,850,000 | 6,240,000 |
| check — nested struct, valid | 238,000 | 368,000 | 2,950,000 | 2,930,000 | 19,700,000 | 2,920,000 | 19,600,000 | 2,910,000 | 19,700,000 | 2,910,000 | 19,700,000 |
| check — nested struct, invalid | 222,000 | 300,000 | 1,570,000 | 1,580,000 | 2,140,000 | 1,570,000 | 2,110,000 | 1,570,000 | 2,110,000 | 1,590,000 | 2,120,000 |

_Apple M3 Max · 16 cores · Node v24.14.1 · median of 5 × 1 s samples, each release in a fresh process · 2026-10-13. ops/s (schemas/s for `Schema.from`), medians._

<!-- bench:releases:end -->

### metaschema on its two backends

<!-- bench:engine:start -->
<!-- generated by `pnpm bench:report` from bench/results — edit the results, not this block -->

<img src="https://metaschema.vercel.app/benchmarks/engine.svg" alt="metaschema on its two backends: pnpm bench: ops/s, log scale, higher is better." width="760" />

<!-- bench:engine:end -->

## Compared with alternatives

metaschema against twenty alternatives in four directions: TypeScript-first validators, JSON
Schema validators and compilers, interface definition languages built for schema evolution, and
an ODM. Every cell was checked against the source of the published package (October 2026), not
its README; the [comparison page](https://metaschema.vercel.app/guide/comparison) has the method,
what the table shows and where each library fits, in a table you can scroll with the features
pinned.

<!-- comparison:start -->
<!-- generated by `pnpm docs:comparison` from docs/comparison.json — edit the data, not this block -->

<div class="ms-matrix">

<table>
<thead>
<tr>
<th>Feature</th>
<th><a href="https://github.com/Alexis-Technologies/metaschema">metaschema</a><br><sub>schemas + IDL</sub></th>
<th><a href="https://github.com/metarhia/metaschema">Metarhia metaschema</a><br><sub>IDL, the original</sub></th>
<th><a href="https://github.com/colinhacks/zod">Zod</a><br><sub>TS-first</sub></th>
<th><a href="https://github.com/open-circle/valibot">Valibot</a><br><sub>TS-first</sub></th>
<th><a href="https://github.com/arktypeio/arktype">ArkType</a><br><sub>TS-first</sub></th>
<th><a href="https://github.com/Effect-TS/effect">Effect Schema</a><br><sub>TS-first</sub></th>
<th><a href="https://github.com/ianstormtaylor/superstruct">Superstruct</a><br><sub>TS-first</sub></th>
<th><a href="https://github.com/gcanti/io-ts">io-ts</a><br><sub>TS-first</sub></th>
<th><a href="https://github.com/runtypes/runtypes">Runtypes</a><br><sub>TS-first</sub></th>
<th><a href="https://github.com/davidmdm/myzod">myzod</a><br><sub>TS-first</sub></th>
<th><a href="https://github.com/badrap/valita">Valita</a><br><sub>TS-first</sub></th>
<th><a href="https://github.com/jquense/yup">Yup</a><br><sub>validator</sub></th>
<th><a href="https://github.com/hapijs/joi">Joi</a><br><sub>validator</sub></th>
<th><a href="https://github.com/vinejs/vine">VineJS</a><br><sub>validator</sub></th>
<th><a href="https://github.com/typestack/class-validator">class-validator</a><br><sub>decorators</sub></th>
<th><a href="https://github.com/ajv-validator/ajv">Ajv</a><br><sub>JSON Schema</sub></th>
<th><a href="https://github.com/sinclairzx81/typebox">TypeBox</a><br><sub>JSON Schema</sub></th>
<th><a href="https://github.com/samchon/typia">typia</a><br><sub>AOT compiler</sub></th>
<th><a href="https://github.com/mtth/avsc">avsc</a><br><sub>IDL · Avro</sub></th>
<th><a href="https://github.com/protobufjs/protobuf.js">protobuf.js</a><br><sub>IDL · Protobuf</sub></th>
<th><a href="https://github.com/Automattic/mongoose">Mongoose</a><br><sub>ODM</sub></th>
</tr>
</thead>
<tbody>
<tr class="ms-matrix-group"><td colspan="22"><strong>Package</strong></td></tr>
<tr><td>Version compared</td><td>3.4.0</td><td>2.2.2</td><td>4.6.6</td><td>1.5.0</td><td>2.2.8</td><td>4.0.3</td><td>2.0.2<sup>1</sup></td><td>2.2.22</td><td>7.0.5</td><td>1.12.1<sup>2</sup></td><td>0.5.5</td><td>1.7.1</td><td>18.2.9</td><td>4.4.0</td><td>0.15.1</td><td>8.20.0</td><td>1.3.36<sup>3</sup></td><td>15.1.0</td><td>5.7.9</td><td>8.8.1</td><td>9.11.1</td></tr>
<tr><td>Latest release</td><td>2026-10 (this release)</td><td>2025-05</td><td>2026-10</td><td>2026-09</td><td>2026-10</td><td>2026-10</td><td>2024-07</td><td>2024-12</td><td>2026-08</td><td>2025-02</td><td>2026-10</td><td>2025-09</td><td>2026-09</td><td>2026-04</td><td>2026-02</td><td>2026-04</td><td>2026-10</td><td>2026-10</td><td>2025-07</td><td>2026-10</td><td>2026-10</td></tr>
<tr><td>Runtime dependencies</td><td>✅ 0</td><td>2: metautil, metavm</td><td>✅ 0</td><td>✅ 0</td><td>3: @ark/schema, @ark/util, arkregex</td><td>✅ 0</td><td>✅ 0</td><td>0 + peer fp-ts</td><td>✅ 0</td><td>✅ 0</td><td>✅ 0</td><td>4: property-expr, tiny-case, toposort, type-fest</td><td>7 (@hapi/*, …)</td><td>10 (validator.js, dayjs, …)</td><td>3 (validator.js, libphonenumber-js, …)</td><td>4</td><td>✅ 0</td><td>3: randexp, @typia/interface, @typia/utils</td><td>✅ 0</td><td>1: long</td><td>7, incl. mongodb driver</td></tr>
<tr><td>License</td><td>MIT</td><td>MIT</td><td>MIT</td><td>MIT</td><td>MIT</td><td>MIT</td><td>MIT</td><td>MIT</td><td>MIT</td><td>MIT</td><td>MIT</td><td>MIT</td><td>BSD-3-Clause</td><td>MIT</td><td>MIT</td><td>MIT</td><td>MIT</td><td>MIT</td><td>MIT</td><td>BSD-3-Clause</td><td>MIT</td></tr>
<tr class="ms-matrix-group"><td colspan="22"><strong>Runtime</strong></td></tr>
<tr><td>Runs on</td><td>✅ Node 18+, browsers, edge</td><td>⚠️ Node; browsers via bundler<sup>4</sup></td><td>✅ Node, browsers, Deno, Bun, edge</td><td>✅ Node, browsers, Deno, Bun, edge</td><td>✅ Node, browsers, Deno, Bun, edge</td><td>✅ Node, browsers, Deno, Bun, edge</td><td>✅ Node ≥14, browsers, edge</td><td>✅ Node, browsers, edge</td><td>✅ Node, Deno (JSR), browsers, edge</td><td>⚠️ Node; browsers/edge via a bundler</td><td>✅ Node ≥22, Deno (JSR), browsers, edge</td><td>✅ Node, browsers, Deno, Bun, edge</td><td>⚠️ Node ≥ 20; browsers via a separate bundle<sup>5</sup></td><td>⚠️ Node, Bun, Deno; browsers if eval is allowed<sup>6</sup></td><td>✅ Node, browsers, Deno, Bun, edge</td><td>⚠️ Node, browsers; CSP/edge need standalone<sup>7</sup></td><td>✅ Node, browsers, Deno, Bun, edge</td><td>✅ generated JS runs anywhere</td><td>⚠️ Node; browsers need polyfills<sup>8</sup></td><td>⚠️ Node, browsers, Deno, Bun</td><td>⚠️ Node ≥ 20.19; browser: @mongoosejs/browser<sup>9</sup></td></tr>
<tr><td>Module format</td><td>CJS, ESM named imports</td><td>CJS</td><td>ESM + CJS</td><td>ESM + CJS</td><td>ESM</td><td>ESM</td><td>ESM + CJS</td><td>CJS + ESM (module field)</td><td>ESM + CJS</td><td>CJS</td><td>ESM</td><td>ESM + CJS</td><td>CJS</td><td>ESM</td><td>ESM + CJS</td><td>CJS</td><td>ESM</td><td>ESM + CJS</td><td>CJS</td><td>CJS (+ UMD dist)</td><td>CJS</td></tr>
<tr><td>Works without eval (strict CSP, edge)</td><td>✅ closures; JIT opt-in, falls back</td><td>✅ never (validation)</td><td>⚠️ object JIT by default; auto fallback<sup>10</sup></td><td>✅ never</td><td>⚠️ JIT by default; auto jitless under CSP</td><td>✅ never by default (JIT opt-in)</td><td>✅ never</td><td>✅ never</td><td>✅ never</td><td>✅ never</td><td>✅ never</td><td>✅ never</td><td>✅ never</td><td>❌ new AsyncFunction per schema</td><td>✅ never</td><td>⚠️ new Function; standalone precompile</td><td>⚠️ Compile evals, falls back; Value never</td><td>✅ code is generated at build time</td><td>❌ needs new Function</td><td>⚠️ reflection evals; static code not</td><td>✅ never (validation)</td></tr>
<tr><td>Works without a build step</td><td>✅ plain JS</td><td>✅ plain JS</td><td>✅ plain JS</td><td>✅ plain JS</td><td>✅ plain JS</td><td>✅ plain JS</td><td>✅ plain JS</td><td>✅ plain JS</td><td>✅ plain JS</td><td>✅ plain JS</td><td>✅ plain JS</td><td>✅ plain JS</td><td>✅ plain JS</td><td>✅ plain JS</td><td>⚠️ legacy TS decorators, or by hand<sup>11</sup></td><td>✅ plain JS; standalone optional</td><td>✅ plain JS</td><td>❌ requires ttsc transform (TypeScript 7)<sup>12</sup></td><td>✅ plain JS</td><td>⚠️ optional pbjs codegen</td><td>✅ plain JS</td></tr>
<tr class="ms-matrix-group"><td colspan="22"><strong>Defining schemas</strong></td></tr>
<tr><td>How a schema is written</td><td>plain object: <code>'?string'</code>, <code>{ array: 'number' }</code></td><td>plain object literal ('?string', kind key)</td><td>builder / method chain (zod/mini: functional)</td><td>functions + pipe()</td><td>TS-syntax strings in object literals + chaining</td><td>builder values: Schema.Struct({...}).pipe/.check</td><td>function combinators: object({ a: string() })</td><td>codec combinators: t.type({ a: t.string })</td><td>runtype values: Object({ a: String })</td><td>builder chain: myzod.object({ a: myzod.string() })</td><td>builder chain: v.object({ a: v.string() })</td><td>builder / method chain</td><td>builder / method chain</td><td>builder / method chain (mutable)</td><td>decorators on classes</td><td>JSON Schema or JTD document</td><td>builder (Type.Object…); TS-syntax strings via Type.Script</td><td>TS types + transformer; type tags</td><td>Avro schema JSON (.avsc) or IDL</td><td>.proto IDL or JSON descriptor</td><td>Mongoose Schema (SchemaType options)</td></tr>
<tr><td>The definition is data (store, send, rebuild)</td><td>✅ plain objects (functions aside)</td><td>✅ plain objects (functions aside)</td><td>⚠️ via toJSONSchema / fromJSONSchema</td><td>❌ export only (@valibot/to-json-schema)</td><td>✅ string/object defs; .json IR</td><td>✅ SchemaRepresentation.toJson / fromJson</td><td>❌ no</td><td>❌ no</td><td>❌ no</td><td>❌ no</td><td>❌ no</td><td>❌ describe() is one-way</td><td>✅ describe() ↔ Joi.build()</td><td>❌ toJSON() holds functions</td><td>❌ registerSchema() is broken<sup>13</sup></td><td>✅ JSON Schema / JTD documents</td><td>✅ types are JSON Schema objects</td><td>⚠️ only via json.schema + @typia/utils</td><td>✅ Avro JSON schema</td><td>✅ JSON descriptors</td><td>⚠️ via toJSONSchema() only</td></tr>
<tr><td>Optional vs nullable</td><td>✅ <code>'?x'</code>, <code>'key?'</code>, <code>nullable: true</code></td><td>⚠️ '?type' = absent/undefined/null</td><td>✅ optional, exactOptional, nullable, nullish</td><td>✅ optional, exactOptional, nullable, nullish, undefinedable</td><td>✅ 'key?' (no undefined), '| null', '| undefined'</td><td>✅ optionalKey, optional, NullOr, UndefinedOr, NullishOr</td><td>✅ optional(), nullable()</td><td>✅ t.partial vs t.union([X, t.null])</td><td>✅ optional(), nullable(), undefinedable()</td><td>✅ optional(), nullable()</td><td>✅ optional(), nullable()</td><td>✅ optional() / nullable() / defined()</td><td>✅ optional default; allow(null); required()</td><td>⚠️ optional() also accepts null<sup>14</sup></td><td>⚠️ IsOptional() skips null and undefined</td><td>✅ <code>required</code> vs type null / <code>nullable</code></td><td>✅ Optional, Union with Null, Undefined</td><td>✅ TS <code>?:</code>, <code>| null</code>, <code>| undefined</code></td><td>⚠️ ['null', T] union; absent needs default</td><td>⚠️ presence only; null = unset</td><td>⚠️ optional = absent/undefined/null</td></tr>
<tr><td>Unions, discriminated</td><td>✅ <code>union</code>, <code>discriminator</code></td><td>❌ none</td><td>✅ union, discriminatedUnion, xor</td><td>✅ union, variant (discriminated)</td><td>✅ 'a | b', .or(); auto-discriminated</td><td>✅ Union, Literals, TaggedUnion</td><td>⚠️ union(); no discriminated union</td><td>✅ union(), tag detected automatically</td><td>⚠️ Union(...); no discriminator</td><td>⚠️ union([..]) / or(); no discriminator</td><td>✅ union(), auto-discriminated</td><td>❌ no union type</td><td>✅ alternatives(); conditional() switch</td><td>✅ union() with if(), unionOfTypes()</td><td>⚠️ class-transformer discriminator</td><td>✅ anyOf / oneOf; <code>discriminator</code> opt-in</td><td>✅ Type.Union (anyOf); no discriminator</td><td>✅ TS unions; discriminant detected</td><td>✅ unions; wrapped = tagged by name</td><td>✅ oneof (virtual discriminator)</td><td>✅ Schema.Types.Union; discriminators</td></tr>
<tr><td>Tuples</td><td>✅ <code>['number', 'string']</code></td><td>⚠️ array shorthand, scalars only</td><td>✅ z.tuple with rest</td><td>✅ tuple, strictTuple, tupleWithRest</td><td>✅ ['string', 'number'], variadic '...'</td><td>✅ Tuple, TupleWithRest</td><td>✅ tuple([..])</td><td>⚠️ tuple([..]) strips extra items<sup>15</sup></td><td>✅ Tuple(...), with Spread rest</td><td>✅ tuple([..])</td><td>✅ tuple([..]), variadic via concat<sup>16</sup></td><td>✅ tuple()</td><td>✅ array().ordered()</td><td>✅ vine.tuple()</td><td>❌ none</td><td>✅ prefixItems + items: false</td><td>✅ Type.Tuple</td><td>✅ TS tuples</td><td>❌ none</td><td>❌ none</td><td>❌ none</td></tr>
<tr><td>Recursive schemas</td><td>✅ by name, a schema its own without a model; cycles tracked</td><td>✅ by entity name in a Model</td><td>✅ getters or z.lazy</td><td>✅ v.lazy</td><td>✅ scope names, 'this'</td><td>✅ Schema.suspend</td><td>✅ lazy(() =&gt; S)</td><td>✅ t.recursion(name, f)</td><td>✅ Lazy(() =&gt; R)</td><td>✅ lazy(() =&gt; S)</td><td>✅ lazy(() =&gt; T)</td><td>✅ lazy()</td><td>✅ link('#id')</td><td>❌ none</td><td>✅ @ValidateNested + @Type(() =&gt; Self)</td><td>✅ $ref, $dynamicRef</td><td>✅ Type.Cyclic, Type.Module</td><td>✅ recursive TS types</td><td>✅ named types</td><td>✅ self-referencing messages</td><td>✅ schema.add({ self: schema })</td></tr>
<tr><td>Schemas referenced by name</td><td>✅ capitalized names in a <code>Model</code></td><td>✅ capitalized names via Model</td><td>❌ JS variables only</td><td>❌ JS variables only</td><td>✅ scope({ User, Group }) by name</td><td>❌ JS variables only</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none (ref() is a value ref)</td><td>✅ id() + link('#id'), shared()</td><td>❌ none</td><td>❌ none</td><td>✅ $ref by $id; ajv.addSchema</td><td>✅ Type.Ref + context, Module, $id</td><td>✅ TS type names</td><td>✅ names + namespaces, registry</td><td>✅ full names via Root</td><td>⚠️ ref: 'Model' for populate</td></tr>
<tr><td>Custom types registered by name</td><td>✅ registered by name</td><td>✅ Model types: js alias or checkType</td><td>❌ z.custom() values, no name registry</td><td>❌ v.custom() values, no name registry</td><td>✅ scope aliases, generics, keywords</td><td>⚠️ Schema.declare; reviver ids for restore</td><td>⚠️ define(name, fn); no registry</td><td>⚠️ new t.Type(name, is, validate, encode); no registry</td><td>⚠️ withBrand/withConstraint; no registry</td><td>⚠️ withPredicate/map on a base type; no registry</td><td>⚠️ unknown().assert()/chain(); no registry</td><td>⚠️ addMethod(), mixed(check)</td><td>✅ Joi.extend({ type })</td><td>⚠️ createRule(), macro() methods</td><td>✅ registerDecorator(), @ValidatorConstraint</td><td>⚠️ addKeyword / addSchema, not types</td><td>⚠️ Unsafe + Refine; Script/Module names</td><td>✅ custom tags (tags.TagBase)</td><td>✅ logicalTypes classes, typeHook</td><td>❌ messages and enums only</td><td>✅ Schema.Types.Name = class</td></tr>
<tr><td>String formats</td><td>✅ 35 + your own (<code>./formats</code>)</td><td>❌ none</td><td>✅ 30+ (email, uuid, url, ip, iso.datetime…)</td><td>✅ ~37 actions (email, uuid, url, isoDateTime…)</td><td>✅ ~18 string.* (email, uuid, url, ip…)</td><td>✅ uuid, ulid, base64, URL, IP; no email</td><td>❌ none (pattern() only)</td><td>⚠️ io-ts-types: UUID, ISO dates</td><td>❌ none (Template literals)</td><td>❌ none (pattern() only)</td><td>❌ none</td><td>✅ 4: email, url, uuid, datetime<sup>17</sup></td><td>✅ 14: email, uri, uuid, ip, isoDate...</td><td>✅ 18: email, url, uuid, ulid, ip, iban, jwt...</td><td>✅ 50+ via validator.js (IsEmail, IsUUID, IsUrl...)</td><td>✅ ajv-formats: 26<sup>18</sup></td><td>✅ 21 built in<sup>19</sup></td><td>✅ 22 via tags.Format</td><td>❌ none</td><td>❌ none</td><td>❌ none (match: RegExp)</td></tr>
<tr><td>Date, BigInt, Map, Set</td><td>✅ Date, BigInt, Map, Set, Uint8Array; BSON (<code>./mongodb</code>)</td><td>⚠️ BigInt, Map, Set; no Date</td><td>✅ Date, BigInt, Map, Set, Symbol, File</td><td>✅ Date, BigInt, Map, Set, Blob, File</td><td>✅ Date, bigint, Map, Set, symbol, Blob, File…</td><td>✅ Date, BigInt, ReadonlyMap, ReadonlySet, Symbol…</td><td>✅ Date, BigInt, Map, Set</td><td>⚠️ BigInt; Date/Map/Set via io-ts-types</td><td>⚠️ BigInt, Symbol; Date/Map/Set via InstanceOf</td><td>⚠️ Date, BigInt</td><td>⚠️ BigInt only</td><td>⚠️ Date</td><td>⚠️ Date, Buffer, symbol, function</td><td>⚠️ Date (output), File</td><td>⚠️ Date; Set/Map via each</td><td>⚠️ Date via ajv-keywords or JTD</td><td>⚠️ BigInt, Symbol, Undefined; no Date/Map/Set<sup>20</sup></td><td>✅ Date, bigint, Map, Set, typed arrays<sup>21</sup></td><td>⚠️ Buffer; Date, BigInt via custom types<sup>22</sup></td><td>⚠️ Uint8Array, Long; BigInt via fromObject<sup>23</sup></td><td>✅ Date, BigInt, Map, Buffer</td></tr>
<tr><td>Custom validators</td><td>✅ <code>validate</code> on a field and a schema</td><td>✅ field and schema validate<sup>24</sup></td><td>✅ .refine / .superRefine / .check</td><td>✅ check (field), forward+partialCheck (object)</td><td>✅ .narrow() on fields and objects</td><td>✅ .check(makeFilter), refine</td><td>✅ refine(struct, name, fn)</td><td>✅ refinement(), brand()</td><td>✅ withConstraint, withGuard, withAssertion</td><td>✅ withPredicate(fn, msg)</td><td>✅ assert(fn, msg), chain()</td><td>✅ test() on fields and objects</td><td>✅ custom() on any schema</td><td>✅ createRule() + use(), any level</td><td>⚠️ custom decorators per property</td><td>✅ custom keywords (addKeyword)</td><td>✅ Type.Refine on any type</td><td>⚠️ TagBase validate expressions (strings)</td><td>⚠️ only via a LogicalType</td><td>❌ none</td><td>✅ validate; pre('validate') + invalidate</td></tr>
<tr><td>Async validators</td><td>✅ <code>checkAsync</code>, run concurrently</td><td>❌ none</td><td>✅ parseAsync; concurrent</td><td>✅ *Async schemas; concurrent<sup>25</sup></td><td>❌ not supported (by design)<sup>26</sup></td><td>✅ Effect getters; concurrency option</td><td>❌ none</td><td>⚠️ experimental TaskDecoder, concurrent<sup>27</sup></td><td>❌ none</td><td>❌ none<sup>28</sup></td><td>❌ none (non-goal)<sup>29</sup></td><td>✅ async test(), concurrent</td><td>⚠️ external(): sequential, after sync rules<sup>30</sup></td><td>⚠️ async rules, in sequence</td><td>✅ async constraints, concurrent<sup>31</sup></td><td>⚠️ $async schemas; awaited one by one</td><td>❌ sync only<sup>32</sup></td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>✅ async validators, concurrent</td></tr>
<tr class="ms-matrix-group"><td colspan="22"><strong>Validation results</strong></td></tr>
<tr><td>Every issue in one run</td><td>✅ all, by default</td><td>✅ all by default</td><td>✅ all by default</td><td>✅ all by default; abortEarly</td><td>✅ all by default</td><td>⚠️ first by default; errors: 'all'</td><td>⚠️ first; all via <code>failures()</code></td><td>✅ all by default</td><td>✅ all by default</td><td>⚠️ first; collectErrors() per object</td><td>✅ all by default</td><td>⚠️ first by default; abortEarly: false</td><td>⚠️ first by default; abortEarly: false</td><td>✅ all fields; first per field</td><td>✅ all by default; stopAtFirstError</td><td>⚠️ first by default; <code>allErrors: true</code><sup>33</sup></td><td>⚠️ <code>Errors()</code>: up to 8 by default</td><td>✅ validate: all; assert: first</td><td>⚠️ first; all via <code>errorHook</code></td><td>❌ first error only</td><td>✅ all paths, one per path</td></tr>
<tr><td>A cap on the number of issues</td><td>✅ <code>maxErrors</code></td><td>❌ none</td><td>❌ first (validate) or all</td><td>❌ first or all</td><td>❌ all only</td><td>❌ first or all</td><td>❌ first or all only</td><td>❌ all only</td><td>❌ all only</td><td>❌ first or all only</td><td>❌ all only</td><td>❌ first or all</td><td>❌ first or all</td><td>❌ none</td><td>❌ none</td><td>❌ first or all</td><td>⚠️ <code>maxErrors</code> (8), process-wide</td><td>❌ first (assert) or all (validate)</td><td>❌ first or all only</td><td>❌ first only</td><td>❌ none</td></tr>
<tr><td>Issues as data: code, path, params</td><td>✅ code, path array, params</td><td>❌ message strings<sup>34</sup></td><td>✅ code, path[], expected/minimum…</td><td>✅ type, path[], expected/received/requirement</td><td>✅ code, path[], expected/actual/rule</td><td>✅ tagged issue tree; paths; check params</td><td>⚠️ path array, type/refinement; no params</td><td>⚠️ context path, expected codec, value; no codes</td><td>⚠️ code, expected, received; nested details</td><td>⚠️ path array + message; no codes</td><td>✅ code, path array, expected/keys/bounds</td><td>⚠️ type, params; path is a string</td><td>✅ type, path array, context</td><td>⚠️ rule, meta; path is a dot string</td><td>⚠️ constraint names; nested error tree</td><td>⚠️ keyword, params; path as JSON Pointer</td><td>⚠️ keyword, params; path as JSON Pointer</td><td>⚠️ path string, expected, value; no code</td><td>⚠️ errorHook(path[], value, type)</td><td>❌ string with dotted path</td><td>⚠️ kind, path string, properties</td></tr>
<tr><td>Localized messages</td><td>✅ en, uk; a locale per call</td><td>❌ none</td><td>✅ 62 locales; per-call error fn</td><td>✅ @valibot/i18n (34 locales); per-call message fn<sup>35</sup></td><td>⚠️ per-kind message config; no locales</td><td>⚠️ message annotations, formatter hooks; no locales</td><td>❌ none (per-call message string)</td><td>❌ none</td><td>❌ none</td><td>❌ none (per-schema messages)</td><td>❌ none</td><td>⚠️ global setLocale(); English only</td><td>✅ messages + errors.language per call</td><td>✅ messagesProvider per call; English only</td><td>⚠️ message functions; none built in</td><td>✅ ajv-i18n: 23 locales</td><td>✅ 38 locales; global Locale.Set</td><td>❌ no messages</td><td>❌ none</td><td>❌ none</td><td>⚠️ global mongoose.Error.messages</td></tr>
<tr><td>Unknown keys</td><td>✅ reject (default), ignore, strip</td><td>⚠️ reject only (no option)<sup>36</sup></td><td>✅ strip (default), strict, loose</td><td>✅ strip (default), strict, loose, rest</td><td>✅ ignore (default), reject, delete</td><td>✅ strip (default), error; keep via StructWithRest</td><td>✅ object() rejects; type() ignores; mask() strips</td><td>⚠️ ignore (t.type), strip (t.exact/t.strict); no reject</td><td>✅ check ignores, parse strips, exact() rejects<sup>37</sup></td><td>✅ reject (default), strip</td><td>✅ strict (default), strip, passthrough per call</td><td>✅ keep default; exact() rejects, stripUnknown<sup>38</sup></td><td>✅ reject default; allowUnknown, stripUnknown</td><td>⚠️ strip default; allowUnknownProperties()<sup>39</sup></td><td>✅ keep default; whitelist strips, forbidNonWhitelisted<sup>40</sup></td><td>✅ ignore default; reject, strip (removeAdditional)</td><td>✅ ignore default; reject, Value.Clean strips</td><td>✅ ignore default; equals rejects, prune strips<sup>41</sup></td><td>✅ ignore (default), reject, strip</td><td>✅ ignore, strip, reject<sup>42</sup></td><td>✅ strip (default), keep, throw</td></tr>
<tr><td>A result instead of an exception</td><td>✅ <code>check</code>, <code>parse</code> return a result</td><td>⚠️ check() returns a result<sup>43</sup></td><td>✅ safeParse</td><td>✅ safeParse, is</td><td>✅ T(data) returns data | ArkErrors</td><td>✅ decodeUnknownResult / Exit / Option</td><td>✅ validate() → [error, value]; is()</td><td>✅ decode() → Either</td><td>✅ inspect() → result; guard()</td><td>✅ try() → value | ValidationError</td><td>✅ try() → { ok, value | issues }</td><td>⚠️ isValid(), ~standard.validate</td><td>✅ validate() → { value, error }</td><td>✅ tryValidate() → [error, value]</td><td>✅ validate() → ValidationError[]</td><td>✅ validate() → boolean + .errors</td><td>✅ Check + Errors; Parse throws</td><td>✅ is / validate</td><td>✅ isValid() -&gt; boolean</td><td>✅ verify() -&gt; null | string</td><td>✅ validateSync() returns the error<sup>44</sup></td></tr>
<tr><td>Cyclic and very deep input</td><td>✅ tracked at references, <code>maxDepth</code></td><td>❌ no detection; stack overflow</td><td>⚠️ cycle-safe; no depth limit<sup>45</sup></td><td>❌ stack overflow, no depth limit</td><td>⚠️ cycle-safe; no depth limit</td><td>❌ stack overflow, no depth limit<sup>46</sup></td><td>❌ stack overflow</td><td>❌ stack overflow</td><td>⚠️ cycles accepted; deep input overflows</td><td>⚠️ the overflow caught as an issue<sup>47</sup></td><td>❌ stack overflow</td><td>❌ stack overflow</td><td>✅ link.depth issue; maxRecursion(n)</td><td>⚠️ finite schemas; the unknown-key copy overflows</td><td>❌ stack overflow</td><td>❌ RangeError; no detection or depth limit</td><td>❌ RangeError; no detection or depth limit</td><td>⚠️ WeakSet guard; deep input overflows<sup>48</sup></td><td>❌ stack overflow</td><td>✅ depth limit 100</td><td>❌ throws (circular JSON, RangeError)</td></tr>
<tr class="ms-matrix-group"><td colspan="22"><strong>Parsing</strong></td></tr>
<tr><td>Defaults</td><td>✅ <code>default</code>, a value or a factory</td><td>❌ kept as metadata only</td><td>✅ .default(), .prefault(), .catch()</td><td>✅ optional(schema, default), fallback</td><td>✅ 'string = "x"', .default()</td><td>✅ withDecodingDefault(Key), withConstructorDefault</td><td>✅ defaulted(), via create()/mask()<sup>49</sup></td><td>⚠️ io-ts-types fromNullable/withFallback</td><td>✅ default(value), parse only<sup>50</sup></td><td>✅ default(value | fn)</td><td>✅ optional(() =&gt; v), nullable(() =&gt; v)</td><td>✅ default(), factories</td><td>✅ default(), factories</td><td>❌ none (parse() can fill)</td><td>✅ field initializers (class-transformer)</td><td>✅ useDefaults: true (in place)<sup>51</sup></td><td>⚠️ Value.Default; Decode pipeline<sup>52</sup></td><td>❌ Default&lt;V&gt; is metadata only</td><td>✅ field default (clone, decode)</td><td>✅ proto defaults, toObject({ defaults })</td><td>✅ default values and functions</td></tr>
<tr><td>Transforms and decoders</td><td>✅ a field's <code>parse</code> (decoder)</td><td>❌ none</td><td>✅ .transform, z.pipe, z.preprocess</td><td>✅ transform, rawTransform in pipe</td><td>✅ morphs: .pipe(), .to(), '=&gt;'</td><td>✅ decodeTo + SchemaTransformation</td><td>✅ coerce(struct, from, fn) via create()</td><td>✅ custom Type with validate/encode</td><td>✅ withParser(fn), parse only</td><td>✅ map(fn)</td><td>✅ map(fn), chain(fn)</td><td>✅ transform()</td><td>✅ custom() return value, rename(), trim()...</td><td>✅ transform(), parse()</td><td>✅ @Transform (class-transformer)</td><td>⚠️ ajv-keywords transform (strings only)</td><td>✅ Type.Codec / Decode / Encode</td><td>⚠️ built-in only: http, notations, llm</td><td>✅ logical types (_fromValue)</td><td>⚠️ conversion options only</td><td>✅ set/get, trim, lowercase</td></tr>
<tr><td>Coercion of input types</td><td>✅ <code>coerce: true</code> (call, kind or field) + <code>./coerce</code><sup>53</sup></td><td>❌ none</td><td>✅ z.coerce.*, z.stringbool</td><td>✅ toNumber, toDate, toBoolean… actions</td><td>✅ string.numeric.parse, string.date.parse…</td><td>✅ NumberFromString, DateFromString…</td><td>❌ none (trimmed() only)</td><td>⚠️ io-ts-types NumberFromString etc.</td><td>❌ none</td><td>✅ number coerce, date, bigint, enum case<sup>54</sup></td><td>❌ none</td><td>✅ on by default; strict() off</td><td>✅ convert: true by default<sup>55</sup></td><td>✅ form semantics by default; { strict: true }</td><td>✅ @Type / implicit (class-transformer)</td><td>✅ coerceTypes: true | "array"</td><td>✅ Value.Convert (also inside Decode)</td><td>⚠️ http.query/headers, llm.coerce</td><td>⚠️ coerceBuffers only</td><td>✅ fromObject casts<sup>56</sup></td><td>✅ casting on by default</td></tr>
<tr><td>Encode back (bidirectional codecs)</td><td>✅ <code>serialize</code></td><td>❌ none</td><td>✅ z.codec + z.encode</td><td>🔜 planned for v2 (#658)</td><td>❌ none</td><td>✅ encodeSync / encodeUnknown*</td><td>❌ none</td><td>✅ codec.encode()</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>✅ instanceToPlain (class-transformer)</td><td>⚠️ JTD compileSerializer (to JSON)</td><td>✅ Codec + Value.Encode</td><td>⚠️ protobuf.encode/decode, json.stringify</td><td>✅ toBuffer/fromBuffer; logical _toValue</td><td>✅ binary, toObject, ProtoJSON</td><td>⚠️ getters, toJSON transform</td></tr>
<tr class="ms-matrix-group"><td colspan="22"><strong>TypeScript</strong></td></tr>
<tr><td>Static type inferred from the schema</td><td>✅ <code>Infer</code>, <code>InferSchema</code></td><td>❌ none</td><td>✅ z.infer</td><td>✅ InferOutput</td><td>✅ typeof T.infer</td><td>✅ typeof S.Type</td><td>✅ Infer&lt;typeof S&gt;</td><td>✅ t.TypeOf&lt;typeof C&gt;</td><td>✅ Static&lt;typeof R&gt;</td><td>✅ Infer&lt;typeof S&gt;</td><td>✅ v.Infer&lt;typeof T&gt;</td><td>✅ InferType</td><td>❌ none</td><td>✅ Infer&lt;typeof schema&gt;</td><td>⚠️ the class is the type</td><td>⚠️ JTDDataType (JTD only)</td><td>✅ Static&lt;T&gt;, also from plain JSON Schema</td><td>✅ the TS type is the schema</td><td>❌ none</td><td>⚠️ via pbjs --dts codegen</td><td>✅ InferSchemaType</td></tr>
<tr><td>Separate input and output types</td><td>✅ <code>Infer</code> / <code>InferOutput</code></td><td>❌ none</td><td>✅ z.input / z.output</td><td>✅ InferInput / InferOutput</td><td>✅ T.inferIn / T.inferOut</td><td>✅ S.Type / S.Encoded</td><td>❌ none</td><td>✅ TypeOf, InputOf, OutputOf</td><td>✅ Static vs Parsed</td><td>❌ none</td><td>❌ output only</td><td>⚠️ defaults only, in ~standard types</td><td>❌ none</td><td>✅ InferInput / Infer</td><td>❌ none</td><td>— no transforms</td><td>✅ StaticDecode / StaticEncode</td><td>— no transforms or defaults</td><td>❌ none</td><td>⚠️ $Properties vs class (pbts)</td><td>⚠️ InferRawDocType vs hydrated</td></tr>
<tr><td>Generates TypeScript source</td><td>✅ <code>toTypeScript</code>, <code>saveTypes</code></td><td>⚠️ model.dts, flat scalars only<sup>57</sup></td><td>⚠️ zod-to-ts (third-party)</td><td>❌ none</td><td>❌ .expression is ArkType syntax, not TS</td><td>✅ SchemaRepresentation.toCodeDocument</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>⚠️ joi-to-typescript (3rd party)</td><td>❌ none</td><td>— schemas are TS classes</td><td>⚠️ json-schema-to-typescript (third-party)</td><td>⚠️ json-schema-to-typescript (third-party)</td><td>— the source is TypeScript</td><td>⚠️ third-party: @ovotech/avro-ts</td><td>✅ pbjs --dts / pbts (protobufjs-cli)</td><td>⚠️ third-party: mongoose-tsgen</td></tr>
<tr class="ms-matrix-group"><td colspan="22"><strong>Interoperability</strong></td></tr>
<tr><td>Standard Schema</td><td>✅ v1 + JSON Schema converter</td><td>❌ no</td><td>✅ v1 + ~standard.jsonSchema</td><td>✅ v1 on every schema</td><td>✅ v1 + ~standard.jsonSchema</td><td>✅ v1 via toStandardSchemaV1()<sup>58</sup></td><td>❌ no</td><td>❌ no</td><td>❌ no</td><td>❌ no</td><td>✅ v1 (~standard), libraryOptions.mode</td><td>✅ v1, always async<sup>59</sup></td><td>✅ v1, + Standard JSON Schema</td><td>⚠️ v1 on validators; path is a string<sup>60</sup></td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>✅ createValidate&lt;T&gt;() (v1)</td><td>❌ no</td><td>❌ no</td><td>✅ Model['~standard'] v1 (9.7+)<sup>61</sup></td></tr>
<tr><td>JSON Schema export</td><td>✅ 2020-12, draft-07, OpenAPI 3.0, MongoDB</td><td>❌ none</td><td>✅ 2020-12, draft-07, draft-04, OpenAPI 3.0</td><td>✅ draft-07, 2020-12, OpenAPI 3.0 (@valibot/to-json-schema)</td><td>✅ draft 2020-12, draft-07</td><td>✅ 2020-12, draft-07, draft-04, OpenAPI 3.1</td><td>❌ none</td><td>⚠️ io-ts-to-json-schema (third-party)</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>⚠️ @sodaru/yup-to-json-schema (3rd party)</td><td>✅ 2020-12 via ~standard.jsonSchema</td><td>✅ draft-07 via toJSONSchema()</td><td>⚠️ class-validator-jsonschema (3rd party)</td><td>✅ the schema is JSON Schema</td><td>✅ types are JSON Schema (2020-12)</td><td>✅ json.schema(s): OpenAPI 3.0, 3.1</td><td>❌ none</td><td>❌ none</td><td>✅ toJSONSchema(): JSON Schema, $jsonSchema</td></tr>
<tr><td>JSON Schema import</td><td>✅ <code>fromJSONSchema</code> (a subset)</td><td>❌ none</td><td>✅ z.fromJSONSchema<sup>62</sup></td><td>⚠️ json-schema-to-valibot (third-party, codegen)</td><td>⚠️ @ark/json-schema 0.0.12 (no $ref)</td><td>✅ SchemaRepresentation.fromJsonSchemaDocument</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>⚠️ json-schema-to-yup (3rd party)</td><td>⚠️ enjoi (3rd party)</td><td>❌ none</td><td>❌ none</td><td>✅ draft-07, 2019-09, 2020-12, JTD</td><td>✅ Compile/Value accept drafts 3–2020-12</td><td>⚠️ @typia/utils OpenApiValidator (untyped)</td><td>❌ none</td><td>❌ none</td><td>❌ none</td></tr>
<tr><td>LLM structured-output profile</td><td>✅ the strict profile</td><td>❌ none</td><td>⚠️ openai/helpers/zod (third-party)</td><td>⚠️ @ai-sdk/valibot (third-party)</td><td>❌ none</td><td>✅ effect/ai toCodecOpenAI, toCodecAnthropic<sup>63</sup></td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>✅ llm.application/parameters; strict mode</td><td>❌ none</td><td>❌ none</td><td>❌ none</td></tr>
<tr class="ms-matrix-group"><td colspan="22"><strong>Domain models</strong></td></tr>
<tr><td>Entities with storage metadata</td><td>✅ kinds: Entity, Registry, …</td><td>✅ 11 kinds: scope, store, id field</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>⚠️ schema/Model variants + SqlModel</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>✅ model(name), collection option</td></tr>
<tr><td>References: an id or the record</td><td>✅ an id or the record, by kind or per call</td><td>⚠️ embedded record only<sup>64</sup></td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none (named types embed)</td><td>❌ none (messages embed)</td><td>⚠️ ref: id or populated doc<sup>65</sup></td></tr>
<tr><td>Indexes and unique keys</td><td>✅ <code>index</code>, <code>primary</code>, <code>unique</code>; driver specs (<code>./mongodb</code>)</td><td>✅ index/primary/unique arrays</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>✅ index/unique/sparse, schema.index()</td></tr>
<tr><td>Relation metadata</td><td>✅ <code>schema.relations</code></td><td>⚠️ schema.relations { to, type }<sup>66</sup></td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>⚠️ ref, virtual populate (justOne)</td></tr>
<tr><td>Derive a schema: pick, omit, partial, extend</td><td>✅ pick, omit, partial (deep), required, extend, keyof (<code>./derive</code>)</td><td>⚠️ Projection kind (pick fields)</td><td>✅ pick, omit, partial, required, extend, deepPartial</td><td>✅ pick, omit, partial, required</td><td>✅ pick, omit, partial, required, merge</td><td>✅ mapFields + Struct.pick/omit/map</td><td>✅ pick, omit, partial, assign</td><td>⚠️ partial, exact, intersection; no pick/omit</td><td>✅ pick, omit, extend, asPartial</td><td>✅ pick, omit, partial (deep), required</td><td>✅ pick, omit, partial, extend, rest</td><td>✅ pick, omit, partial, shape, concat</td><td>✅ keys, append, fork, tailor, concat</td><td>✅ pick, omit, partial, merge(group)</td><td>⚠️ class extends; @nestjs/mapped-types</td><td>⚠️ allOf; ajv-merge-patch $merge/$patch</td><td>✅ Pick, Omit, Partial, Required, Mapped</td><td>✅ TS Pick, Omit, Partial</td><td>❌ none</td><td>❌ none</td><td>✅ pick, omit, add, clone, discriminator</td></tr>
<tr><td>A model of many schemas</td><td>✅ <code>Model</code>: order, missing references</td><td>✅ Model: order, missing refs</td><td>❌ none</td><td>❌ none</td><td>⚠️ scope(): resolves names, errors on missing</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>⚠️ Ajv instance as $ref registry</td><td>⚠️ Type.Module (named types)</td><td>❌ none</td><td>⚠️ protocols, shared registry</td><td>⚠️ Root: lookup, resolveAll()</td><td>⚠️ mongoose.model() registry</td></tr>
<tr class="ms-matrix-group"><td colspan="22"><strong>Evolution</strong></td></tr>
<tr><td>Snapshot of a schema or model</td><td>✅ <code>model.toJSON()</code>, <code>schema.toSnapshot()</code>, <code>fromJSON</code></td><td>⚠️ schema.toJSON(), fields only</td><td>⚠️ via JSON Schema round trip</td><td>❌ export only, no restore</td><td>✅ .json → type.schema()</td><td>✅ SchemaRepresentation toJson / fromJson</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>⚠️ describe(), no restore</td><td>✅ describe() / Joi.build()</td><td>⚠️ toJSON(), no restore</td><td>❌ none</td><td>✅ schemas are JSON</td><td>✅ JSON.stringify; Compile reads it back</td><td>⚠️ export only (json.schema, reflect.schema)</td><td>✅ schema(), JSON.stringify(type)</td><td>✅ root.toJSON() / Root.fromJSON()</td><td>❌ none</td></tr>
<tr><td>Diff of two versions</td><td>✅ <code>diff</code></td><td>🔜 issue #251 (migrations)</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>⚠️ Value.Diff (generic JSON edits)</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td></tr>
<tr><td>Compatibility of a change</td><td>✅ backward / forward / full</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>⚠️ via .extends() / .equals()</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>⚠️ Type.Extends (assignability)</td><td>❌ none</td><td>✅ reader/writer resolution<sup>67</sup></td><td>❌ none</td><td>❌ none</td></tr>
<tr><td>Field aliases (renames)</td><td>✅ <code>aliases</code>, renamed by <code>parse</code></td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>⚠️ Schema.encodeKeys (one encoded name)</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>✅ object.from(old, new, alias)</td><td>✅ rename(old, new, { alias })</td><td>❌ none</td><td>⚠️ @Expose({ name }) (class-transformer)</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>✅ type and field aliases</td><td>⚠️ renames free on the wire</td><td>✅ alias option (virtual)</td></tr>
<tr><td>Deprecation markers</td><td>✅ <code>deprecated</code></td><td>❌ none</td><td>✅ .meta({ deprecated: true })</td><td>❌ free-form metadata() only</td><td>✅ .configure({ deprecated: true })</td><td>❌ none</td><td>✅ deprecated(struct, log)</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none (meta() is free-form)</td><td>❌ none (meta(), notes free-form)</td><td>❌ none</td><td>❌ none</td><td>✅ deprecated keyword (annotation)</td><td>⚠️ deprecated: true passes through</td><td>✅ JSDoc @deprecated → schema</td><td>❌ none</td><td>⚠️ [deprecated] kept in options</td><td>❌ none</td></tr>
<tr class="ms-matrix-group"><td colspan="22"><strong>Tooling</strong></td></tr>
<tr><td>Sample values from a schema</td><td>✅ <code>sample</code>, seeded</td><td>❌ none</td><td>⚠️ zod-schema-faker (third-party)</td><td>⚠️ valimock (third-party)</td><td>✅ @ark/fast-check (arkToArbitrary)</td><td>✅ Arbitrary.schema (own engine)</td><td>❌ none</td><td>⚠️ fast-check-io-ts (third-party)</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none (example() is an annotation)</td><td>❌ none</td><td>❌ none</td><td>⚠️ json-schema-faker (third-party)</td><td>⚠️ Value.Create (zero values)</td><td>✅ typia.random&lt;T&gt;() (randexp)</td><td>✅ type.random()</td><td>❌ none</td><td>❌ none</td></tr>
<tr><td>A schema inferred from data</td><td>✅ <code>infer</code></td><td>❌ none</td><td>⚠️ json-to-zod (third-party, 2022)</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>✅ Type.forValue, Type.forTypes<sup>68</sup></td><td>❌ none</td><td>❌ none</td></tr>
<tr><td>Merge or intersect two schemas</td><td>✅ <code>merge</code></td><td>❌ none</td><td>✅ z.intersection, .extend</td><td>✅ intersect</td><td>✅ .merge(), .and()</td><td>⚠️ fieldsAssign (struct fields only)</td><td>✅ assign(), intersection()</td><td>✅ intersection()</td><td>✅ Intersect(...), and()</td><td>✅ and() / intersection()</td><td>⚠️ extend(other.shape); no intersection</td><td>✅ concat()</td><td>✅ concat()</td><td>❌ none</td><td>❌ none</td><td>⚠️ allOf; ajv-merge-patch $merge</td><td>✅ Intersect + Evaluate</td><td>✅ TS intersection (A &amp; B)</td><td>⚠️ Type.forTypes (widening)</td><td>❌ none</td><td>✅ schema.add(other), new Schema([a, b])</td></tr>
<tr><td>Warnings about a definition</td><td>✅ <code>schema.warnings</code></td><td>⚠️ model.warnings: refs, recursion</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>✅ strict mode; strictTypes logs</td><td>❌ none</td><td>❌ compile errors only</td><td>❌ none</td><td>❌ none</td><td>⚠️ reserved-key, duplicate-index warnings</td></tr>
<tr><td>Streams and iterables of records</td><td>✅ <code>checkEach</code>, <code>transform</code></td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>✅ ChannelSchema.decode/encode<sup>69</sup></td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>❌ none</td><td>⚠️ Node stream codecs</td><td>❌ none (delimited framing only)</td><td>❌ none</td></tr>
<tr><td>Compiled to code, with a fallback</td><td>✅ <code>compile()</code>, closures fallback</td><td>❌ interpreter only</td><td>✅ z.compile / zod/compile; runtime fallback</td><td>🔜 compiler PR by the author (#1441)</td><td>✅ JIT by default; jitless fallback</td><td>✅ opt-in JIT + AOT; interpreter fallback<sup>70</sup></td><td>❌ interpreter only</td><td>❌ interpreter only</td><td>❌ interpreter only</td><td>❌ interpreter only</td><td>❌ interpreter only</td><td>❌ interpreter only</td><td>❌ interpreter only</td><td>✅ always; no interpreter fallback</td><td>❌ interpreter only</td><td>✅ always compiles; no interpreter</td><td>✅ Compile; interpreter fallback</td><td>✅ AOT at build time; no fallback</td><td>✅ new Function; no fallback</td><td>✅ runtime codegen; static AOT</td><td>❌ interpreter only</td></tr>
<tr><td>Readable at runtime</td><td>✅ <code>fields</code>, <code>toJSON()</code></td><td>✅ fields, kind, indexes, relations</td><td>✅ .def, .shape, .meta()</td><td>✅ plain schema objects (type, entries, pipe)</td><td>✅ .json, .props, .expression, .select()</td><td>✅ .ast, .fields, annotations</td><td>⚠️ struct.type, struct.schema</td><td>✅ _tag, props, types, name</td><td>✅ tag, fields, alternatives, element</td><td>⚠️ shape(); other parts private</td><td>⚠️ name, shape, options; transforms opaque</td><td>✅ describe(), fields, spec</td><td>✅ describe(), $_terms, _rules</td><td>✅ toJSON() tree, getProperties()</td><td>✅ getMetadataStorage()</td><td>✅ the schema is a plain object</td><td>✅ JSON Schema objects; Type.Is* guards</td><td>✅ reflect.schema / json.schema</td><td>✅ fields, typeName, schema()</td><td>✅ reflection: fields, options</td><td>✅ schema.paths, path(), eachPath</td></tr>
</tbody>
</table>

</div>

✅ built in, or in an official package of the same project (named) · ⚠️ partial, opt-in, with a caveat, or through a third-party package (named) · ❌ not built in · 🔜 planned by the maintainers, no code yet · — does not apply. Every cell was checked against the source of the published package in October 2026.

1. No release since 2024-07; MetaMask publishes a maintained fork, <code>@metamask/superstruct</code>.
2. No commits since the 2025-02 release.
3. The legacy @sinclair/typebox 0.34.52 differs materially: CJS + ESM, Type.Date / Uint8Array and a TypeRegistry for custom kinds, and a Value.Parse that cleans, defaults and converts by default (research/typebox-legacy/node_modules/@sinclair/typebox/build/cjs/value/parse/parse.js:60-66).
4. A minified bundle validates nothing but unknown keys: identity is checked by constructor.name === 'Type' (lib/util.js:42, lib/struct.js:34), which minifiers rename. esbuild minify without keepNames: { a: 1 } against { a: 'string' } is valid.
5. The browser bundle has no describe()/build() ('Manifest functionality disabled'), binary() or trace(); the main entry needs Node's url and util modules.
6. The compiled validator needs code generation, so it does not run on Cloudflare Workers or under a CSP without unsafe-eval.
7. Runtimes that forbid eval (Cloudflare Workers, strict CSP) can only run validation code pre-generated with ajv/dist/standalone at build time.
8. Built for browserify-era Node polyfills; and since every type is created with new Function, eval-free edge runtimes (Cloudflare Workers) cannot load it.
9. @mongoosejs/browser 0.1.3 is a prebuilt UMD (1.1 MB, 270 KB gzip) of mongoose 9.0.0-rc1 that validates documents only; its Node entry exports the driver, not mongoose, despite its README.
10. z.object builds a fast path with new Function when eval is allowed; a CSP probe (or z.config({ jitless: true })) switches to the interpreter. z.compile / "zod/compile" also use new Function and fall back to the runtime parser.
11. Standard (TC39) decorators are not supported; class-transformer's implicit conversion also needs emitDecoratorMetadata.
12. Since v13 the transform is written in Go and run by ttsc on the TypeScript 7 native compiler (the first build compiled the plugin in 85 s); typia 12 is the legacy ts-patch setup for TypeScript &lt; 7. Bundlers need @ttsc/unplugin.
13. After registerSchema(), validating any decorated class throws the same TypeError (MetadataStorage.js:107).
14. optional() lets null through and drops it from the output; nullable() keeps the key required; an absent key and undefined are the same.
15. A longer array is accepted and truncated, not rejected.
16. The invalid_length message is garbled in 0.5.5 ("expected an arraywith items", :852-866): a missing space and no count.
17. Regex-only: uuid() accepts versions 1-5 only (a v7 UUID fails) and datetime() does not check ranges.
18. The core has none: in strict mode a schema with an unknown format fails to compile ("unknown format \"email\" ignored in schema").
19. An unregistered format name passes silently: Format.Test returns true when the name is unknown (_registry.ts:103-106; typebox-behaviour.mjs).
20. Type.Date and Type.Uint8Array were removed in 1.0; the migration guide rebuilds them with Type.Unsafe + Type.Refine.
21. An invalid Date (new Date("nope")) passes as a Date, and NaN passes as a number unless the numeric/finite transform flags are set.
22. A JS Map passes a map type vacuously (it has no own keys): new Map([['a', 'x']]) is valid for values int and encodes as an empty map (lib/types.js:1799-1830).
23. verify() rejects a BigInt for int64 ("integer|Long expected") although fromObject and toObject accept it.
24. A field validate runs even when the type check already failed (both messages reported).
25. Async needs the parallel *Async API (objectAsync, pipeAsync, checkAsync). In plain JS, the sync safeParse of an async schema reports success: true for invalid input (the Promise has no issues); TypeScript forbids the call.
26. A narrow that returns a Promise passes, because the predicate result is only tested for truthiness.
27. TaskDecoder belongs to the experimental modules (lib/TaskDecoder.d.ts:2, "independent and backward-incompatible with stable ones").
28. An async predicate silently passes every value (its promise is truthy).
29. An async predicate silently passes every value.
30. custom() given an async function passes and returns a Promise as the value (research-scripts/joi-extra.mjs).
31. validateSync() skips async validators silently and reports the value valid (Validator.js:31; script).
32. A refinement that returns a promise is not awaited: Value.Check returns true, and a compiled Check returns the Promise object itself, so the value is accepted.
33. The Ajv security guide says not to use allErrors: true in production (research/ajv-src/docs/security.md:41).
34. An unknown nested key loses its path: { nested: { extra } } reports Field "extra" (research-scripts/metarhia-basics.mjs).
35. In @valibot/i18n 1.3.0 the CommonJS root entry does not load (index.cjs declares <code>var import_zh-CN</code>, a SyntaxError); ESM and per-locale imports work.
36. Keys named like Struct.prototype members (constructor, check, __proto__) pass silently: this[name] finds the inherited member (lib/struct.js:29-34).
37. The same schema keeps unknown keys under check()/guard() and drops them under parse().
38. noUnknown() strips unknown keys instead of rejecting them unless the schema is strict() (the README warns about it); exact() rejects.
39. No way to reject unknown keys.
40. whitelist deletes the keys from the validated object itself; forbidUnknownValues (default true) rejects an object with no metadata, so a plain object fails.
41. equals accepts an extra key whose value is undefined.
42. Each policy belongs to a different API: verify ignores, fromObject strips, ProtoJSON fromJson rejects by default.
43. <code>check(null)</code> throws.
44. validateSync is deprecated in 9.x and emits a process warning on every call (research-scripts/mongoose-custom.mjs); validate() rejects; the constructor throws for strict: 'throw' and cyclic input.
45. The classic API installs a memoizer: a self-referencing value parses (output keeps the cycle), unless the cycle closes through a transform ($ZodCyclicError). zod/mini has no memoizer unless configured. 10 000-deep input overflows the stack.
46. The RangeError surfaces as a defect: the Result/Exit adapters throw "Result adapter can only return schema issues".
47. The RangeError of a cyclic or 3 000-deep value is returned as an issue whose path is thousands of keys long.
48. A cycle is accepted (coinductive), and there is no depth limit.
49. Defaults apply only on the coercing calls (create, mask, validate with coerce: true), not in is()/assert().
50. The default is a value, not a factory: default([]) hands every parse the same array (script).
51. Defaults are written into the input object, and not inside anyOf/oneOf/not.
52. Value.Parse and Compile().Parse never fill defaults (only with the global correctiveParse setting, and only for a value that fails the check); Value.Decode does, and Compile().Decode does only when the type contains a codec.
53. Opt-in, in parse only (check never converts): strict decimal strings, <code>true</code>/<code>false</code>/<code>1</code>/<code>0</code>, ISO dates with a zone, never the empty string; a value a union branch accepts as it is is not converted; <code>coerce()</code> is the step alone.
54. Lenient: number().coerce() turns "1abc" into 1, number() accepts NaN, bigint() accepts true (script).
55. number() also rejects values beyond Number.MAX_SAFE_INTEGER unless unsafe() (types/number.js:104).
56. fromObject does not validate: { age: 'abc' } becomes 0 and { name: 42 } "42".
57. Only number/string/boolean are typed: a nested struct, enum, array or custom type is rendered as string (profile: string), and a reference as &lt;name&gt;Id: string although check validates the embedded record.
58. Schemas do not carry ~standard themselves ('~standard' in schema is false); wrap with Schema.toStandardSchemaV1 / toStandardJSONSchemaV1.
59. ~standard.validate always returns a promise and runs with abortEarly: false; array indexes come back as strings.
60. ~standard.validate puts the dotted field string in path (the specification wants an array) and, for a valid falsy output (false, 0, ''), returns { issues: undefined } without the value. Schemas themselves have no ~standard; vine.create() validators do.
61. On models only (a Schema has none), and validate always returns a promise; it casts, so { n: '5' } is valid with value n: 5.
62. Its JSDoc calls it semi-experimental.
63. Marked @stability unstable.
64. An id is never accepted, while the generated dts names the field companyId: string.
65. A populated document is not validated with its own schema (an invalid Dog passes).
66. The labels are reversed: a many field is labelled many-to-one and a single reference one-to-many.
67. A resolver either builds or throws for one reader/writer pair; there is no backward/forward/full classification.
68. Any non-integer number below 2^53 is inferred as float (32-bit), which loses precision when encoded (lib/types.js:247-252).
69. Works on Effect Channels/Streams (unstable), not on Web Streams directly.
70. Both are @stability unstable; the interpreter is the default.

<!-- comparison:end -->

## Installation

```bash
pnpm add @alexify/metaschema
# or
npm install @alexify/metaschema
```

Requires Node.js 18 or newer. Works in browsers through any bundler. The typings need
TypeScript 5.0 or newer.

## Schema syntax

| Form | Example | Meaning |
| --- | --- | --- |
| Type name | `title: 'string'` | a required string |
| Optional | `subtitle: '?string'` or `'subtitle?': 'string'` | the key may be absent, `undefined` or `null` |
| Nullable | `parent: { type: 'string', nullable: true }` | the key is required, the value may be `null` |
| Long form | `login: { type: 'string', length: [3, 32] }` | a type with options, `type` first |
| Rules | `{ type: 'integer', min: 18, max: 120 }`, `{ type: 'string', pattern: '^[a-z]+$', length: { max: 32 } }`, `{ type: 'number', decimals: 2 }` | `min`/`max` for numbers, `decimals` for a number, `length`/`pattern`/`format` for strings, `length` for collections |
| Collections | `{ array: 'number' }`, `{ set: 'string' }`, `{ object: { string: 'number' } }`, `{ map: { string: 'string' } }` | |
| Enum | `{ enum: ['admin', 'user'] }` | one of the values |
| Flags | `perms: { flags: ['read', 'write'] }` | an object of those names, each `true` or `false` |
| Bytes | `avatar: 'bytes'` | a `Uint8Array` (a `Buffer` too) |
| Tuple | `point: ['number', 'number']` | a fixed-length array, each element its own definition |
| Union | `id: { union: ['string', 'number'] }`, `{ union: [...], discriminator: 'kind' }` | one of several definitions |
| Nested struct | `name: { first: 'string', last: 'string' }` | an object whose first key is none of the above |
| Reference | `company: 'Company'`, `{ many: 'Address' }` | another schema in the model (or the schema itself, by its own name): its id for a stored kind, the record for a memory kind |
| Any object | `payload: 'json'` | any non-null object |
| Calculated | `ratio: (file) => file.compressed / file.size` | a function, never validated |

The first key of an object decides what it is. Built-in types: `string`, `number`, `integer`,
`bigint`, `boolean`, `date`, `bytes`, `null`, `any`/`unknown`, `enum`, `flags`, `array`, `set`,
`object`, `map`, `tuple`, `union`, `json`. Rules: `length` (with `unicode: true` for code
points), `pattern` and `format` for strings, `length` for collections, `min`/`max` for numbers,
`decimals` for a number; a rule on a type that does not
take it is a definition error. Fields can add a `validate(value, path)` function, and a schema
can have a top-level `validate` for rules across fields. `check(value, options)` takes `root`
(the label of the error lines), `maxErrors`, `unknown: 'ignore'` (keys the schema does not have;
`{ Struct: { unknown: 'ignore' } }` makes it the schema's default), `references` (`'kind'`,
`'embed'` or `'id'`) and `messages` (a locale); the result has `issues`, `errors`, `summary`,
`flatten()`, `tree()` and `toJSON()`. `schema.warnings` lints the definition (a mistyped option, a `pattern`
without `length.max`). See [Schema Syntax](https://metaschema.vercel.app/guide/schema-syntax),
[Types](https://metaschema.vercel.app/guide/types),
[Unions, nullable and null](https://metaschema.vercel.app/guide/unions),
[References](https://metaschema.vercel.app/guide/references) and
[Validation](https://metaschema.vercel.app/guide/validation).

## Domain models

```js
const { Model } = require('@alexify/metaschema');

const types = {
  string: { metadata: { pg: 'varchar' } },
  number: { metadata: { pg: 'integer' } },
  boolean: { metadata: { pg: 'boolean' } },
};

const entities = new Map([
  ['Company', { Dictionary: {}, name: { type: 'string', unique: true }, addresses: { many: 'Address' } }],
  ['Address', { Entity: {}, city: 'string', street: 'string', building: '?string' }],
  ['User', { Registry: {}, login: { type: 'string', length: { min: 3, max: 32 } }, company: 'Company', active: 'boolean' }],
]);

const model = new Model(types, entities);

model.order; // Set { 'Address', 'Company', 'User' }
model.warnings; // [] (lint and consistency warnings, `Warning [code]: text`, end up here)
model.entities.get('User').check({ login: 'ab', company: 'c1', active: true }).errors;
// [ 'Field "User.login" value is too short' ]

const { toTypeScript } = require('@alexify/metaschema/generators');
console.log(toTypeScript(model));
```

```ts
interface Address {
  city: string;
  street: string;
  building?: string;
  addressId?: string;
}

interface Company {
  name: string;
  addressesId: string[];
  companyId?: string;
}

interface User {
  login: string;
  companyId: string;
  active: boolean;
  userId?: string;
}
```

`saveTypes(outputFile, model, options?)` of the same subpath writes the interfaces to a file
(`{ named: true }` names enums and nested structs, and a field's `description` is its JSDoc); its
`register()` adds `model.dts`, `model.toTypeScript` and `schema.toInterface` as methods. The first
key of a definition sets
its kind and metadata (`Entity`, `Registry`, `Dictionary`, `Journal`, `Details`, `Relation`,
`View`, `Struct`, `Form`, `Projection`, or any custom kind). Stored kinds default to
`scope: 'application'` and `store: 'persistent'`, and they get an id field; a reference to a
stored kind holds its id, a reference to a memory kind embeds the record, in `check` and in the
generated types alike. See
[Kinds and Metadata](https://metaschema.vercel.app/guide/kinds-and-metadata),
[Custom Types](https://metaschema.vercel.app/guide/custom-types) and
[Domain Models](https://metaschema.vercel.app/guide/model).

## String formats

`format` names a form a string must have; `@alexify/metaschema/formats` registers the 35
built-in formats and your own, once per process:

```js
const { register } = require('@alexify/metaschema/formats');
register({ phone: { test: (value) => /^\+\d{9,15}$/.test(value), examples: ['+380501234567'] } });

const signup = Schema.from({
  email: { type: 'string', format: 'email', length: { max: 254 } },
  phone: { type: 'string', format: 'phone' },
});
signup.check({ email: 'ann@', phone: '050' }).errors;
// [ 'Field "email" is not a valid email', 'Field "phone" is not a valid phone' ]
```

A format the table does not know is a definition error, never a check that passes everything;
`toJSONSchema` writes the name, `fromJSONSchema` reads it back, `sample` draws the format's
examples and `infer` reads a format out of the strings. See
[String formats](https://metaschema.vercel.app/guide/formats).

## Records and streams

`@alexify/metaschema/stream` runs a schema over a sequence of records, lazily and in order:

```js
const { checkEach, parseEach, transform } = require('@alexify/metaschema/stream');

for (const { index, record, result } of checkEach(user, rows)) {
  if (!result.valid) console.log(index, result.errors);
}
for (const { result } of parseEach(user, rows, { unknown: 'strip', maxInvalid: 10 })) save(result.value);

const parsed = ReadableStream.from(rows).pipeThrough(
  transform(user, { onInvalid: (record, result, index) => log(index, result.issues) }),
);
```

`checkEachAsync` and `parseEachAsync` take a sync or async source and keep `concurrency` records
in flight; `maxInvalid` ends an iteration after that many invalid records, and a `transform`
without `onInvalid` ends its stream with `ERR_INVALID_RECORD`. See
[Records and streams](https://metaschema.vercel.app/guide/streaming).

## Coercion

Text from a query string, a form or a file converts to the types of the fields with
`coerce: true`, before the check; `check` never converts:

```js
require('@alexify/metaschema/coerce').register();

const Query = new Schema('Query', {
  Form: { coerce: true },
  page: { type: 'integer', min: 1 },
  all: 'boolean',
  tags: { array: 'string' },
});
Query.parse(Object.fromEntries(new URLSearchParams('page=2&all=1&tags=news'))).value;
// { page: 2, all: true, tags: [ 'news' ] }
```

The converters are strict (a number written as one, `true`/`false`/`1`/`0`, an ISO date with
its zone, never the empty string), a union takes a value a branch accepts as it is, and
`coerce(schema, value)` converts without checking. See
[Coercion](https://metaschema.vercel.app/guide/coercion).

## Deriving schemas

```js
const { omit, partial, pick } = require('@alexify/metaschema/derive');

const CreateAccount = omit(Account, ['password'], { name: 'CreateAccount' });
const UpdateAccount = partial(CreateAccount, { name: 'UpdateAccount' });
const AccountView = pick(Account, ['accountId', 'login', 'role'], { name: 'AccountView' });
```

A derived schema is built from the definition of its source, every rule of a field included; a
stored kind becomes a struct without its id, `partial` leaves the defaults out (a patch keeps
what is stored), `extend` replaces fields where `merge` unifies them, and `register()` makes the
six methods (`Account.omit(['password']).partial()`). See
[Deriving schemas](https://metaschema.vercel.app/guide/derive).

## MongoDB

```js
const mongodb = require('mongodb');
const bson = require('@alexify/metaschema/mongodb');
bson.register({ bson: mongodb });

const model = new Model({ ...bson.types }, entities);
const validators = toJSONSchema(model, { target: 'mongodb', ids: 'objectId' });
const indexes = bson.indexesOf(model); // for createIndexes

const parsed = Account.parse(body);
if (parsed.valid) await accounts.insertOne(bson.toDocument(Account, parsed.value));
const { value } = bson.fromDocument(Account, await accounts.findOne({ login: 'ann' }));
if (bson.checkUpdate(Account, update).valid) await accounts.updateOne(filter, bson.toUpdate(Account, update));
```

The program keeps ids as strings, the database as ObjectIds under `_id`; the subpath does no I/O
and imports nothing of the driver. Mongoose remains the tool for `populate`, middleware and
change tracking. See [MongoDB](https://metaschema.vercel.app/guide/mongodb).

## Inferring a definition

`infer` of `@alexify/metaschema/model` reads a definition out of the values that exist, the
reverse of `sample`, to bootstrap a model from the documents of a collection or the rows of a
table:

```js
const { infer } = require('@alexify/metaschema/model');

infer([
  { id: 'ord-1', total: 12.5, status: 'paid', address: { city: 'Kyiv', zip: '01001' } },
  { id: 'ord-2', total: 7, status: 'new', address: { city: 'Lviv', zip: null }, coupon: 'X1' },
]);
// {
//   Struct: {},
//   id: 'string',
//   total: 'number',
//   status: 'string',
//   address: { city: 'string', zip: { type: 'string', nullable: true } },
//   coupon: '?string',
// }
```

Records fuse into one struct with optional keys, a string of few recurring values is an `enum`,
records whose keys are data are a dictionary, and the definition is checked against every
sample before it comes back. See
[Schema inference](https://metaschema.vercel.app/guide/infer).

## TypeScript

A schema keeps its definition as a type parameter, and `InferSchema` turns it into the type of
a value `check` accepts; `Infer<typeof definition>` does the same for a definition declared
`as const`:

```ts
import { Schema, type InferSchema } from '@alexify/metaschema';

const user = Schema.from({
  name: 'string',
  age: '?number',
  role: { enum: ['admin', 'user'] },
  tags: { array: 'string' },
  address: { city: 'string', 'street?': 'string' },
  point: ['number', 'number'],
});

type User = InferSchema<typeof user>;
// {
//   name: string;
//   age?: number | null | undefined;
//   role: 'admin' | 'user';
//   tags: string[];
//   address: { city: string; street?: string | null | undefined };
//   point: [number, number];
// }
```

Every form of the language is covered: optional and nullable fields, collections, enums,
tuples, unions, nested structs, references (an id, or the record through an entity map with
`Infer<D, E>` and `InferEntity<E, 'Name'>`) and custom types declared through module
augmentation of `CustomTypes`. A model renders its entities as interfaces with `toTypeScript`. See
[TypeScript](https://metaschema.vercel.app/guide/typescript).

A `Schema<D>` is also a `StandardSchemaV1<Infer<D>, InferOutput<D>>` of `@standard-schema/spec`:
`schema['~standard']` is typed as `StandardProps<D>`, with `StandardResult<T>` and
`StandardOptions` beside it. See
[Standard Schema](https://metaschema.vercel.app/guide/standard-schema).

## JSON Schema

`toJSONSchema(schema, options)` of `@alexify/metaschema/generators` renders the rules of `check`
as a JSON Schema document, and `toJSONSchema(model, options)` every entity of a model as a
definition:

```js
const { toJSONSchema } = require('@alexify/metaschema/generators');

toJSONSchema(user, { target: 'draft-07' });
// {
//   $schema: 'http://json-schema.org/draft-07/schema#',
//   type: 'object',
//   properties: {
//     name: { type: 'object', properties: { first: { type: 'string' }, last: { type: 'string' } }, required: ['first', 'last'], additionalProperties: false },
//     email: { type: 'string', minLength: 5, maxLength: 64 },
//     age: { type: ['number', 'null'] },
//     roles: { type: 'array', items: { enum: ['admin', 'editor', 'viewer'] } }
//   },
//   required: ['name', 'email', 'roles'],
//   additionalProperties: false
// }

toJSONSchema(answer, { profile: 'strict' }); // the dialect of OpenAI and Anthropic structured outputs
toJSONSchema(model, { target: 'mongodb' }); // one $jsonSchema validator per entity
```

The targets are `draft-2020-12` (the default), `draft-07`, `openapi-3.0` and `mongodb`; an
optional field accepts `null`, a reference to a stored kind is its id and a reference to a memory
kind a `$ref`, `validate` functions are not exported, and a type with no form in the target
(`bigint`, a `Date` on the way out) throws unless the call says `unrepresentable: 'any'`. The
export is checked against ajv for every form of the language. `register()` of the subpath turns
the functions into methods (`schema.toJSONSchema`, `model.toJSONSchema`) and adds the Standard
JSON Schema converter to `schema['~standard']`. See
[JSON Schema](https://metaschema.vercel.app/guide/json-schema).

## Compiled checks

`compile(schema)` of `@alexify/metaschema/compile` replaces the check of a schema, or of every
entity of a model, with one function generated from the same plan the closures walk and built
with `new Function`; `register()` does it for every schema built from then on. The issues are
the ones the closures record, only sooner: about three times faster on a flat struct, six on a
nested one. Where code generation from strings is not allowed (a Content Security Policy,
Cloudflare Workers, `node --disallow-code-generation-from-strings`) nothing changes: the
closures stay, silently unless `{ jit: true }` asks for an error.

```js
const { compile, compiled, register, canEval } = require('@alexify/metaschema/compile');

compile(user); // { accelerated: true }: user.check runs generated code now
compiled(user); // true
compile(model); // every entity; { accelerated: false } where there is no eval
register(); // every schema built from here on is compiled as it is built
canEval(); // whether this environment builds functions from source
```

The generated source holds identifiers, numbers and JSON strings only; regular expressions, enum
sets, validate functions and nested schemas reach it through a scope, never through the source
text. See [The JIT backend](https://metaschema.vercel.app/guide/compile).

## Exports

```js
const {
  KIND, KIND_STORED, KIND_MEMORY, SCOPE, STORE, ALLOW,
  getKindMetadata, Schema, Model, SchemaDefinitionError, ValidationResult,
} = require('@alexify/metaschema');

const { toJSONSchema, toTypeScript, saveTypes, fromJSONSchema, register } = require('@alexify/metaschema/generators');
const { compile, compiled, canEval } = require('@alexify/metaschema/compile'); // and its own register()
const { fromJSON, diff, compatibility, compatibilityOf, sample, merge, infer } = require('@alexify/metaschema/model'); // and its own register()
const { checkEach, parseEach, checkEachAsync, parseEachAsync, transform } = require('@alexify/metaschema/stream'); // and its own register()
const { FORMATS, register: registerFormats } = require('@alexify/metaschema/formats'); // fills the table the format rule reads
const { pick, omit, partial, required, extend, keyof } = require('@alexify/metaschema/derive'); // and its own register()
const { COERCIONS, coerce, register: registerCoercion } = require('@alexify/metaschema/coerce'); // the converters parse runs
const { types, toDocument, fromDocument, fromDocumentAsync, indexesOf, checkUpdate, toUpdate } = require('@alexify/metaschema/mongodb'); // and register({ bson })
const { Schema: Definition } = require('@alexify/metaschema/definition'); // the core's Schema and Model, built and read without validation

const en = require('@alexify/metaschema/locales/en'); // the built-in messages
const uk = require('@alexify/metaschema/locales/uk'); // schema.check(value, { messages: uk })
```

```js
import { Schema, Model } from '@alexify/metaschema';
import type { Infer, InferSchema, InferEntity, CustomTypes, ValidationIssue } from '@alexify/metaschema';
```

In the browser every export works the same, except `saveTypes` of the generators, which rejects
because there is no file system, and `compile`, which keeps the closures where a Content
Security Policy forbids `new Function`. The [API reference](https://metaschema.vercel.app/api/exports) lists every member
and every exported type.

## Migrating

### From 2.x

3.0 has two breaking changes. The generators left the core entry: `model.dts`,
`schema.toInterface()` and `saveTypes` are `toTypeScript(target, options)` and
`saveTypes(file, target, options)` of `@alexify/metaschema/generators`, whose `register()` puts
the methods back on the classes once per process. And `schema['~standard'].validate` is `parse`
rather than `check`: a consumer of Standard Schema gets the defaults filled in and the `parse`
functions applied, and a promise for a schema with an `async function`. The smaller changes: a
struct rejects an array, the synchronous `check` and `parse` throw `ERR_ASYNC_VALIDATOR` for a
promise, a graph deeper than 128 embedded records is a `depth` issue (`maxDepth` raises it),
`Infer` makes a defaulted key optional, and a few definitions that could never work throw when
the schema is built. Everything else is additive: `parse`, `serialize`, `checkAsync` and
`parseAsync`, the JSON Schema export, the JIT backend of `@alexify/metaschema/compile`, JSDoc
and named types. 3.1 and 3.2 add without breaking, with a few behaviours a 2.x program meets on
the way: two fields of one key and a non-list `aliases` are definition errors,
`JSON.stringify(model)` writes the snapshot, the issues of an async check come in walk order
then field order, a `pattern` is not run past `length.max`, and the `unexpected` message lists
ten keys. The step-by-step guide with before-and-after examples is
[Migrating from 2.x](https://metaschema.vercel.app/guide/migrating-from-2); the full list is
under "Upgrading from 2.0" in the [CHANGELOG](./CHANGELOG.md).

### From 1.x

2.0 changes the shape of a result (`issue.path` is an array of keys, `issue.message` has no
location, unknown keys are one issue per struct), the signature of `check`
(`check(value, { root, maxErrors, unknown, references, messages })`), and a few rules of the
language: the first key of an object decides what it is, numbers are bounded by `min`/`max`
instead of `length`, a reference to a stored kind is its id, a `set` renders as `Set<T>`, the
`relations` labels follow the referencing side, and a type failure cancels the rules and
`validate` of the field. Everything else is additive: `integer`, `date`, `null`, `any`, `union`,
`nullable`, `pattern`, locales, the lint, `Infer` and Standard Schema. The step-by-step guide
with before-and-after examples is
[Migrating from 1.x](https://metaschema.vercel.app/guide/migrating-from-1); the full list is
under "Upgrading from 1.x" in the [CHANGELOG](./CHANGELOG.md).

### From `metaschema` (metarhia)

`@alexify/metaschema` is a fork of [`metaschema`](https://github.com/metarhia/metaschema) 2.2 with
the same schema language. What changed in 1.0:

- **No loader.** `createSchema`, `loadSchema`, `readDirectory` and `loadModel` are removed along
  with the `metavm` sandbox. Use `new Schema(name, require('./schemas/User.js'))` and
  `new Model(types, new Map([...]), database)`. Schema files written as `({ ... })` become modules
  (`module.exports = { ... }`).
- **No runtime dependencies:** `metautil`, `metavm` and `metaskills` are gone.
- **Fixed messages, no old text kept:** `Field "..."` instead of `Filed "..."` and
  `not of expected type: object` instead of `is not a object`.
- **`detouch` is renamed to `detach`**, with no alias.
- **`browser.js`** replaces `dist.js`, and an `exports` map closes deep imports.

The full list is in [Migrating from metarhia](https://metaschema.vercel.app/guide/migrating-from-metarhia),
and the 2.0 and 3.0 changes above apply on top of it.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## License

[MIT](./LICENSE) © Alexis Technologies

`@alexify/metaschema` is a fork of [`metaschema`](https://github.com/metarhia/metaschema) by the
[Metarhia contributors](https://github.com/metarhia/metaschema/graphs/contributors), originally
part of the [Metarhia](https://github.com/metarhia) technology stack. Their copyright is kept in
[LICENSE](./LICENSE).
