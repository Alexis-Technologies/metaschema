# Migrating from metarhia

`@alexify/metaschema` 1.0 is a fork of [`metaschema`](https://github.com/metarhia/metaschema) 2.2.
The schema language, validation rules and messages are the same, apart from the fixes listed
below. What changed is the package around them.

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

- **Messages.** Typos in validation messages are fixed, and the old text is not kept. Update any
  test that matches it:

  | Before | After |
  | --- | --- |
  | `Filed "x" is required` | `Field "x" is required` |
  | `Filed "x" is not a object` | `Field "x" not of expected type: object` |
  | `Filed "x" is not a map` | `Field "x" not of expected type: map` |
  | `value length is more then expected in tuple` | `value length is more than expected in tuple` |

- **`Schema#detach`.** The misspelt `detouch` is renamed to `detach`. There is no alias: rename the
  calls.
- **Browser entry.** `dist.js` is now `browser.js` and exports the same names as the main entry,
  including `saveTypes`, which rejects in the browser. Bundlers pick it automatically.
- **Exports map.** The package has an `exports` field, so deep imports such as
  `metaschema/lib/types.js` are no longer reachable.
- **Typings.** `index.d.ts` now matches the runtime: the static `Schema.KIND`-style fields and the
  `'system'` scope are gone, `validate`, `findReference` and `Model#database` can be `null`, and the
  `Kind`, `Scope`, `Store`, `Allow`, `Cardinality`, `Relation` and `ValidationResult` types are
  exported.
