# Deriving schemas

An entity is rarely the shape every boundary of a program takes: the body that creates a
record has no id, the body that updates one has every field optional, the view of it leaves
the password out. The `@alexify/metaschema/derive` subpath makes those schemas from the one
that describes the record, so a rule written once (a length, an enum, a reference) holds for
all of them.

```js
const { Model } = require('@alexify/metaschema');
const { omit, partial, pick } = require('@alexify/metaschema/derive');

const model = new Model({}, [
  ['Company', { Entity: {}, name: 'string' }],
  [
    'Account',
    {
      Entity: {},
      login: { type: 'string', length: { min: 3 } },
      password: { type: 'string', length: { min: 8 } },
      role: { enum: ['admin', 'user'], default: 'user' },
      company: 'Company',
      address: { city: 'string', street: 'string' },
      byLogin: { unique: ['login'] },
    },
  ],
]);
const Account = model.entities.get('Account');

const CreateAccount = omit(Account, ['password'], { name: 'CreateAccount' });
const UpdateAccount = partial(CreateAccount, { name: 'UpdateAccount' });
const AccountView = pick(Account, ['accountId', 'login', 'role'], { name: 'AccountView' });

UpdateAccount.parse({ role: 'admin' });
// { valid: true, value: { role: 'admin' }, issues: [] }
```

Each function builds a new `Schema` from the definition the source was built from: the source
is never changed, and every rule of a field comes along (its type, length, pattern, enum,
aliases, codecs, annotations). The functions take a schema of a struct; anything else is a
`TypeError` with `code: 'ERR_INVALID_TARGET'`.

## pick and omit

`pick(schema, keys, options)` keeps the fields named, `omit(schema, keys, options)` every field
but those. The keys are field names as the schema has them (`'nick'`, not `'nick?'`), a
calculated field included; the fields come in the order of the schema, whatever the order of
the keys. A name the schema has no field of is a `SchemaDefinitionError` with
`code: 'ERR_UNKNOWN_FIELD'`, located in the source:

```js
pick(Account, ['email']);
// SchemaDefinitionError: No such field in "Account.email"
```

## partial and required

`partial(schema, options)` makes every field optional, `required(schema, options)` every field
required; `options.keys` names the fields to change instead.

A field made optional **loses its `default`**: `partial` is the shape of a patch, and a key a
patch leaves out stays as it is stored, where filling in a default would overwrite it.
`defaults: true` keeps them. `required` keeps the defaults: `check` asks for the key, `parse`
fills it.

```js
const Patch = partial(Account, { keys: ['password', 'role'] });
Patch.fields.role.default; // undefined
partial(Account, { defaults: true }).parse({}).value; // { role: 'user' }
```

`partial` is shallow: a nested struct given is checked whole.

```js
UpdateAccount.check({ address: { city: 'Lviv' } }).errors;
// [ 'Field "UpdateAccount.address.street" is required' ]
partial(CreateAccount, { deep: true }).check({ address: { city: 'Lviv' } }).valid;
// true
```

`deep: true` goes into nested structs at every depth, in each form a field holds one (a nested
definition, `{ schema: … }`, a Schema as a field). It does not go into the elements of a
collection, a tuple, the branches of a union or a referenced entity: a patch replaces a list
whole, and an element of it must be a whole record; a referenced entity is its own schema. A
nested struct made optional by `deep` loses its own `validate`, `parse` and `serialize`, which
were written for the whole struct.

## extend

`extend(schema, extension, options)` puts fields over the schema's. A field of the same name
takes the place of the schema's field, in its position, with its whole definition (`'company?'`
replaces `company`); the other fields come after.

```js
const Signup = extend(CreateAccount, { 'company?': 'Company', terms: 'boolean' });
Object.keys(Signup.fields);
// [ 'login', 'role', 'company', 'address', 'terms' ]
Signup.fields.company.required; // false
```

The extension is an object of fields, or a Schema of a struct, whose fields, indexes and own
functions come along (not its kind, nor the id of a stored kind). An extension with a kind as
its first key is `ERR_INVALID_DEFINITION`: the kind of the result is `options.metadata`.

`extend` replaces; [`merge`](/guide/schema-syntax#merging-schemas) of `./model` unifies (a field
in both takes the constraints of both, and what no value satisfies is a conflict). Use `extend`
to reshape a schema, `merge` to combine two descriptions of one value.

## keyof

`keyof(schema, options)` is a schema of the names of the fields a value carries, as an enum:
what a `sort` or a `fields` parameter of a query takes. The calculated fields and the id of a
stored kind are not among them.

```js
const { Schema } = require('@alexify/metaschema');
const { keyof } = require('@alexify/metaschema/derive');

const Query = new Schema('Query', { sort: keyof(Account), 'limit?': 'integer' });
Query.check({ sort: 'email' }).errors;
// [ 'Field "Query.sort" value is not of enum: login, password, role, company, address' ]
```

## The kind and the id

A schema derived from a **stored kind** (an `Entity`, a `Registry`, …) or from a `Projection` is a
`Struct`: a stored kind would add its id field again over the fields derived, and a projection
would copy its parent's fields over them. The id field of the stored kind goes with it, unless
the call names it (`pick(Account, ['accountId', …])` keeps it as the optional string it was,
`partial(…, { keys: ['accountId'] })` too). The `unknown` policy stays. A memory kind (`Struct`,
`Form`, a kind of your own) keeps its kind and all its metadata.

`options.metadata` puts metadata over that, as `merge` does: `{ metadata: { kind: 'entity' } }`
makes the result a stored kind again, with the id of its own name.

## The schema's own functions

The `validate`, `parse`, `serialize` and `format` of the schema itself were written for the
whole value, and may read a field a derived schema no longer has, or has as optional:
`pick`, `omit` and `partial` leave them out, `required` and `extend` keep them. An extension puts
one back: `extend(pick(Account, ['login', 'password']), { validate })`. The codecs and the
`validate` of a field are the field's own and always come along.

## Indexes, names and models

An index of the source stays when every column of it is a field of the result, so a derived
schema has no `missing-index-field` warning; a `many` field records its relation again by
itself. The references and relations are those of the fields that stay.

The name of a derived schema is the source's unless `options.name`, so its error lines keep the
entity's label. A `Model` takes a Schema only under its own name: give `name` to put a derived
schema in a model.

```js
const api = new Model({}, [['CreateAccount', CreateAccount]]);
```

The namespaces are the source's (and the extension's), so references and the custom types of
an isolated registry resolve as they did. A derived schema is an ordinary schema: its snapshot
is a `Struct` with its fields, it compiles with `./compile` like any other, and the
[`./stream`](/guide/streaming) functions take it.

## Methods

`register()` installs the six as methods of `Schema`, not enumerable, so they chain:

```js
const derive = require('@alexify/metaschema/derive');
derive.register();

const AccountPatch = Account.omit(['password']).partial({ name: 'AccountPatch' });
```

Importing the subpath registers nothing; `register()` runs once per process.

## TypeScript

Each function is typed by the definition: `InferSchema` of a derived schema is the value it
accepts, a key the schema has no field of is a compile error, and a schema of an unknown
definition (`model.entities.get('Account')`) gives a `Schema` of an unknown one.

```ts
const view = pick(account, ['login', 'nick']);
type View = InferSchema<typeof view>; // { login: string; nick?: string | null | undefined }
pick(account, ['nmae']); // error
```

The id of a stored kind is not in the static type (as with
[`Infer`](/guide/typescript)): a definition does not carry the entity's name.

## Boundaries

- The keys are field names, not paths: `pick(Account, ['address.city'])` is an unknown field.
  Give the nested struct a Schema of its own and derive from that, or extend with a new
  definition of the field.
- `deep` stops at collections, tuples, unions and references (above).
- A field replaced by `extend` takes the whole new definition: its old rules, aliases and
  annotations do not come along.
- A partial schema describes a patch; it cannot check what depends on the stored record (a
  length after a merge, a rule across fields). Check the record after applying the patch.
- MongoDB updates name fields by dotted paths and replace an embedded document whole: a deep
  partial is the shape of a JSON merge patch, not of `$set`.
