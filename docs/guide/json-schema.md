# JSON Schema

`schema.toJSONSchema(options)` renders a schema as a [JSON Schema](https://json-schema.org)
document, and `model.toJSONSchema(options)` renders every entity of a model. The document says
what `check` says: a struct is an object with its required keys and no others, an optional field
accepts `null`, a rule is the matching keyword, and a reference is an id or the record by the
kind of its target. Four dialects are supported, plus a profile for LLM structured outputs.

```js
const { Schema } = require('@alexify/metaschema');

const user = new Schema('User', {
  login: { type: 'string', length: { min: 3, max: 32 }, description: 'The login name' },
  age: '?integer',
  role: { enum: ['admin', 'editor', 'viewer'] },
  tags: { array: 'string' },
  address: { city: 'string', 'zip?': { type: 'string', pattern: '^\\d{5}$', length: 5 } },
});

user.toJSONSchema();
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

## Options

| Option | Values | Meaning |
| --- | --- | --- |
| `target` | `'draft-2020-12'` (default), `'draft-07'`, `'openapi-3.0'`, `'mongodb'` | the dialect; see [Targets](#targets) |
| `profile` | `'strict'` | the dialect of LLM structured outputs; see [The strict profile](#the-strict-profile) |
| `io` | `'input'` (default), `'output'` | which side of the wire the document describes; see [Input and output](#input-and-output) |
| `unrepresentable` | `'throw'` (default), `'any'` | what to do with a type that has no form in the target: throw `SchemaDefinitionError` (code `ERR_UNREPRESENTABLE`), or render it as `{}` |
| `references` | `'kind'` (default), `'embed'`, `'id'` | how a reference renders, as in [`check`](/guide/references#storage-view-and-graph-view) |
| `definitions` | a pointer such as `'#/$defs/'` | where a `$ref` points and where the definitions are placed; the default depends on the target |

`model.toJSONSchema` takes the same options plus `root`, the entity at the root of the document
(see [Models](#models)).

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
Schema.from({ amount: 'bigint' }).toJSONSchema();
// throws SchemaDefinitionError [ERR_UNREPRESENTABLE]:
//   Type "bigint" cannot be represented in JSON Schema target "draft-2020-12" in "amount"

Schema.from({ amount: 'bigint' }).toJSONSchema({ unrepresentable: 'any' });
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

model.entities.get('Person').toJSONSchema();
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

model.entities.get('Person').toJSONSchema({ references: 'embed' }).properties.employer;
// { $ref: '#/$defs/Company' }
```

A reference the schema cannot resolve (outside a model) is an id, unless the field says
`embed: true`, which has no form. The `definitions` option moves the definitions: with
`'#/components/schemas/'`, the default of the `openapi-3.0` target, they come back under
`components.schemas`.

## Models

`model.toJSONSchema()` is one document with every entity as a definition, in dependency order,
and no root type; with `{ root: 'Person' }` it is the document of that entity with the
definitions it needs, the same as `model.entities.get('Person').toJSONSchema()`:

```js
model.toJSONSchema();
// { $schema: '...', $defs: { Tag: {...}, Company: {...}, Person: {...} } }

model.toJSONSchema({ target: 'openapi-3.0' });
// { components: { schemas: { Tag: {...}, Company: {...}, Person: {...} } } }

model.toJSONSchema({ target: 'mongodb' });
// { Tag: {...}, Company: {...}, Person: {...} }  (one $jsonSchema per entity)
```

Each entity is closed or open by its own `unknown` policy. An entity renders the same through
`model.toJSONSchema({ root })` and through its own `toJSONSchema`.

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

answer.toJSONSchema({ profile: 'strict' });
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
  input_schema: answer.toJSONSchema({ profile: 'strict' }),
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
user.toJSONSchema({ target: 'mongodb' });
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

for (const [name, $jsonSchema] of Object.entries(model.toJSONSchema({ target: 'mongodb' }))) {
  await db.createCollection(name, { validator: { $jsonSchema } });
}
```

A custom type names its BSON type as `metadata.bson` (`datetime: { js: 'string', metadata: {
bson: 'date' } }`); without it the type renders as the built-in it aliases, or throws.

## Custom types

A custom type takes part through its metadata: `metadata.jsonSchema` is copied as the schema
of the type (annotations and `null` are added around it), `metadata.bson` is its `bsonType`
for the mongodb target. An alias (`{ js: 'string' }`) without metadata renders as the type it
aliases, with the rules of the field. A type with its own `checkType` and no metadata has no
form and throws, since nothing knows what it accepts. See
[Custom Types](/guide/custom-types#reading-metadata).

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
`JSONSchemaOptions` and `ModelJSONSchemaOptions`, the targets `JSONSchemaTarget`. Every schema
is also a Standard JSON Schema through `schema['~standard'].jsonSchema`; see
[Standard Schema](/guide/standard-schema#json-schema).
