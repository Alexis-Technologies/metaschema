# String formats

`format` is a rule of strings beside [`length` and `pattern`](/guide/types#rules): the name of a
form the string must have, an email, a uuid, a date. The core knows the rule and keeps an empty
table of formats; `register()` of the `@alexify/metaschema/formats` subpath fills it with nine
built-in formats and with your own, so that a program that validates no email carries no email
expression.

```js
const { Schema } = require('@alexify/metaschema');
const { register } = require('@alexify/metaschema/formats');

register();

const signup = Schema.from({
  email: { type: 'string', format: 'email', length: { max: 254 } },
  'site?': { type: 'string', format: 'uri' },
  since: { type: 'string', format: 'date' },
});
signup.check({ email: 'ann@example.com', since: '2026-10-11' }).valid; // true
signup.check({ email: 'ann@', site: 'example.com', since: '2026-02-30' }).issues;
// [
//   { code: 'format', path: ['email'], message: 'is not a valid email', params: { format: 'email' } },
//   { code: 'format', path: ['site'], message: 'is not a valid uri', params: { format: 'uri' } },
//   { code: 'format', path: ['since'], message: 'is not a valid date', params: { format: 'date' } }
// ]
```

A format the table does not know is a definition error when the schema is built, never a check
that passes everything:

```js
Schema.from({ email: { type: 'string', format: 'email' } }); // before register()
// throws SchemaDefinitionError [ERR_INVALID_RULE]: Rule "format" names a format that is not registered: "email" (register() of @alexify/metaschema/formats) in "email"
```

## The rule

```mermaid
flowchart TB
    V["a value of a string field"] --> T{"a string?"}
    T -->|"no"| TI(["a type issue, nothing more"])
    T -->|"yes"| R["the rules, each recording its own issue:<br/>length, then pattern and format,<br/>these two only up to length.max"]
    R --> Q{"an issue?"}
    Q -->|"no"| VA["validate"]
    Q -->|"yes"| END(["the issues of the rules"])
```

`format` applies to `string` fields only (`{ type: 'number', format: 'email' }` is
`ERR_INVALID_RULE`, as any rule on a type that does not accept it). It runs after the type,
`length` and `pattern`, before `validate`, and a failed test is a `format` issue with the name in
`params`; the [locales](/guide/validation#messages-and-locales) render it (`is not a valid
email`, `не є коректним email`). Like a pattern, a format is never run over a string longer
than `length.max` (such a string is reported for its length alone), so a bound keeps a custom
test safe as it keeps a pattern safe; see [Patterns and ReDoS](/guide/validation#patterns-and-redos).
Both backends run the same test: the [JIT](/guide/compile) reaches it through the scope of the
generated code.

The field keeps the name (`schema.fields.email.format` is `'email'`), so a
[snapshot](/guide/model#the-snapshot) writes it, [`diff`](/guide/evolution#diff) compares it and
[`merge`](/guide/schema-syntax#merging-schemas) refuses two different ones. The
[TypeScript type](/guide/typescript) of a formatted field is `string`.

## The built-in formats

| Format | Accepts | Example |
| --- | --- | --- |
| `uuid` | a UUID of any version, with or without the `urn:uuid:` prefix, in either case | `550e8400-e29b-41d4-a716-446655440000` |
| `email` | an address as the fast mode of ajv-formats reads it: a local part of the usual characters, a domain of labels of at most 63 characters | `ann@example.com` |
| `date-time` | RFC 3339: a `date`, `T` (or `t`, or a space), a `time` | `2026-10-11T12:00:00Z` |
| `date` | RFC 3339 `full-date`, the day within its month, leap years included | `2026-10-11` |
| `time` | RFC 3339 `full-time` with its offset (`Z` or `±hh:mm`); a leap second (`:60`) only at 23:59 UTC | `23:59:59.999+02:00` |
| `ipv4` | four decimal octets | `192.168.0.1` |
| `ipv6` | the forms of RFC 4291, an embedded IPv4 included | `2001:db8::ff00:42:8329` |
| `uri` | a scheme, a colon and no whitespace (the form of a URI, not its registry) | `https://example.com/path?q=1` |
| `hostname` | labels of letters, digits and hyphens, at most 63 characters each and 253 together | `api.example.org` |

The names are those of JSON Schema, so an exported `format` is read by any validator and an
imported one comes back as the rule. The expressions of `email`, `uuid`, `uri`, `hostname`,
`ipv4` and `ipv6` are those of ajv-formats' fast mode (MIT), copied into the subpath with their
attribution the way the repository copies a helper instead of adding a dependency: each is
anchored and linear, with every repetition bounded, and the repository's tests time each of them
on hostile strings. `date`, `time` and `date-time` check the ranges as well as the form
(`2026-02-29` is not a date), which the fast mode does not.

## Your own formats

`register()` takes the program's formats beside the built-in ones: a `test` over the string, a
few `examples` for [`sample`](/guide/samples) (valid strings), and whether [`infer`](/guide/infer)
may read the format out of data (`infer: false` for a form that ordinary words pass):

```js
register({
  phone: { test: (value) => /^\+\d{9,15}$/.test(value), examples: ['+380501234567'] },
  slug: { test: (value) => /^[a-z0-9-]+$/.test(value), examples: ['hello-world'], infer: false },
});
Schema.from({ phone: { type: 'string', format: 'phone', length: { max: 16 } } }).check({ phone: '050' }).errors;
// [ 'Field "phone" is not a valid phone' ]
```

A name is registered once, process-wide, like a [custom type](/guide/custom-types#types-are-registered-globally):
the same `test` again does nothing, another `test` under a registered name is
`ERR_FORMAT_REGISTERED` (the schemas built so far hold the first one), and an entry that is not
a format (no `test` function, no example strings) is `ERR_INVALID_FORMAT`. Importing the subpath
registers nothing; an isolated type registry does not isolate the formats, which are pure
functions. `FORMATS`, the table itself, is exported to read (`FORMATS.email.examples`), never to
write.

A custom `test` is the program's code, like a `validate` function: bound the field with
`length.max` if the test backtracks, and keep it synchronous (a promise is not a boolean).

## JSON Schema

[`toJSONSchema`](/guide/json-schema) writes `format` with the name for draft 2020-12, draft-07
and OpenAPI 3.0; the [strict profile](/guide/json-schema#the-strict-profile) drops it with the
other value rules, and a [`$jsonSchema`](/guide/json-schema#the-mongodb-target) has no `format`.
[`fromJSONSchema`](/guide/json-schema#importing-a-document) reads a `format` the table knows back
into the rule and drops any other, as the annotation JSON Schema says a format is unless a
dialect asserts it:

```js
const { toJSONSchema, fromJSONSchema } = require('@alexify/metaschema/generators');
toJSONSchema(signup).properties.email; // { type: 'string', maxLength: 254, format: 'email' }
fromJSONSchema({ type: 'object', properties: { x: { type: 'string', format: 'int32' } }, required: ['x'] }).x; // 'string'
```

## Samples and inference

[`sample`](/guide/samples) draws one of the format's `examples` for a formatted field, then
verifies the draw with the field's own check, so a field whose other rules reject every example
(`format: 'email', length: { max: 5 }`) is `ERR_UNSATISFIABLE`.

[`infer`](/guide/infer) writes `{ type: 'string', format }` for a place whose every string
passes a registered format, the first in the order of registration (`uuid`, `email`,
`date-time`, `date`, `time`, `ipv4`, `ipv6`, `uri`, then the program's own); a `hostname` is
never inferred, since every word is one, and an `enum` of few recurring values wins over a
format. `formats: false` turns the reading off.

```js
const { infer } = require('@alexify/metaschema/model');
infer([{ e: 'ann@example.com', at: '2026-10-11T12:00:00Z' }, { e: 'bob@example.org', at: null }]);
// { Struct: {}, e: { type: 'string', format: 'email' }, at: { type: 'string', format: 'date-time', nullable: true } }
```

## Evolution

In [`diff` and `compatibility`](/guide/evolution#compatibility) a format is read as a pattern:
added, the change is `forward`; removed, `backward`; changed, `none`. `merge` keeps one format
and throws `ERR_MERGE_CONFLICT` for two.

## Boundaries

- **A format is a rule, not a type.** `{ type: 'string', format: 'email' }`, never
  `{ email: ... }`: a type named `email` would make `{ email: 'string', name: 'string' }` read as
  the shorthand of that type (the [first key decides](/guide/schema-syntax#the-first-key-decides)).
- **The tests are forms.** An email that matches is not an address that exists, a uri is not
  fetched, a hostname is not resolved. A `validate` function does what a form cannot.
- **The table is process-wide and read when a schema is built.** A model restored with
  [`fromJSON`](/guide/model#restoring-a-model) needs the formats registered first, or its
  `format` is `ERR_INVALID_RULE` at the field; a format registered after a schema was built
  does not reach that schema.
- **The subpath is 1.3 KB min+gzip on top of the core**, gated at 2 KB; the rule itself is in
  the core.
