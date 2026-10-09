# TypeScript

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
| `{ enum: ['open', 'done'] }` | `"open" \| "done"` |
| `{ array: T }`, `{ set: T }` | `T[]` |
| `['number', 'number']` | `[number, number]` |
| `{ object: { string: T } }` | `Record<string, T>` |
| `{ map: { number: T } }` | `Map<number, T>` |
| a nested struct | an inline object: `{ city: string; zip?: string }` |
| `'json'` | `unknown` |
| a custom type with its own `checkType` | `string` |
| `company: 'Company'` | an id: `companyId: string` |
| `addresses: { many: 'Address' }` | ids: `addressesId: string[]` |

Optional fields get `?`, and stored kinds include their own id field (`userId?: string`).

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

`@alexify/metaschema` ships hand-written declarations in `index.d.ts`. Besides `Schema`, `Model`
and the functions, it exports the `Kind`, `Scope`, `Store`, `Allow`, `Cardinality`, `Relation` and
`ValidationResult` types:

```ts
import { Schema, type Kind, type ValidationResult } from '@alexify/metaschema';

const schema = Schema.from({ name: 'string' });
const kind: Kind = schema.kind;
const result: ValidationResult = schema.check({ name: 'Marcus' });
```
