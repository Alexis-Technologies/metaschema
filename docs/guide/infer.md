# Schema inference

`infer(samples, options)` of `@alexify/metaschema/model` is the reverse of
[`sample`](/guide/samples): a definition that accepts every value given, to bootstrap a model
from the documents that exist (the rows of a table, the records of a collection, the payloads of
an API) before anyone writes a schema by hand. One pass over the samples summarizes what every
place held; the summary is written as the most readable definition; and that definition is
checked against every sample before it comes back, so what you get is a schema the samples pass.

```js
const { infer } = require('@alexify/metaschema/model');

const orders = [
  {
    id: 'ord-1',
    total: 12.5,
    status: 'paid',
    items: [{ sku: 'a', qty: 1 }],
    address: { city: 'Kyiv', zip: '01001' },
  },
  {
    id: 'ord-2',
    total: 7,
    status: 'new',
    items: [{ sku: 'b', qty: 2, note: 'gift' }],
    address: { city: 'Lviv', zip: null },
    coupon: 'X1',
  },
];

infer(orders);
// {
//   Struct: {},
//   id: 'string',
//   total: 'number',
//   status: 'string',
//   items: { array: { sku: 'string', qty: 'integer', note: '?string' } },
//   address: { city: 'string', zip: { type: 'string', nullable: true } },
//   coupon: '?string',
// }
```

The definition is data: paste it into a model and edit it (`status` is an `enum` of three
values, `total` has a `min`, `id` a `pattern`), or build the schema at once:

```js
const order = infer(orders, { as: 'schema', name: 'Order' });
order.check(orders[0]).valid; // true
order.check({ id: 1 }).errors;
// [
//   'Field "Order.id" not of expected type: string',
//   'Field "Order.total" is required',
//   'Field "Order.status" is required',
//   'Field "Order.items" is required',
//   'Field "Order.address" is required'
// ]
```

After `register()` of the subpath the same is `Schema.infer(orders, options)`.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `as` | `'definition'` | what comes back: the definition, or a `Schema` built from it (`'schema'`) |
| `name` | `''` | the name of the schema, and of the places in the errors |
| `kind` | `'struct'` | the [kind](/guide/kinds-and-metadata) of a root that is a struct: `{ Struct: {} }`, or `{ Entity: {} }` with `'entity'` |
| `enum` | `8` | the most distinct strings a place may hold to be an `enum`, each value seen twice on average over at least four samples; `0` or `false` never |
| `integer` | `true` | whether whole numbers are `integer` rather than `number` |
| `map` | `16` | the distinct keys past which the records of a place read as a dictionary (see below); `false` keeps every record a struct |
| `maxDepth` | `128` | how deep a sample may nest; past it `ERR_INFER_DEPTH` |
| `formats` | `true` | whether a place whose every string passes a registered [format](/guide/formats) is that format; nothing is registered until `register()` of the formats subpath ran |

```js
infer(orders, { kind: 'entity', name: 'Order' });
// { Entity: {}, id: 'string', total: 'number', ... }
infer([{ qty: 1 }], { integer: false });
// { Struct: {}, qty: 'number' }
```

An option outside these is `ERR_INVALID_OPTIONS`; a `samples` argument that is not a non-empty
iterable (a string included) is a `TypeError` with `code: 'ERR_INVALID_TARGET'`.

## What is inferred

Every value of a place is classified with the tests `check` makes, so what `infer` calls a date
or a set, the check accepts as one.

| Values of a place | Definition |
| --- | --- |
| strings | `'string'`, an `enum` of the values (below), or `{ type: 'string', format }` when every string passes a registered format (below) |
| whole numbers | `'integer'` (`'number'` with `integer: false`) |
| numbers with a fraction, `NaN`, `Infinity` | `'number'` |
| booleans, bigints | `'boolean'`, `'bigint'` |
| `Date` instances with a time | `'date'` |
| `Uint8Array` instances of any realm, a `Buffer` included | `'bytes'` |
| arrays | `{ array: T }`, `T` the definition of all the elements together; `'unknown'` when every array was empty |
| `Set`, `Map` instances | `{ set: T }`; `{ map: { string: T } }` or `{ map: { number: T } }` by the keys, `'json'` for keys of another kind |
| objects (plain, null-prototype, class instances) | a struct of their own enumerable keys fused into one, or a dictionary (below) |
| values of several kinds | `{ union: [...] }` of their definitions, the record last |
| a function, a symbol, an invalid `Date` | `'any'` |
| only `null` | `'null'` |

```js
infer(['a', 'b']); // 'string'
infer([{ v: 1 }, { v: 'x' }, { v: [true] }]);
// { Struct: {}, v: { union: ['integer', 'string', { array: 'boolean' }] } }
```

The records of one place always fuse into one struct whose keys are optional where some record
lacks them (the record fusion of Baazizi et al.): a human adopts a struct with optional keys,
where a union of two struct shapes is tried branch by branch. The elements of all the arrays of a
place fuse the same way.

What is **not** inferred: `length`, `min` and `max` bounds (the extremes of a sample are
observations, not a contract: `max: 42` because 42 was the largest value would reject the 43rd
record, the reverse of what the samples promise), patterns, tuples (an array is a list, whatever
its length), references (an id samples as a string), custom types, `validate` functions and
annotations. `integer`, `enum` and, with the formats registered, a string `format` are the
refinements kept: each is one edit to loosen.

## Optional, nullable and null

The language tells [optional from nullable](/guide/unions#optional-nullable-and-null), and so
does the inference. A key some record lacks, or holds `undefined`, is optional (`'?string'`,
`{ array: 'string', required: false }`, `{ schema: {...}, required: false }`). A key every record
has, some with `null`, is nullable (`{ type: 'string', nullable: true }`,
`{ schema: {...}, nullable: true }`). A key that is both absent and null is optional, since an
optional key accepts `null` too. An element or a dictionary value that was `null` or `undefined`
among others is `'?T'`.

```js
infer([{ a: 'x', b: 'y' }, { a: null }]);
// { Struct: {}, a: { type: 'string', nullable: true }, b: '?string' }
```

A place that held nothing but `null` is `'null'`, `'?null'` when the key was absent too; one
that held nothing but `undefined` is `'?unknown'`.

## Enums and dictionaries

Two readings come from the values rather than their kinds, both heuristics, both with an option
to turn them off.

**A string of few values is an `enum`.** When a place holds at most `enum` distinct strings (8),
each seen twice on average, over at least four samples, the definition is `{ enum: [...] }` in
the order the values were first met. One or two samples never make an enum; `enum: 0` makes
none.

```js
const statuses = ['paid', 'new', 'paid', 'shipped', 'new', 'paid', 'paid', 'shipped'];
infer(statuses.map((status) => ({ status }))).status;
// { enum: ['paid', 'new', 'shipped'] }
```

**Strings of one form are a `format`.** When the [formats subpath](/guide/formats) registered
its formats and every string of a place passes one of them, the definition is
`{ type: 'string', format }`, the first format that passes in the order of registration
(`uuid`, `email`, `date-time`, `date`, `time`, `ipv4`, `ipv6`, `uri`, then the program's own);
`hostname` is never inferred, since every word is one, a format registered with
`infer: false` neither, and an `enum` wins. `formats: false` turns it off.

```js
const { register } = require('@alexify/metaschema/formats');
register();
infer([{ e: 'ann@example.com' }, { e: 'bob@example.org' }]).e;
// { type: 'string', format: 'email' }
```

**Records whose keys are data are a dictionary.** A record is `{ object: { string: T } }`,
`T` the definition of all its values together, when none of its keys is a name (an identifier,
Unicode letters included): ids, dates, codes as keys, from one sample on. Across several samples
it is a dictionary too when it has more than `map` distinct keys (16), every key is missing
from some record, and the values are all of one kind, as a wide entity with a column every row
has is not. `map: false` keeps every record a struct, keys as they are.

```js
infer([{ byDay: { '2020-01-01': 3, '2020-01-02': 5 } }]);
// { Struct: {}, byDay: { object: { string: 'integer' } } }
```

## Keys

Every key of the data is a key of the definition, written through `define`, so `__proto__`,
`constructor`, `toString`, the names of the methods of a field (`check`, `compile`) and the
names of definition keys (`type`, `required`, `validate`, `default`) are fields like any other.
A nested struct whose first key would read as something else under the
[first-key rule](/guide/schema-syntax#the-first-key-decides) (a type name such as `string` or
`date`, `type`, a capitalized key) is wrapped as `{ schema: {...} }`; the root carries its kind
first, which settles every key after it. Symbol keys, inherited keys and keys that do not
enumerate are not keys of the data, as they are not for `check`. The one key the language
cannot write is one ending in `?`, which reads as an optional key: it is written with one more
(`'foo??'` is the field `foo?`), optional whatever its presence.

## The root

A root of records is a struct with its `kind`; a root of scalars or lists is the definition of
that one type (`'string'`, `{ array: 'integer' }`, `{ union: [...] }`), and `'?integer'` when
`null` was among the samples. A root of records and `null` is a union of that one struct,
optional, since the `schema` shorthand at the root is the struct itself and cannot be optional.

A stored kind (`'entity'`, `'registry'`, ...) adds its id field, `<name>Id`, which takes
precedence over a field of that name in the definition; when the samples carry such a field
with another type, the self-check says so:

```js
infer([{ orderId: 1 }], { kind: 'entity', name: 'Order' });
// throws SchemaDefinitionError [ERR_INFER_MISMATCH]: The inferred definition rejects sample 0 at "Order.orderId": not of expected type: string
```

## The self-check

Before it returns, `infer` builds the schema and checks every sample against it under
`unknown: 'reject'`. A sample it rejects is `ERR_INFER_MISMATCH` with the sample's index
(`error.index`) and the first issue: the id field of a stored kind above, or a bug of the
inference, which is worth reporting with the sample. The check costs one `check` per sample,
nothing next to the walk. A sample nested deeper than `maxDepth` (a cycle, most likely) is
`ERR_INFER_DEPTH` with the sample's index and the place:

```js
infer([{ a: { b: { c: 1 } } }], { maxDepth: 2 });
// throws SchemaDefinitionError [ERR_INFER_DEPTH]: Sample 0 nests deeper than 2 levels at "a.b" (a cycle?)
```

## Round trip with sample

A definition inferred from samples of a schema accepts further samples of it, with the losses
listed above (a pattern, the bounds, a reference, a validate function): what `sample` draws from
a schema, `infer` reads back into one that accepts it.

```js
const { Schema } = require('@alexify/metaschema');
const { infer, sample } = require('@alexify/metaschema/model');

const original = new Schema('Order', {
  id: 'string',
  total: { type: 'number', min: 0 },
  status: { enum: ['new', 'paid'] },
  'note?': 'string',
});
const samples = Array.from({ length: 20 }, (_, index) => sample(original, { seed: index + 1 }));

infer(samples);
// { Struct: {}, id: 'string', total: 'number', status: { enum: ['new', 'paid'] }, note: '?string' }
infer(samples, { as: 'schema', name: 'Order' }).check(sample(original, { seed: 99 })).valid; // true
```

## Boundaries

- **The samples are held in memory.** They are read twice, the summary and the self-check; an
  iterable is drained into an array first. The cost is linear in the size of the samples.
- **A definition is a starting point.** It says what the samples looked like, not what the data
  must be: no bounds, no patterns, no references, no `validate`. Add them by hand.
- **The heuristics are heuristics.** An `enum` from eight samples may miss a ninth value, a
  dictionary may be a struct of odd keys; `enum: 0` and `map: false` turn them off, and the
  definition is yours to edit.
- **The order of a struct's keys is the order of first sight**, an integer-like key first, as
  JavaScript orders the keys of an object.
- **A `date` is a `Date` instance.** A date-time string stays a string (with the formats
  registered, `{ type: 'string', format: 'date-time' }`); a field's `parse` function decodes it,
  and that is the program's to add.
