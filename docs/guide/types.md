# Types

## Scalars

| Type | Accepts | `length` rule |
| --- | --- | --- |
| `string` | `typeof value === 'string'` | string length |
| `number` | `typeof value === 'number'` | the number itself |
| `bigint` | `typeof value === 'bigint'` | the number itself |
| `boolean` | `typeof value === 'boolean'` | — |
| `enum` | one of the listed values | — |

```js
Schema.from({
  id: 'bigint',
  active: 'boolean',
  role: { enum: ['admin', 'user'] },
  level: { type: 'enum', enum: [1, 2, 3] },
});
```

## Collections

| Type | Accepts | Definition |
| --- | --- | --- |
| `array` | an `Array` | `{ array: <item> }` |
| `set` | a `Set` | `{ set: <item> }` |
| `object` | an object used as a dictionary | `{ object: { <keyType>: <value> } }` |
| `map` | a `Map` | `{ map: { <keyType>: <value> } }` |

The item or value can be any definition, including another collection or a nested struct:

```js
const schema = Schema.from({
  tags: { array: 'string' },
  matrix: { array: { array: 'number' } },
  ids: { set: 'number' },
  counters: { object: { string: 'number' } },
  labels: { map: { string: 'string' } },
});
```

Errors point at the element that failed: `Field "tags[1]" not of expected type: string`,
`Field "counters.visits" not of expected type: number`.

Elements are required. To allow `null` elements, mark the element optional: `{ array: '?string' }`
for a scalar, or the long form for a nested struct:

```js
const schema = Schema.from({
  stops: { array: { type: 'schema', schema: { city: 'string' }, required: false } },
});
schema.check({ stops: [null, { city: 'Lviv' }] }).valid; // true
```

## Tuples

An array definition is a tuple of scalars. Elements can be named, and the name shows up in errors:

```js
const point = Schema.from({ position: [{ x: 'number' }, { y: 'number' }] });
point.check({ position: [1, '2'] }).errors;
// [ 'Field "position(y1)" not of expected type: number' ]
```

Optional elements use the usual prefix (`['string', '?number']`). A tuple rejects arrays longer
than its definition. `{ tuple: ['string', 'number'] }` is the long form.

## `json`

`json` accepts any non-null object, including arrays, without looking inside it:

```js
Schema.from({ payload: 'json' }).check({ payload: { anything: [1, 2, 3] } }).valid; // true
```

## Rules

### `required`

Every field is required unless it is optional (`'?type'`, `'key?'` or `required: false`). An
optional field accepts `undefined` and `null`.

### `length`

`length` applies to `string`, `number`, `bigint`, `array` and `set` fields. It takes three forms:

| Value | Meaning |
| --- | --- |
| `length: 4` | at most 4 |
| `length: [3, 32]` | at least 3, at most 32 |
| `length: { min: 3, max: 32 }` | the same, written out |

For strings and collections it limits the size; for numbers it limits the value itself.

```js
const schema = Schema.from({
  login: { type: 'string', length: { min: 3, max: 8 } },
  age: { type: 'number', length: [18, 120] },
  tags: { array: 'string', length: { max: 2 } },
});
schema.check({ login: 'ab', age: 150, tags: ['a', 'b', 'c'] }).errors;
// [
//   'Field "login" value is too short',
//   'Field "age" exceeds the maximum length',
//   'Field "tags" exceeds the maximum length'
// ]
```

### `validate`

Any field can carry its own check. See [Validation](/guide/validation#custom-validation).

## Your own types

`Model` accepts a table of types, which can add database metadata to the built-in ones or define
new ones. See [Custom Types](/guide/custom-types).
