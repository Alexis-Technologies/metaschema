# MongoDB

Mongoose does three things for a MongoDB program: it describes the documents (a schema), it
**casts** and validates what goes in, and it is an object-document mapper around the driver
(queries, `populate`, middleware, change tracking, `save()`). The
`@alexify/metaschema/mongodb` subpath is the first two on a metaschema model, without a
dependency on the driver and without I/O: the program's own `mongodb` driver reads and writes.

| | Mongoose | metaschema with `./mongodb` |
| --- | --- | --- |
| Schema of a document, nested documents, arrays, references | `Schema` | the model, [kinds](/guide/kinds-and-metadata), [references](/guide/references) |
| ObjectId, Decimal128, Binary | SchemaTypes | `types` of the subpath |
| Casting the input | always on | [coercion](/guide/coercion), opt-in |
| `_id` and the ids of references | ObjectIds in the program | strings in the program, ObjectIds in the database (`toDocument`, `fromDocument`) |
| Indexes | `schema.index()`, `syncIndexes()` | `indexesOf(model)` for the driver's `createIndexes` |
| Collection validator | `toJSONSchema()` | `toJSONSchema(model, { target: 'mongodb', ids: 'objectId' })` |
| Validated updates | `runValidators` | `checkUpdate`, `toUpdate` |
| Create and update bodies | `pick`, `omit` | [`./derive`](/guide/derive) |
| Queries, `populate`, middleware, change tracking, plugins | yes | no: the driver, and your code |

## Setup

The subpath reads the values of the driver without importing it: the program gives the module
of the driver once (it carries the bson it was built with, so values of two versions of bson do
not mix), and its BSON types to the model that uses them.

```js
const { Model } = require('@alexify/metaschema');
const mongodb = require('mongodb');
const bson = require('@alexify/metaschema/mongodb');
const { toJSONSchema } = require('@alexify/metaschema/generators');

bson.register({ bson: mongodb });

const model = new Model({ ...bson.types }, [
  ['Company', { Registry: {}, name: { type: 'string', unique: true } }],
  [
    'Account',
    {
      Entity: {},
      login: { type: 'string', unique: true, length: { min: 3, max: 32 } },
      company: 'Company',
      address: { city: 'string', 'zip?': { type: 'string', index: true } },
      visits: { type: 'integer', default: 0 },
      'avatar?': 'binary',
    },
  ],
]);
const Account = model.entities.get('Account');
```

`register({ bson })` also teaches [coercion](/guide/coercion) the BSON types: a string of 24
hex digits is an ObjectId, a decimal string a Decimal128, text of the base64 shape (never the
empty string: the decoder of the driver would read anything) a Binary. The types are
given to the model and not registered process-wide, because a type name is the shorthand key of
a definition: `{ binary: … }` as the first key of a struct would change meaning everywhere.

## Collections

The validator of a collection is the mongodb target of the [JSON Schema export](/guide/json-schema)
with `ids: 'objectId'`: the id field of a stored record is `_id`, an ObjectId, and every
reference an ObjectId, which is what `toDocument` writes. The indexes are data for
`createIndexes`:

```js
const validators = toJSONSchema(model, { target: 'mongodb', ids: 'objectId' });
const indexes = bson.indexesOf(model);
// { Company: [ { key: { name: 1 }, unique: true } ],
//   Account: [ { key: { login: 1 }, unique: true }, { key: { 'address.zip': 1 } } ] }

for (const name of Object.keys(validators)) {
  await db.createCollection(name, { validator: { $jsonSchema: validators[name] } });
  if (indexes[name]?.length) await db.collection(name).createIndexes(indexes[name]);
}
```

`indexesOf` reads the index definitions of a schema (`{ byLogin: { unique: ['login',
'company'] } }`, named after their key) and the fields marked `unique`, `index` or `primary`,
in nested structs and the structs of lists too, by their dotted paths. `primary` is a unique
index (`_id` is MongoDB's primary key), and a unique field that may be missing is `sparse`. A
model gives one list per stored entity; memory kinds and projections are no collection.

## Writing

Validate the input with `parse` (with the defaults, the decoders and, where the input is text,
coercion), then turn the value into a document:

```js
const { value, issues } = Account.parse(body);
if (!issues.length) {
  const document = bson.toDocument(Account, value);
  // { login: 'ann', company: new ObjectId('650c…'), address: { city: 'Kyiv' }, visits: 0 }
  const { insertedId } = await db.collection('Account').insertOne(document);
  const accountId = insertedId.toHexString();
}
```

`toDocument` runs the serializers of the fields, moves the id field (`accountId`) to `_id`, the
first key, and leaves it out when there is none yet so that the driver gives one; it makes the
ids of the references ObjectIds (a list of them for `many`), walks nested structs, lists,
dictionaries, maps, tuples, discriminated unions and embedded records (which get their own
`_id`), and leaves out undefined values and the keys of calculated fields. `ids: 'string'` keeps
the ids strings (and needs no driver). The value given is never written to. An `_id` beside the
id field (a body checked with `unknown: 'ignore'`, or not checked, cannot choose the `_id` of
the document) is left out; a value of a class at the root (a model instance) is
`ERR_INVALID_TARGET` rather than a document with its id a string. The `ids` of this subpath
default to `'objectId'`, the way the documents are stored; `toJSONSchema` of the generators
defaults to `'string'`, the way a program's JSON is, and names `'objectId'` for the collection
validator. The walk counts the records it embeds as `check` does and stops at `maxDepth` (128
by default): a record deeper is left as it is, and the check reports the depth.

## Reading

```js
const document = await db.collection('Account').findOne({ login: 'ann' });
const { value } = bson.fromDocument(Account, document);
// { accountId: '650c…', login: 'ann', company: '650c…', address: { city: 'Kyiv' }, visits: 0 }
```

`fromDocument` is the other direction: `_id` to the id field, ObjectIds to their hex strings,
then `parse` with `coerce: true` (a `Long` read as a number for a `bigint` field, a date stored
as text) unless the options say otherwise. An `_id` the schema has no field for is the
database's and is dropped; a key the schema does not have is what `unknown` says (`strip` drops
Mongoose's `__v`). `fromDocumentAsync` is the same through `parseAsync`. The result of an
aggregation that `$lookup`s records reads with `{ references: 'embed' }`. The `null` of a
`findOne` that found nothing is a `type` issue of the result, not a throw. Reading needs no
driver: an ObjectId is read by its method.

A collection is read through its cursor, one document at a time, the same way; a document the
program itself wrote (validated on the way in, kept as the schema says) reads with
`coerce: false`, since there is nothing to convert, at the cost of a plain `parse`:

```js
for await (const document of db.collection('Account').find(filter)) {
  const { valid, value, issues } = bson.fromDocument(Account, document, { coerce: false });
  if (valid) accounts.push(value);
  else logger.warn('a document the schema no longer accepts', issues);
}
```

[`parseEach`](/guide/streaming) over `cursor.map(…)` does the same for a pipeline of records.

## Updates

The driver's updates name fields by dotted paths and replace what a path names whole, so a
[partial schema](/guide/derive#partial-and-required) is not their shape. `checkUpdate` checks
an update against the schema:

```js
bson.checkUpdate(Account, {
  $set: { 'address.city': 5, login: 'a' },
  $unset: { company: '' },
}).errors;
// [ 'Field "Account.address.city" not of expected type: string',
//   'Field "Account.login" value is too short',
//   'Field "Account.company" is required' ]
```

- `$set`, `$setOnInsert`, `$min`, `$max`: the value against the field the path names, with its
  rules.
- `$unset`: a required field cannot be unset.
- `$inc`, `$mul`: a number for a field of numbers (a whole one for an integer, a bigint for a
  bigint).
- `$currentDate`: a field of dates.
- `$push`, `$addToSet` (`$each` included): the elements against the element of the list.
- `$pull`, `$pullAll`, `$pop`: the path.
- A path goes through nested structs, the elements of lists (`items.0`, `items.$`,
  `items.$[]`, `items.$[name]`), the values of dictionaries and the records references embed; a
  key a struct does not have is `unexpected` under `unknown: 'reject'` and the policy's under
  `'ignore'`. A path with an empty segment (`'a..b'`), into a part a field cannot have (an
  element of a string, a field of a reference checked as an id) or to the `_id` of the
  document is `unexpected` whatever the policy says; one through more embedded records than
  `maxDepth` is a `depth` issue. The id of a stored record (its field, or `_id`) is set by
  `$setOnInsert` only. The issue of an operand names what the operator takes (`$push` on a
  field that is no list: `not of expected type: array`).

`toUpdate` turns a checked update into the driver's: the values serialized, their ids
ObjectIds, the id of the record as `_id`. It converts what the schema knows and passes the rest
through as given (an operator the subpath does not read, such as `$rename` or `$bit`, a path
the schema has no field of): what `checkUpdate` would reject is not checked here, so check
first.

```js
const update = { $set: { 'address.city': 'Lviv' }, $inc: { visits: 1 } };
if (bson.checkUpdate(Account, update).valid) {
  await db.collection('Account').updateOne({ _id }, bson.toUpdate(Account, update));
}
```

## BSON types

| Type | A value | The mongodb target | JSON Schema | Coerced from |
| --- | --- | --- | --- | --- |
| `objectId` | an ObjectId of bson 4 to 6 or of the driver | `objectId` | a string of 24 hex digits | a string of 24 hex digits |
| `decimal128` | a Decimal128 | `decimal` | a string | a decimal string, a number |
| `binary` | a Binary (a bson `UUID` is one), a Uint8Array | `binData` | base64 text | text of the base64 shape |

A value of bson is recognized by its `_bsontype` and a method JSON cannot give a value, never by
`instanceof`: a value of another realm or of another copy of bson is one, and a body of a
request that claims to be an ObjectId (`{ "_bsontype": "ObjectId" }`) is data. A `Long` is a
`bigint` field (with the driver's `useBigInt64`), a UUID a string with
[`format: 'uuid'`](/guide/formats). In TypeScript the subpath's typings teach `Infer` the three
types.

## When Mongoose still fits

The subpath is the schema side. Mongoose is the better tool where the program wants an ODM:
`populate` across collections, middleware and hooks around `save` and queries, change tracking
and `save()` of a document, query casting, virtuals and plugins. A persistence layer on top of
this subpath (a repository that parses, writes and reads in one call, keeps the validators and
the indexes in sync) is a separate package, planned.

## Boundaries

- No I/O, no driver dependency: the program calls the driver.
- What depends on the document stored is the validator's to check: a length after a `$push`,
  a bound after an `$inc`, a parent a dotted `$set` creates. Array filters, `$rename`, `$bit`
  and pipeline updates are not read.
- Any string of 24 hex digits in an id or a reference becomes an ObjectId; a string id of
  another form stays a string.
- A plain union is written as it is (a discriminated one is walked through its branch). The
  driver writes a Map as a document; a Set needs a codec of its field (`serialize` to a list,
  `parse` back) where the document should hold a list.
