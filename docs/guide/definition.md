# The definition entry

`@alexify/metaschema/definition` is the half of the core that builds schemas and models and reads
them, without the half that validates them. It is for a program that needs the definitions and
their [snapshots](/guide/model#the-snapshot-of-one-schema) but never checks a value against them:
the browser client of a codec built from a snapshot, a form builder that renders fields, a tool
that writes the model down. It is 10.3 KB min+gzip on its own, where the core entry is 21.3 KB.

```js
import { Schema, Model } from '@alexify/metaschema/definition';

const model = new Model({}, [
  ['Category', { Struct: {}, title: 'string', 'parent?': 'Category' }],
  ['Product', { Entity: {}, name: 'string', price: { type: 'number', decimals: 2 }, category: 'Category' }],
]);

const snapshot = model.entities.get('Product').toSnapshot();
JSON.stringify(snapshot); // the same text the core writes
```

## What it does

Everything that builds a schema or reads one works as it does with the core: the constructors
of `Schema` and `Model` (a broken definition is the same `SchemaDefinitionError`, with its code,
when the schema is built), the fields, the metadata, the indexes and the relations, references
(through a model, or a schema's own name), `toJSON`, `toSnapshot`, `model.toJSON()`,
`model.order`, `util.inspect`. The exports are those of the core's that build: `Schema`,
`Model`, `getKindMetadata`, `SchemaDefinitionError` and the constants `KIND`, `KIND_STORED`,
`KIND_MEMORY`, `SCOPE`, `STORE`, `ALLOW`.

What validates says that it cannot, with a `TypeError` of the code `ERR_NOT_REGISTERED`: `check`,
`parse`, `serialize`, `validate` (and `checkAsync`, `parseAsync`, which reject), the `check` of a
field, the warnings of the lint (`schema.warnings`, `schema.checkConsistency()`,
`model.warnings`). A schema has no `~standard`, so a consumer of Standard Schema does not take it
for a validator.

```js
const product = model.entities.get('Product');
product.check({ name: 'Lamp' });
// TypeError: check needs the core entry @alexify/metaschema: ./definition alone does not validate
'~standard' in product; // false
```

## With the core

The classes are the core's own (`require('@alexify/metaschema/definition').Schema ===
require('@alexify/metaschema').Schema`): the core entry is this half with the other installed
into it. A program that loads the core as well validates with the schemas it built through the
definition entry, the ones built before the core was loaded included, and a bundle of both
carries each module once.

```js
const { Schema } = require('@alexify/metaschema/definition');
const tag = new Schema('Tag', { label: { type: 'string', length: 3 } });

require('@alexify/metaschema');
tag.check({ label: 'abcd' }).errors; // [ 'Field "Tag.label" exceeds the maximum length' ]
```

A method taken from a schema before the core was loaded (`const { check } = tag`, a
`check.bind(tag)` handed to a router) calls the core's once it is loaded. In an ES module
program, `import '@alexify/metaschema'` for this alone is kept by a bundler: the package lists its
entries as the modules with side effects.

The halves meet within one copy of the package. A schema built by the definition entry of one copy
(a library with a version of its own in `node_modules`) does not validate with the core of
another, and says so:

```js
// TypeError: check needs the core entry @alexify/metaschema: the core entry loaded is another
//   copy of the package than the one that built the schema (deduplicate @alexify/metaschema)
```

`npm ls @alexify/metaschema` shows the copies; one version for both (a `peerDependencies` range
of the library, an `overrides` entry of the program) makes them one.

The subpaths that only build or name things work beside the definition entry alone:
[`./derive`](/guide/derive) (`pick`, `omit`, `partial`, …) and [`./formats`](/guide/formats)
(whose names a `format` rule is read against when a field is built). The ones that validate,
render or convert (`./generators`, `./compile`, `./model`, `./stream`, `./coerce`, `./mongodb`)
load the validation half themselves.

## Boundaries

- **The lint is the validation half's.** A definition with an option no type reads, a pattern
  without `length.max` or an index over a missing field builds as well; its warnings are read
  where the core is loaded (a CI check of the model, for instance).
- **The checks are compiled on their first use**, in either entry: building a schema compiles
  none, so a schema that is only read costs its construction alone.
- **The type registry is the core's**, process-wide as it is there: custom types registered by a
  model of the definition entry are the ones the core sees.
