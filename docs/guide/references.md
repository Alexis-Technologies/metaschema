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

## Validation

A referenced value is validated against the referenced schema, so a record can be checked together
with the records it embeds:

```js
const person = model.entities.get('Person');

person.check({
  name: 'Ann',
  employer: { name: 5, addresses: [{ city: 1, street: 'Main' }] },
  home: {},
}).errors;
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

A reference becomes an id: `employer: 'Company'` renders as `employerId: string`, and
`{ many: 'Address' }` as `addressesId: string[]`. See [TypeScript](/guide/typescript).
