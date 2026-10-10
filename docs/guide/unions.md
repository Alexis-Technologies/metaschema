# Unions, nullable and null

Three things look alike in a definition and mean different things: a field that holds one of
several shapes, a field whose value may be `null`, and a field that must be `null`. This page
tells them apart, and from an optional field.

## Unions

`{ union: [...] }` accepts a value that matches one of its branches. Each branch is a definition
of its own: a type name, a long form, a collection, a nested struct, a `Schema` instance or a
reference.

```js
const { Schema } = require('@alexify/metaschema');

const schema = Schema.from({
  id: { union: ['string', 'number'] },
  shape: { union: [{ r: 'number' }, { side: 'number' }] },
});

schema.check({ id: 7, shape: { side: 2 } }).valid; // true
schema.check({ id: true, shape: { r: 'x' } }).errors;
// [
//   'Field "id" does not match any of: string, number',
//   'Field "shape" does not match any of: object, object'
// ]
```

Without a discriminator the branches are tried in order, the first one that reports nothing
wins, and what a failed branch reported is dropped. A value that matches none is one `union`
issue with the branch names in `params`:

```js
schema.check({ id: true }).issues[0];
// { code: 'union', path: ['id'], message: 'does not match any of: string, number', params: { expected: ['string', 'number'], discriminator: undefined } }
```

The branches of a plain union may overlap (`['string', { enum: ['a', 'b'] }]` is fine; the first
match wins), and a reference may be a branch, since it resolves when a value is checked:

```js
const entities = new Map([
  ['Tag', { Struct: {}, label: 'string' }],
  ['Post', { Struct: {}, tag: { union: ['string', 'Tag'] } }],
]);
const post = new Model({ string: {} }, entities).entities.get('Post');
post.check({ tag: 'plain' }).valid; // true
post.check({ tag: { label: 'x' } }).valid; // true
post.check({ tag: 5 }).errors; // [ 'Field "Post.tag" does not match any of: string, Tag' ]
```

### Discriminated unions

With `discriminator: '<field>'` every branch must be a nested struct (inline or a `Schema`
instance) whose field of that name is an `enum`. The branch is picked from the value of that
field in one lookup, in a table built when the schema is built, so the other branches are never
tried, and errors come from the branch that was picked:

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
```

A value with an unknown or missing discriminator is one `union` issue at the discriminator's
path, with the known values in `params`, and a value that is not an object is a type error:

```js
canvas.check({ shape: { kind: 'line' } }).issues[0];
// { code: 'union', path: ['shape', 'kind'], message: 'is not one of: circle, square, rect', params: { expected: ['circle', 'square', 'rect'], discriminator: 'kind' } }
canvas.check({ shape: 'circle' }).errors;
// [ 'Field "Canvas.shape" not of expected type: object' ]
```

A reference cannot be a discriminated branch (its fields are not known when the schema is
built). A definition that cannot discriminate throws `ERR_INVALID_UNION` when the schema is
built: an empty branch list, a branch that is a function, a branch without the discriminator
field or with a non-enum one, or a discriminator value shared by two branches:

```js
Schema.from({ s: { union: [{ r: 'number' }], discriminator: 'kind' } });
// SchemaDefinitionError [ERR_INVALID_UNION]: Union branch 0 needs an enum field "kind" to discriminate on in "s"
Schema.from({ s: { union: [{ k: { enum: ['a'] } }, { k: { enum: ['a'] } }], discriminator: 'k' } });
// SchemaDefinitionError [ERR_INVALID_UNION]: Union discriminator value "a" is in two branches in "s"
```

### Optional and nullable unions

A union field is required like any other. It has no string shorthand, so it is made optional on
the key or in the definition, and nullable with `nullable: true`:

```js
Schema.from({ 'id?': { union: ['string', 'number'] } }).check({}).valid; // true
Schema.from({ id: { union: ['string', 'number'], required: false } }).check({}).valid; // true
Schema.from({ id: { union: ['string', 'number'], nullable: true } }).check({ id: null }).valid; // true
```

### In TypeScript

A union renders as `A | B` in the generated interfaces and in `Infer`, a nullable one as
`A | B | null`:

```ts
interface Doc {
  id: string | number;
  shape: { r: number } | { side: number };
  n: string | number | null;
}
```

A discriminated union is a union of its structs, which TypeScript narrows on the discriminator
field as usual.

## Optional, nullable and `null`

| Field | Key may be absent | `undefined` | `null` | A value |
| --- | --- | --- | --- | --- |
| `'?string'`, `'key?': 'string'`, `{ type: 'string', required: false }` | yes | yes | yes | checked |
| `{ type: 'string', nullable: true }` | no | no, a type error | yes | checked |
| `'null'` | no | no, a type error | yes | no |
| `'any'` / `'unknown'` | no | yes | yes | yes |

**Optional** means the field may be missing, and `undefined` or `null` in its place pass. That is
what `'?type'`, `'key?'` and `required: false` all mean, as in upstream metaschema.

**Nullable** means the key is required but the value may be `null`: a column that is present in
every row and may be empty, a reference that is cleared. `nullable: true` applies to any type,
a nested struct and a collection element included, and `null` skips the rules and `validate`:

```js
const schema = Schema.from({
  parent: { type: 'string', nullable: true },
  'nick?': 'string',
});
schema.check({ parent: null }).valid; // true
schema.check({}).errors; // [ 'Field "parent" is required' ]
schema.check({ parent: undefined }).errors; // [ 'Field "parent" not of expected type: string' ]

Schema.from({ a: { schema: { x: 'number' }, nullable: true } }).check({ a: null }).valid; // true
Schema.from({ a: { array: { type: 'string', nullable: true } } }).check({ a: ['x', null] }).valid; // true
Schema.from({ a: { type: 'string', length: { min: 3 }, nullable: true } }).check({ a: null }).valid; // true
```

**`null`** is a type: the field must be present and must be `null`, for a placeholder or a
discriminated branch that carries nothing. `'?null'` is a field that may be absent or `null`.

```js
Schema.from({ d: 'null' }).check({ d: undefined }).errors; // [ 'Field "d" not of expected type: null' ]
Schema.from({ d: '?null' }).check({}).valid; // true
```

**`any` and `unknown`** accept every value, `null` and `undefined` included, but the key must be
present. They are one type under two names and differ only in the TypeScript they render.

```js
Schema.from({ p: 'any' }).check({}).errors; // [ 'Field "p" is required' ]
Schema.from({ p: 'any' }).check({ p: undefined }).valid; // true
```

### `nullable` or a union with `null`?

`{ union: ['string', 'null'] }` and `{ type: 'string', nullable: true }` accept the same values.
Prefer `nullable`: it is one comparison before the type check, it renders as `string | null`
rather than through a union, and its message for `undefined` names the type
(`not of expected type: string`) where the union says `does not match any of: string, null`. A
union with `null` is for a branch list that already exists.

In `Infer`, an optional field is an optional property typed `T | null | undefined`, a nullable
one `T | null`, and `null`, `any` and `unknown` are themselves; see
[TypeScript](/guide/typescript#inferring-types-from-a-schema).
