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

user.check({ name: { first: 'Marcus' }, email: 'm@r', roles: ['owner'] }).errors;
// [
//   'Field "User.name.last" is required',
//   'Field "User.email" value is too short',
//   'Field "User.roles[0]" value is not of enum: admin, editor, viewer'
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
- **Fast.** Every check is compiled into a closure when the schema is built: about 11 million
  validations a second of a flat struct on Node 24 (`pnpm bench`).
- **Zero dependencies, under 10 KB min+gzip.** CommonJS with ESM named imports, no build step,
  one package for Node.js and browsers.

## Installation

```bash
pnpm add @alexify/metaschema
# or
npm install @alexify/metaschema
```

Requires Node.js 18 or newer. Works in browsers through any bundler.

## Schema syntax

| Form | Example | Meaning |
| --- | --- | --- |
| Type name | `title: 'string'` | a required string |
| Optional | `subtitle: '?string'` or `'subtitle?': 'string'` | `undefined` / `null` allowed |
| Nullable | `parent: { type: 'string', nullable: true }` | the key is required, the value may be `null` |
| Long form | `login: { type: 'string', length: [3, 32] }` | a type with options, `type` first |
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

`saveTypes(outputFile, model)` writes `model.dts` to a file. The first key of a definition sets
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

## Exports

```js
const {
  KIND, KIND_STORED, KIND_MEMORY, SCOPE, STORE, ALLOW,
  getKindMetadata, saveTypes, Schema, Model, SchemaDefinitionError, ValidationResult,
} = require('@alexify/metaschema');
```

```js
import { Schema, Model } from '@alexify/metaschema';
```

In the browser every export works the same, except `saveTypes`, which rejects because there is no
file system. The [API reference](https://metaschema.vercel.app/api/exports) lists every member.

## Migrating from `metaschema` (metarhia)

`@alexify/metaschema` is a fork of [`metaschema`](https://github.com/metarhia/metaschema) 2.2. The
schema language and the validation rules are the same. What changed:

- **No loader.** `createSchema`, `loadSchema`, `readDirectory` and `loadModel` are removed along
  with the `metavm` sandbox. Use `new Schema(name, require('./schemas/User.js'))` and
  `new Model(types, new Map([...]), database)`. Schema files written as `({ ... })` become modules
  (`module.exports = { ... }`).
- **No runtime dependencies:** `metautil`, `metavm` and `metaskills` are gone.
- **Fixed messages, no old text kept:** `Field "..."` instead of `Filed "..."`,
  `not of expected type: object` instead of `is not a object`, and "more than" instead of
  "more then".
- **`detouch` is renamed to `detach`**, with no alias.
- **`browser.js`** replaces `dist.js`, and an `exports` map closes deep imports.

The full list is in [Migrating from metarhia](https://metaschema.vercel.app/guide/migrating-from-metarhia)
and the [CHANGELOG](./CHANGELOG.md).

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## License

[MIT](./LICENSE) © Alexis Technologies

`@alexify/metaschema` is a fork of [`metaschema`](https://github.com/metarhia/metaschema) by the
[Metarhia contributors](https://github.com/metarhia/metaschema/graphs/contributors), originally
part of the [Metarhia](https://github.com/metarhia) technology stack. Their copyright is kept in
[LICENSE](./LICENSE).
