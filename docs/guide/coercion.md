# Coercion

A query string, a form, an environment variable or a row of a CSV file carries text: `age=42`
is `'42'`, `active=true` is `'true'`. A schema says `age` is an integer and `active` a boolean,
and `check` holds the value to that. Coercion is the step of `parse` that converts such input
to the types of the fields **before** the check, so the check, the decoders and the output see
the converted value.

```js
const { Schema } = require('@alexify/metaschema');
const coercion = require('@alexify/metaschema/coerce');

coercion.register();

const Query = new Schema('Query', {
  Form: { coerce: true },
  page: { type: 'integer', min: 1 },
  all: 'boolean',
  tags: { array: 'string' },
  since: '?date',
});

const params = new URLSearchParams('page=2&all=1&tags=news&since=2026-10-01');
Query.parse(Object.fromEntries(params)).value;
// { page: 2, all: true, tags: [ 'news' ], since: 2026-10-01T00:00:00.000Z }
```

Coercion is opt-in and belongs to `parse` alone: `check` never converts, and a value `check`
accepts is never converted by `parse` either.

## The policy

Three places say whether a parse coerces, in this order:

- **a field** with `coerce: true` or `coerce: false` decides for itself and everything under it
  (down to a field with a `coerce` of its own);
- **the call**: `parse(value, { coerce: true })`, `parseAsync`, the `libraryOptions` of
  `~standard.validate`, the options of `parseEach`;
- **the schema**: `coerce: true` in its kind metadata (`{ Form: { coerce: true } }`), the default
  of its own `parse` and so of `~standard.validate`, which is how a framework that validates
  through Standard Schema gets converted values.

The metadata of a schema reached through a field or a reference is not read: the policy is the
parse's, as `unknown` is. `coerce` must be a boolean in each place. A nested struct takes the
key in its long form, `address: { schema: { city: 'string' }, coerce: false }`: in the
shorthand `address: { city: 'string', coerce: false }` the key would be a field.

## register()

The core has the policy and the step; the converters are those of the
`@alexify/metaschema/coerce` subpath, which `register()` installs. A parse that coerces (by the
call, the kind metadata or a field's own `coerce: true`) before that is a `TypeError` with
`code: 'ERR_NOT_REGISTERED'`, thrown as the pass enters the schema, whatever the value holds:
an empty body in a test does not hide a missing `register()` from the program. A schema with
`coerce` builds without it, and a parse that does not coerce never needs it.

`register(custom)` also takes converters of the program's own, by type name, for its custom
types (below), and installs `schema.coerce(value)`. It runs once per name, process-wide, like
the type registry, and checks every entry before it writes any; another function under a
registered name is `ERR_COERCION_REGISTERED`, a name that does not start with a lowercase letter
(the names of types do) or an entry that is not a function `ERR_INVALID_COERCION`.

## What is converted

The built-in converters are strict: a value is converted only when it is written as a value of
the type, and anything else comes back as it was, for the check to report.

| Type | Converted | Left as it is |
|---|---|---|
| `number` | a decimal string (`'42'`, `'-1.5'`, `'1e3'`) whose value is finite; a bigint within ±(2^53−1) | `''`, `' 42'`, `'0x10'`, `'Infinity'`, `'1e400'`, booleans |
| `integer` | as `number`, when the result is a safe integer (`'1.0'` is 1) | `'1.5'`, `'9007199254740993'` |
| `bigint` | an integer string; a safe integer | `'1.0'`, `1.5` |
| `boolean` | `'true'`, `'false'`, `'1'`, `'0'` (exactly) and the numbers `1` and `0` | `'yes'`, `'on'`, `'TRUE'`, `''` |
| `date` | `YYYY-MM-DD` (midnight UTC); a date-time with `Z` or an offset (`T` or a space between); a number of milliseconds | a date-time without a zone, `'2026-02-31'` |
| `string` | a finite number, a bigint, a boolean | `NaN`, objects |
| `enum` | a string written as a member that is not a string (`'2'` for `2`), a number, boolean or bigint written as a string member | anything else |
| `array` | a single value (`?tag=a`), a Set | an object, `''` |
| `set` | an array (duplicates merge), a single value | `''` |
| `map` | a plain object, a list of pairs; a key written as a number in a map of numbers | |

A tuple, a nested struct, a union, a dictionary (`object`) and a reference have nothing to
convert of their own: their parts are converted.

**The empty string is never converted.** An empty field of a form is `''`, and what it should
become (nothing, `null`, a default, `0`) is the program's to say: give the field a decoder, or
leave it out of the input. A date-time without a zone is not converted either: read as local
time, it would depend on the zone of the server.

## Unions, references, aliases

A **union** takes a value one of its branches accepts as it is, as `check` would; only when no
branch does is the value converted, and the first branch that accepts the converted value is
taken. `{ union: ['number', 'string'] }` keeps `'3'` a string, `{ union: ['number', 'boolean'] }`
makes `'true'` the boolean. A discriminator is read as given.

A **reference** converts the record it embeds through its entity; an id is an id, and stays the
id it was given (a number is not converted to a string id). A value under an **alias** of a
field is converted, then renamed.

## Defaults and decoders

A present value is converted, a missing one filled with its default (converted too: a default
is validated like any value). A field's decoder runs after the check, on the converted value:

```js
const Event = Schema.from({ at: { type: 'date', parse: (date) => date.getUTCFullYear() } });
Event.parse({ at: '2026-05-05' }, { coerce: true }).value; // { at: 2026 }
```

## coerce()

`coerce(schema, value, options)` is the pass `parse` runs before its check, with coercion on:
the conversions and the defaults, nothing checked, nothing stripped, no decoder run. It is for
the cases where the policy is off and one value should still be converted, or where the check
is somebody else's.

```js
const { coerce } = require('@alexify/metaschema/coerce');

const converted = coerce(Query, { page: '3', all: '0', tags: [] });
// { page: 3, all: false, tags: [] }
Query.check(converted).valid; // true
```

`check(coerce(schema, value)).valid` is the verdict of `parse(value, { coerce: true })`, short
of what only the pass after the check can say (a decoder that throws is an `exception` issue
of `parse`). After `register()`, `schema.coerce(value)` is the same. The options are
`references` and `maxDepth`, as for `check`.

The converters run before the check, so the `length` of a field does not bound what they
read; they are linear on any string (a run of a hundred thousand digits that is not a number
costs what reading it once costs), and a converter of your own should be too.

## Converters of your own

A converter is `(value, field) => value`: the value of a field of its type read from what the
input gave, or the value itself when it cannot be read. A converter that throws is taken as one
that cannot. A custom type gets one by its name:

```js
coercion.register({
  point: (value) => (typeof value === 'string' ? Point.parse(value) : value),
});
```

An alias type (`{ money: { js: 'number' } }`) converts as the type it aliases, unless it has a
converter of its own: that is also the way to read a built-in type differently, since the
built-in converters cannot be replaced.

```js
const { COERCIONS, register } = require('@alexify/metaschema/coerce');

const model = new Model({ looseBoolean: { js: 'boolean' } }, entities);
register({
  looseBoolean: (value) => (value === 'on' || value === 'yes' ? true : COERCIONS.boolean(value)),
});
```

## TypeScript, JSON Schema, evolution

`Infer` is not changed by coercion: the type of a schema is what `check` accepts and what
`parse` gives, and the input coercion reads (text, mostly) is `unknown` to `parse` anyway.
`CheckOptions` has no `coerce`, so `check(value, { coerce: true })` does not compile. The JSON
Schema export and the TypeScript generators ignore `coerce`, and a change of it is `full` in
[`compatibility`](/guide/evolution): neither what `check` accepts nor what `parse` gives
changes.

## Records and streams

`parseEach`, `parseEachAsync` and `transform` of [`./stream`](/guide/streaming) take the options
of `parse`, so a file of rows converts with them:

```js
const Row = new Schema('Row', { Form: { coerce: true }, id: 'integer', price: 'number' });
for (const { result } of parseEach(Row, rows)) console.log(result.value);
```

## Performance

A parse that does not coerce costs what it did: the policy is one more bit in the pass before
the check. A parse that coerces visits every field of the value and looks up the converter of
each, so it is slower than a plain parse; [Performance](/guide/performance) has the numbers.

## Boundaries

- Converters are synchronous: the pass before the check is synchronous in `parseAsync` too.
- Coercion converts types; it does not trim, change case or normalize text. A decoder or a
  validator of the field does that.
- The keys of a dictionary (`object`) are strings in JavaScript and are not converted.
- An id in the storage view and a discriminator are read as given.
