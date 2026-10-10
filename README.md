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
- **Domain models.** Entities, registries, dictionaries and projections, with references,
  relations and indexes, ordered by dependency and checked for missing references.
- **TypeScript.** `InferSchema<typeof schema>` is the type of a value the schema accepts,
  computed from the definition with nothing generated, and a model renders its entities as
  interfaces. The package ships hand-written typings for its own API.
- **Standard Schema.** Every schema implements [Standard Schema v1](https://standardschema.dev)
  (`schema['~standard']`), so tRPC, TanStack Form, Hono and any other consumer of the interface
  take it as they take a zod or valibot schema.
- **JSON Schema.** `toJSONSchema` renders a schema or a whole model as JSON Schema draft 2020-12
  or draft-07, an OpenAPI 3.0 schema object or a MongoDB `$jsonSchema`, with a strict profile for
  LLM structured outputs; `~standard.jsonSchema` is the Standard JSON Schema converter.
- **Fast.** Every check is compiled into a closure when the schema is built and runs in a context
  of its own: about 10 million validations a second of a flat struct on Node 24 (`pnpm bench`,
  see [Performance](https://metaschema.vercel.app/guide/performance)).
- **Zero dependencies, 15.7 KB min+gzip.** CommonJS with ESM named imports, no build step,
  one package for Node.js and browsers.

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
console.log(model.dts);
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

`saveTypes(outputFile, model, options?)` writes `model.dts` to a file (`model.toTypeScript({ named:
true })` names enums and nested structs, and a field's `description` is its JSDoc). The first key of a definition sets
its kind and metadata (`Entity`, `Registry`, `Dictionary`, `Journal`, `Details`, `Relation`,
`View`, `Struct`, `Form`, `Projection`, or any custom kind). Stored kinds default to
`scope: 'application'` and `store: 'persistent'`, and they get an id field; a reference to a
stored kind holds its id, a reference to a memory kind embeds the record, in `check` and in the
generated types alike. See
[Kinds and Metadata](https://metaschema.vercel.app/guide/kinds-and-metadata),
[Custom Types](https://metaschema.vercel.app/guide/custom-types) and
[Domain Models](https://metaschema.vercel.app/guide/model).

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
augmentation of `CustomTypes`. A model renders its entities as interfaces with `model.dts`. See
[TypeScript](https://metaschema.vercel.app/guide/typescript).

A `Schema<D>` is also a `StandardSchemaV1<Infer<D>, Infer<D>>` of `@standard-schema/spec`:
`schema['~standard']` is typed as `StandardProps<D>`, with `StandardResult<T>` and
`StandardOptions` beside it. See
[Standard Schema](https://metaschema.vercel.app/guide/standard-schema).

## JSON Schema

`schema.toJSONSchema(options)` renders the rules of `check` as a JSON Schema document, and
`model.toJSONSchema(options)` every entity of a model as a definition:

```js
user.toJSONSchema({ target: 'draft-07' });
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

answer.toJSONSchema({ profile: 'strict' }); // the dialect of OpenAI and Anthropic structured outputs
model.toJSONSchema({ target: 'mongodb' }); // one $jsonSchema validator per entity
```

The targets are `draft-2020-12` (the default), `draft-07`, `openapi-3.0` and `mongodb`; an
optional field accepts `null`, a reference to a stored kind is its id and a reference to a memory
kind a `$ref`, `validate` functions are not exported, and a type with no form in the target
(`bigint`, a `Date` on the way out) throws unless the call says `unrepresentable: 'any'`. The
export is checked against ajv for every form of the language. See
[JSON Schema](https://metaschema.vercel.app/guide/json-schema).

## Exports

```js
const {
  KIND, KIND_STORED, KIND_MEMORY, SCOPE, STORE, ALLOW,
  getKindMetadata, saveTypes, Schema, Model, SchemaDefinitionError, ValidationResult,
} = require('@alexify/metaschema');

const en = require('@alexify/metaschema/locales/en'); // the built-in messages
const uk = require('@alexify/metaschema/locales/uk'); // schema.check(value, { messages: uk })
```

```js
import { Schema, Model } from '@alexify/metaschema';
import type { Infer, InferSchema, InferEntity, CustomTypes, ValidationIssue } from '@alexify/metaschema';
```

In the browser every export works the same, except `saveTypes`, which rejects because there is no
file system. The [API reference](https://metaschema.vercel.app/api/exports) lists every member
and every exported type.

## Migrating

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
and the 2.0 changes above apply on top of it.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## License

[MIT](./LICENSE) © Alexis Technologies

`@alexify/metaschema` is a fork of [`metaschema`](https://github.com/metarhia/metaschema) by the
[Metarhia contributors](https://github.com/metarhia/metaschema/graphs/contributors), originally
part of the [Metarhia](https://github.com/metarhia) technology stack. Their copyright is kept in
[LICENSE](./LICENSE).
