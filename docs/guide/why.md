# Why metaschema?

`@alexify/metaschema` is a fast, zero-dependency schema library for JavaScript. A schema is a
plain object, written once, and the same definition serves every place a program needs a
description of its data:

- **Validation and parsing.** `check(value)` returns every problem with its path as data;
  `parse(value)` also fills defaults, strips unknown keys and decodes fields into the values of
  the program, and `serialize` goes back.
- **Types and contracts.** The TypeScript type of a valid value is inferred from the definition;
  the same schema is a [Standard Schema](/guide/standard-schema) for tRPC, TanStack Form or
  Hono, renders as [JSON Schema](/guide/json-schema) (draft 2020-12, draft-07, OpenAPI 3.0,
  MongoDB, a strict profile for LLM tools) and is read back from it.
- **Domain models that evolve.** Entities, registries and projections with references,
  relations and indexes are assembled into a [Model](/guide/model); the model is a JSON
  snapshot, and two snapshots are [compared and classified](/guide/evolution) as backward,
  forward or fully compatible.

## What sets it apart

- **Fast, on any runtime.** Every check is compiled when the schema is built. Through the
  [JIT backend](/guide/compile) metaschema validates the moltar object 30 to 48 million times a
  second, and with unknown keys rejected only TypeBox's compiler is faster; on its closures,
  where `new Function` is not allowed, 4.6 to 9.8 million, ahead of every interpreter in the
  [benchmarks](/guide/benchmarks). Collecting every issue of an invalid value with its path
  costs it the least of the TypeScript-first validators (Ajv alone is faster), and a cold start
  (load, build, first check) takes 5.7 ms.

- **The definition is data.** `'?string'` is an optional string, `{ array: 'number' }` an array
  of numbers, `'Company'` a reference: a schema is an object literal you can store, send, diff
  and generate, not a chain of method calls. ArkType's string definitions and TypeBox's JSON
  Schema objects are data too; a metaschema definition also carries the model around the shape:
  kinds, references, indexes, aliases.
- **Every problem, as data, without paying for it.** Validation never throws on bad input. Each
  issue is `{ code, path, params, message }`, the path an array of keys, the message rendered
  once through the locale of the call (English and Ukrainian ship). `maxErrors` caps the
  number; most libraries offer only "the first" or "all".
- **Parse, not only a verdict.** Defaults (a value or a factory), decoders, `unknown: 'strip'`,
  aliases renamed and `serialize` back are passes over the built schema that cost nothing when
  the schema has nothing for them. `checkAsync` and `parseAsync` run independent async
  validators together.
- **A model, not only shapes.** Kinds with storage metadata, references that validate as an id
  or as the embedded record, indexes, relations, projections, a model that orders its entities
  and reports what is missing; then a snapshot, `diff`, `compatibility`, aliases and
  `deprecated` for its history. Among the validators in the [comparison](/guide/comparison) none
  has references, indexes and relations; Mongoose has them as an ODM, and the formats built for
  evolution (Avro, Protocol Buffers) have no inferred types or JSON Schema export.
- **Tools around the schema.** [`sample`](/guide/samples) draws values a schema accepts,
  [`infer`](/guide/infer) writes a definition from data, `merge` unifies two schemas,
  [`pick`, `omit` and `partial`](/guide/derive) derive the bodies of an API from an entity,
  [coercion](/guide/coercion) reads query strings and forms, [`checkEach` and
  `transform`](/guide/streaming) validate iterables and Web Streams of records,
  [`./formats`](/guide/formats) checks 35 formats and your own, and
  [`./mongodb`](/guide/mongodb) writes and reads the documents of MongoDB.
- **Zero dependencies, any runtime.** Nothing is installed besides the package; the core entry
  is 18.1 KB min+gzip, and the generators (7.4 KB), the JIT backend (4.2 KB), the model tools
  (12.0 KB), the record tools (1.0 KB), the string formats (4.0 KB), the derive tools (1.9 KB),
  the converters of coercion (1.4 KB) and the MongoDB tools (3.5 KB on top of the converters)
  are subpaths a program pays for only when it imports them. CommonJS with ESM named imports, no build step,
  hand-written typings, Node.js 18+ and browsers, and nothing that needs `eval` unless you ask
  for the JIT.

## When something else fits better

- **The smallest possible bundle for a few form fields.** Valibot builds the comparison's
  schema in about 1.2 KB min+gzip and zod/mini in about 5 KB; metaschema's core carries its
  whole language (unions, references, formats, parse) in 18 KB.
- **A JSON Schema document is the contract.** Ajv implements every draft and keyword;
  `fromJSONSchema` reads a subset of JSON Schema into a metaschema definition.
- **TypeScript types are the source of truth.** typia compiles validators from the types
  themselves, at the price of a compiler step.
- **Bytes on the wire across languages.** Avro (avsc) and Protocol Buffers (protobuf.js) encode
  binary data and are shared with other languages; metaschema describes and checks JavaScript
  values.
- **An ODM around MongoDB.** Mongoose adds queries, `populate`, middleware and change tracking
  around its schemas; [`./mongodb`](/guide/mongodb) covers the schema side (BSON types, `_id`
  and references, indexes, the validator, checked updates) with your own driver, and does no
  I/O.

The [comparison](/guide/comparison) has the whole picture, feature by feature, and
[Benchmarks](/guide/benchmarks) the numbers.

## Where it comes from

metaschema started as [`metaschema`](https://github.com/metarhia/metaschema) in the
[Metarhia](https://github.com/metarhia) stack. `@alexify/metaschema` is a fork maintained by
Alexis Technologies. 1.0 kept the schema language and the validation semantics, dropped the
runtime dependencies and removed loading schemas from the file system; 2.0 rewrote the
validation core and settled the semantics the language left open; 3.0 added `parse`, the async
methods, the JSON Schema and TypeScript generators and the JIT backend; 3.1 the model as data
(snapshots, `diff`, `compatibility`, `sample`, `merge`, aliases); 3.2 records and streams,
`infer` and string formats. See [Migrating from metarhia](/guide/migrating-from-metarhia),
[Migrating from 1.x](/guide/migrating-from-1) and [Migrating from 2.x](/guide/migrating-from-2)
for the exact differences.
