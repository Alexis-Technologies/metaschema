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
- **Errors, not exceptions.** `check` walks the whole value and returns every problem with its
  path. Only a broken definition throws.
- **Domain models.** Entities, registries, dictionaries and projections, with references,
  relations and indexes, ordered by dependency and checked for missing references.
- **TypeScript.** A model renders its entities as interfaces. The package ships hand-written
  typings for its own API.
- **Zero dependencies, about 6 KB min+gzip.** CommonJS with ESM named imports, no build step, one
  package for Node.js and browsers.

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
| Long form | `login: { type: 'string', length: [3, 32] }` | a type with options |
| Collections | `{ array: 'number' }`, `{ set: 'string' }`, `{ object: { string: 'number' } }`, `{ map: { string: 'string' } }` | |
| Enum | `{ enum: ['admin', 'user'] }` | one of the values |
| Tuple | `point: ['number', 'number']` | a fixed-length array of scalars |
| Nested struct | `name: { first: 'string', last: 'string' }` | an object with its own fields |
| Reference | `company: 'Company'`, `{ many: 'Address' }` | another schema in the model |
| Any object | `payload: 'json'` | any non-null object |
| Calculated | `ratio: (file) => file.compressed / file.size` | a function, never validated |

Built-in types: `string`, `number`, `bigint`, `boolean`, `enum`, `array`, `set`, `object`, `map`,
`tuple`, `json`. Fields can add a `validate(value, path)` function, and a schema can have a
top-level `validate` for rules across fields. See
[Schema Syntax](https://metaschema.vercel.app/guide/schema-syntax) and
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
model.warnings; // [] (missing references end up here)
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
`scope: 'application'` and `store: 'persistent'`, and they get an id field. See
[Kinds and Metadata](https://metaschema.vercel.app/guide/kinds-and-metadata),
[Custom Types](https://metaschema.vercel.app/guide/custom-types) and
[Domain Models](https://metaschema.vercel.app/guide/model).

## Exports

```js
const {
  KIND, KIND_STORED, KIND_MEMORY, SCOPE, STORE, ALLOW,
  getKindMetadata, saveTypes, Schema, Model, SchemaDefinitionError,
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
