# Parse and serialize

`check` answers one question: is this value what the schema describes? `parse` answers it and
builds the value of the program from the value that was given: a missing key gets its
`default`, keys the schema does not have can be stripped, a field's `parse` function turns the
validated value into what the program works with (a date-time string into a `Date`, a decimal
string into cents), and the schema's own `parse` finishes the record. `serialize` is the way
back. Both are built on the same compiled check, so a schema compiled by the
[JIT backend](/guide/compile) parses through its generated code.

```js
const { Schema } = require('@alexify/metaschema');

const payment = new Schema('Payment', {
  amount: { type: 'string', pattern: /^\d+\.\d\d$/, length: 16, parse: (text) => Math.round(Number(text) * 100) },
  'currency?': { type: 'string', default: 'EUR' },
  paidAt: { type: 'string', parse: (text) => new Date(text), serialize: (date) => date.toISOString() },
});

payment.parse({ amount: '12.34', paidAt: '2026-10-10T12:00:00.000Z' });
// {
//   valid: true,
//   value: { amount: 1234, paidAt: 2026-10-10T12:00:00.000Z, currency: 'EUR' },
//   issues: [],
// }

payment.parse({ amount: '12.3' });
// {
//   valid: false,
//   value: undefined,
//   issues: [
//     { code: 'pattern', path: ['amount'], message: 'does not match the pattern ^\\d+\\.\\d\\d$', params: { pattern: '^\\d+\\.\\d\\d$' } },
//     { code: 'required', path: ['paidAt'], message: 'is required', params: {} },
//   ],
// }
```

## The pipeline

`schema.parse(value, options?)` runs, in this order:

1. **Defaults.** Every struct field with a `default` whose key is missing or `undefined` is
   filled in, at any depth (nested structs, the elements of collections, the records a reference
   embeds). A function is a factory, called on every parse: `default: () => new Date()`.
2. **The check.** The value with its defaults is validated by `check`, with the options of the
   call. A default is validated like any value, and a required field with a `default` may be left
   out of the value: `check` alone still reports it as `required`. An invalid value stops here:
   `{ valid: false, value: undefined, issues }`.
3. **Strip.** With `unknown: 'strip'` every struct of the output is rebuilt from the keys the
   schema knows, at any depth.
4. **The decoders.** A field's `parse(value)` function runs on the validated value of the field,
   from the parts of a value up to the value: the elements of an array, set, map or tuple before
   the collection, the fields of a nested struct before the struct's own `parse`, the record of
   an embedded reference through the `parse` of its entity.
5. **The schema's `parse`.** The top-level `parse(value)` function of the schema runs last, over
   the whole record.

The result is `{ valid, value, issues }`: `issues` is always an array, `value` is the output for a
valid value and `undefined` otherwise. The value given is never written to. Where nothing was
applied the output is the value itself; where something was, the containers on the way to it
are new and the rest is shared with the input:

```js
const user = Schema.from({ name: 'string', 'tags?': { array: 'string' } });
const input = { name: 'Marcus', tags: ['stoic'] };
user.parse(input).value === input; // true: no default, no decoder, nothing stripped

const stripped = user.parse({ ...input, extra: 1 }, { unknown: 'strip' }).value;
// { name: 'Marcus', tags: ['stoic'] }, a new object; stripped.tags === input.tags
```

## Options

The [options of `check`](/guide/validation#options), plus one value of `unknown`:

| Option | Meaning |
| --- | --- |
| `unknown: 'strip'` | keys the schema does not have are accepted by the check and left out of the output, at every depth; `'reject'` and `'ignore'` are what they are in `check`. `strip` is an option of `parse` alone: `check` throws for it |
| `root`, `maxErrors`, `references`, `messages` | as in `check`; `references` also decides which records the decoders enter (an id is never entered) |

A schema's own `unknown` metadata (`{ Form: { unknown: 'ignore' } }`) is the default of its
`parse` as it is of its `check`.

## Defaults

`default` is an annotation of a field (a key the type does not read, kept on the field, and the
[JSON Schema export](/guide/json-schema) renders it). `parse` applies it; `check` does not:

```js
const doc = new Schema('Doc', {
  title: 'string',
  status: { type: 'string', default: 'draft' },
  'labels?': { array: 'string', default: () => [] },
  serial: { type: 'integer', default: () => Date.now() },
});

doc.parse({ title: 'x' }).value;
// { title: 'x', status: 'draft', labels: [], serial: 1791036000000 }
doc.check({ title: 'x' }).errors;
// [ 'Field "Doc.status" is required', 'Field "Doc.serial" is required' ]
```

A key that is there is never defaulted, `null` included (`{ status: null }` is a type error for a
required string, and stays `null` for a `nullable` one); a key set to `undefined` is. A function
is always a factory, so each parse gets its own array, date or object. A default is validated
after it is applied: `{ type: 'number', default: 'zero' }` fails every parse of a value without
that key, which [`schema.warnings`](/guide/model#warnings) does not report.

## Codecs: `parse` and `serialize` on a field

A field's `parse` function is its decoder: it gets the validated value of the field and returns
the value of the program. Its `serialize` function is the encoder back. Both may be given on any
field (scalars, collections, nested structs, references, custom types), in the long form:

```js
const event = new Schema('Event', {
  when: {
    type: 'string',
    parse: (text) => new Date(text),
    serialize: (date) => date.toISOString(),
  },
  amount: {
    type: 'string',
    pattern: /^\d+\.\d\d$/,
    length: 16,
    parse: (text) => Math.round(Number(text) * 100),
    serialize: (cents) => (cents / 100).toFixed(2),
  },
  tags: {
    array: { type: 'string', parse: (text) => text.toLowerCase() },
    parse: (list) => new Set(list),
    serialize: (set) => Array.from(set),
  },
});

const { value } = event.parse({ when: '2026-10-10T12:00:00.000Z', amount: '12.34', tags: ['A', 'B'] });
// { when: 2026-10-10T12:00:00.000Z, amount: 1234, tags: Set(2) { 'a', 'b' } }

event.serialize(value);
// { value: { when: '2026-10-10T12:00:00.000Z', amount: '12.34', tags: ['a', 'b'] } }
```

The rules of a decoder:

- It runs only on a value that passed its type, its rules and its `validate`, so it can rely on
  all three; `null` and `undefined` (an optional or `nullable` field) pass it by.
- It runs after the decoders of the parts of its value: the element decoder of `tags` runs on
  each element, then the field's own on the array of decoded elements.
- It is called on the field (`this` is the field) with the value alone, and whatever it returns
  is the output; it may return a promise to [`parseAsync`](#async).
- An exception is an `exception` issue at the field's path, and the result is invalid; after
  the first failure no other decoder runs.
- A decoder on a reference field gets what the field holds in that check: the record of an
  embedded reference (already decoded by its entity), or the id.

The schema-level `parse` and `serialize` functions (next to `validate` in a definition) are the
decoder and encoder of the whole record: the schema's `parse` runs last, after every field; its
`serialize` runs first. A nested struct's own `parse`/`serialize` work the same way for that
struct, and a `Schema` instance used as a field brings its own. `format` is collected into
`schema.options` and not called by metaschema.

## Strip

`unknown: 'strip'` is the third policy for keys the schema does not have, next to `reject` (an
`unexpected` issue) and `ignore` (accepted and kept). The check behind `parse` runs as with
`ignore`, and the output is rebuilt without them, in every struct of the value:

```js
const form = Schema.from({ name: 'string', address: { city: 'string' } });
form.parse({ name: 'x', address: { city: 'Kyiv', geo: [0, 0] }, csrf: 'token' }, { unknown: 'strip' }).value;
// { name: 'x', address: { city: 'Kyiv' } }
```

A [calculated field](/guide/validation#calculated-fields) is a key the schema knows, and its
value is kept. With `strip` every struct of the output is a new object, whether or not it had
keys to drop.

A field with [`aliases`](/guide/evolution#aliases-and-deprecated) is read from an alias the
value carries when it has nothing under the field's own key, and `parse` writes it under the
field's own key, with or without `strip`: `Schema.from({ login: { type: 'string', aliases:
['name'] } }).parse({ name: 'x' }).value` is `{ login: 'x' }`, the field in the place of the
alias. A value that carries no alias comes back as it is, like any value nothing applied to.
No `default` fills a field whose value is under an alias, and `serialize` never looks at one:
it reads the value of the program, which carries the field keys.

## Serialize

`schema.serialize(value, options?)` is the other direction: the schema's own `serialize` first,
then the `serialize` of every field, from the value down to its parts, through the same
collections, tuples, nested structs and embedded references. It validates nothing by default and
returns `{ value }`; a serializer that throws throws out of `serialize`, since the value is the
program's own. With `check: true` the result is validated, and the options are the options of
`check` for it:

```js
event.serialize(value, { check: true });
// { valid: true, value: { when: '...', amount: '12.34', tags: ['a', 'b'] }, issues: [] }
```

A `union` is followed through its `discriminator`; a plain union is entered through the first
branch whose check accepts the program value, so only while it still has the form of the branch.

## Async

A `validate` function (of a field or of the schema), a custom type's `checkType` and a decoder may
return a promise. `checkAsync` and `parseAsync` return a promise of the same result as `check`
and `parse`:

```js
const signup = new Schema('Signup', {
  login: {
    type: 'string',
    length: { min: 3, max: 32 },
    validate: async (login) => !(await users.exists(login)) || 'is taken',
  },
  password: 'string',
  validate: async (value) => !(await passwords.isCommon(value.password)) || 'is a common password',
});

const result = await signup.checkAsync({ login: 'marcus', password: 'secret' });
result.errors; // [ 'Field "Signup.login" is taken' ]

const parsed = await signup.parseAsync({ login: 'marcus', password: 'secret' });
```

The walk of the value is synchronous, and every validator runs where `check` runs it, with one
exception: a validator that returns a promise is set aside with the path it was met at, and a
validator met later with a promise pending under its path (the `validate` of a struct whose
field is still being checked, the schema's own) is set aside uncalled, so that the rule of
[validation](/guide/validation#custom-validation) holds across promises: a validator runs only
when nothing under it failed, and the schema's own after the fields. Validators beside a promise
run at once, and their promises are in flight together. After the walk the entries are settled
in the order they were met: a promise is awaited, a validator set aside is called once the
promises under it settled, each recording its issues at its path; `maxErrors` stops the list as
it stops the walk. The issues the walk recorded come first, in walk order, the settled ones
after them, in field order. Decoders in `parseAsync` settle the same way, the parts of a value
before the value.

Under a low `maxErrors` a validator may be called whose result is then dropped: the limit
decides what is recorded, as in `check`, not which validators run.

The synchronous `check` and `parse` throw a `TypeError` with the code `ERR_ASYNC_VALIDATOR` when
a validator, a `checkType` or a decoder returns a promise:

```js
signup.check({ login: 'marcus', password: 'secret' });
// TypeError: The validator of "Signup.login" returned a promise; use checkAsync or parseAsync
//   code: 'ERR_ASYNC_VALIDATOR'
```

`serialize` is synchronous; its `check` option runs the synchronous `check`.

### Async validators in a plain union

A plain `union` picks the first branch whose synchronous checks pass. A validator of a branch
that returns a promise is set aside: the branch is taken if nothing else in it failed, the
validator settles after the walk and may still make the value invalid, and no further branch is
tried for it. A branch that fails drops the validators it set aside with its issues, and their
promises are observed, never awaited. Where branches carry async validators, a `discriminator`
says which branch a value is without a trial.

The promises of independent validators are in flight together, so the latency of a check is the
longest of theirs, not the sum; a validator over them waits for them, and such validators settle
one after the other: the rule that a validator runs only when nothing under it failed needs
that much order.

## Standard Schema

[`schema['~standard'].validate`](/guide/standard-schema) is `parse` with the policies of the
schema, so a consumer of the specification gets the defaults and the decoders applied, and a
schema whose functions include an `async function` (a validator, a decoder, a custom
`checkType`, in it or in an entity it references) validates through `parseAsync`, returning a
promise as the specification allows.

## TypeScript

[`InferOutput<D>`](/guide/typescript#the-output-of-parse) is the type of the value `parse` gives:
`Infer<D>` with the result of every `parse` function in place of the value it decodes, and
every defaulted key present. `parse` returns
`{ valid: true; value: InferOutput<D>; issues: [] } | { valid: false; value: undefined; issues: ValidationIssue[] }`,
and `serialize` takes an `InferOutput<D>` and gives an `Infer<D>`.

## check, parse and `~standard` side by side

| | `check` | `parse` | `~standard.validate` |
| --- | --- | --- | --- |
| returns | `ValidationResult` (`valid`, `issues`, `errors`, …) | `{ valid, value, issues }` | `{ value }` or `{ issues }`, or a promise of one |
| defaults | not applied: a missing required key is `required` | applied before the check | applied |
| decoders, the schema's `parse` | not called | called on a valid value | called |
| `unknown` | `reject` or `ignore`; the schema's own metadata by default | `reject`, `ignore` or `strip` | the schema's own metadata, or `libraryOptions` |
| the value | never touched | never touched; the output shares what did not change | the output of `parse` |
| a validator's promise | `ERR_ASYNC_VALIDATOR`; `checkAsync` | `ERR_ASYNC_VALIDATOR`; `parseAsync` | a promise when the schema has an async function |

## Boundaries

- Defaults apply to the fields of structs; a tuple element, an array element or a root value
  has no missing key to fill.
- A value with a `then` function is data. `parse` awaits nothing; `parseAsync` awaits only the
  promises its decoders make, never a thenable of the value, so a field called `then` comes back
  as it is. The one case that is awaited is a `Promise` instance in the data under a field with
  an async decoder, in `parseAsync`.
- A non-function `default` is the same object in every output (`default: []` is one array shared
  by every parse); a function is a factory and gives each parse its own. A `default` factory or
  a field's `serialize` that throws is a programming error and throws out of the call; only a
  decoder's exception is an issue.
- A plain `union` whose subtree carries a default, a decoder or a serializer is entered through a
  second check of the union value, with the options, the root and the path of the call: a
  validator of such a branch runs in that trial and again in the check. A `discriminator` picks
  the branch in one lookup and avoids it.
- The `validate`, `parse` and `serialize` functions of a nested struct are the struct's own, as
  they are options at the root: a value carrying `inner: { parse: 1 }` has an unexpected key.
- A valid result's `issues` is a frozen empty array, the same one for every valid result.
- A default on a field of a branch of a plain `union` applies when that branch accepts the value
  with its defaults in place; the branches are tried in order, as the check tries them. A
  `discriminator` picks the branch without trying.
- Decoders do not change what `check` reports and are not part of the JSON Schema export or the
  generated TypeScript: both describe the value as it is validated (the input side).
- `format` is stored in `schema.options` and never called.
- A value that loops through its embedded references cannot be defaulted (the copies could not
  close the loop) and is checked as it was given, which reports the loop.
