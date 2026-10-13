# JSON Schema

`toJSONSchema(schema, options)` of the `@alexify/metaschema/generators` subpath renders a schema
as a [JSON Schema](https://json-schema.org) document, and `toJSONSchema(model, options)` every
entity of a model. The document says what `check` says: a struct is an object with its required
keys and no others, an optional field accepts `null`, a rule is the matching keyword, and a
reference is an id or the record by the kind of its target. Four dialects are supported, plus a
profile for LLM structured outputs.

```js
const { Schema } = require('@alexify/metaschema');
const { toJSONSchema } = require('@alexify/metaschema/generators');

const user = new Schema('User', {
  login: { type: 'string', length: { min: 3, max: 32 }, description: 'The login name' },
  age: '?integer',
  role: { enum: ['admin', 'editor', 'viewer'] },
  tags: { array: 'string' },
  address: { city: 'string', 'zip?': { type: 'string', pattern: '^\\d{5}$', length: 5 } },
});

toJSONSchema(user);
// {
//   $schema: 'https://json-schema.org/draft/2020-12/schema',
//   type: 'object',
//   properties: {
//     login: { type: 'string', minLength: 3, maxLength: 32, description: 'The login name' },
//     age: { type: ['integer', 'null'] },
//     role: { enum: ['admin', 'editor', 'viewer'] },
//     tags: { type: 'array', items: { type: 'string' } },
//     address: {
//       type: 'object',
//       properties: {
//         city: { type: 'string' },
//         zip: { type: ['string', 'null'], maxLength: 5, pattern: '^\\d{5}$' }
//       },
//       required: ['city'],
//       additionalProperties: false
//     }
//   },
//   required: ['login', 'role', 'tags', 'address'],
//   additionalProperties: false
// }
```

The result is a plain object, ready for `JSON.stringify`, an OpenAPI document, a MongoDB
validator, a tool definition or [ajv](https://ajv.js.org). The repository checks it against ajv:
for values generated from the schemas, `check` and ajv over `toJSONSchema` agree on every
verdict (`tests/unit/jsonschema-ajv.test.js`).

## The generators subpath

The generators live outside the core entry so that a program that only validates does not
carry them: `@alexify/metaschema` is 17.7 KB min+gzip, `@alexify/metaschema/generators` adds
7.1 KB on top. The subpath exports five functions:

| Export | Meaning |
| --- | --- |
| `toJSONSchema(target, options?)` | the JSON Schema document of a `Schema`, or of a `Model` |
| `toTypeScript(target, options?)` | the TypeScript interface of a `Schema`, or the interfaces of every entity of a `Model`; see [TypeScript](/guide/typescript#generating-interfaces-from-a-model) |
| `saveTypes(outputFile, target, options?)` | writes `toTypeScript(target, options)` to a file |
| `fromJSONSchema(document, options?)` | a definition, or a `Schema`, from a JSON Schema document; see [Importing a document](#importing-a-document) |
| `register()` | installs the methods: `schema.toJSONSchema(options)`, `schema.toInterface(options)`, `model.toJSONSchema(options)`, `model.toTypeScript(options)`, `model.dts`, `Schema.fromJSONSchema(document, options)`, and the [`jsonSchema` converter](/guide/standard-schema#json-schema) on `schema['~standard']` |

`register()` runs once per process (later calls do nothing) and installs the members on the
`Schema` and `Model` classes like class members, invisible to `Object.keys`, `JSON.stringify`
and `for...in`. Call it at startup when the methods read better than the functions, or when a
Standard JSON Schema consumer needs `schema['~standard'].jsonSchema`:

```js
require('@alexify/metaschema/generators').register();

user.toJSONSchema({ target: 'draft-07' }); // the same document as toJSONSchema(user, { target: 'draft-07' })
```

The rest of this page uses the functions; every example reads the same with the methods.

## Options

| Option | Values | Meaning |
| --- | --- | --- |
| `target` | `'draft-2020-12'` (default), `'draft-07'`, `'openapi-3.0'`, `'mongodb'` | the dialect; see [Targets](#targets) |
| `profile` | `'strict'` | the dialect of LLM structured outputs; see [The strict profile](#the-strict-profile) |
| `io` | `'input'` (default), `'output'` | which side of the wire the document describes; see [Input and output](#input-and-output) |
| `unrepresentable` | `'throw'` (default), `'any'` | what to do with a type that has no form in the target: throw `SchemaDefinitionError` (code `ERR_UNREPRESENTABLE`), or render it as `{}` |
| `references` | `'kind'` (default), `'embed'`, `'id'` | how a reference renders, as in [`check`](/guide/references#storage-view-and-graph-view) |
| `definitions` | a pointer such as `'#/$defs/'` | where a `$ref` points and where the definitions are placed; the default depends on the target |

`toJSONSchema(model, options)` takes the same options plus `root`, the entity at the root of the
document (see [Models](#models)).

## Targets

| Target | `$schema` | Definitions | `null` | Notes |
| --- | --- | --- | --- | --- |
| `draft-2020-12` | `https://json-schema.org/draft/2020-12/schema` | `$defs`, `#/$defs/<Name>` | `type: ['T', 'null']` | tuples as `prefixItems`, `const` for a one-value enum |
| `draft-07` | `http://json-schema.org/draft-07/schema#` | `definitions`, `#/definitions/<Name>` | `type: ['T', 'null']` | tuples as an `items` list with `additionalItems: false`; no `deprecated` |
| `openapi-3.0` | none | `components.schemas`, `#/components/schemas/<Name>` | `nullable: true` | a Schema Object of OpenAPI 3.0: no type lists, no `const`, no tuples, no `propertyNames`; `example` instead of `examples`; a discriminated union is a `oneOf` with `discriminator` |
| `mongodb` | none | none: references are inlined | `bsonType: ['T', 'null']` | a [`$jsonSchema`](https://www.mongodb.com/docs/manual/reference/operator/query/jsonSchema/) validator: `bsonType` instead of `type`, no `$ref`, `format`, `default` or `examples`; see [The mongodb target](#the-mongodb-target) |

The `openapi-3.0` document is a schema object, not an OpenAPI document: put it under
`components.schemas` or into a request body, and merge the `components.schemas` it returns
(the entities it refers to) into yours.

## The mapping

| Definition | JSON Schema (draft 2020-12) |
| --- | --- |
| `'string'`, `{ type: 'string', length: { min, max }, pattern }` | `{ type: 'string', minLength, maxLength, pattern }` (the pattern's source, without flags) |
| `{ type: 'string', format: 'email' }` | `{ type: 'string', format: 'email' }`, the name as given (the built-in names are JSON Schema's); dropped by the strict profile and for mongodb; see [String formats](/guide/formats) |
| `'number'`, `'integer'`, with `min`/`max` | `{ type: 'number' }`, `{ type: 'integer' }`, with `minimum`/`maximum` |
| `'boolean'`, `'null'` | `{ type: 'boolean' }`, `{ type: 'null' }` |
| `'any'`, `'unknown'` | `{}` |
| `'json'` | `{ type: ['object', 'array'] }` |
| `'date'` | `{ type: 'string', format: 'date-time' }` on the input side; unrepresentable on the output side; `bsonType: 'date'` for mongodb |
| `'bigint'` | unrepresentable; `bsonType: 'long'` for mongodb |
| `{ enum: [...] }` | `{ enum: [...] }`; one value is `{ const: value }` where the dialect has it |
| `{ array: T, length }` | `{ type: 'array', items: T, minItems, maxItems }` |
| `{ set: T }` | the same with `uniqueItems: true` on the input side; unrepresentable on the output side and for mongodb |
| `{ object: { string: T }, length }` | `{ type: 'object', additionalProperties: T, minProperties, maxProperties }`; a required one has `minProperties: 1`, since `check` rejects an empty one; a `number` key is `propertyNames: { pattern }` where the dialect has it |
| `{ map: { string: T } }` | as `object` on the input side; unrepresentable on the output side |
| `['number', { 'label?': 'string' }]` | `{ type: 'array', prefixItems: [...], items: false, minItems }`, `minItems` being the position of the last required element |
| `{ union: [A, B] }` | `{ anyOf: [A, B] }`; with a `discriminator`, `{ oneOf, discriminator: { propertyName } }` for openapi-3.0 |
| a nested struct, `{ schema }`, a `Schema` instance | `{ type: 'object', properties, required, additionalProperties: false }` |
| `'Company'` (a stored kind), `{ many: 'Address' }` | `{ type: 'string' }`, `{ type: 'array', items: { type: 'string' } }`: the id |
| `'Tag'` (a memory kind), `{ many: 'Tag' }` | `{ $ref: '#/$defs/Tag' }`, an array of them, with `Tag` in the definitions |
| `'?T'`, `'key?'`, `required: false`, `nullable: true` | `null` allowed: `type: ['T', 'null']`, `null` among the `enum` values, a `{ type: 'null' }` branch in an `anyOf`; an optional field is left out of `required` |
| `title`, `description`, `default`, `examples`, `deprecated` | the same keywords, where the dialect has them |
| a custom type | `metadata.jsonSchema` of the type (copied), `metadata.bson` for mongodb, else the built-in it aliases (`js`), else unrepresentable |

A struct is closed (`additionalProperties: false`) unless the schema at the root says
`{ Form: { unknown: 'ignore' } }`, which opens every object of the document, as it does for
[`check`](/guide/validation#options). A calculated field (a function), an index definition,
the kind key and the schema-level options are not properties.

### Optional, nullable and null

`check` accepts `null` and an absent key for an optional field, and `null` for a nullable one,
so the document does too: an optional `'?number'` is `{ type: ['number', 'null'] }` and is not
listed in `required`; a nullable field is the same type and is listed. An optional reference is
`{ anyOf: [{ $ref }, { type: 'null' }] }`; an optional enum takes `null` as a value. See
[Unions, nullable and null](/guide/unions) for the difference between the three.

## Input and output

`io: 'input'`, the default, describes the JSON a value is parsed from: a `date` is a
`date-time` string, a `set` an array of unique items, a `map` an object. `io: 'output'`
describes the value `check` accepts, so those three have no JSON form there and throw (or
render as `{}` with `unrepresentable: 'any'`). The `mongodb` target describes the stored
document and has one side only: a `date` is a BSON date, a `map` a document, a `set` has no
form.

```js
toJSONSchema(Schema.from({ amount: 'bigint' }));
// throws SchemaDefinitionError [ERR_UNREPRESENTABLE]:
//   Type "bigint" cannot be represented in JSON Schema target "draft-2020-12" in "amount"

toJSONSchema(Schema.from({ amount: 'bigint' }), { unrepresentable: 'any' });
// { $schema: '...', type: 'object', properties: { amount: {} }, required: ['amount'], additionalProperties: false }
```

## References

A reference follows the [rule of `check`](/guide/references#storage-view-and-graph-view): a
stored kind is held as an id, a memory kind as the record, `embed` on the field and the
`references` option deciding otherwise. The record of a memory kind is a `$ref` to a definition
named after the entity, placed where the target keeps them, with the definitions it needs in
turn; a reference to the schema at the root is `{ $ref: '#' }`.

```js
const { Model } = require('@alexify/metaschema');

const types = {
  datetime: { js: 'string', metadata: { jsonSchema: { type: 'string', format: 'date-time' }, bson: 'date' } },
};

const model = new Model(types, new Map([
  ['Tag', { Struct: {}, label: 'string', 'parent?': 'Tag' }],
  ['Company', { Registry: {}, name: { type: 'string', unique: true } }],
  ['Person', { Entity: {}, name: 'string', employer: 'Company', tags: { many: 'Tag' }, created: 'datetime' }],
]));

toJSONSchema(model.entities.get('Person'));
// {
//   $schema: 'https://json-schema.org/draft/2020-12/schema',
//   type: 'object',
//   properties: {
//     name: { type: 'string' },
//     employer: { type: 'string' },
//     tags: { type: 'array', items: { $ref: '#/$defs/Tag' } },
//     created: { type: 'string', format: 'date-time' },
//     personId: { type: ['string', 'null'] }
//   },
//   required: ['name', 'employer', 'tags', 'created'],
//   additionalProperties: false,
//   $defs: {
//     Tag: {
//       type: 'object',
//       properties: {
//         label: { type: 'string' },
//         parent: { anyOf: [{ $ref: '#/$defs/Tag' }, { type: 'null' }] }
//       },
//       required: ['label'],
//       additionalProperties: false
//     }
//   }
// }

toJSONSchema(model.entities.get('Person'), { references: 'embed' }).properties.employer;
// { $ref: '#/$defs/Company' }
```

A reference the schema cannot resolve (outside a model) is an id, unless the field says
`embed: true`, which has no form. The `definitions` option moves the definitions: with
`'#/components/schemas/'`, the default of the `openapi-3.0` target, they come back under
`components.schemas`.

## Models

`toJSONSchema(model)` is one document with every entity as a definition, in dependency order,
and no root type; with `{ root: 'Person' }` it is the document of that entity with the
definitions it needs, the same as `toJSONSchema(model.entities.get('Person'))`:

```js
toJSONSchema(model);
// { $schema: '...', $defs: { Tag: {...}, Company: {...}, Person: {...} } }

toJSONSchema(model, { target: 'openapi-3.0' });
// { components: { schemas: { Tag: {...}, Company: {...}, Person: {...} } } }

toJSONSchema(model, { target: 'mongodb' });
// throws ERR_UNREPRESENTABLE here: Tag refers to itself, and the mongodb target inlines
// references (see below); without `parent` in Tag:
// { Tag: {...}, Company: {...}, Person: {...} }  (one $jsonSchema per entity)
```

Each entity is closed or open by its own `unknown` policy. An entity renders the same through
`toJSONSchema(model, { root })` and on its own.

## The strict profile

LLM structured outputs (OpenAI's `strict: true`, Anthropic's `strict: true` tools and
`output_config.format`) accept a restricted dialect: an object at the root, every property
listed in `required` (an optional one allows `null` instead), `additionalProperties: false` on
every object, no `allOf`, `not` or `if`, and no value constraints. `profile: 'strict'` renders
it, for the `draft-2020-12` and `draft-07` targets:

```js
const answer = new Schema('Answer', {
  summary: { type: 'string', description: 'One paragraph' },
  confidence: { type: 'number', min: 0, max: 1 },
  'followUp?': 'string',
  sentiment: { enum: ['positive', 'neutral', 'negative'] },
});

toJSONSchema(answer, { profile: 'strict' });
// {
//   $schema: 'https://json-schema.org/draft/2020-12/schema',
//   type: 'object',
//   properties: {
//     summary: { type: 'string', description: 'One paragraph' },
//     confidence: { type: 'number' },
//     followUp: { type: ['string', 'null'] },
//     sentiment: { enum: ['positive', 'neutral', 'negative'] }
//   },
//   required: ['summary', 'confidence', 'followUp', 'sentiment'],
//   additionalProperties: false
// }
```

The profile keeps the structure (types, properties, enums, unions as `anyOf`, `$ref`/`$defs`)
and leaves out what those dialects reject or ignore: `minLength`, `maxLength`, `pattern`,
`minimum`, `maximum`, `minItems`, `maxItems`, `uniqueItems` and `minProperties`. Validate the
model's answer with `check` afterwards, which applies them all:

```js
const tool = {
  name: 'record_answer',
  description: 'Records the answer to the question',
  input_schema: toJSONSchema(answer, { profile: 'strict' }),
  strict: true,
};
// ... after the call:
const result = answer.check(toolUse.input);
```

`any`, `unknown`, `json`, `object` and `map` have no place in the profile (a value without a
type, an object without its properties listed) and throw, or render as `{}` with
`unrepresentable: 'any'`. A root that is not a struct, and any other target, is an
`ERR_INVALID_OPTIONS` error.

## The mongodb target

`target: 'mongodb'` renders the [`$jsonSchema`](https://www.mongodb.com/docs/manual/reference/operator/query/jsonSchema/)
dialect of a collection validator: `bsonType` instead of `type` (`'bool'`, `['int', 'long']`
for an integer, `'long'` for a bigint, `'date'` for a date, `'number'` for a number), no
`$schema`, `$ref`, `definitions`, `format`, `default` or `examples`, and `title` and
`description` only. References are inlined, so a cycle between embedded entities has no form
and throws. The root of a closed document lets `_id` in, since every stored document has one;
declare `_id` as a field to constrain it.

```js
toJSONSchema(user, { target: 'mongodb' });
// {
//   bsonType: 'object',
//   properties: {
//     login: { bsonType: 'string', minLength: 3, maxLength: 32, description: 'The login name' },
//     age: { bsonType: ['int', 'long', 'null'] },
//     role: { enum: ['admin', 'editor', 'viewer'] },
//     tags: { bsonType: 'array', items: { bsonType: 'string' } },
//     address: { bsonType: 'object', properties: {...}, required: ['city'], additionalProperties: false },
//     _id: {}
//   },
//   required: ['login', 'role', 'tags', 'address'],
//   additionalProperties: false
// }

for (const [name, $jsonSchema] of Object.entries(toJSONSchema(model, { target: 'mongodb' }))) {
  await db.createCollection(name, { validator: { $jsonSchema } });
}
```

A custom type names its BSON type as `metadata.bson` (`datetime: { js: 'string', metadata: {
bson: 'date' } }`); without it the type renders as the built-in it aliases, or throws.

The document above describes the program's values, where a stored record carries its id as a
string field (`userId`) and a reference holds an id string. `ids: 'objectId'` (the mongodb
target only) describes the document the database holds instead, as `toDocument` of
[`@alexify/metaschema/mongodb`](/guide/mongodb) writes it: the id field of a stored record is
`_id`, an ObjectId, first and required at the root (optional in an embedded record), and every
reference is an ObjectId.

```js
toJSONSchema(model, { target: 'mongodb', ids: 'objectId' }).Account.properties;
// { _id: { bsonType: 'objectId' }, login: {...}, company: { bsonType: 'objectId' }, ... }
```

A format that is not one of JSON Schema's carries its shape as a `pattern` here too (the target
has no `format`); see [String formats](/guide/formats#json-schema).

## Custom types

A custom type takes part through its metadata: `metadata.jsonSchema` is copied as the schema
of the type (annotations and `null` are added around it), `metadata.bson` is its `bsonType`
for the mongodb target. An alias (`{ js: 'string' }`) without metadata renders as the type it
aliases, with the rules of the field. A type with its own `checkType` and no metadata has no
form and throws, since nothing knows what it accepts. See
[Custom Types](/guide/custom-types#reading-metadata).

## Importing a document

`fromJSONSchema(document, options)` is the other direction: a definition from a JSON Schema
document, for the subset a validation schema is made of. A program that kept its schemas as
JSON Schema (for ajv, for an OpenAPI document) moves them to metaschema with it and keeps
`toJSONSchema` for the documents it still has to produce.

```js
const { fromJSONSchema } = require('@alexify/metaschema/generators');

fromJSONSchema({
  type: 'object',
  properties: {
    login: { type: 'string', minLength: 3 },
    age: { type: ['integer', 'null'], minimum: 0 },
    role: { enum: ['admin', 'user'] },
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['login', 'role'],
  additionalProperties: false,
});
// {
//   Struct: {},
//   login: { type: 'string', length: { min: 3 } },
//   age: { type: 'integer', min: 0, required: false },
//   role: { type: 'enum', enum: ['admin', 'user'] },
//   tags: { type: 'array', value: 'string', required: false }
// }
```

The result is a definition for `new Schema(name, definition)`, or the `Schema` itself with
`as: 'schema'`. The options:

| Option | Values | Meaning |
| --- | --- | --- |
| `as` | `'definition'` (default), `'schema'` | what comes back: the definition, or a `Schema` built from it |
| `name` | a string | the name of the schema: what `$ref: '#'` refers to (an entity name), and the name of the `Schema` |
| `references` | `'inline'` (default), `'name'` | a `$ref` into `$defs`, `definitions` or `components.schemas`: the definition in place, or a reference to an entity of that name (capitalized), to resolve through a [`Model`](/guide/references) |
| `unsupported` | `'throw'` (default), `'ignore'` | a keyword the subset has no form for: `SchemaDefinitionError` with the code `ERR_UNSUPPORTED_SCHEMA` and the place in the document as a JSON pointer, or dropped |
| `onUnsupported` | `(reason, pointer) => void` | told of every drop of `unsupported: 'ignore'`: what was dropped, as the error names it, and its place as a JSON pointer; not called in the throw mode, where the error carries both |

The subset, the reverse of [the mapping](#the-mapping):

| JSON Schema | Definition |
| --- | --- |
| `type: 'string'` with `minLength`, `maxLength`, `pattern` | `{ type: 'string', length: { min, max }, pattern }`; a pattern the `u` flag rejects is outside the subset (see below) |
| `type: 'string'` with `format` | `{ type: 'string', format }` when the [formats subpath](/guide/formats) registered that name; any other `format` is dropped |
| `type: 'number'`, `'integer'`, with `minimum`, `maximum` | `{ type, min, max }` |
| `type: 'boolean'`, `'null'` | `'boolean'`, `'null'` |
| `type: 'object'` with `properties` and `required` | a nested struct, a property outside `required` optional (`'?string'`, `required: false`); `{ schema }` when its first key would read as a type or a kind |
| `type: 'object'` with `additionalProperties: T`, `minProperties`, `maxProperties` | `{ object: { string: T }, length }`; a `propertyNames` with the number-key pattern gives a `number` key |
| `type: 'object'` alone, `type: ['object', 'array']` | `'json'` |
| `type: 'array'` with `items: T`, `minItems`, `maxItems` | `{ array: T, length }`; `uniqueItems: true` gives a `set` |
| `prefixItems` (2020-12) or an `items` list (draft-07) with `minItems` | a tuple, the elements past `minItems` optional |
| `enum`, `const` | `{ enum: [...] }`; `null` among the values makes the field nullable |
| `anyOf`, `oneOf` | `{ union: [...] }`; a `{ type: 'null' }` branch makes the field nullable, one branch left is that branch; OpenAPI's `discriminator.propertyName` is the `discriminator` |
| `type: ['T', 'null']`, `nullable: true` | `nullable: true` on a required property; an optional one accepts null anyway |
| a `type` list | a `union` of the types |
| `allOf` of one schema | that schema (`{ allOf: [{ $ref }], nullable: true }` is how OpenAPI 3.0 writes a nullable reference) |
| `$ref: '#'` | a reference to `options.name` |
| `$ref` into the definitions | the definition in place, or the entity name with `references: 'name'` |
| `title`, `description`, `default`, `examples`, `example`, `deprecated` | the same annotations; at the root they go into the kind metadata |
| `additionalProperties: false` at the root | a closed struct (`{ Struct: {} }`); anything else at the root `{ Struct: { unknown: 'ignore' } }` |
| `{}`, `true` | `'any'` |

`$schema`, `$id`, `$comment`, `readOnly`, `writeOnly`, `contentMediaType`, `contentEncoding`
and a `format` the formats subpath did not register say nothing a check applies (`format` is an
annotation in JSON Schema unless a dialect asserts it) and are dropped. `additionalProperties`
inside the document is dropped too:
whether a struct is closed is a policy of the whole check, which the root decides. Everything
else is outside the subset: `allOf` of several schemas, `not`, `if`/`then`/`else`,
`patternProperties`, `unevaluatedProperties`, `dependentRequired`, `exclusiveMinimum`,
`multipleOf`, `contains`, a `$ref` to another document, a recursive `$ref` inlined, a
`propertyNames` beyond the number-key pattern, a struct with `minProperties`.

```js
fromJSONSchema({ type: 'object', properties: { n: { type: 'number', multipleOf: 2 } } });
// throws SchemaDefinitionError [ERR_UNSUPPORTED_SCHEMA]:
//   The keyword "multipleOf" is not supported in a JSON Schema at "/properties/n"

fromJSONSchema({ type: 'object', properties: { n: { type: 'number', multipleOf: 2 } } }, { unsupported: 'ignore' });
// { Struct: { unknown: 'ignore' }, n: '?number' }
```

A lenient import keeps a trace of what it dropped through `onUnsupported`, called once per drop
with what the error would have said and the place; in the throw mode it is never called, since
the first drop is the error.

```js
const dropped = [];
fromJSONSchema(
  {
    type: 'object',
    properties: { n: { type: 'number', multipleOf: 2 }, s: { type: 'string', pattern: '\\:' } },
  },
  { unsupported: 'ignore', onUnsupported: (reason, pointer) => dropped.push(`${reason} at ${pointer}`) },
);
// { Struct: { unknown: 'ignore' }, n: '?number', s: '?string' }
dropped;
// [
//   'The keyword "multipleOf" at /properties/n',
//   'The pattern "\\:" (not a valid pattern under the u flag) at /properties/s'
// ]
```

The document is read as untrusted input, and what it can make the import do is bounded:

- **A `$ref` is `#` or a JSON pointer `#/...` into the document**, read through own keys only
  (`#/__proto__` and `#/constructor` find nothing), with the percent-escapes and the `~0`/`~1`
  of RFC 6901 decoded before the lookup, so `#/$defs/%41` and `#/$defs/A` are one target and a
  bad escape is outside the subset, as are `#foo` and a `$ref` to another document.
- **A `$ref` inlined is converted once per pointer.** The places that inline it share the
  converted definition and write their own annotations, `nullable` and `required` on a copy of
  its top-level object, so a document whose definitions refer to one another many times over
  (a diamond: each definition referring twice to the next) is converted in linear time, while a
  walk per `$ref` would be exponential; `new Schema` and `JSON.stringify` still unfold the
  result. Through a `Model` with `references: 'name'` it stays a graph.
- **A nesting deeper than 128 levels** is `ERR_UNSUPPORTED_SCHEMA` (`Nesting deeper than 128
  levels at "<pointer>"`) in both modes: a lenient import does not recurse without end either.
- **A `pattern` is checked under the `u` flag.** A JSON Schema pattern is ECMA-262 without the
  flag, and the `pattern` rule of a field compiles with it, so a pattern the flag rejects (an
  escape it does not know, such as `\:`) is outside the subset, reported with its place instead
  of by the `Schema` built from the definition.
- **A type list** (`type: ['string', 'Foo']`) is checked name by name, as a single `type` is.

```js
fromJSONSchema({ type: 'object', properties: { s: { type: 'string', pattern: '\\:' } } });
// throws SchemaDefinitionError [ERR_UNSUPPORTED_SCHEMA]:
//   The pattern "\\:" (not a valid pattern under the u flag) is not supported in a JSON Schema at "/properties/s"
```

On the subset the two directions are inverse: `toJSONSchema(fromJSONSchema(document, { as:
'schema' }))` is the document for every document the export writes, and the schema imported
from an export checks a value as the exported schema does, on both backends; the repository
holds both. What the import cannot bring back: a `date`, `set` or `map` field (the input side
describes the JSON they are parsed from, and the import reads a string, an array of unique
items, an object), the `discriminator` of a union exported to draft 2020-12 or draft-07 (only
the `openapi-3.0` target writes it; the union comes back plain), and a `$ref` into the
definitions exported from a model (inlined, or kept as a name).

## What is not exported

- **`validate` functions** of fields and schemas, and the `checkType` of a custom type: code has
  no JSON form. A document describes the structure and the rules; `check` applies the rest.
- **Calculated fields, indexes and kind metadata.** A function is not a property; `index`,
  `primary`, `unique` and the metadata of a kind describe storage, not a value.
- **`length` counts UTF-16 units** unless the field says `unicode: true`, where JSON Schema counts
  code points: the two differ for a string with characters outside the Basic Multilingual Plane.
- **An `object` or `map` with number keys**: the keys of a JSON object are strings, so the
  pattern accepts what `check` rejects.
- **Instances on the output side**: a `date`, `set` or `map` on the input side describes the
  JSON they are parsed from, and a `bigint` has no JSON form on either side.

Everything the document does say is checked against ajv in the repository, for the
`draft-2020-12` and `draft-07` targets.

## TypeScript

`toJSONSchema` returns `JSONSchema`, an alias of `Record<string, unknown>`; the options are
`JSONSchemaOptions` and `ModelJSONSchemaOptions`, the targets `JSONSchemaTarget`, all exported
by the core typings. The methods `register()` installs are declared on `Schema` and `Model`.
Every schema is also a Standard JSON Schema through `schema['~standard'].jsonSchema` once the
generators are registered; see [Standard Schema](/guide/standard-schema#json-schema).
