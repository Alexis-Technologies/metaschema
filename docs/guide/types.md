# Types

## Scalars

| Type | Accepts | Rules |
| --- | --- | --- |
| `string` | `typeof value === 'string'` | `length`, `unicode`, `pattern`, [`format`](/guide/formats) |
| `number` | `typeof value === 'number'` (`NaN` included) | `min`, `max`, `decimals` |
| `integer` | a number without a fraction (`Number.isInteger`) | `min`, `max` |
| `bigint` | `typeof value === 'bigint'` | `min`, `max` |
| `boolean` | `typeof value === 'boolean'` | — |
| `date` | a `Date` instance with a valid time (`new Date('nope')` is rejected) | — |
| `bytes` | a `Uint8Array` of any realm, a `Buffer` included | `length` (of bytes) |
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
render); a required `any` field still has to be present. `bytes` is binary data: a view is told
by the name the engine keeps in it, never by `instanceof` or a key of the value, so a
`Uint8Array` of another realm is one, another view (`Int8Array`, `DataView`), an array of
numbers and base64 text are not; base64 text is what [coercion](/guide/coercion) reads into bytes
and what the [JSON Schema](/guide/json-schema) of the input side describes. `length` bounds the
number of bytes (`{ type: 'bytes', length: { max: 65536 } }`), and coercion leaves a text whose
bytes would be over `length.max` undecoded, for the check to reject, so the bound is also what
caps what a request can make the converter allocate. `null` is for a field that must be
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

## Flags

`{ flags: [...] }` is a set of named switches: an object whose keys are names of the list, each
`true` or `false`, any of them left out (`{}` has every flag off). A name the list does not have
is a key the schema does not have, so it follows the unknown-keys policy of the check, as a
struct's keys do: `unexpected` by default, ignored under `unknown: 'ignore'`, left out of the
output of `parse` under `strip`.

```js
const access = Schema.from({ perms: { flags: ['read', 'write', 'admin'] } });
access.check({ perms: { read: true, admin: false } }).valid; // true
access.check({ perms: { read: 'yes', owner: true } }).errors;
// [ 'Field "perms.read" not of expected type: boolean', 'Field "perms" has unexpected keys: owner' ]
access.parse({ perms: { read: true, owner: true } }, { unknown: 'strip' }).value;
// { perms: { read: true } }
```

The list is a non-empty list of distinct names (`__proto__` is none), or the definition is
`ERR_INVALID_DEFINITION`. It renders as `{ read?: boolean; write?: boolean; admin?: boolean }` in
TypeScript and as an object of boolean properties in JSON Schema.

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

`{ union: [...] }` accepts a value that matches one of its branches, each a definition of its own:
without a discriminator the first branch that reports nothing wins, with
`discriminator: '<field>'` the branch is picked from an `enum` field in one lookup.

```js
const schema = Schema.from({ id: { union: ['string', 'number'] } });
schema.check({ id: true }).errors; // [ 'Field "id" does not match any of: string, number' ]
```

See [Unions, nullable and null](/guide/unions) for discriminated unions, optional and nullable
unions, the `union` issue and the definition errors.

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
and a collection element (`{ array: { type: 'string', nullable: true } }`). The comparison with
optional fields, the `null` type and `any` is in [Unions, nullable and null](/guide/unions#optional-nullable-and-null).

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

### `decimals`

`decimals` bounds the digits after the point of a `number` (an integer from 0 to 15): the value
times 10ⁿ is a whole number, to within the error the arithmetic of doubles leaves on the way, so
`0.1 + 0.2` has two decimals and `19.999` has three. `NaN` and the infinities have none to
count (the issue names them: `params.received` is `'NaN'`, and the message says it is not a
finite number). A failed test is a `decimals` issue:

```js
const schema = Schema.from({ price: { type: 'number', decimals: 2, min: 0 } });
schema.check({ price: 0.1 + 0.2 }).valid; // true
schema.check({ price: 19.999 }).issues;
// [ { code: 'decimals', path: ['price'], message: 'has more than 2 decimals', params: { decimals: 2 } } ]
```

The tolerance is 256 units in the last place of the scaled value: a decimal too many is told
apart while the value is under 2⁴³ units of its last decimal (about 88 billion at two
decimals, 8.8 at twelve, 0.0088 at fifteen), where a bound of 1e-9 of the value would let
`12345678.123` pass as two decimals. Past that every number passes, so a field whose bounds
reach it (`max`, `min`, or 1 for a side without one) is an `unenforceable-decimals` warning in
`schema.warnings`: thirteen decimals or more without bounds, two with `max: 1e12`. The JSON Schema
export writes `multipleOf: 0.01` (a validator that divides disagrees with the last bit of a
sum: ajv needs `multipleOfPrecision`, see [JSON Schema](/guide/json-schema#the-mapping)), and an `integer`, a `bigint` or a `string` with `decimals` is `ERR_INVALID_RULE`.

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
`pattern` with a `length.max`: a string past the bound is reported for its length and the pattern
is never run over it; see [Patterns and ReDoS](/guide/validation#patterns-and-redos).

### `format`

`format` names a form a string must have, `email`, `uuid`, `date`, `uri`, one of the 35 the
`@alexify/metaschema/formats` subpath registers or one of your own. It runs after `pattern`,
under the same `length.max` bound, and a failed test is a `format` issue:

```js
const { register } = require('@alexify/metaschema/formats');
register();
const schema = Schema.from({ email: { type: 'string', format: 'email', length: { max: 254 } } });
schema.check({ email: 'ann@' }).issues;
// [ { code: 'format', path: ['email'], message: 'is not a valid email', params: { format: 'email' } } ]
```

A format the subpath did not register is `ERR_INVALID_RULE` when the schema is built. See
[String formats](/guide/formats).

### `validate`

Any field can carry its own check. See [Validation](/guide/validation#custom-validation).

## Your own types

`Model` accepts a table of types, which can add database metadata to the built-in ones or define
new ones. See [Custom Types](/guide/custom-types).
