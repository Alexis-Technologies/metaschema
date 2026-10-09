# Types

## Scalars

| Type | Accepts | Rules |
| --- | --- | --- |
| `string` | `typeof value === 'string'` | `length`, `unicode`, `pattern` |
| `number` | `typeof value === 'number'` (`NaN` included) | `min`, `max` |
| `integer` | a number without a fraction (`Number.isInteger`) | `min`, `max` |
| `bigint` | `typeof value === 'bigint'` | `min`, `max` |
| `boolean` | `typeof value === 'boolean'` | — |
| `date` | a `Date` instance with a valid time (`new Date('nope')` is rejected) | — |
| `null` | `null` only | — |
| `any`, `unknown` | any value, `null` and `undefined` included | — |
| `enum` | one of the listed values | — |

```js
Schema.from({
  id: 'bigint',
  count: { type: 'integer', min: 0 },
  active: 'boolean',
  created: 'date',
  deleted: 'null',
  payload: 'any',
  role: { enum: ['admin', 'user'] },
  level: { type: 'enum', enum: [1, 2, 3] },
});
```

`any` and `unknown` are the same type under two names (they differ only in the TypeScript they
render); a required `any` field still has to be present. `null` is for a field that must be
`null`; a field that may be `null` next to its type is [`nullable`](#nullable), and one that may
be absent is optional.

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

An array definition is a tuple: a fixed-length array whose elements are each a definition of
their own, scalar or not. Errors address them by index:

```js
const row = Schema.from({ row: ['string', { array: 'number' }, { x: 'number', y: 'number' }] });
row.check({ row: ['a', [1, 'b'], { x: 1 }] }).errors;
// [ 'Field "row[1][1]" not of expected type: number', 'Field "row[2].y" is required' ]
```

A one-key object holding a type name is a **named** scalar element, as in upstream metaschema:
`[{ x: 'number' }, { 'y?': 'number' }]` is two numbers named `x` and `y` (the name is kept on the
element type, `fields.position.value[1].name`), not two one-field structs. A struct element with
one field is written with the `schema` shorthand: `[{ schema: { x: 'number' } }]`.

Optional elements use the usual prefix (`['string', '?number']`) or the optional key of a named
element. A tuple rejects arrays longer than its definition. `{ tuple: ['string', 'number'] }` is
the long form.

## Unions

`{ union: [...] }` accepts a value that matches one of its branches, each a definition of its own.
Without a discriminator the branches are tried in order, the first one that reports nothing wins,
and what a failed branch reported is dropped; a value that matches none is one `union` issue with
the branch names:

```js
const schema = Schema.from({ id: { union: ['string', 'number'] } });
schema.check({ id: true }).issues;
// [ { code: 'union', path: ['id'], message: 'does not match any of: string, number', params: { expected: ['string', 'number'], discriminator: undefined } } ]
```

With `discriminator: '<field>'` every branch must be a nested struct whose field of that name is
an `enum`. The branch is picked from the value of that field in one lookup, built when the schema
is built, so the other branches are never tried, and a value with an unknown or missing
discriminator is one `union` issue at the discriminator's path:

```js
const canvas = new Schema('Canvas', {
  shape: {
    union: [
      { kind: { enum: ['circle'] }, r: 'number' },
      { kind: { enum: ['square', 'rect'] }, side: 'number' },
    ],
    discriminator: 'kind',
  },
});
canvas.check({ shape: { kind: 'circle', side: 1 } }).errors;
// [ 'Field "Canvas.shape.r" is required', 'Field "Canvas.shape" has unexpected keys: side' ]
canvas.check({ shape: { kind: 'line' } }).errors;
// [ 'Field "Canvas.shape.kind" is not one of: circle, square, rect' ]
```

A branch may be a `Schema` instance. A reference (`'Shape'`) resolves when a value is checked, so
it can be a branch of a plain union but not of a discriminated one. An empty branch list, a
branch without the discriminator field or with a non-enum one, and a discriminator value shared
by two branches throw `ERR_INVALID_UNION`. In TypeScript a union renders as `A | B`.

## `json`

`json` accepts any non-null object, including arrays, without looking inside it:

```js
Schema.from({ payload: 'json' }).check({ payload: { anything: [1, 2, 3] } }).valid; // true
```

## Rules

### `required`

Every field is required unless it is optional (`'?type'`, `'key?'` or `required: false`). An
optional field accepts `undefined` and `null`.

### `nullable`

`nullable: true` lets the value be `null` while the key stays required, for a column that is
present in every row but may be empty. It is separate from optional: an optional field may be
absent, a nullable one may not.

```js
const schema = Schema.from({
  parent: { type: 'string', nullable: true },
  'nick?': 'string',
});
schema.check({ parent: null }).valid; // true
schema.check({}).errors; // [ 'Field "parent" is required' ]
schema.check({ parent: undefined }).errors; // [ 'Field "parent" not of expected type: string' ]
```

A nullable field skips its rules and `validate` for `null`. It renders as `T | null` in TypeScript,
and `nullable` applies to any type, including a nested struct (`{ schema: {...}, nullable: true }`)
and a collection element (`{ array: { type: 'string', nullable: true } }`).

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
