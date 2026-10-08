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
// [ 'Field "author" is not expected' ]
```

## The long form

`{ type: '<name>', ...options }` gives a field options next to its type:

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

A `Schema` instance can be used as a field too:

```js
const fullName = Schema.from({ first: 'string', last: 'string' });
const person = Schema.from({ name: fullName, age: 'number' });
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
