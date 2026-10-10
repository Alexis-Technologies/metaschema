# References

A capitalized type name refers to another schema. References only resolve inside a
[`Model`](/guide/model), which holds every entity and acts as the namespace for lookups.

```js
const { Model } = require('@alexify/metaschema');

const types = { string: {}, number: {}, boolean: {} };

const entities = new Map([
  ['Company', { Registry: {}, name: { type: 'string', unique: true }, addresses: { many: 'Address' } }],
  ['Address', { Entity: {}, city: 'string', street: 'string' }],
  ['Person', { Entity: {}, name: 'string', employer: 'Company', home: { one: 'Address' }, mentor: '?Person' }],
]);

const model = new Model(types, entities);
```

## Forms

| Field | Meaning |
| --- | --- |
| `employer: 'Company'` | one `Company` |
| `mentor: '?Person'` | an optional reference |
| `home: { one: 'Address' }` | one `Address`, written out |
| `addresses: { many: 'Address' }` | a list of `Address` records |
| `owner: { type: 'Person', required: false }` | the long form |

## Storage view and graph view

A reference can hold two different things. In the **storage view** a record holds the *id* of
the record it points at, the way a row holds a foreign key: `{ name: 'Ann', employerId: 'c1' }`.
In the **graph view** it holds the record itself, the way an API response or a form embeds it:
`{ name: 'Ann', employer: { name: 'Acme' } }`. Upstream metaschema validated the graph view and
generated TypeScript for the storage view, and nothing said which was meant.

### Decision

**The kind of the referenced schema decides, per field, and `check` and the generated TypeScript
follow the same rule.**

| Target | By default a reference holds | `check` accepts | TypeScript |
| --- | --- | --- | --- |
| a stored kind (`Entity`, `Registry`, `Dictionary`, `Journal`, `Details`, `Relation`, `View`) | its id | a string (`string[]` for `many`) | `employerId: string` |
| a memory kind (`Struct`, `Form`, `Scalar`, `Projection`, a custom kind) | the record | a value of that schema | `employer: Company` |

The rule reads the `store` of the target's kind: `persistent` is held by id, `memory` is embedded,
so `{ Struct: { store: 'persistent' } }` is held by id too. A stored kind lives in its own table and
a row holds its key; a memory kind has no table of its own, so it is part of the row.

Two overrides, from the narrowest to the widest:

- **`embed: true` or `embed: false` on the field** fixes that field whatever the kind of its target:
  `former: { many: 'Company', embed: true }` embeds stored companies; `label: { type: 'Tag', embed:
  false }` holds the id of a memory-kind tag. The generated TypeScript follows the field.
- **`check(value, { references })`** switches every reference of one check: `'embed'` validates the
  whole graph (an API payload, a document store), `'id'` validates rows as stored, and `'kind'`
  (the default) applies the rule and the field overrides above.

```js
const person = model.entities.get('Person');

person.check({ name: 'Ann', employer: 'c1', home: 'a1' }).valid; // true: Company and Address are stored
person.check({ name: 'Ann', employer: { name: 'Acme' }, home: 'a1' }).errors;
// [ 'Field "Person.employer" not of expected type: string' ]
person.check({ name: 'Ann', employer: { name: 'Acme', addresses: [] }, home: { city: 'Rome', street: 'Via Appia' } }, { references: 'embed' }).valid; // true
```

### Consequences

- A stored reference is one `typeof` check and never recurses, so a cyclic value (`category.parent
  === category`) against stored kinds is a plain type error, not a `circular` issue; `circular` is
  reported where a record is embedded and met again.
- A reference to an entity the model does not have is a `reference` issue in every mode.
- `schema.toInterface()` outside a model cannot resolve the target and renders the id form; inside a
  model the memory-kind target renders by its interface name, which `model.dts` emits.
- `Infer` applies the same rule through an [entity map](/guide/typescript#references-and-entity-maps):
  a stored reference is a string, a memory reference is the record. The
  [JSON Schema export](/guide/json-schema#references) follows it too: a stored reference is
  `{ type: 'string' }`, a memory reference a `$ref` to the definition of the entity, and the
  `references` option of `toJSONSchema` switches every reference as the option of `check` does.

## Validation

In the default mode a stored reference is an id and a memory reference is validated against its
schema. With `references: 'embed'` a record is checked together with the records it embeds:

```js
person.check(
  {
    name: 'Ann',
    employer: { name: 5, addresses: [{ city: 1, street: 'Main' }] },
    home: {},
  },
  { references: 'embed' },
).errors;
// [
//   'Field "Person.employer.name" not of expected type: string',
//   'Field "Person.employer.addresses[0].city" not of expected type: string',
//   'Field "Person.home.city" is required',
//   'Field "Person.home.street" is required'
// ]
```

A reference to an entity that is not in the model fails validation with
`Entity "<Name>" is not found`, and the model reports it as a warning when it is built (see
[Domain Models](/guide/model#warnings)).

## Relations and references

Each schema records what it points at:

- `schema.references` is a `Set` of every type and entity name the schema uses.
- `schema.relations` is a `Set` of `{ to, type }` entries, one per reference field, read from
  the referencing side: a `many` field is `'one-to-many'` (one record holds many of the target),
  any other reference is `'many-to-one'` (many records point at one target).

```js
person.relations;
// Set {
//   { to: 'Company', type: 'many-to-one' },
//   { to: 'Address', type: 'many-to-one' },
//   { to: 'Person', type: 'many-to-one' }
// }
```

The model uses `references` to order entities so that every entity comes after the ones it
depends on.

## In generated TypeScript

A reference follows the [same rule](#storage-view-and-graph-view) as `check`: a stored target is an
id (`employer: 'Company'` renders as `employerId: string`, `{ many: 'Address' }` as
`addressesId: string[]`), a memory target is the referenced interface (`label: 'Tag'` renders as
`label: Tag`, `{ many: 'Tag' }` as `tags: Tag[]`), and `embed` on the field turns one into the
other. See [TypeScript](/guide/typescript).
