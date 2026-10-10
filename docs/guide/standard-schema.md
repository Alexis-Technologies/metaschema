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

`validate(value)` is [`check(value)`](/guide/validation) read as the specification does: a value
that passes comes back as `{ value }`, the same reference, and one that fails as `{ issues }`,
the [issues of the result](/guide/validation#the-result) themselves. Each has the `message` and
the `path` the specification reads (an array of keys from the root of the value, empty for the
value itself), plus the `code` and `params` of metaschema. The property is an accessor of the
prototype, so `JSON.stringify(schema)` and `Object.keys(schema)` do not see it, and
`'~standard' in schema` is how a consumer tells a Standard Schema from anything else.

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
reads them as the [options of `check`](/guide/validation#options):

```js
const uk = require('@alexify/metaschema/locales/uk');

validate({}, { libraryOptions: { maxErrors: 1, messages: uk } });
// {
//   issues: [{ code: 'required', path: ['name'], message: 'є обовʼязковим', params: {} }],
// }
```

## TypeScript

The typings declare `~standard` as `StandardProps<D>`, and a `Schema<D>` is a
`StandardSchemaV1<Infer<D>, Infer<D>>` of
[`@standard-schema/spec`](https://www.npmjs.com/package/@standard-schema/spec): nothing is
transformed, so the input type is the output type, and both are what
[`InferSchema`](/guide/typescript) gives:

```ts
import type { StandardSchemaV1 } from '@standard-schema/spec';

type User = StandardSchemaV1.InferOutput<typeof user>;
// { name: string; age?: number | null | undefined }
const schema: StandardSchemaV1<User> = user;
```

`StandardProps<D>`, `StandardResult<T>` and `StandardOptions` are exported for code that reads
the interface itself. The package does not depend on `@standard-schema/spec`; the compatibility
is pinned by its type tests.

## What it is not

- **A verdict, not a transformation.** `value` is the value that was given, untouched: no
  defaults, no coercion, no stripping of unknown keys. A `parse` that applies them is planned for
  2.2.
- **Synchronous.** `validate` never returns a promise; a consumer that awaits the result gets the
  same object.
- **Not JSON Schema.** `~standard.jsonSchema`, the Standard JSON Schema interface, comes with the
  JSON Schema export planned for 2.1.
