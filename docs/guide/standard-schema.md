# Standard Schema

[Standard Schema](https://standardschema.dev) is a common interface that validation libraries
implement so that the frameworks consuming them (tRPC, TanStack Form and Router, Hono, the AI
SDK, vee-validate, wrpc) accept any of them without an adapter. A library exposes a `~standard`
property with a `validate` function; a consumer calls it and reads back a value or a list of
issues.

Every `Schema` implements version 1 of the specification: `schema['~standard']` is
`{ version: 1, vendor: 'alexify.metaschema', validate }`, for a named or anonymous schema, a
scalar one and an entity of a model alike:

```js
const { Schema } = require('@alexify/metaschema');

const user = Schema.from({ name: 'string', age: '?number' });
const { validate } = user['~standard'];

validate({ name: 'Marcus' });
// { value: { name: 'Marcus' } }

validate({ age: 'old' });
// {
//   issues: [
//     { code: 'required', path: ['name'], message: 'is required', params: {} },
//     {
//       code: 'type',
//       path: ['age'],
//       message: 'not of expected type: number',
//       params: { expected: 'number', received: 'string' },
//     },
//   ],
// }
```

`validate(value)` is [`parse(value)`](/guide/parse) read as the specification does: a value
that passes comes back as `{ value }`, the value `parse` gives (the [defaults](/guide/parse#defaults)
filled in and the [decoders](/guide/parse#codecs-parse-and-serialize-on-a-field) applied; the
value itself, the same reference, when the schema has neither), and one that fails as
`{ issues }`, the [issues of the result](/guide/validation#the-result) themselves. Each has the
`message` and the `path` the specification reads (an array of keys from the root of the value,
empty for the value itself), plus the `code` and `params` of metaschema. The property is an
accessor of the prototype, so `JSON.stringify(schema)` and `Object.keys(schema)` do not see it,
and `'~standard' in schema` is how a consumer tells a Standard Schema from anything else.

```js
const event = Schema.from({
  name: 'string',
  'level?': { type: 'integer', default: 1 },
  when: { type: 'string', parse: (text) => new Date(text) },
});

event['~standard'].validate({ name: 'deploy', when: '2026-10-10T12:00:00.000Z' });
// { value: { name: 'deploy', when: 2026-10-10T12:00:00.000Z, level: 1 } }
```

Keys the schema does not have follow the schema's own `unknown` metadata (rejected unless it
says `ignore`), as they do in `parse`; a consumer that wants them stripped passes
`{ libraryOptions: { unknown: 'strip' } }`.

## In a consumer

A consumer that knows only the specification treats a metaschema schema like one from any other
library. This is the function of the specification's README:

```js
const standardValidate = async (schema, input) => {
  let result = schema['~standard'].validate(input);
  if (result instanceof Promise) result = await result;
  if (result.issues) throw new Error(JSON.stringify(result.issues, null, 2));
  return result.value;
};

await standardValidate(user, { name: 'Marcus' }); // { name: 'Marcus' }
await standardValidate(Schema.from('string'), 42); // throws: not of expected type: string
```

With tRPC, TanStack Form or Hono the schema goes where a zod or valibot schema would:

```ts
import { sValidator } from '@hono/standard-validator';

// tRPC: the input of the procedure is typed from the schema
t.procedure.input(user).mutation(({ input }) => input.name);

// TanStack Form
useForm({ defaultValues: { name: '' }, validators: { onChange: user } });

// Hono
app.post('/users', sValidator('json', user), (c) => c.json(c.req.valid('json')));
```

The entities of a model are `Schema` instances and implement the interface too; a reference to a
stored kind validates as its id, as [`check` does](/guide/references#storage-view-and-graph-view):

```js
const account = model.entities.get('Account');
account['~standard'].validate({ login: 'marcus', company: 'c1' /* ... */ });
```

## Options

The specification lets a consumer pass vendor-specific options as `libraryOptions`. metaschema
reads them as the [options of `parse`](/guide/parse#options):

```js
const uk = require('@alexify/metaschema/locales/uk');

validate({}, { libraryOptions: { maxErrors: 1, messages: uk } });
// {
//   issues: [{ code: 'required', path: ['name'], message: 'є обовʼязковим', params: {} }],
// }
```

## JSON Schema

`schema['~standard'].jsonSchema` is the converter of
[Standard JSON Schema](https://standardschema.dev): `input(options)` and `output(options)` render
the schema as a JSON Schema document for the `target` the consumer names (`'draft-2020-12'`,
`'draft-07'` or `'openapi-3.0'`; anything else throws, as the specification asks), with the
other [options of `toJSONSchema`](/guide/json-schema#options) as `libraryOptions`. The
converter comes with the [generators subpath](/guide/json-schema#the-generators-subpath), which
keeps the JSON Schema code out of the core entry: `register()` it once at startup, and every
schema has it, the ones built before too:

```js
require('@alexify/metaschema/generators').register();

user['~standard'].jsonSchema.input({ target: 'draft-07' });
// {
//   $schema: 'http://json-schema.org/draft-07/schema#',
//   type: 'object',
//   properties: { name: { type: 'string' }, age: { type: ['number', 'null'] } },
//   required: ['name'],
//   additionalProperties: false
// }
```

`input` describes the JSON a value is parsed from and `output` the value `check` accepts; the
two differ only for a `date`, `set` or `map`, which have no JSON form on the way out (see
[Input and output](/guide/json-schema#input-and-output)). The `mongodb` target is not a JSON
Schema and is reached through [`toJSONSchema`](/guide/json-schema) only. Without the
registration `~standard` has `version`, `vendor` and `validate` only; the typings declare
`jsonSchema` on every schema, as it is once the generators are registered.

## TypeScript

The typings declare `~standard` as `StandardProps<D>`, and a `Schema<D>` is a
`StandardSchemaV1<Infer<D>, InferOutput<D>>` and a `StandardJSONSchemaV1<Infer<D>, Infer<D>>` of
[`@standard-schema/spec`](https://www.npmjs.com/package/@standard-schema/spec): the input type is
what `parse` accepts ([`Infer`](/guide/typescript)) and the output type what it gives
([`InferOutput`](/guide/typescript#the-output-of-parse)); the two are the same for a schema
without decoders or defaults:

```ts
import type { StandardSchemaV1 } from '@standard-schema/spec';

type User = StandardSchemaV1.InferOutput<typeof user>;
// { name: string; age?: number | null | undefined }
const schema: StandardSchemaV1<User> = user;

type EventInput = StandardSchemaV1.InferInput<typeof event>;
// { name: string; level?: number | null | undefined; when: string }
type EventOutput = StandardSchemaV1.InferOutput<typeof event>;
// { name: string; level: number | null; when: Date }
```

`validate` is typed as returning the result or a promise of it, which the specification allows
and every consumer of it awaits.

`StandardProps<D>`, `StandardResult<T>`, `StandardOptions`, `StandardConverter` and
`StandardJSONSchemaOptions` are exported for code that reads the interface itself. The package
does not depend on `@standard-schema/spec`; the compatibility is pinned by its type tests.

## Async

A schema whose functions include an `async function` (a `validate` of a field or of the schema,
a decoder, a custom type's `checkType`, in it or in an entity it references) validates through
[`parseAsync`](/guide/parse#async): `validate` returns a promise of the result, as the
specification allows, and the consumers of the specification await it. Any other schema returns
the result itself. The detection reads the functions of the schema the first time `~standard` is
used; a validator that returns a promise without being an `async function` is to `validate` what
it is to `parse`: a `TypeError` with the code `ERR_ASYNC_VALIDATOR`.

## What it is not

- **Not a coercion.** `value` is the value that was given with the schema's defaults and decoders
  applied, and nothing else: a string is not turned into a number because the field is a number.
  A decoder is the place for that, explicitly.
- **Not a JSON Schema.** `jsonSchema` renders the schema; `validate` validates the value.
