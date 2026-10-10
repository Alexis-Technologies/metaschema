# Migrating from metarhia

`@alexify/metaschema` 1.0 is a fork of [`metaschema`](https://github.com/metarhia/metaschema) 2.2.
The schema language and the validation rules are the same. What changed is the package around
them, plus the fixes listed below: more precise messages and paths, definition errors that say
where they are, and definitions that used to pass silently and now throw.

2.0 goes further: the shape of a result, the signature of `check` and a few rules of the language
change on top of this page, and the outputs below are the 2.0 ones. Read this page, then
[Migrating from 1.x](/guide/migrating-from-1).

## Install

```bash
pnpm remove metaschema
pnpm add @alexify/metaschema
```

```js
// before
const { Schema, Model } = require('metaschema');
// after
const { Schema, Model } = require('@alexify/metaschema');
```

## Removed: loading schemas from files and strings

`createSchema`, `loadSchema`, `readDirectory` and `loadModel` are gone, together with the `metavm`
sandbox they used. metaschema no longer reads files or evaluates source code. Schemas are plain
values, so load them the way you load any other module:

| Before | After |
| --- | --- |
| `createSchema(name, src)` | `new Schema(name, definition)` |
| `await loadSchema('./schemas/User.js')` | `new Schema('User', require('./schemas/User.js'))` |
| `await loadModel('./schemas', types)` | `new Model(types, new Map([...]), database)` |

Schema files written as a bare expression, `({ ... })`, need to become modules:

```js
// schemas/User.js, before
({
  Registry: {},
  login: { type: 'string', unique: true },
});

// schemas/User.js, after
module.exports = {
  Registry: {},
  login: { type: 'string', unique: true },
};
```

`loadModel` treated `.types.js` and `.database.js` in the directory as the custom types and the
database metadata. Pass them to `Model` directly:

```js
const types = { ...systemTypes, ...require('./schemas/types.js') };
const database = require('./schemas/database.js');

const entities = new Map([
  ['Company', require('./schemas/Company.js')],
  ['User', require('./schemas/User.js')],
]);

const model = new Model(types, entities, database);
```

`saveTypes` stays.

## No runtime dependencies

`metautil`, `metavm` and `metaskills` are no longer installed. The few `metautil` helpers
metaschema used are copied into the package.

## Changed

- **Optional nested structs as collection elements.** `{ array: { type: 'schema', schema, required: false } }`
  now accepts `null` elements; upstream ignored `required: false` there.
- **Messages and paths.** Typos are fixed and paths are more precise; the old text is not kept.
  Update any test that matches it:

  | Before | After |
  | --- | --- |
  | `Filed "x" is required` | `Field "x" is required` |
  | `Filed "x" is not a object` | `Field "x" not of expected type: object` |
  | `Filed "x" is not a map` | `Field "x" not of expected type: map` |
  | `Value of "x" must be an object` | `Field "x" not of expected type: object` |
  | `value length is more then expected in tuple` | `exceeds the maximum length` (1.x: `value length is more than expected in tuple`) |
  | `Field "field2" is not expected` (inside `nested`) | `Field "nested" has unexpected keys: field2` (1.x: `Field "nested.field2" is not expected`) |
  | `Field "Person.companies.name" ...` (a `many` record) | `Field "Person.companies[1].name" ...` |
  | `Field "o" In object "o": type of key must be a string` | `Field "o" keys must be of type string` |
  | `Field "o" validation failed TypeError: ...` for `null` | `Field "o" not of expected type: object` |
  | `Recursive dependency: A.B` (a model warning) | `Warning [recursive-reference]: "A" depends on "B" recursively` |

  Every element of a tuple and every record of a `many` reference is reported, not only the
  first; a circular value is reported as `is a circular reference` instead of overflowing the
  stack; and key names taken from the input are truncated to 100 characters in messages.
- **Definition errors.** A broken definition throws `SchemaDefinitionError` (a `TypeError` with
  `code`, `schema` and `field`) instead of a bare `Error`, and the message ends with the location:
  `Unknown type strng` is now `Unknown type "strng" in "Order.total"`. Definitions that upstream
  accepted and that could never validate correctly now throw when the schema is built:

  | Definition | Now |
  | --- | --- |
  | `{ type: 'enum' }` without values, `enum: []` | `ERR_INVALID_ENUM` |
  | `length: 'abc'`, `length: { min: 'a' }` | `ERR_INVALID_LENGTH` (and `length: { max: 0 }` works) |
  | `{ many: 5 }`, `{ one: '' }` | `ERR_INVALID_REFERENCE` |
  | a projection naming a field its parent does not have | `ERR_PROJECTION` |
  | a field definition key named like a method of the field (`check`, `constructor`, ...) or `__proto__` | `ERR_RESERVED_KEY` |
  | a type table entry that redefines a registered name, such as `json: { js: 'schema' }` from a metasql-style system table (`json` is a built-in) | `ERR_TYPE_REGISTERED`; write `json: { metadata: { pg: 'jsonb' } }` |
  | `{ js: 'strng' }` | `ERR_UNKNOWN_JS_TYPE` (`js` may name a custom type registered earlier) |

- **Tuples in the short form are required.** `point: ['number', 'number']` was never required
  upstream; it is now, like every other field, and `'point?': [...]` makes it optional.
- **`result.issues`.** Besides `errors`, a result carries `{ code, path, message, params }` per
  problem, with `path` as an array of keys, and `check(value, { maxErrors })` limits how many are
  collected. The root path of 1.x and upstream (`check(value, path)`) is `check(value, { root })`.
  See [Validation](/guide/validation) for the result and its options.
- **`new Schema(name, instance)`.** A `Schema` instance is still returned as is, but the
  namespaces are attached to it and a different `name` is a definition error.
- **`Model#preprocess` and `Model#reorderEntity`** are constructor internals and no longer
  public.

- **`Schema#detach`.** The misspelt `detouch` is renamed to `detach`. There is no alias: rename the
  calls.
- **Browser entry.** `dist.js` is now `browser.js` and exports the same names as the main entry,
  including `saveTypes`, which rejects in the browser. Bundlers pick it automatically.
- **Exports map.** The package has an `exports` field, so deep imports such as
  `metaschema/lib/types.js` are no longer reachable.
- **Typings.** `index.d.ts` now matches the runtime: the static `Schema.KIND`-style fields and the
  `'system'` scope are gone, `validate`, `findReference` and `Model#database` can be `null`,
  `Cardinality` has the two values the runtime produces, and there is a type for everything
  public (`Fields`, `FieldType`, `TypeEntry`, `ValidationIssue`, `DefinitionErrorCode`, ...).
