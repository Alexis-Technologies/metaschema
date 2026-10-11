# Model evolution

A model changes with the program it describes: a field is added, renamed or made optional, a
type is widened, an entity is dropped. `@alexify/metaschema/model` makes the change itself a
value. `diff(prev, next)` lists what changed between two versions of a model, as data;
`compatibility(changes)` says whether a reader with the old model and a reader with the new one
still read each other's data, by the rules of the Confluent Schema Registry; and two primitives
of the language, `aliases` and `deprecated`, let a model carry its own history. A version of a
model is a [snapshot](/guide/model#the-snapshot), so a committed JSON file compares with the
model of the running program, without a database.

```js
const { Model } = require('@alexify/metaschema');
const { diff, compatibility } = require('@alexify/metaschema/model');

const previous = require('./model.snapshot.json'); // what the last release committed
const current = new Model(types, entities, database);

const changes = diff(previous, current);
compatibility(changes); // 'full', 'backward', 'forward' or 'none'
```

## The model subpath

The functions live outside the core entry, so that a program that only validates does not carry
them: `@alexify/metaschema` is 17.2 KB min+gzip, `@alexify/metaschema/model` adds 9.5 KB on
top. The subpath exports seven functions:

| Export | Meaning |
| --- | --- |
| `fromJSON(snapshot, options?)` | a `Model` from a [snapshot](/guide/model#restoring-a-model), with the paths of its `placeholders` |
| `diff(prev, next)` | the [changes](#diff) between two models or snapshots |
| `compatibility(changes)` | the [compatibility class](#compatibility) of a list of changes |
| `compatibilityOf(change)` | the compatibility class of one change |
| `sample(schema, options?)` | a [value the schema accepts](/guide/samples), the same for a seed |
| `merge(a, b, options?)` | the [schema both schemas describe](/guide/schema-syntax#merging-schemas) |
| `register()` | installs `Model.fromJSON`, `Model.diff`, `Model.compatibility`, `Model.compatibilityOf`, `Schema.merge` and `schema.sample(options)` on the classes, once per process |

`register()` installs the members like class members, invisible to `Object.keys`,
`JSON.stringify` and `for...in`; the functions do the same job without it.

## `aliases` and `deprecated`

A field renamed in the model keeps reading its old key:

```js
const user = Schema.from({
  login: { type: 'string', aliases: ['name'] },
  'active?': { type: 'boolean', default: true },
});

user.check({ name: 'marcus' }).valid; // true: `name` is read as `login`
user.check({ name: 1 }).errors; // [ 'Field "name" not of expected type: string' ]
user.check({}).errors; // [ 'Field "login" is required' ]
user.parse({ name: 'marcus' }).value; // { active: true, login: 'marcus' }
```

The rules, the same on both [backends](/guide/compile):

- `check` reads a field from the first alias the value carries when it has nothing under the
  field's own key, and reports an issue under the key it found the value under. A value with the
  field's own key and an alias is read from its own key, and the alias is a known key, never
  `unexpected`.
- `parse` fills no `default` over a value held under an alias, and writes the value under the
  field's own key: the output has `login`, never `name`. Under `unknown: 'strip'` the output has
  the field keys only; otherwise an alias left beside the field's own key stays where it was.
  `serialize` reads the value of the program, which carries the field keys, and leaves it as it
  is.
- An alias is a key of the struct: it cannot be a field, a calculated field or an alias of
  another field, whatever the order of the definition (`ERR_INVALID_DEFINITION`). A nested
  struct takes aliases through its `schema` shorthand or the long form
  (`address: { schema: { city: 'string' }, aliases: ['addr'] }`).
- The [JSON Schema](/guide/json-schema), the [generated TypeScript](/guide/typescript) and
  `Infer` name the field's own key only: an alias is a key of the input, not of the value the
  schema describes. The [snapshot](/guide/model#the-snapshot) writes it with the field.

`deprecated: true` (or a note, `deprecated: 'use login'`) is metadata: the JSON Schema export
writes `deprecated: true`, the generated TypeScript adds `@deprecated`, and `diff` marks the
removal of such a field as expected (`detail.deprecated`). Nothing warns when a deprecated
field is used; a model that wants to stop accepting it removes it.

## `diff`

`diff(prev, next)` takes two `Model`s, two snapshots, or one of each (a `Model` is compared
through its snapshot) and returns the changes as a list, in the order of the new model: the
entities of `next` in their dependency order (an added one, or the changes inside it: its
metadata, then its fields, its indexes and its relations), then the entities that are gone, then
the types the entities use.

```js
const v1 = new Model(types, [
  ['Company', { Dictionary: {}, name: { type: 'string', unique: true } }],
  ['User', { Registry: {}, login: { type: 'string', length: { min: 3, max: 32 } }, company: 'Company', active: { type: 'boolean', default: true } }],
]);
const v2 = new Model(types, [
  ['Company', { Dictionary: {}, name: { type: 'string', unique: true } }],
  ['User', { Registry: {}, login: { type: 'string', length: { min: 3, max: 32 }, aliases: ['name'] }, company: 'Company', active: { type: 'boolean', default: true }, 'email?': 'string' }],
]);

diff(v1, v2);
// [
//   {
//     kind: 'field', op: 'changed', entity: 'User', name: 'login',
//     from: { type: 'string', required: true, length: { min: 3, max: 32 } },
//     to: { type: 'string', required: true, aliases: ['name'], length: { min: 3, max: 32 } },
//     detail: { keys: ['aliases'] },
//   },
//   { kind: 'field', op: 'added', entity: 'User', name: 'email', to: { type: 'string', required: false } },
// ]
```

A change is `{ kind, op, entity, name, from?, to?, detail? }`:

| Key | Values |
| --- | --- |
| `kind` | `'entity'`, `'field'`, `'index'`, `'relation'`, `'type'` |
| `op` | `'added'`, `'removed'`, `'changed'`, `'renamed'` (a field, through an alias) |
| `entity` | the entity the change is in (`''` for a type) |
| `name` | the entity, the field, the index, the target of the relation, or the type |
| `from`, `to` | what it was and what it is: a field's definition as the snapshot writes it, an entity's metadata (`kind`, `scope`, `store`, `allow`, `parent`, `unknown`, `custom`, and `type` for a schema of one type), an index definition, a relation `{ to, type }`, a type entry |
| `detail.keys` | for `changed`: the keys whose values differ, sorted |
| `detail.renamed` | for `renamed`: the old key; `detail.keys` lists what else differs, if anything |
| `detail.deprecated` | `true` for a removed field that was marked `deprecated` |

A field of the new model whose `aliases` name a key of the old struct that the new one does
not have is `renamed` from that key, not added, and the old key is not removed. Nested structs
compare as one field: a change inside `address` is a `changed` field `address` with `schema`
among its keys. Functions compare equal (a `validate` is a `validate`; the snapshot has no body
for it).

A `Model` is compared through its snapshot, built on every call: a registry service that
compares many versions should keep the snapshots (`JSON.stringify(model)` at release time) and
pass them to `diff`, rather than rebuild the models. A snapshot is input to `diff`, as it is
to `fromJSON`: an entity that is not one (no `fields` of objects nor `type`, `relations` that
are not a list) is `ERR_INVALID_SNAPSHOT` naming the entity; see
[the snapshot as a trust boundary](/guide/model#the-snapshot-as-a-trust-boundary).

## `compatibility`

Two readers meet whenever a model changes: the code deployed with the old model still reads
the data the new one writes (a rolling deploy, a consumer behind a queue), and the new code reads
what the old one wrote (every record already stored). `compatibility(changes)` names which of
the two still works, with the words of the Confluent Schema Registry:

| Class | Meaning |
| --- | --- |
| `'backward'` | a reader with the **new** model reads data written with the old one |
| `'forward'` | a reader with the **old** model reads data written with the new one |
| `'full'` | both |
| `'none'` | neither |

The class of a list is the class every change allows: `full` changes nothing, `backward` and
`forward` together are `none`. The rules assume a reader that ignores keys it does not know, as
those registries do and as `check(value, { unknown: 'ignore' })` and `parse` with
`unknown: 'strip'` do; a reader that rejects unknown keys is `forward` compatible with nothing
that adds one.

| Change | Class | Why |
| --- | --- | --- |
| an entity added | `full` | old readers ignore it; new readers find it empty |
| an entity removed | `backward` | old code still looks for it |
| an entity's `kind`, `store` or `parent` changed, or a schema of one type changed its type | `none` | a reference is held as an id or as the record by the kind of its target |
| an entity's `scope`, `allow` or custom metadata changed | `full` | storage metadata, not data |
| `unknown` `reject` → `ignore` | `backward` | new readers take old data; old readers reject new keys |
| `unknown` `ignore` → `reject` | `forward` | the other way round |
| a field added, optional or with a `default` | `full` | missing in old data, filled or allowed; ignored by old readers |
| a field added, required without a default | `forward` | old data lacks it |
| a field removed, optional or with a `default` | `full` | old readers do without it |
| a field removed, required without a default | `backward` | old readers need it |
| a field renamed through an alias | `full` when the old field was optional or had a default, else `backward` | new readers read the old key; old readers miss it |
| `required` `true` → `false` | `backward` | new data may lack it |
| `required` `false` → `true` | `forward` | old data may lack it |
| a `default` added, or changed | `full` | a missing key is filled either way |
| a `default` removed from a required field | `forward` | old data written without it has no key |
| `nullable` `false` → `true` | `backward` | new data may hold null |
| `nullable` `true` → `false` | `forward` | old data may hold null |
| `integer` → `number` | `backward` | every integer is a number |
| `number` → `integer` | `forward` | old data may hold fractions |
| any other type | `none` | |
| `length`, `min` or `max` tightened (a lower bound raised, an upper one lowered, a bound added) | `forward` | old data may lie outside |
| loosened (a bound lowered, raised or removed) | `backward` | new data may lie outside |
| tightened on one end and loosened on the other | `none` | |
| a `pattern` added | `forward` | old data may not match |
| a `pattern` removed | `backward` | |
| a `pattern` changed | `none` | two patterns compare as nothing |
| `enum` values added | `backward` | new data may hold them |
| `enum` values removed | `forward` | old data may hold them |
| values added and removed | `none` | |
| a `validate` added (a field's, a struct's, the schema's) | `forward` | it may reject old data |
| a `validate` removed | `backward` | |
| a `parse` or `serialize` added, removed or changed | `full` | the wire format is the same |
| an alias added | `full` | |
| an alias removed | `forward` | old data under that key is not read |
| `unique`, `index`, `primary`, `title`, `description`, `examples`, `deprecated` changed | `full` | |
| a field of a nested struct | the rule of the field | the fields of `schema` compare as an entity's do |
| the element of an `array`, `set`, `object` or `map` | the rule of the element | |
| a tuple element | the rule of the element; another number of elements is `none` | |
| a union branch added | `backward` | the union accepts more |
| a union branch removed | `forward` | |
| a union branch changed | the rule of the branch, by position | |
| the key type of an `object` or `map`, the target or `embed` of a reference, the `discriminator` of a union | `none` | |
| an index added, removed or changed | `full` | storage, not data |
| a relation added or removed | `full` | it follows the field that changed |
| a calculated field added or removed | `full` | never validated |
| a type's `metadata` changed | `full` | |
| a type's `js` or check changed | `none` | its fields validate differently |
| a type added or removed | `full` | the fields that used it changed |

```js
compatibility(diff(v1, v2)); // 'full': an alias and an optional field
compatibility(diff(v2, v3)); // 'forward': v3 adds a required `role` and drops `active`, which had a default
```

`compatibilityOf(change)` is the class of one change, by the same rules, so a list can be
filtered down to what costs the class:

```js
const changes = diff(v2, v3);
changes.map((change) => [change.op, change.name, compatibilityOf(change)]);
// [ [ 'added', 'role', 'forward' ], [ 'removed', 'active', 'full' ] ]
changes.filter((change) => compatibilityOf(change) !== 'full').map((change) => change.name);
// [ 'role' ]
```

A CI check that holds a release to its promise:

```js
const changes = Model.diff(require('./model.snapshot.json'), model);
const level = Model.compatibility(changes);
assert.ok(level === 'full' || level === 'backward', `the model is ${level} compatible`);
```

`compatibility` takes the list `diff` writes: an entry that is not a change (no `kind` or
`op`, a `changed` without `detail.keys`) is `ERR_INVALID_TARGET`, and a definition inside a
change that cannot be read (a bigint tag that does not read) is `ERR_INVALID_SNAPSHOT` located
at the change.

## Boundaries

- **An entity is never renamed.** Entities have no aliases; a renamed entity is one removed and
  one added.
- **Functions have no body in a snapshot**, so a `validate` that changed its code is the same
  `validate`. The rules count a validate added or removed, not rewritten.
- **A reader that rejects unknown keys** is stricter than the rules assume: with
  `unknown: 'reject'` (the default of `check`), adding any field is `backward` at best.
- **Unions compare by position.** A branch moved is a branch changed.
- **`compatibility` is the class of the list it gets.** A change list filtered by entity, or by
  kind, classifies on its own; `compatibility([])` is `'full'`.
