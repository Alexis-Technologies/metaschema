# Types

## Scalars

| Type | Accepts | Rules |
| --- | --- | --- |
| `string` | `typeof value === 'string'` | `length`, `unicode`, `pattern` |
| `number` | `typeof value === 'number'` (`NaN` included) | `min`, `max` |
| `integer` | a number without a fraction (`Number.isInteger`) | `min`, `max` |
| `bigint` | `typeof value === 'bigint'` | `min`, `max` |
| `boolean` | `typeof value === 'boolean'` | — |
| `enum` | one of the listed values | — |

```js
Schema.from({
  id: 'bigint',
  count: { type: 'integer', min: 0 },
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

An array definition is a tuple of scalars. Elements can be named (the name is kept on the element
type, `point.fields.position.value[1].name`); errors address them by index:

```js
const point = Schema.from({ position: [{ x: 'number' }, { y: 'number' }] });
point.check({ position: [1, '2'] }).errors;
// [ 'Field "position[1]" not of expected type: number' ]
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

Every type lists the rules it accepts, and a rule on a type that does not accept it is a
`SchemaDefinitionError` (`ERR_INVALID_RULE`) when the schema is built: `{ type: 'number', length:
3 }` throws with the hint to use `min` and `max`, and so does `{ type: 'string', min: 1 }`. A
[custom type](/guide/custom-types) names its rules in `rules: [...]`; an alias (`{ js: 'number' }`)
accepts the rules of the type it aliases.

### `length`

`length` applies to `string`, `array`, `set`, `object` and `map` fields and limits their size. It
takes three forms:

| Value | Meaning |
| --- | --- |
| `length: 4` | at most 4 |
| `length: [3, 32]` | at least 3, at most 32 |
| `length: { min: 3, max: 32 }` | the same, written out |

```js
const schema = Schema.from({
  login: { type: 'string', length: { min: 3, max: 8 } },
  tags: { array: 'string', length: { max: 2 } },
});
schema.check({ login: 'ab', tags: ['a', 'b', 'c'] }).errors;
// [
//   'Field "login" value is too short',
//   'Field "tags" exceeds the maximum length'
// ]
```

A string is measured in UTF-16 code units, the same as `value.length`, so an emoji counts as two.
`unicode: true` measures code points instead:

```js
Schema.from({ s: { type: 'string', length: { max: 2 } } }).check({ s: '😀😀' }).valid; // false
Schema.from({ s: { type: 'string', length: { max: 2 }, unicode: true } }).check({ s: '😀😀' }).valid; // true
```

A `length` whose `min` is above its `max` can never pass and throws `ERR_INVALID_LENGTH`.

### `min` and `max`

`min` and `max` bound a `number`, `integer` or `bigint` value. Each is a number or a bigint, and a
bigint bound is compared exactly, never through `Number`:

```js
const schema = Schema.from({
  age: { type: 'integer', min: 18, max: 120 },
  balance: { type: 'bigint', min: 0n },
  ratio: { type: 'number', max: 1 },
});
schema.check({ age: 150, balance: -1n, ratio: 1 }).errors;
// [ 'Field "age" is greater than 120', 'Field "balance" is less than 0' ]
schema.check({ age: 150 }).issues[0];
// { code: 'range', path: ['age'], message: 'is greater than 120', params: { min: 18, max: 120, actual: 150 } }
```

A `max` below `min` throws `ERR_INVALID_RULE`.

### `pattern`

`pattern` tests a string against a regular expression, given as a string or a `RegExp`. It is
compiled once, when the schema is built, with the `u` flag (so `\p{L}` and astral characters
work) and without `g` and `y`, whose `lastIndex` would make repeated tests disagree. The field
keeps the compiled `RegExp`, and a failed match is a `pattern` issue with the source in `params`:

```js
const schema = Schema.from({
  slug: { type: 'string', pattern: '^[a-z0-9-]+$', length: { max: 64 } },
  name: { type: 'string', pattern: /^\p{L}+$/i, length: { max: 64 } },
});
schema.fields.slug.pattern; // /^[a-z0-9-]+$/u
schema.check({ slug: 'Hello World', name: 'Марк' }).issues;
// [ { code: 'pattern', path: ['slug'], message: 'does not match the pattern ^[a-z0-9-]+$', params: { pattern: '^[a-z0-9-]+$' } } ]
```

A pattern that does not compile throws `ERR_INVALID_RULE` when the schema is built. Pair every
`pattern` with a `length.max`; see [Patterns and ReDoS](/guide/validation#patterns-and-redos).

### `validate`

Any field can carry its own check. See [Validation](/guide/validation#custom-validation).

## Your own types

`Model` accepts a table of types, which can add database metadata to the built-in ones or define
new ones. See [Custom Types](/guide/custom-types).
