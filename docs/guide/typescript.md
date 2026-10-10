# TypeScript

## Inferring types from a schema

`Infer<D>` is the TypeScript type of a value `check` accepts for the definition `D`, computed
from the definition's type alone, with nothing generated. `Schema.from` and `new Schema` keep
the definition as a type parameter (`Schema<D>`), and `InferSchema<typeof schema>` reads it:

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

The literal types of the definition are what `Infer` reads, so write the definition inline, as
above, or declare it `as const`. A definition held in a plain `const` widens `'string'` to
`string` and `['admin', 'user']` to `string[]`, and every field infers as `unknown`:

```ts
import type { Infer } from '@alexify/metaschema';

const definition = { name: 'string', role: { enum: ['admin', 'user'] } } as const;
type User = Infer<typeof definition>; // { name: string; role: 'admin' | 'user' }
```

| Definition | `Infer` |
| --- | --- |
| `'string'`, `'number'`, `'boolean'`, `'bigint'` | the scalar |
| `'integer'` | `number` |
| `'date'`, `'null'`, `'any'`, `'unknown'` | `Date`, `null`, `any`, `unknown` |
| `'json'` | `unknown` |
| `'?T'`, `{ type: 'T', required: false }` | `T \| null \| undefined`; in a struct, an optional property |
| `'key?': 'T'` | an optional property: `key?: T \| null \| undefined` |
| `{ type: 'T', nullable: true }` | `T \| null` |
| `{ type: 'T', ...options }` | `T`; the options do not change the type |
| `{ enum: ['open', 'done'] }` | `'open' \| 'done'` |
| `{ array: T }`, `{ set: T }` | `T[]`, `Set<T>` |
| `{ object: { string: T } }`, `{ map: { number: T } }` | `Record<string, T>`, `Map<number, T>` |
| `['number', 'string']`, `[{ x: 'number' }, { 'y?': 'number' }]` | `[number, string]`, `[number, number \| null \| undefined]` |
| `{ union: [A, B] }` | `A \| B`; a discriminated union is a union of its structs |
| a nested struct, `{ schema: {...} }`, a `Schema` instance | an object type |
| `'Company'`, `{ one: 'Company' }`, `{ type: 'Company' }` | `string`, the id |
| `{ many: 'Address' }` | `string[]` |
| `{ type: 'Company', embed: true }` | `unknown`, or the record with an [entity map](#references-and-entity-maps) |
| a custom type | its entry in [`CustomTypes`](#custom-types), else `unknown` |

A kind key (`Entity: {}`), an index definition (`{ unique: [...] }`), a calculated field (a
function) and the schema-level `validate`, `parse`, `serialize` and `format` are not fields and
do not appear in the type.

### What `Infer` reads

TypeScript keeps no key order, so where the runtime reads the
[first key](/guide/schema-syntax#the-first-key-decides), `Infer` reads the keys that are there:
an object with a kind key is a struct; otherwise one with a `type` string is the long form, one
with a collection key (`array`, `set`, `object`, `map`, `enum`, `tuple`, `union`, `schema`,
`one`, `many`) is that shorthand, and anything else is a struct. The two agree on every
definition the syntax guide shows, and differ on a struct with a field named `type` or like a
collection type that is not its first field: `{ name: 'string', type: 'string' }` validates as a
struct and infers as `string`. A kind settles it for both:

```ts
const part = Schema.from({ Struct: {}, type: { enum: ['cpu', 'ram'] }, name: 'string' });
type Part = InferSchema<typeof part>; // { type: 'cpu' | 'ram'; name: string }
```

### Custom types

`Infer` knows a custom type through the `CustomTypes` interface, extended by module
augmentation; a type name that is neither built in nor declared there infers as `unknown`:

```ts
// The types of the Custom Types guide: `datetime` is `{ js: 'string' }`,
// `decimal` validates a string with its own checkType.
declare module '@alexify/metaschema' {
  interface CustomTypes {
    datetime: string;
    decimal: string;
  }
}

const payment = Schema.from({ amount: 'decimal', createdAt: 'datetime', clientIp: '?ip' });
type Payment = InferSchema<typeof payment>;
// { amount: string; createdAt: string; clientIp?: unknown }
```

An alias of `schema` in the long form (`{ type: 'address', schema: { city: 'string' } }`) infers
as the struct it holds.

### References and entity maps

Without a model `Infer` cannot see what a reference points at, so it follows `check` outside a
model: every reference is an id (`string`, `string[]` for `many`) and `embed: true` is
`unknown`. `Infer<D, E>` takes an entity map `E`, the entities as an object by name, and applies
the [rule of `check`](/guide/references#storage-view-and-graph-view): a stored kind is its id, a
memory kind is the record, `embed` on the field overrides, and a projection has its parent's
fields. `InferEntity<E, 'Name'>` is one entity of the map with the id field its kind adds
(`personId?: string` for a stored `Person`), which `Infer<D>` and `InferSchema` leave out
because a definition does not carry the entity's name:

```ts
import { Model, type Infer, type InferEntity } from '@alexify/metaschema';

const entities = {
  Company: { Registry: {}, name: 'string' },
  Tag: { Struct: {}, label: 'string', parent: '?Tag' },
  Person: { Entity: {}, name: 'string', employer: 'Company', tags: { many: 'Tag' } },
} as const;

type Tag = Infer<'Tag', typeof entities>;
// { label: string; parent?: Tag | null | undefined }
type Person = InferEntity<typeof entities, 'Person'>;
// { name: string; employer: string; tags: Tag[]; personId?: string }

const model = new Model({}, new Map(Object.entries(entities)));
```

The entities of a model are plain `Schema` instances (`model.entities.get('Person')` is a
`Schema | undefined` and infers nothing); the entity map is the typed source.

### `Infer` and `model.dts`

Both follow the same rules, with two differences. The dts names a stored reference after its
column (`employerId: string`), where `check` reads the field (`employer`) and `Infer` types it as
such. The dts renders an optional field as `street?: string`, where `check` also accepts `null`
and `Infer` says `string | null | undefined`.

The typings need TypeScript 5.0 or later (const type parameters). The examples of this page are
compiled by `tests/types/infer.test-d.ts`. A `Schema<D>` is also a Standard Schema whose input
and output types are `Infer<D>`; see [Standard Schema](/guide/standard-schema#typescript).

## Generating interfaces from a model

`model.dts` renders every entity as a TypeScript interface, in dependency order:

```js
const model = new Model(types, entities);
console.log(model.dts);
```

For the model in [Domain Models](/guide/model) this prints:

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

Rules of the conversion:

| Definition | TypeScript |
| --- | --- |
| `'string'`, `'number'`, `'boolean'`, `'bigint'`, and aliases of them (`{ js: 'string' }`) | the same scalar |
| `'integer'` | `number` |
| `'date'`, `'null'`, `'any'`, `'unknown'` | `Date`, `null`, `any`, `unknown` |
| `{ union: [A, B] }` | `A \| B` |
| `{ enum: ['open', 'done'] }` | `"open" \| "done"` |
| `{ array: T }` | `T[]` |
| `{ set: T }` | `Set<T>` |
| `['number', 'number']` | `[number, number]` |
| `{ object: { string: T } }` | `Record<string, T>` |
| `{ map: { number: T } }` | `Map<number, T>` |
| a nested struct | an inline object: `{ city: string; zip?: string }` |
| `{ type: T, nullable: true }` | `T \| null` |
| `'json'` | `unknown` |
| a custom type with its own `checkType` | `string` |
| `company: 'Company'`, a stored kind | an id: `companyId: string` |
| `addresses: { many: 'Address' }`, a stored kind | ids: `addressesId: string[]` |
| `label: 'Tag'`, a memory kind | the interface: `label: Tag` (`tags: Tag[]` for `many`) |
| `{ type: 'Company', embed: true }` / `{ type: 'Tag', embed: false }` | the record / the id, whatever the kind |

Optional fields get `?`, and stored kinds include their own id field (`userId?: string`). Whether a
reference is an id or the interface follows the [storage view and graph view](/guide/references#storage-view-and-graph-view)
rule of `check`; a reference `toInterface()` cannot resolve (outside a model) renders as an id.

`schema.toInterface()` renders a single schema the same way; a schema whose definition is a single
type renders as a type alias (`type Pair = [number, string];`).

### Writing the file

`saveTypes(outputFile, model)` writes `model.dts` to a file and returns a promise:

```js
const { saveTypes } = require('@alexify/metaschema');

await saveTypes('./types/model.d.ts', model);
```

It is a thin wrapper over `fs.promises.writeFile(outputFile, model.dts)`, and the only API that
touches the file system. In the browser it rejects.

## Typings for the package

`@alexify/metaschema` ships hand-written declarations in `index.d.ts`. Besides the classes and
functions, it exports a type for everything public: `Infer`, `InferSchema`, `InferEntity`,
`CustomTypes`, `Kind`, `Scope`, `Fields`, `FieldType`, `TypeEntry`, `ValidationIssue`,
`DefinitionErrorCode` and the rest listed in the [API reference](/api/exports#types):

```ts
import { Schema, type Kind, type ValidationResult } from '@alexify/metaschema';

const schema = Schema.from({ name: 'string' });
const kind: Kind = schema.kind;
const result: ValidationResult = schema.check({ name: 'Marcus' });
```
