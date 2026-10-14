# Migrating from 2.x

3.0 moves two things. The generators of TypeScript and JSON Schema leave the core entry for the
`@alexify/metaschema/generators` subpath, which takes `model.dts`, `schema.toInterface()` and
`saveTypes` with them, and `schema['~standard'].validate` is `parse` rather than `check`. The
schema language, `check`, the shape of a result and the typings of 2.0 stay as they are, with the
smaller changes below. This page goes through them with the 2.0 behaviour first and the 3.0
behaviour after it; the condensed list is under "Upgrading from 2.0" in the
[CHANGELOG](https://github.com/Alexis-Technologies/metaschema/blob/main/CHANGELOG.md).

Everything not listed here is additive: [`parse`, `serialize`, `checkAsync` and
`parseAsync`](/guide/parse), the [JSON Schema export](/guide/json-schema) with its four targets
and the strict profile, the [JIT backend](/guide/compile), JSDoc and named types in the
[generated TypeScript](/guide/typescript#jsdoc-and-named-types), `InferOutput` and the `maxDepth`
option work on a 2.0 schema as it is. A project coming from 1.x goes through
[Migrating from 1.x](/guide/migrating-from-1) first.

## The generators subpath

### `model.dts`, `toInterface()` and `saveTypes`

The TypeScript rendering is no longer in `@alexify/metaschema`: `model.dts` is `undefined`,
`schema.toInterface` is not a function and the core entry has no `saveTypes` export. The
`@alexify/metaschema/generators` subpath has them as functions that take the schema or the model:

```js
const { Model } = require('@alexify/metaschema');

const model = new Model({}, new Map([
  ['Company', { Registry: {}, name: { type: 'string', unique: true } }],
  ['Person', { Entity: {}, name: 'string', employer: 'Company' }],
]));

// 2.0
const { saveTypes } = require('@alexify/metaschema');
model.dts;                                  // 'interface Company {\n  name: string;\n  companyId?: string;\n}\n\ninterface Person { ...'
model.entities.get('Person').toInterface(); // 'interface Person {\n  name: string;\n  employerId: string;\n  personId?: string;\n}'
await saveTypes('./types/model.d.ts', model);

// 3.0
const { toTypeScript, saveTypes } = require('@alexify/metaschema/generators');
model.dts;                                  // undefined
model.entities.get('Person').toInterface(); // TypeError: model.entities.get(...).toInterface is not a function
toTypeScript(model);                        // what model.dts returned
toTypeScript(model.entities.get('Person')); // what toInterface() returned
await saveTypes('./types/model.d.ts', model);
```

The text is the same; `toTypeScript(model)` renders what `model.dts` did:

```ts
interface Company {
  name: string;
  companyId?: string;
}

interface Person {
  name: string;
  employerId: string;
  personId?: string;
}
```

A program that prefers the methods calls `register()` of the subpath once at startup. It
installs `model.dts`, `model.toTypeScript(options)`, `schema.toInterface(options)`,
`schema.toJSONSchema(options)` and `model.toJSONSchema(options)` on the classes, and the
`jsonSchema` converter of Standard JSON Schema on `schema['~standard']`, for every schema, the
ones built before the call too:

```js
require('@alexify/metaschema/generators').register();

model.dts === toTypeScript(model); // true
```

Nothing happens on import, and `register()` is idempotent. The subpath is 7.3 KB min+gzip on top
of the core entry, which is 18.6 KB in 3.3 (17.7 KB in 3.2, 4.5 KB and 16.1 KB in 3.0) and carries no Node.js
runtime any more; the browser entry is the same. `toJSONSchema` is new (2.0 had no JSON Schema export), and so are the JSDoc and the
`named` option of the rendering. See
[The generators subpath](/guide/json-schema#the-generators-subpath) and
[Generating interfaces from a model](/guide/typescript#generating-interfaces-from-a-model).

## Validation

### `~standard.validate` is `parse`

A consumer of [Standard Schema](/guide/standard-schema) (tRPC, TanStack Form, Hono, …) gets the
value [`parse`](/guide/parse) gives: the `default` of a missing key filled in and the `parse`
function of every field applied. In 2.0 `validate` was `check`, so a `default` was an annotation
and a `parse` key an option the lint reported:

```js
const event = Schema.from({
  name: 'string',
  'level?': { type: 'integer', default: 1 },
  when: { type: 'string', parse: (text) => new Date(text) },
});

event['~standard'].validate({ name: 'deploy', when: '2026-10-10T12:00:00.000Z' });
// 2.0: { value: { name: 'deploy', when: '2026-10-10T12:00:00.000Z' } }
//      (and event.warnings: 'Warning [unknown-option]: option "parse" of "when" is not known to type "string"')
// 3.0: { value: { name: 'deploy', when: 2026-10-10T12:00:00.000Z, level: 1 } }
```

A schema without defaults and decoders returns the value it was given, the same reference, as
2.0 did. Keys the schema does not have follow its own `unknown` metadata in both versions, and
`libraryOptions` are the options of `parse` now, `unknown: 'strip'` included (2.0 threw for it):

```js
const user = Schema.from({ name: 'string' });
const value = { name: 'Marcus' };
user['~standard'].validate(value).value === value; // 2.0 and 3.0: true

user['~standard'].validate({ name: 'Marcus', extra: 1 }, { libraryOptions: { unknown: 'strip' } });
// 2.0: TypeError: unknown must be "reject" or "ignore", got "strip"
// 3.0: { value: { name: 'Marcus' } }
```

A schema with an `async function` among its validators, decoders and custom `checkType`s (in it
or in an entity it references) returns a promise of the result, which the specification allows
and its consumers await. 2.0 reported the promise itself:

```js
const signup = Schema.from({
  login: { type: 'string', validate: async (login) => login !== 'taken' || 'is taken' },
});
signup['~standard'].validate({ login: 'marcus' });
// 2.0: { issues: [ { code: 'custom', path: ['login'], message: '[object Promise]', params: {} } ] }
// 3.0: Promise { { value: { login: 'marcus' } } }
```

The typings say `validate` returns `StandardResult<T> | Promise<StandardResult<T>>`, with
`types.input` as `Infer<D>` and `types.output` as `InferOutput<D>`, so a consumer typed on the
output of the schema sees the decoded value. The JSON Schema converter, `~standard.jsonSchema`,
is new and comes with `register()` of the generators. See
[check, parse and `~standard` side by side](/guide/parse#check-parse-and-standard-side-by-side).

### A struct rejects an array

2.0 accepted `[]` for a struct whose fields are all optional (`typeof [] === 'object'`, and no
key to look at) and reported the missing keys of any other struct. An array is
`not of expected type: object` now, whatever the fields:

```js
const order = Schema.from({ address: { 'city?': 'string', 'zip?': 'string' } });
order.check({ address: [] }).errors;
// 2.0: []
// 3.0: [ 'Field "address" not of expected type: object' ]
```

### A promise from a validator throws

A `validate` function, a custom type's `checkType` or a field's `parse` function may return a
promise to `checkAsync` and `parseAsync`, which settle them after the walk, in field order. The
synchronous `check` and `parse` throw a `TypeError` with the code `ERR_ASYNC_VALIDATOR` for one;
2.0 stringified it into a `custom` issue:

```js
const signup = Schema.from({
  login: { type: 'string', validate: async (login) => login !== 'taken' || 'is taken' },
});

signup.check({ login: 'taken' }).errors;
// 2.0: [ 'Field "login" [object Promise]' ]
// 3.0: TypeError: The validator of "login" returned a promise; use checkAsync or parseAsync
//      (code: 'ERR_ASYNC_VALIDATOR')

(await signup.checkAsync({ login: 'taken' })).errors;
// 3.0: [ 'Field "login" is taken' ]
```

A validator that returned a promise in 2.0 never validated anything, so the change surfaces a
bug rather than creating one. `~standard.validate` returns a promise only for a schema with an
`async function` (above); a plain function that returns a promise throws there too. See
[Async](/guide/parse#async).

### A graph deeper than 128 embedded records is invalid

`check`, `parse` and `serialize({ check: true })` count the embedded records they are inside and
record a `depth` issue at the first record past `maxDepth`, 128 by default, instead of walking
until the stack runs out:

```js
const node = new Model({}, new Map([['Node', { Struct: {}, 'next?': 'Node' }]])).entities.get('Node');
let value = {};
for (let i = 0; i < 200; i++) value = { next: value };

node.check(value).valid;
// 2.0: true
// 3.0: false
node.check(value).issues[0];
// 3.0: { code: 'depth', path: ['next', 'next', ...], message: 'is nested deeper than 128 references', params: { max: 128 } }
//      (129 keys in the path)
node.check(value, { maxDepth: 256 }).valid;
// 3.0: true
```

A program that validates deeper graphs passes a larger `maxDepth` on the call. A reference to a
stored kind is an id and never recurses, so the limit concerns memory kinds and `embed: true`
only. See [Validation](/guide/validation#options).

### The `validate`, `parse` and `serialize` of a nested struct are not keys of the value

A nested struct's `validate` function, and its `parse` and `serialize` since 3.0, are the
struct's own, as they are at the root. 2.0 let a value carry a key of that name:

```js
const order = Schema.from({
  address: { city: 'string', validate: (address) => address.city !== '' || 'city is empty' },
});
order.check({ address: { city: 'Kyiv', validate: 1 } }).errors;
// 2.0: []
// 3.0: [ 'Field "address" has unexpected keys: validate' ]
```

Under `unknown: 'ignore'` the key is accepted like any other, and `parse` with
`unknown: 'strip'` drops it.

### `maxErrors` is a whole number

`maxErrors` must be an integer of at least 1, or `Infinity`; 2.0 took `1.5` and stopped after
two issues:

```js
const schema = Schema.from({ a: 'string', b: 'string', c: 'string' });
schema.check({}, { maxErrors: 1.5 }).errors;
// 2.0: [ 'Field "a" is required', 'Field "b" is required' ]
// 3.0: TypeError: maxErrors must be an integer of at least 1, got 1.5
```

## The schema language

### Definitions that could never work are errors

Three definitions 2.0 built, and failed on later, throw `SchemaDefinitionError` when the schema
is built, like every other broken definition:

```js
Schema.from({ flags: { object: { boolean: 'string' } } });
// 2.0: builds; every value fails with 'Field "flags" keys must be of type boolean'
// 3.0: SchemaDefinitionError [ERR_INVALID_DEFINITION]: Type "object" needs a key type of "string" or "number" in "flags"

Schema.from({ flags: { map: { boolean: 'string' } } });
// 2.0: builds, and accepts a Map with keys of any type
// 3.0: SchemaDefinitionError [ERR_INVALID_DEFINITION]: Type "map" needs a key type of "string" or "number" in "flags"

Schema.from({
  shape: {
    union: [
      { kind: { enum: ['circle'], default: 'circle' }, r: 'number' },
      { kind: { enum: ['square'] }, side: 'number' },
    ],
    discriminator: 'kind',
  },
});
// 2.0: builds; { shape: { r: 1 } } fails with 'Field "shape.kind" is not one of: circle, square'
// 3.0: SchemaDefinitionError [ERR_INVALID_UNION]: Union discriminator "kind" of branch 0 cannot have a default in "shape"
```

The key type of an `object` or a `map` is `'string'` or `'number'`. A `default` on the
discriminator field can never apply, because the branch is picked before the defaults of the
branch are filled in; see [Discriminated unions](/guide/unions#discriminated-unions).

## TypeScript

### `Infer` leaves out a key with a `default`

A field with a `default` is an optional property on the input side, because `parse` fills it in;
`InferOutput<D>`, new in 3.0, has it present:

```ts
import { Schema, type Infer, type InferOutput } from '@alexify/metaschema';

const event = Schema.from({ name: 'string', status: { type: 'string', default: 'draft' } });

type EventInput = Infer<typeof event>;
// 2.0: { name: string; status: string }
// 3.0: { name: string; status?: string | undefined }
type Event = InferOutput<typeof event>;
// 3.0: { name: string; status: string }

const input: EventInput = { name: 'deploy' };
// 2.0: error TS2741: Property 'status' is missing in type '{ name: string; }'
// 3.0: compiles
```

Where the key was declared optional (`'level?': { type: 'integer', default: 1 }`), `null` stays
in its input type (`level?: number | null | undefined`) and the output type is
`level: number | null`. The generated interfaces are unchanged (every field present), so a value
typed from the dts is still assignable to `Infer`, and the output type to the dts. A `Schema<D>`
is a `StandardSchemaV1<Infer<D>, InferOutput<D>>` now, where 2.0 had `Infer<D>` on both sides.
See [The output of parse](/guide/typescript#the-output-of-parse).

### `CheckContext` has more slots

For code that builds on the internals and calls `field.check(value, context, key)` with a
context of its own: the context of a check has five new slots, `depth` and `maxDepth` (how many
embedded records the check is inside, and how many it may be), `source` (the value the check
started from, when the schema can reach it again through a reference), `async` (the validators
that returned a promise, `null` in a synchronous check) and `scratch` (the context `parse` tries
the branches of a plain union in, `null` in a check). The `CheckContext` type declares them; the
keys of the object, in their order:

```js
// 2.0: issues, count, limit, path, seen, unknown, references, root, messages
// 3.0: issues, count, limit, depth, maxDepth, path, seen, source, unknown, references, root, messages, async, scratch
// 3.1: the same, then renamed
```

A context built by hand needs `depth: 0`, `maxDepth: 128`, `source: null`, `async: null`,
`scratch: null` and, since 3.1, `renamed: false` (whether the check read a field from an alias)
besides the slots of 2.0, and its `unknown` may be `'strip'` in a parse. The
internal constructor of an `exception` issue takes the key of the field as well. Nothing changes
for a validator, a `checkType` or a decoder: they receive the value and the path, as before.

## The JIT backend

### `compile()` returns a report

`@alexify/metaschema/compile` is new in 3.0, so there is nothing to change, only what to expect
of it: `compile(target)` replaces the check of a schema, or of every entity of a model, in place
and returns `{ accelerated, error }` rather than the schema; `register(options)` compiles every
schema built from then on, not the ones built before; and the default mode keeps the closures
silently where `new Function` is not allowed:

```js
const { compile, register, canEval } = require('@alexify/metaschema/compile');

compile(user);                 // { accelerated: true }: user.check runs generated code now
compile(user, { jit: false }); // { accelerated: false }: the closures are back
compile(model);                // { accelerated: true }: every entity of the model
```

`error` is set when a check could not be generated in the default mode (a `SchemaDefinitionError`
with the code `ERR_JIT_BUILD`, the generator's error as its `cause`; the closures stay),
`register({ onFallback })` is told of every such schema, and `jit: true` throws instead
(`ERR_NO_EVAL` where there is no eval at all). A compiled schema records exactly the issues the
closures record. See [The JIT backend](/guide/compile).

## Since 3.0: 3.1 and 3.2

The releases after 3.0 add without breaking, but a few behaviours a 2.x program meets on the
way changed:

- **3.1: two fields of one key are an error.** `{ a: 'string', 'a?': 'number' }`, or a
  calculated field and a field of one name, is `ERR_INVALID_DEFINITION`; the second silently
  replaced the first before.
- **3.1: `aliases` is read.** It is a key of a field (old names the field is read from), so
  `aliases: 'old'` (not a list) is `ERR_INVALID_DEFINITION`, and a custom type no longer sees
  an option of that name. See [Model evolution](/guide/evolution#aliases-and-deprecated).
- **3.1: `JSON.stringify(model)` writes the [snapshot](/guide/model#the-snapshot)** rather than
  the instance's own enumerable properties.
- **3.1: a subpath function given the wrong thing throws `ERR_INVALID_TARGET`** (a plain
  `TypeError` with a code, like `ERR_ASYNC_VALIDATOR`).
- **3.2: the order of the issues of an async check.** Independent async validators are in
  flight together: a synchronous validator met after an unrelated promise runs during the
  walk, so the issues of the walk come first and the settled ones after them, in field order.
- **3.2: a `pattern` is never run over a string longer than `length.max`**; such a string has
  its `length` issue alone.
- **3.2: the message of `unexpected` lists the first ten keys** and says how many more;
  `params.keys` keeps them all.

## Checklist

1. Replace `model.dts`, `schema.toInterface()` and `saveTypes` of the core entry with
   `toTypeScript(target, options)` and `saveTypes(file, target, options)` of
   `@alexify/metaschema/generators`, or call its `register()` once at startup.
2. Where a schema goes to a Standard Schema consumer, expect the value `parse` gives: defaults
   filled in, `parse` functions applied, and a promise for a schema with an `async function`. A
   2.0 schema that carried a `parse` key for its own purposes has a decoder now.
3. Replace `check` and `parse` with `checkAsync` and `parseAsync` where a validator, a
   `checkType` or a decoder returns a promise (2.0 reported `[object Promise]` for it).
4. Expect `not of expected type: object` for an array where a struct is expected, one
   `unexpected` issue for a `validate`, `parse` or `serialize` key inside a nested struct of the
   value, and a `depth` issue past 128 embedded records (`maxDepth` on the call for deeper
   graphs).
5. Fix the definitions that throw at build time: the key type of an `object` or `map`
   (`'string'` or `'number'`), a `default` on a discriminator field, and a fractional
   `maxErrors` on a call.
6. Read `Infer<D>` as the input side (a defaulted key optional) and `InferOutput<D>` as the
   output of `parse`; code that builds a `CheckContext` by hand adds the new slots.
7. Then, as wanted: `compile()` or `register()` of `@alexify/metaschema/compile` for the JIT,
   `toJSONSchema` for the JSON Schema export, `{ named: true }` for named types.

The pages for what is new: [Parse and serialize](/guide/parse), [The JIT backend](/guide/compile),
[JSON Schema](/guide/json-schema), [Standard Schema](/guide/standard-schema) and
[TypeScript](/guide/typescript).
