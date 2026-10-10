# Getting Started

## Installation

```bash
pnpm add @alexify/metaschema
# or
npm install @alexify/metaschema
```

Node.js 18 or newer. The package has no runtime dependencies.

## Validate a value

```js
const { Schema } = require('@alexify/metaschema');

const schema = Schema.from({
  name: {
    first: 'string',
    last: 'string',
    third: '?string',
  },
  age: 'number',
  levelOne: {
    levelTwo: {
      levelThree: { type: 'enum', enum: [1, 2, 3] },
    },
  },
  collection: { array: { array: 'number' } },
});

const data = {
  name: { first: 'a', last: 'b' },
  age: 5,
  levelOne: { levelTwo: { levelThree: 1 } },
  collection: [
    [1, 2, 3],
    [3, 5, 6],
  ],
};

console.log(schema.check(data));
// ValidationResult { valid: true, errors: [], issues: [] }
```

When the value does not match, `check` reports every problem it finds:

```js
const result = schema.check({ name: { first: 'a' }, age: '5' });
console.log(result.valid); // false
console.log(result.errors);
// [
//   'Field "name.last" is required',
//   'Field "age" not of expected type: number',
//   'Field "levelOne" is required',
//   'Field "collection" is required'
// ]
result.issues[1];
// { code: 'type', path: ['age'], message: 'not of expected type: number', params: { expected: 'number', received: 'string' } }
```

`errors` is the list to print; `issues` is the same problems as data, for a form or an API
response.

## ESM and TypeScript

The package is CommonJS, and its named exports are visible to ESM:

```js
import { Schema, Model } from '@alexify/metaschema';
```

Type declarations ship with the package (`index.d.ts`), so TypeScript needs no extra setup, and
`InferSchema<typeof schema>` is the type of a value a schema accepts; see
[TypeScript](/guide/typescript#inferring-types-from-a-schema).

## Next steps

- [Schema Syntax](/guide/schema-syntax): every way to write a field.
- [Validation](/guide/validation): what `check` returns and how to add your own rules.
- [Domain Models](/guide/model): entities, references and generated TypeScript.
- [Migrating from 1.x](/guide/migrating-from-1): what changed in 2.0, if you come from 1.x.
