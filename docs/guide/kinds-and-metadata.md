# Kinds and Metadata

The first key of a definition can be a capitalized **kind**. Its value is the schema's metadata,
and the remaining keys are its fields:

```js
const { Schema } = require('@alexify/metaschema');

const company = new Schema('Company', {
  Registry: { scope: 'global' },
  name: { type: 'string', unique: true },
});

company.kind; // 'registry'
company.scope; // 'global'
company.store; // 'persistent'
```

Without a kind, an object definition is a `struct`.

## Built-in kinds

| Kind | Group | Default `scope` | Default `store` | Adds an id field |
| --- | --- | --- | --- | --- |
| `Struct` | memory | `local` | `memory` | no |
| `Scalar` | memory | `local` | `memory` | no |
| `Form` | memory | `local` | `memory` | no |
| `Projection` | memory | `local` | `memory` | no |
| `Entity` | stored | `application` | `persistent` | yes |
| `Registry` | stored | `application` | `persistent` | yes |
| `Dictionary` | stored | `application` | `persistent` | yes |
| `Journal` | stored | `application` | `persistent` | yes |
| `Details` | stored | `application` | `persistent` | yes |
| `Relation` | stored | `application` | `persistent` | yes |
| `View` | stored | `application` | `persistent` | yes |

`allow` defaults to `'write'` for every kind. The exported constants list the values:

```js
const { KIND, KIND_STORED, KIND_MEMORY, SCOPE, STORE, ALLOW } = require('@alexify/metaschema');

KIND_STORED; // ['entity', 'registry', 'dictionary', 'journal', 'details', 'relation', 'view']
KIND_MEMORY; // ['struct', 'scalar', 'form', 'projection']
SCOPE; // ['application', 'global', 'local']
STORE; // ['persistent', 'memory']
ALLOW; // ['write', 'append', 'read']
```

**Stored kinds get an id field.** A stored schema gains an optional string field named after it:
`Company` gets `companyId`, an anonymous schema gets `id`.

## Metadata fields

| Field | Meaning |
| --- | --- |
| `kind` | the kind, in lower camel case |
| `scope` | `'application'`, `'global'` or `'local'` |
| `store` | `'persistent'` or `'memory'` |
| `allow` | `'write'`, `'append'` or `'read'` |
| `parent` | the parent schema of a projection |
| `custom` | any other metadata keys |

## Custom kinds

Any capitalized key works as a kind. Unknown kinds behave like memory kinds, and their metadata
ends up in `schema.custom`:

```js
const settings = Schema.from({ Settings: { theme: 'dark' }, mode: 'string' });
settings.kind; // 'settings'
settings.custom; // { theme: 'dark' }
```

## Projections

A projection copies selected fields from another entity in the same model:

```js
const entities = new Map([
  ['Account', { Registry: {}, login: { type: 'string', unique: true }, password: 'string', email: 'string' }],
  ['Signin', { Projection: { schema: 'Account', fields: ['login', 'password'] } }],
]);
```

The copied fields keep their type and options. Projections are built after every other entity,
so they may refer to entities defined later in the map.

## Indexes

Keys whose value holds `index`, `primary` or `unique` with an array of field names are indexes,
not fields. They are collected in `schema.indexes`:

```js
const address = new Schema('Address', {
  Entity: {},
  street: 'string',
  building: 'string',
  naturalKey: { primary: ['street', 'building'] },
  byStreet: { index: ['street'] },
});

Object.keys(address.indexes); // ['naturalKey', 'byStreet']
Object.keys(address.fields); // ['street', 'building', 'addressId']
```

`many` reference fields are listed in `indexes` as well, and stay fields.

## Options

Top-level `validate`, `format`, `parse` and `serialize` functions are schema options, stored in
`schema.options`. metaschema itself calls only `validate`; see
[Validation](/guide/validation#custom-validation). The others are kept for code that builds on the
schema.
