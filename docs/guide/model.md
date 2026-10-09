# Domain Models

A `Model` is a set of named schemas that can refer to each other, plus a table of types and
optional database metadata.

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

const database = { name: 'example', driver: 'pg', version: 1 };

const model = new Model(types, entities, database);
```

`new Model(types, entities, database?)` takes:

- `types`: built-in type annotations and custom types (see [Custom Types](/guide/custom-types)).
- `entities`: any iterable of `[name, definition]` pairs, such as a `Map` or `Object.entries(...)`.
  A definition can also be a `Schema` instance.
- `database`: any metadata you want to carry with the model. metaschema stores it as
  `model.database` and does not read it.
- `options`: `{ registry: 'isolated' }` gives the model its own type registry instead of the
  process-wide one; see [Custom Types](/guide/custom-types#an-isolated-registry).

## What a model holds

| Property | Contents |
| --- | --- |
| `model.entities` | `Map` of name → `Schema` |
| `model.types` | the type table, including custom types |
| `model.database` | the `database` argument, or `null` |
| `model.order` | `Set` of entity names, dependencies first |
| `model.warnings` | consistency warnings |
| `model.dts` | TypeScript interfaces for every entity |

```js
model.order; // Set { 'Address', 'Company', 'User' }
model.entities.get('User').check({ login: 'ab', company: { name: 'Acme', addresses: [] }, active: true }).errors;
// [ 'Field "User.login" value is too short' ]
```

## Order

Entities are ordered so that each one comes after the entities it references. An entity named
`Identifier` always comes first. A cycle of any length (`A → B → A`, or `A → B → C → B`) is
reported as `Warning: "C" depends on "B" recursively` in `warnings`, naming the edge where the
walk met the cycle again, and the order is still produced. A schema that references itself is
fine.

## Warnings

While building, the model checks that every referenced entity exists. A missing reference does
not throw; it is collected in `model.warnings`:

```js
const broken = new Model(types, new Map([['Order', { Entity: {}, buyer: 'Customer' }]]));
broken.warnings;
// [ 'Warning: "Customer" referenced by "Order" is not found' ]
```

An unknown lowercase type name is different: it is a broken definition, so building the model
throws `SchemaDefinitionError: Unknown type "<name>" in "<Entity>.<field>"` (code
`ERR_UNKNOWN_TYPE`).

## Loading schemas from files

metaschema does not read files. Keep each schema in a module and assemble the map yourself:

```js
// schemas/Company.js
module.exports = { Dictionary: {}, name: { type: 'string', unique: true } };

// model.js
const { Model } = require('@alexify/metaschema');

const entities = new Map([
  ['Company', require('./schemas/Company.js')],
  ['Address', require('./schemas/Address.js')],
]);

const model = new Model(types, entities);
```
