# metaschema

[![npm](https://img.shields.io/npm/v/%40alexify%2Fmetaschema)](https://www.npmjs.com/package/@alexify/metaschema)
[![CI](https://github.com/Alexis-Technologies/metaschema/actions/workflows/ci.yml/badge.svg)](https://github.com/Alexis-Technologies/metaschema/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/%40alexify%2Fmetaschema)](#installation)
[![dependencies](https://img.shields.io/badge/runtime_dependencies-0-brightgreen)](#why-metaschema)
[![docs](https://img.shields.io/badge/docs-online-blue)](https://metaschema.vercel.app/)
[![license](https://img.shields.io/npm/l/%40alexify%2Fmetaschema)](./LICENSE)

**Metadata schema and interface definition language for JavaScript.** Declare data structures and
domain models once as plain objects, validate data against them, and generate TypeScript
interfaces. Zero dependencies, Node.js and browsers.

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
  `pattern`; `@alexify/metaschema/formats` registers `uuid`, `email`, `date-time`, `date`,
  `time`, `ipv4`, `ipv6`, `uri`, `hostname` and your own, and the name travels into JSON Schema,
  samples and inference.
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
- **Fast.** Every check is compiled into a closure when the schema is built and runs in a context
  of its own: about 10 million validations a second of a flat struct on Node 24, and about 30
  million through the JIT backend of `@alexify/metaschema/compile`, which generates the same
  check where `new Function` is allowed and keeps the closures where it is not (`pnpm bench`,
  see [Performance](https://metaschema.vercel.app/guide/performance)).
- **The model as data.** `model.toJSON()` is a snapshot other programs read the model through
  (a migration tool, an introspecting service, a committed baseline), and
  `@alexify/metaschema/model` tells two versions apart (`diff`), classifies the change by the
  Confluent rules (`compatibility`), draws a value every schema accepts (`sample`), unifies two
  schemas (`merge`) and infers a definition from the values that exist (`infer`); `aliases` and
  `deprecated` let a model carry its history, and `fromJSONSchema` of the generators reads a
  JSON Schema document back.
- **Zero dependencies, 17.7 KB min+gzip.** CommonJS with ESM named imports, no build step,
  one package for Node.js and browsers; the generators add 7.1 KB, the JIT backend 4.2 KB, the
  model tools 12.0 KB, the record tools 1.0 KB and the string formats 1.3 KB where they are
  imported.

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
| Rules | `{ type: 'integer', min: 18, max: 120 }`, `{ type: 'string', pattern: '^[a-z]+$', length: { max: 32 } }` | `min`/`max` for numbers, `length`/`pattern` for strings, `length` for collections |
| Collections | `{ array: 'number' }`, `{ set: 'string' }`, `{ object: { string: 'number' } }`, `{ map: { string: 'string' } }` | |
| Enum | `{ enum: ['admin', 'user'] }` | one of the values |
| Tuple | `point: ['number', 'number']` | a fixed-length array, each element its own definition |
| Union | `id: { union: ['string', 'number'] }`, `{ union: [...], discriminator: 'kind' }` | one of several definitions |
| Nested struct | `name: { first: 'string', last: 'string' }` | an object whose first key is none of the above |
| Reference | `company: 'Company'`, `{ many: 'Address' }` | another schema in the model: its id for a stored kind, the record for a memory kind |
| Any object | `payload: 'json'` | any non-null object |
| Calculated | `ratio: (file) => file.compressed / file.size` | a function, never validated |

The first key of an object decides what it is. Built-in types: `string`, `number`, `integer`,
`bigint`, `boolean`, `date`, `null`, `any`/`unknown`, `enum`, `array`, `set`, `object`, `map`,
`tuple`, `union`, `json`. Rules: `length` (with `unicode: true` for code points) and `pattern`
for strings, `length` for collections, `min`/`max` for numbers; a rule on a type that does not
take it is a definition error. Fields can add a `validate(value, path)` function, and a schema
can have a top-level `validate` for rules across fields. `check(value, options)` takes `root`
(the label of the error lines), `maxErrors`, `unknown: 'ignore'` (keys the schema does not have;
`{ Struct: { unknown: 'ignore' } }` makes it the schema's default), `references` (`'kind'`,
`'embed'` or `'id'`) and `messages` (a locale); the result has `issues`, `errors`, `summary`,
`flatten()` and `tree()`. `schema.warnings` lints the definition (a mistyped option, a `pattern`
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

`format` names a form a string must have; `@alexify/metaschema/formats` registers the nine
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

A `Schema<D>` is also a `StandardSchemaV1<Infer<D>, Infer<D>>` of `@standard-schema/spec`:
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
const { compile, register, canEval } = require('@alexify/metaschema/compile');

compile(user); // { accelerated: true }: user.check runs generated code now
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
and named types. The step-by-step guide with before-and-after examples is
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
