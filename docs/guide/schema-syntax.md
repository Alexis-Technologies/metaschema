# Schema Syntax

A schema is a plain JavaScript value. `Schema.from(definition)` builds an anonymous schema, and
`new Schema(name, definition)` builds a named one (the name is used in error paths and in generated
TypeScript).

```js
const { Schema } = require('@alexify/metaschema');

const anonymous = Schema.from({ title: 'string' });
const named = new Schema('Article', { title: 'string' });
```

## Fields

Every key of a definition object is a field, and its value says what the field holds.

| Form | Example | Meaning |
| --- | --- | --- |
| Type name | `title: 'string'` | a required string |
| Optional type | `subtitle: '?string'` | `undefined` or `null` is allowed |
| Optional key | `'tags?': { array: 'string' }` | the same, written on the key |
| Nullable | `parent: { type: 'string', nullable: true }` | the key is required, the value may be `null` |
| Long form | `size: { type: 'number', required: false }` | a type with options |
| Type shorthand | `list: { array: 'number' }` | the key of the object is the type |
| Nested struct | `name: { first: 'string', last: 'string' }` | an object with its own fields |
| Tuple | `point: ['number', 'number']` | a fixed-length array of scalars |
| Reference | `company: 'Company'` | a capitalized name is another schema |
| Function | `ratio: (file) => file.compressed / file.size` | a calculated field, never validated |

Fields are required unless marked optional. A struct rejects keys it does not declare:

```js
const schema = Schema.from({ title: 'string' });
schema.check({ title: 'Meditations', author: 'Marcus' }).errors;
// [ 'Field "" has unexpected keys: author' ]
```

## The first key decides

An object definition is read by its **first key**, and nothing else:

| First key | The object is | Example |
| --- | --- | --- |
| a `Schema` instance (no keys) | that schema, as a nested struct | `name: fullName` |
| capitalized | a [kind](#kinds) with its metadata | `{ Entity: {}, ... }` |
| `type` | the [long form](#the-long-form) | `{ type: 'string', length: 8 }` |
| a type name | that type's [shorthand](#type-shorthands) | `{ array: 'string' }` |
| anything else | a [nested struct](#nested-structs) | `{ first: 'string', last: 'string' }` |

So `{ name: 'string', type: 'string' }` is a struct with the fields `name` and `type`, while
`{ type: 'string', name: 'string' }` is a string whose definition carries a `name` option. A
struct whose first field is called `type`, or named like a type, says so with a kind or with the
`schema` shorthand:

```js
Schema.from({ Struct: {}, type: { enum: ['cpu', 'ram'] }, name: 'string' });
Schema.from({ part: { schema: { type: { enum: ['cpu', 'ram'] }, name: 'string' } } });
```

An object that cannot be what its first key says is a `SchemaDefinitionError`
(`ERR_INVALID_DEFINITION`): `{ required: false, type: 'string' }` is read as a struct, and `false`
is not a field definition.

## The long form

`{ type: '<name>', ...options }`, with `type` first, gives a field options next to its type:

```js
const schema = Schema.from({
  login: { type: 'string', length: { min: 3, max: 32 } },
  email: { type: 'string', unique: true, validate: (value) => value.includes('@') },
  nickname: { type: '?string' },
  bio: { type: 'string', required: false },
});
```

Keys a type does not understand (`unique` above) are kept on the field as metadata. They do not
affect validation, but they are there for code that reads the schema, such as a database layer.

## Type shorthands

When the first key of an object is a type name, the object describes that type and its value is the
type's argument:

```js
Schema.from({
  tags: { array: 'string' },
  matrix: { array: { array: 'number' } },
  scores: { object: { string: 'number' } },
  ids: { set: 'number' },
  role: { enum: ['admin', 'user'] },
});
```

The long form of the same fields uses `type` plus a key named after the type:
`{ type: 'array', array: 'string' }`.

Because the first key decides, a struct whose **first** field is named like a type (`map`, `set`,
`string`, `json`, or a custom type) is read as that type: `Schema.from({ map: {...}, name:
'string' })` is a schema of type `map` with a `name` option, not a struct with a `map` field. Give
such a struct a kind (`{ Struct: {}, map: {...}, name: 'string' }`), use the `schema` shorthand,
or put another field first.

## Nested structs

An object whose first key is neither a type nor a kind is a nested struct:

```js
const schema = Schema.from({
  name: { first: 'string', last: 'string', third: '?string' },
  address: { city: 'string', street: 'string' },
});
schema.check({ name: { first: 'Marcus' }, address: { city: 'Rome', street: 'Via Appia' } }).errors;
// [ 'Field "name.last" is required' ]
```

A `Schema` instance can be used as a field too, bare or in the `schema` forms, and it brings its
fields, its references and its schema-level `validate` with it:

```js
const fullName = Schema.from({ first: 'string', last: 'string' });
const person = Schema.from({
  name: fullName,
  'nickname?': fullName,
  alias: { schema: fullName, required: false },
  age: 'number',
});
```

## Kinds

A capitalized first key sets the schema's **kind** and its metadata, for example
`{ Entity: {}, ... }` or `{ Registry: { scope: 'global' }, ... }`. Kinds matter for domain models;
see [Kinds and Metadata](/guide/kinds-and-metadata).

## Scalars and tuples on their own

A definition does not have to be an object:

```js
Schema.from('string').kind; // 'scalar'
Schema.from('?number').check(null).valid; // true
Schema.from(['string', 'number']).check(['x', 1]).valid; // true
```
