# Sample values

`sample(schema, options)` of `@alexify/metaschema/model` is a witness of the schema: a value
`check` accepts, drawn from the definition with a seeded generator, so the same seed gives the
same value on every run. It gives tests a fixture per schema, documentation and LLM prompts an
example, and a definition that no value can satisfy an error at the field, before any data
meets it.

```js
const { Schema } = require('@alexify/metaschema');
const { sample } = require('@alexify/metaschema/model');

const order = new Schema('Order', {
  id: { type: 'string', pattern: '^ord-[0-9]{6}$', length: 10 },
  total: { type: 'number', min: 1, max: 1000 },
  status: { enum: ['new', 'paid', 'shipped'] },
  tags: { array: 'string', length: { max: 3 } },
  'note?': 'string',
  address: { city: 'string', zip: { type: 'string', pattern: '^\\d{5}$', length: 5 } },
});

sample(order, { seed: 1 });
// {
//   id: 'ord-596441',
//   total: 404.34102032659575,
//   status: 'new',
//   tags: [],
//   note: 'k',
//   address: { city: 'heblpuh', zip: '51497' }
// }

sample(order, { seed: 2 });
// { id: 'ord-284774', total: 835.1624499929603, status: 'paid', tags: [], note: 'zbx', address: { city: 'd', zip: '96235' } }

order.check(sample(order, { seed: 3 })).valid; // true, for every seed
```

After `register()` of the subpath the same is `order.sample({ seed: 1 })`.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `seed` | `1` | the seed of the generator (an integer): the same seed gives the same value |
| `locale` | `'en'` | the letters free strings are made of: `'en'` (Latin) or `'uk'` (Ukrainian) |
| `references` | `'kind'` | how a reference is held, as in [`check`](/guide/references#storage-view-and-graph-view): the id of a stored kind and the record of a memory kind, `'embed'` for the record always, `'id'` for an id always |
| `maxDepth` | `3` | how deep embedded records nest: an optional reference deeper than that is left out, a required one is an error |

```js
sample(order, { seed: 1, locale: 'uk' });
// { id: 'ord-596441', total: 404.34102032659575, status: 'new', tags: [], note: 'й', address: { city: 'зебкпцз', zip: '51497' } }
```

## What is drawn

Every field is drawn from its definition, then verified with the field's own check (its type,
its rules, its `validate`); a draw that fails is drawn again, up to 24 times, and the whole value
is checked against the schema last. An optional field is present three times out of four, a
nullable one is `null` one time out of five, and a field with `examples` takes one of them half
the time.

| Definition | Sample |
| --- | --- |
| `'string'` | letters of the locale, within `length` (1 to 8 without one); a `pattern` is read, see below |
| `'number'`, `'integer'`, `'bigint'` | a value within `min` and `max` (0 to 100 without them); an integer is whole |
| `'boolean'`, `'date'`, `'null'` | either value, a date in the 2020s, `null` |
| `'any'`, `'unknown'` | a short string |
| `'json'` | `{}` |
| `{ enum: [...] }` | one of the values |
| `{ array: T }`, `{ set: T }` | elements of `T`, as many as `length` allows (0 to 3 without one); a set holds distinct ones |
| `{ object: { string: T } }`, `{ map: { number: T } }` | entries within `length`, at least one where the field is required, keys of the key type |
| a tuple | an element per position |
| `{ union: [...] }` | one branch; a `discriminator` takes the value of its branch |
| a nested struct, a `Schema` instance | a value per field |
| a reference | an id (`'company-3f2a'`) for a stored kind, the record for a memory kind, by `references` and the field's `embed` |
| a custom type | what `metadata.sample` gives: a function of the field and the random source, or a value; a type without it is `ERR_SAMPLE_TYPE`, an alias (`{ js: 'string' }`) draws as the type it aliases |

```js
const types = {
  hex: {
    kind: 'scalar',
    construct() {},
    checkType: (value) => /^[0-9a-f]{6}$/.test(value) || 'not hex',
    metadata: { sample: (field, random) => Math.floor(random() * 0xffffff).toString(16).padStart(6, '0') },
  },
};
```

### Patterns

A `pattern` is read from the source of the regular expression: alternatives (`a|b`), groups
(`(...)`, `(?:...)`, `(?<name>...)`), classes (`[a-z]`, `[^0-9]`, `.`), the class escapes `\d`,
`\w`, `\s` and their negations, `\p{L}`, `\p{Lu}`, `\p{Ll}`, `\p{N}` and `\p{Nd}`, the escapes
of single characters (`\n`, `\x41`, `A`, `\u{1F600}`), the quantifiers `*`, `+`, `?`,
`{n}`, `{n,}` and `{n,m}` (a lazy one draws the same), and the anchors `^` and `$`. An unbounded
quantifier repeats as many times as the field's `length.min` asks for, a few otherwise. A pattern
outside that subset (a lookaround, a back reference, a word boundary, another Unicode property)
is `ERR_SAMPLE_PATTERN`:

```js
sample(Schema.from({ code: { type: 'string', pattern: '^(?=a)a$', length: 3 } }));
// throws SchemaDefinitionError [ERR_SAMPLE_PATTERN]: Pattern /^(?=a)a$/ cannot be sampled: a lookaround
```

## A definition no value satisfies

A field whose draws all fail its check is `ERR_UNSATISFIABLE`, with the path of the field and
the reason the last draw failed. A `length` above a `max`, an empty `enum` or a `min` above a
`max` are rejected when the schema is built; what the sampler finds is a contradiction between
rules that are fine on their own:

```js
sample(Schema.from({ code: { type: 'string', pattern: '^a$', length: { min: 2 } } }));
// throws SchemaDefinitionError [ERR_UNSATISFIABLE]: No value satisfies "code": value is too short

sample(Schema.from({ byId: { object: { number: 'string' } } }));
// throws: No value satisfies "byId": keys must be of type number (the keys of an object are strings)

sample(Schema.from({ v: { type: 'string', validate: () => 'never' } }));
// throws: No value satisfies "v": never
```

A `validate` function that rejects every draw says what a value must be in code the sampler
cannot read: give the field `examples`, which the sampler draws from.

## Boundaries

- **A sample is one value, not a test suite.** It shows the schema accepts something and what
  that looks like; it does not explore the edges of the rules.
- **A reference needs a model.** A reference the schema cannot resolve is `ERR_UNSATISFIABLE`,
  since no value passes a check that reports it.
- **`maxDepth` bounds embedded records.** A required reference to the schema itself (a linked
  list through `next: 'Node'`) ends at the depth with an error; an optional one stops there.
- **The generator is mulberry32**, seeded by `seed`: the same values on every platform. A new
  minor version may draw differently; pin a snapshot of a sample rather than its text.
