---
layout: home

title: metaschema
titleTemplate: Fast, zero-dependency schemas, validation and TypeScript types for JavaScript

hero:
  name: metaschema
  text: Fast, zero-dependency schemas for JavaScript
  tagline: Declare data structures and domain models once as plain objects. Validate and parse them at tens of millions of checks a second, get every problem back as data, and generate TypeScript types and JSON Schema from the same definitions. Node.js and browsers.
  image:
    src: /logo-mark.svg
    alt: metaschema
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Why metaschema?
      link: /guide/why
    - theme: alt
      text: Compare with alternatives
      link: /guide/comparison

features:
  - icon: ⚡
    title: Fast, with or without eval
    details: "Every check is compiled when the schema is built: about 10 million checks a second of a flat object on the closures, about 30 million through the JIT backend, which keeps the closures where new Function is not allowed."
    link: /guide/benchmarks
    linkText: Benchmarks
  - icon: ✍️
    title: Compact schema syntax
    details: "Shorthands like '?string', 'key?', { array: 'number' } and ['number', 'number'] sit next to a long form for when a field needs options. A definition is a plain object you can store and send."
    link: /guide/schema-syntax
    linkText: Schema syntax
  - icon: ✅
    title: Every problem, as data
    details: "check() walks the whole value and returns every issue with a code, the path as keys, its params and a localized message. Collecting all of them is cheap: no exceptions, messages rendered once."
    link: /guide/validation
    linkText: Validation
  - icon: 🔄
    title: Parse, not only a verdict
    details: "parse() fills defaults, strips unknown keys, renames aliases and decodes fields into the values of the program; serialize() goes back. The async methods run independent validators together."
    link: /guide/parse
    linkText: Parse and serialize
  - icon: 🔷
    title: TypeScript from the definition
    details: "The type of a value a schema accepts, and of what parse gives, is inferred from the definition with nothing generated; a model renders its entities as interfaces."
    link: /guide/typescript
    linkText: TypeScript
  - icon: 🔌
    title: Standard Schema and JSON Schema
    details: "Every schema is a Standard Schema for tRPC, TanStack Form or Hono. Export JSON Schema 2020-12, draft-07, OpenAPI 3.0, MongoDB or a strict profile for LLM tools, and import JSON Schema back."
    link: /guide/json-schema
    linkText: JSON Schema
  - icon: 🧩
    title: Domain models that evolve
    details: "Entities, registries and projections with references, relations and indexes. A model is a JSON snapshot; diff two of them and classify the change as backward, forward or fully compatible."
    link: /guide/evolution
    linkText: Model evolution
  - icon: 🛠️
    title: Tools around the schema
    details: "Draw values a schema accepts, infer a definition from data, merge two schemas, validate streams of records, and check email, uuid, date-time and your own string formats."
    link: /guide/samples
    linkText: Sample values
  - icon: 📦
    title: Zero dependencies, any runtime
    details: "No runtime dependencies and 17.7 KB min+gzip for the core; generators, the JIT and the model tools are subpaths you import when you need them. CommonJS with ESM named imports, Node.js 18+ and browsers, no build step."
    link: /guide/browser
    linkText: Browser usage
---

<script setup>
import BenchCompare from './.vitepress/theme/components/BenchCompare.vue';
</script>

## Benchmarks

A check is a function call, and with the [JIT backend](/guide/compile) a straight-line one.
The chart runs the object of the moltar suite through metaschema and ten other validators on one
machine, each in a fresh process and checked for the right verdicts first. On the JIT metaschema
validates 30 to 48 million objects a second, and in the strict modes (unknown keys rejected) only
TypeBox's compiler is faster; on its closures, with no `eval` at all, 4.6 to 9.8 million, ahead
of every interpreter in the set. Asked for every issue of an invalid value with its path, it is
second only to Ajv, and 6 to 100 times faster than the other TypeScript-first validators.

<BenchCompare />

[Method, every issue of an invalid value, cold start, bundle size and release over release →](/guide/benchmarks)
