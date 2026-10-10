# Why metaschema?

`@alexify/metaschema` describes data with plain JavaScript objects. One definition serves three
purposes:

- **Validation.** `schema.check(value)` walks the value and returns every error with the path where
  it occurred.
- **Domain modelling.** Entities, registries, dictionaries, projections, references between them,
  indexes and storage metadata, assembled into a `Model` that orders entities by dependency and
  reports missing references.
- **TypeScript.** `InferSchema<typeof schema>` is the type of a value a schema accepts, computed
  from the definition, and a model renders its entities as interfaces.

## What sets it apart

- **A small, readable syntax.** `'?string'` is an optional string, `'tags?'` an optional key,
  `{ array: 'number' }` an array of numbers, `['number', 'number']` a tuple. The long form
  (`{ type: 'string', length: { min: 3 } }`) is there when a field needs options.
- **Errors are data.** Validation never throws on bad input. Every problem comes back as an issue
  with a code, the path as an array of keys and the params it was made from; `result.errors` renders
  them as lines through a locale, and `result.valid` tells you whether there were any.
- **Standard Schema.** Every schema implements [Standard Schema v1](/guide/standard-schema), so
  tRPC, TanStack Form, Hono and the other consumers of the interface take it without an adapter.
- **Fast.** Every check is compiled into a closure when the schema is built: about 10 million
  validations a second of a flat struct on Node 24; see [Performance](/guide/performance).
- **Zero dependencies.** Nothing is installed besides the package itself, and the whole library is
  15.7 KB min+gzip.
- **One package for Node.js and browsers.** The browser entry is resolved automatically by
  bundlers.
- **No build step.** The package is CommonJS that ships exactly as written, with hand-written
  TypeScript declarations.

## Where it comes from

metaschema started as [`metaschema`](https://github.com/metarhia/metaschema) in the
[Metarhia](https://github.com/metarhia) stack. `@alexify/metaschema` is a fork maintained by
Alexis Technologies. 1.0 kept the schema language and the validation semantics, dropped the runtime
dependencies, and removed loading schemas from the file system; 2.0 rewrote the validation core and
settled the semantics the language left open. See
[Migrating from metarhia](/guide/migrating-from-metarhia) and
[Migrating from 1.x](/guide/migrating-from-1) for the exact differences.
