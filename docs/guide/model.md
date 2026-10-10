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
| `model.warnings` | lint and consistency warnings, `Warning [code]: text` |
| `model.dts` | TypeScript interfaces for every entity; `model.toTypeScript(options)` takes the [options](/guide/typescript#jsdoc-and-named-types) |
| `model.toJSONSchema(options)` | every entity as a [JSON Schema](/guide/json-schema#models) definition, or the document of one entity |

```js
model.order; // Set { 'Address', 'Company', 'User' }
model.entities.get('User').check({ login: 'ab', company: 'c1', active: true }).errors;
// [ 'Field "User.login" value is too short' ]
```

## Order

Entities are ordered so that each one comes after the entities it references. An entity named
`Identifier` always comes first. A cycle of any length (`A → B → A`, or `A → B → C → B`) is
reported as `Warning [recursive-reference]: "C" depends on "B" recursively` in `warnings`, naming
the edge where the walk met the cycle again, and the order is still produced. A schema that
references itself is fine.

## Warnings

A definition that can never validate correctly (an unknown type, an `enum` without values, a
`min` above `max`, a `length` on a number) is a broken definition and throws a
[`SchemaDefinitionError`](/api/exports#schemadefinitionerror) when the schema is built. What is
merely not what the author meant is a **warning**: a string of the form `Warning [code]: text`,
collected and never thrown. Every schema lints itself into `schema.warnings` when it is built,
and a model collects the warnings of its entities and adds its own:

| Code | Reported for | Found by |
| --- | --- | --- |
| `unknown-option` | a key of a field definition its type does not read (`{ type: 'string', shorthand: true }`); annotations (`default`, `unique`, `index`, `primary`, `title`, `description`, `examples`, `deprecated`) are known, and a custom type with its own `construct` owns its keys | `schema.warnings` |
| `unbounded-pattern` | a `pattern` without a `length.max`; see [Patterns and ReDoS](/guide/validation#patterns-and-redos) | `schema.warnings` |
| `missing-index-field` | an index (`index`, `primary`, `unique`) naming a field the schema does not have | `schema.warnings` |
| `missing-reference` | a reference to an entity that is not in the model | `model.warnings` (also `schema.checkConsistency()`) |
| `missing-type` | a type the schema can no longer resolve after a namespace is detached | `schema.checkConsistency()` |
| `recursive-reference` | a cycle in the references between entities | `model.warnings` |

```js
const broken = new Model(types, new Map([
  ['Order', { Entity: {}, buyer: 'Customer', total: { type: 'number', precision: 2 } }],
]));
broken.warnings;
// [
//   'Warning [unknown-option]: option "precision" of "Order.total" is not known to type "number"',
//   'Warning [missing-reference]: "Customer" referenced by "Order" is not found'
// ]
```

The path in an `unknown-option` warning follows the definition: `Order.address.city` for a nested
struct, `Order.tags[]` for the element of a collection, `Order.point[1]` for a tuple element,
`Order.shape|1` for a union branch. Treat warnings as a CI check (`assert.deepStrictEqual(model.warnings, [])`)
to catch a typo in an option name before it is silently ignored.

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
