# Migrating from 1.x

2.0 rewrites the validation core and settles the semantics of the schema language. The package
name, the exports and most definitions stay as they are; what changes is the shape of a result,
the signature of `check`, and a few rules of the language that 1.x left ambiguous. This page
goes through them with the 1.x behaviour on the left and the 2.0 behaviour on the right; the
condensed list is under "Upgrading from 1.x" in the
[CHANGELOG](https://github.com/Alexis-Technologies/metaschema/blob/main/CHANGELOG.md).

Everything not listed here is additive: `integer`, `date`, `null`, `any`, `union`, `nullable`,
`pattern`, `min`/`max`, locales, the lint, `Infer` and Standard Schema work on a 1.x schema as it
is.

## Validation

### `check(value, options)`

The second argument of `check` is an options object. The root label of the error lines, which
1.x took as a positional string, is `options.root`:

```js
// 1.x
schema.check(value, 'body', { maxErrors: 1 });

// 2.0
schema.check(value, { root: 'body', maxErrors: 1 });
```

A string in its place throws a `TypeError` that says where it went:

```js
schema.check(value, 'body');
// TypeError: check options must be an object (the path is options.root now), got "body"
```

The options are `root`, `maxErrors`, `unknown`, `references` and `messages`; see
[Validation](/guide/validation#options).

### Issues are data

`result.issues` carries the path as an array of keys, the message without its location, and the
params the message was made from. The line with the location is `result.errors[i]`, as before,
rendered on first use:

```js
const user = new Schema('User', { name: 'string', age: '?number' });
const result = user.check({ age: 'old' });

// 1.x
result.issues;
// [
//   { code: 'required', path: 'User.name', message: 'Field "User.name" is required' },
//   { code: 'type', path: 'User.age', message: 'Field "User.age" not of expected type: number' }
// ]

// 2.0
result.issues;
// [
//   { code: 'required', path: ['name'], message: 'is required', params: {} },
//   { code: 'type', path: ['age'], message: 'not of expected type: number', params: { expected: 'number', received: 'string' } }
// ]
result.errors;
// [ 'Field "User.name" is required', 'Field "User.age" not of expected type: number' ]
```

Two paths render differently in `errors`: a key that is not an identifier is bracketed and
quoted, and a tuple element is addressed by its index.

| Value | 1.x | 2.0 |
| --- | --- | --- |
| `{ o: { 'a.b': 'x' } }` against `{ object: { string: 'number' } }` | `Field "o.a.b" not of expected type: number` | `Field "o["a.b"]" not of expected type: number` |
| `{ point: [1, 'x'] }` against `['number', 'number']` | `Field "point(item1)" not of expected type: number` | `Field "point[1]" not of expected type: number` |
| `{ point: [1, 2, 3] }` | `Field "point" value length is more than expected in tuple` | `Field "point" exceeds the maximum length` (`params: { max: 2, actual: 3 }`) |

A `validate` function may return `{ code, message, path, params }` of its own, and `path` (a key
or an array of keys) is relative to the field. 1.x ignored it:

```js
const schema = Schema.from({ a: { type: 'string', validate: () => ({ message: 'nope', path: 'x' }) } });
schema.check({ a: 'v' }).errors;
// 1.x: [ 'Field "a" nope' ]
// 2.0: [ 'Field "a.x" nope' ]
```

Code that matched `issue.path` as a string, or parsed `issue.message` for the field, reads
`issue.path` as keys now; `result.flatten()` gives the messages by dotted path for a form, and
`result.tree()` follows the value.

### Unknown keys are one issue per struct

Keys the schema does not have are reported once per struct, at the path of the struct, with the
keys in `params`:

```js
const schema = new Schema('Point', { a: 'string' });
schema.check({ a: 'x', b: 1, c: 2 }).errors;
// 1.x: [ 'Field "Point.b" is not expected', 'Field "Point.c" is not expected' ]
// 2.0: [ 'Field "Point" has unexpected keys: b, c' ]
schema.check({ a: 'x', b: 1, c: 2 }).issues[0];
// 2.0: { code: 'unexpected', path: [], message: 'has unexpected keys: b, c', params: { keys: ['b', 'c'] } }
```

`maxErrors` counts them as one. `check(value, { unknown: 'ignore' })` accepts them, and a schema
can make that its default with `{ Form: { unknown: 'ignore' }, ... }`; see
[Kinds and Metadata](/guide/kinds-and-metadata#metadata-fields).

### The order inside a field

A field is checked in the order type, then rules (`length`, `pattern`, `min`, `max`), then
`validate`, and each step runs only when the one before it passed. 1.x ran all three and reported
them together:

```js
const schema = Schema.from({ s: { type: 'string', length: 2, validate: () => 'never' } });
schema.check({ s: 5 }).errors;
// 1.x: [
//   'Field "s" not of expected type: string',
//   'Field "s" never',
//   'Field "s" exceeds the maximum length'
// ]
// 2.0: [ 'Field "s" not of expected type: string' ]
```

The schema-level `validate` runs after the fields and only when every field passed, so it can
rely on their shape; 1.x ran it first, and always:

```js
const schema = Schema.from({ a: 'string', validate: () => 'schema says no' });
schema.check({ a: 1 }).errors;
// 1.x: [ 'Field "" schema says no', 'Field "a" not of expected type: string' ]
// 2.0: [ 'Field "a" not of expected type: string' ]
```

A validator that relied on running next to a type error (to report both) reports the type
error alone now; nothing else to change.

### `ValidationResult`

The constructor takes options, not a path, and a result a `validate` function returns is
relative to the field it belongs to, so build it with no arguments:

```js
// 1.x
const result = new ValidationResult('body');

// 2.0
const result = new ValidationResult(); // inside a validate function
const result = new ValidationResult({ root: 'body', messages: uk }); // standalone
```

`ValidationResult.format` is gone; `ValidationResult.issuesOf(error, path?, code?)` takes the
path as an array of keys. `add`, `valid`, `errors` and `issues` stay, and `summary`, `flatten()`
and `tree()` are new.

### Cycles

A value that refers back to itself is reported as `circular` where a reference (`'Category'`,
`{ many: 'Category' }`) meets it again, exactly as in 1.x. A schema without references cannot
recurse, so 1.x's check of every object on the way is gone: such a value is walked as far as the
schema goes and reported for what it is, which may be nothing at all:

```js
const schema = Schema.from({ n: { n: '?json' } });
const value = { n: null };
value.n = value;
schema.check(value).errors;
// 1.x: [ 'Field "n" is a circular reference' ]
// 2.0: [] (value.n is an object, which is what the `json` field asks for)
```

### Warnings carry a code

```js
model.warnings;
// 1.x: [ 'Warning: "Customer" referenced by "Order" is not found' ]
// 2.0: [ 'Warning [missing-reference]: "Customer" referenced by "Order" is not found' ]
```

The lint adds `unknown-option`, `unbounded-pattern` and `missing-index-field` (in
`schema.warnings`, new) and `recursive-reference` keeps its text. A test that compares
`model.warnings` with an exact list needs the codes; see
[Domain Models](/guide/model#warnings).

### Messages

Every message the library produces keeps its 1.x wording, except the unexpected-keys line and the
tuple-length line above. Messages are rendered through a locale, English by default; pass
`{ messages: uk }` for Ukrainian or a table of your own. A validator's text is kept as it is.

## The schema language

### The first key decides

An object definition is read by its first key: `type` first is the long form, a capitalized
first key is a kind, a type name is that type's shorthand, and anything else is a nested struct.
1.x read the long form wherever a `type` key was present:

```js
const schema = Schema.from({ part: { name: 'string', type: 'string' } });

// 1.x: `part` is a string field; { part: 'cpu' } is valid
// 2.0: `part` is a struct with the fields `name` and `type`; { part: 'cpu' } is a type error
```

A struct whose first field is called `type`, or named like a type, says so with a kind or with
the `schema` shorthand:

```js
Schema.from({ Struct: {}, type: { enum: ['cpu', 'ram'] }, name: 'string' });
Schema.from({ part: { schema: { type: { enum: ['cpu', 'ram'] }, name: 'string' } } });
```

`date`, `null`, `any`, `unknown`, `integer` and `union` are type names in 2.0, so a nested struct
whose **first** field is called `date` (a `birth: { date, place }` struct) is now read as a
`date` field with unknown options. `schema.warnings` points at it:

```js
Schema.from({ birth: { date: '?string', place: '?string' } }).warnings;
// [ 'Warning [unknown-option]: option "place" of "birth" is not known to type "date"' ]
```

Give it a kind (`birth: { Struct: {}, date: '?string', place: '?string' }`) or put another field
first. `{ required: false, type: 'string' }` is read as a struct and throws
`ERR_INVALID_DEFINITION`, because `false` is not a field definition; write `type` first. See
[Schema Syntax](/guide/schema-syntax#the-first-key-decides).

### Numbers: `min` and `max`

`length` on a `number` or a `bigint` was a range check with a misleading message. 2.0 has
`min` and `max` for `number`, `bigint` and the new `integer`, and `length` on a number is a
definition error:

```js
// 1.x
Schema.from({ age: { type: 'number', length: [18, 120] } }).check({ age: 150 }).errors;
// [ 'Field "age" exceeds the maximum length' ]

// 2.0
Schema.from({ age: { type: 'number', length: [18, 120] } });
// SchemaDefinitionError [ERR_INVALID_RULE]: Rule "length" does not apply to type "number"; use min and max in "age"
Schema.from({ age: { type: 'integer', min: 18, max: 120 } }).check({ age: 150 }).errors;
// [ 'Field "age" is greater than 120' ]
```

The issue code is `range` with `{ min, max, actual }`. A bigint bound is compared exactly
(1.x went through `Number`). Every type lists the rules it accepts, so a `min` on a string or a
`length` on a boolean throws `ERR_INVALID_RULE` too, and a custom type names its rules in
`rules: [...]`. A `length` whose `min` is above its `max`, which 1.x accepted, throws
`ERR_INVALID_LENGTH`. See [Types](/guide/types#rules).

### References follow the kind of their target

In 1.x a reference always expected the referenced record, while the generated TypeScript
rendered it as an id. In 2.0 the kind of the target decides: a reference to a stored kind
(`Entity`, `Registry`, `Dictionary`, ...) is its id, a reference to a memory kind (`Struct`,
`Form`, ...) is the record, in `check` and in the generated types alike.

```js
const entities = new Map([
  ['Company', { Registry: {}, name: { type: 'string', unique: true }, addresses: { many: 'Address' } }],
  ['Address', { Entity: {}, city: 'string', street: 'string' }],
  ['Person', { Entity: {}, name: 'string', employer: 'Company', home: { one: 'Address' } }],
]);
const person = new Model(types, entities).entities.get('Person');

person.check({ name: 'Ann', employer: 'c1', home: 'a1' }).errors;
// 1.x: [ 'Field "Person.employer" not of expected type: object', 'Field "Person.home" not of expected type: object' ]
// 2.0: []

person.check({ name: 'Ann', employer: { name: 'Acme', addresses: [] }, home: { city: 'Rome', street: 'Via Appia' } }).errors;
// 1.x: []
// 2.0: [ 'Field "Person.employer" not of expected type: string', 'Field "Person.home" not of expected type: string' ]
```

Code that validated a graph of stored entities (an API payload with the records embedded) keeps
doing so with `check(value, { references: 'embed' })`, or marks the fields `embed: true`;
`{ references: 'id' }` validates rows. An id never recurses, so a cyclic value through stored
kinds is a type error, not `circular`. The decision and its consequences are in
[References](/guide/references#storage-view-and-graph-view).

### `set` in the generated TypeScript

A `set` field renders as `Set<T>` (1.x rendered `T[]` while `check` accepted only a `Set`);
`map` was already `Map<K, V>`:

```ts
// 1.x
ids: number[];
// 2.0
ids: Set<number>;
```

A memory-kind reference renders as its interface (`label: Tag`, `tags: Tag[]`) instead of
`labelId: string`, following the rule above. `integer` renders as `number`, `date` as `Date`,
`null`, `any` and `unknown` as themselves, a `union` as `A | B` and a nullable field as
`T | null`.

### `relations` labels

The labels follow the referencing side, the conventional direction. A `many` field is
`'one-to-many'` (one record holds many targets) and a single reference `'many-to-one'`; 1.x had
the two swapped:

```js
person.relations;
// 1.x: Set { { to: 'Company', type: 'one-to-many' }, { to: 'Address', type: 'one-to-many' } }
// 2.0: Set { { to: 'Company', type: 'many-to-one' }, { to: 'Address', type: 'many-to-one' } }
company.relations; // addresses: { many: 'Address' }
// 1.x: Set { { to: 'Address', type: 'many-to-one' } }
// 2.0: Set { { to: 'Address', type: 'one-to-many' } }
```

### Tuple elements

A tuple element may be any definition. A one-key object holding a type name is still a named
scalar (`[{ x: 'number' }, { y: 'number' }]`, as upstream); an object with more keys is a struct
element, which 1.x read as the named element `x` and failed on the rest:

```js
const schema = Schema.from({ t: [{ x: 'number', y: 'number' }] });
schema.check({ t: [{ x: 1, y: 2 }] }).errors;
// 1.x: [ 'Field "t(x0)" not of expected type: number' ]
// 2.0: []
```

### A `Schema` instance as a field

A `Schema` instance used as a field keeps its schema-level `validate` in every form (bare,
`{ schema }`, the long form). 1.x dropped it, so a value that passed may fail now:

```js
const inner = Schema.from({ a: 'string', validate: () => 'inner no' });
Schema.from({ x: inner }).check({ x: { a: 'v' } }).errors;
// 1.x: []
// 2.0: [ 'Field "x" inner no' ]
```

## TypeScript

The typings need TypeScript 5.0 or later: `Schema` is generic over its definition
(`Schema<D>`, a const type parameter), so `InferSchema<typeof schema>` is the type of a value
`check` accepts. `Schema` written on its own is still any schema, and `Model.entities` is still
a `Map<string, Schema>`, so existing annotations compile. See [TypeScript](/guide/typescript).

## Checklist

1. Replace `check(value, path, options)` with `check(value, { root: path, ...options })`.
2. Read `issue.path` as an array of keys and `issue.message` as text without the location; use
   `result.errors` for the lines, `flatten()` for forms.
3. Expect one `unexpected` issue per struct, and one issue per field (a type error alone).
4. Replace `length` on numbers with `min`/`max`; add `rules: [...]` to custom types that take
   rules.
5. Check structs whose first field is `type` or a type name (`date` especially) and give them a
   kind.
6. Decide what a reference holds: ids by default for stored kinds, `{ references: 'embed' }` or
   `embed: true` for graphs.
7. Update tests that match `Set` fields in the dts, `relations` labels, tuple paths, the
   tuple-length message and `model.warnings` texts.
8. Build `ValidationResult` with options, not a path; drop `ValidationResult.format`.
9. Run `model.warnings` (or `schema.warnings`) once: the lint reports mistyped options and the
   first-key cases above.
