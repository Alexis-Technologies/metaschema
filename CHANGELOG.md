# Changelog

All notable changes to **`@alexify/metaschema`** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.4.0] - 2026-10-16

3.4 makes the snapshot a contract a program can build on and the language complete for the
programs that encode from it. A schema writes its own snapshot (`schema.toSnapshot()`, with the
entities it reaches and its name as `root`), the guarantees of format 1 are written down, and
the typings narrow a field of a snapshot on its type; a schema names itself without a model;
binary data (`bytes`), named switches (`flags`) and a number of decimals (`decimals`) are built
in. The checks are compiled on their first use, which makes building a schema 13 to 15% faster,
and the core is split into two halves over the same classes, so that a client that reads
schemas without validating them imports `@alexify/metaschema/definition`, 10.3 KB, about half
of the core. The two new type names change what a struct whose first key is `bytes` or `flags`
reads as, and a program that registered either as a custom type of its own (protoarray 1.2's
`types`) drops that entry: see Changed. The review of the release before its tag kept bundlers
from dropping the import that installs validation, made the snapshot of a schema whole (what a
reused schema reaches, the values that have no JSON form, copies of the metadata) and its
restore strict, bounded binary data by a `length`, and moved the gates to 22 KB for the core
and 11 KB for `./definition`.

### Added

- **`schema.toSnapshot()`.** The snapshot of format 1 for one schema: the schema and every
  entity it reaches through its references (the parent of a projection included), each after
  the ones it references in the order a walk from the schema meets them, with the name of the
  schema as the new optional key `root` (`''` for an anonymous schema) and no `database`
  metadata. `fromJSON` restores it (`model.entities.get(snapshot.root)`
  is the schema again, and `toSnapshot()` of it writes the same text), and `fromJSON` and `diff`
  check that `root` names one of its entities (`ERR_INVALID_SNAPSHOT`). Two schemas of one name
  in what a schema reaches (one derived from an entity keeps its name) cannot be one snapshot:
  `ERR_UNREPRESENTABLE`, and so are two custom types of one name from two registries. A Schema
  reused as a field (`{ inner: Inner }`) resolves its references and types through itself, as its
  fields do, and an anonymous schema of a model is the entity of the name the model gives it.
  `snapshot.js` shares the walk between the two writers, a loop rather than a recursion, so a
  chain of entities of any length orders; `model.toJSON()` does not change.
- **What format 1 guarantees**, written down in the model guide: the fields of a struct in the
  order of the definition, the id field of a stored kind after them, the entities each after the
  ones they reference (`model.order` for a model), the tags as they are, and keys only ever
  added. A change of any of them is a
  major release.
- **A typed snapshot.** `FieldSnapshot` is a union that narrows on `type`: a string with its
  rules, a number with its bounds and `decimals`, the scalars, an enum with `enum`, `flags`
  with `flags`, a list or a dictionary with `value` (and `key`), a tuple with its elements, a
  nested struct with `schema`, a union with `union` and `discriminator`, a reference by the
  capitalized name of its entity with `one`/`many` and `embed`, a custom type by the names of
  `CustomTypes`, `bytes` with its `length` (`BytesFieldSnapshot`). `SchemaSnapshot` is what
  `toSnapshot()` returns; `BytesSnapshot`, `MapSnapshot` and `SetSnapshot` type the new tags.
- **Bytes, a Map and a Set are tagged in a snapshot** (`{ $bytes: 'AQL/' }`, `{ $map: [[k, v]] }`,
  `{ $set: [v] }`), beside `$date` and `$bigint`, and `fromJSON` reads them back into their
  values: a `default` or the `examples` of such a field restore as values of the field (a Map
  and a Set were written as `{}`, bytes as an object of indices). A tag that does not read is
  `ERR_INVALID_SNAPSHOT`.
- **`bytes`**, a built-in type: a `Uint8Array` of any realm, a `Buffer` included, told by the
  name the engine keeps in the view (`isBytes` of `util.js`), never by `instanceof` or a key of
  the value. `length` counts its bytes, on both backends. `Uint8Array` in TypeScript and
  `Infer`; base64 text on the input side of a JSON Schema (`format: 'byte'` for OpenAPI 3.0,
  `length` as `minLength`/`maxLength` of the text; the strict profile keeps the type only),
  unrepresentable on its output side (as a `date`), `binData` for mongodb; random bytes within
  the length in `sample`; `bytes` in `infer` for the views of the samples; canonical base64 read into bytes by `./coerce` (padded, the unused bits at zero;
  `''`, the text of no bytes, as an empty `Uint8Array`, the one exception to the rule that `''`
  is never converted; a scan of the text, linear and without the stack of a repeated group, so
  a valid text of megabytes converts; a text whose bytes would be over `length.max` is left
  undecoded, for the check to reject); a generic Binary of the driver (subtype 0, or 2) read
  back into a copy of its bytes by `fromDocument` of `./mongodb`, any other subtype (a UUID, an
  encrypted value) left for the check, so that it is never written back as generic binary
  data.
- **`flags`**, a built-in type: `{ flags: ['read', 'write'] }` is an object of those names,
  each a boolean, any left out. A name the list does not have is `unexpected` under the
  unknown-keys policy of the check, ignored under `unknown: 'ignore'`, left out by `parse`
  under `strip`; a list that is not one of distinct names is `ERR_INVALID_DEFINITION`. An
  object of optional booleans in TypeScript and `Infer`, an object of boolean properties in
  JSON Schema (closed with the document; every name required under the strict profile), a
  random set of switches in `sample`; `merge` keeps the names both have, and `compatibility`
  reads them as the values of an enum. The list is a frozen copy of the program's.
- **`decimals`**, a rule of `number` (0 to 15): the value times 10ⁿ is a whole number to
  within 256 units in the last place, so `0.1 + 0.2` has two decimals and `12345678.123` does
  not; NaN and the infinities have none to count. A new issue code, `decimals` (`{ decimals }`,
  and `received` naming NaN or an infinity), with a renderer in both locales; a new warning,
  `unenforceable-decimals`, where the bounds of the field reach 2⁴³ units of the last decimal,
  past which every number passes (thirteen decimals or more without bounds, two with
  `max: 1e12`); `multipleOf` in JSON Schema (read back by `fromJSONSchema`);
  drawn with its decimals by `sample`; the fewer of the two in `merge`; an upper bound in
  `compatibility`.
- **`@alexify/metaschema/definition`**, the half of the core that builds schemas and models and
  reads them (fields, metadata, `toJSON`, `toSnapshot`), on its own: 10.3 KB min+gzip, gated at
  11 KB. Its `Schema` and `Model` are the core's; a schema it builds says `ERR_NOT_REGISTERED`
  (with the `method`) when it is asked to validate (`check`, `parse`, `serialize`, `validate`,
  the async pair, the `check` of a field, the warnings) until the program loads the core entry,
  and validates from then on, the schemas built before and a method taken from them before
  (`const { check } = schema`) included; it has no `~standard` until then. A schema of another
  copy of the package (two versions installed side by side) says that the core loaded is
  another copy. `./derive` and `./formats` work beside it alone; a bundle of it and the core
  carries each module once, and `import '@alexify/metaschema'` for the validation it installs
  survives a bundler (`sideEffects` lists the entries and `src/validation.js`).
- `pnpm size` measures `./definition` on its own (`--max-gzip-definition`); `graph.test.js`
  pins that the definition half, `./derive` and `./formats` reach no module of the validation
  half. `pnpm run size:gate` is `pnpm size` with the budgets as gates, the one place they are
  written, which CI and `prepublishOnly` run.

### Changed

- **The checks are compiled on their first use**: a field on the first read of its `check`, a
  struct on its first check (`checkOf`, kept beside its frozen plan, whose entries no longer
  hold the checks), a schema through a stub of `Schema[RUN]` that takes the closures' place. A
  schema that is only read never compiles them: `Schema.from` is 13 to 15% faster, `new Model`
  5%, and `check` and `parse` are at parity on both backends. What a definition must reject is
  still found when it is built (a `max` below `min`, a format not registered), and the test of
  a format is the one named when the field was built.
- **The core is two halves.** The definition half (`schema.js`, `model.js`, `types.js`, the
  prototypes, `struct.js`, `rules.js`, `snapshot.js`) builds; the validation half
  (`validation.js`, `checks.js`, `codec.js`, `context.js`, `issues.js`, `result.js`,
  `lint.js`, the locale) installs `check`, `parse` and their kin, `~standard`, the warnings and
  `checkConsistency` on the classes, and the type check of every built-in on the prototype
  object the classes of the type inherit from. The core entry loads both; nothing changes for a
  program that imports it. The state the validation half keeps on a schema is held under
  symbols, and `fields[STRUCT]` is `{ plan, known, calculated }` (the check is `checkOf`).
- **`bytes` and `flags` are type names**, so a struct whose first key is one of them
  (`{ flags: ['a'], name: 'string' }`) reads as that type now, as `{ date, place }` reads as a
  date: give it a kind (`{ Struct: {}, flags: … }`). A table of custom types of the program
  under either name (`bytes` and `flags` of protoarray 1.2's `types`, for one) is
  `ERR_TYPE_REGISTERED`: leave those entries out, the built-ins check the same values (only
  `{ metadata }` may still be added). `infer` writes `bytes` for a `Uint8Array` among the
  samples (it wrote a dictionary of its indices).
- **The core gate is 22 KB** (was 19): `toSnapshot`, the two types and the rule cost the core
  about 1.0 KB, the lazy checks and the split about 0.8 KB, the review about 0.9 KB; the core
  measures 21.3 KB. The generators gate is 8 KB (was 7.5; the two types and the rule took the
  subpath to 7.7 KB); a new gate of 11 KB for `./definition` (10.3 KB).
- **The `compile` of a custom type of its own runs on the first check** of its field, as every
  check is compiled now (when the schema is built under the JIT): what it throws is
  `ERR_INVALID_CUSTOM_TYPE` located at the schema, with the error as the cause.
- **What a snapshot holds is a copy.** The `custom` metadata of a kind, the index definitions
  and the `database` metadata were the model's own objects inside the snapshot; they are written
  as any value is now, their functions, bigints and dates tagged.
- **A discriminator field that is optional or nullable is `ERR_INVALID_UNION`**
  (`'kind?'`, `required: false`, `nullable: true` on the field a `discriminator` names), as a
  `default` on it already was: a value without the tag or with `null` is in no branch, so such a
  branch could never be picked. A definition of that kind built until now and rejected every
  value without the tag; it throws when it is built now, a snapshot that says so does not
  restore, and an OpenAPI document whose branch does not require its discriminator does not
  build. protoarray holds the same rule.
- **`prepublishOnly` runs both backends and the bundle budgets** (`test:jit`, `test:nojit`,
  `size:gate`) besides the gates it ran, so that a release from a machine is held to what CI
  holds; the release process tags the squash commit on `main`.
- The warnings of a schema and of a model (`schema.warnings`, `schema.checkConsistency()`,
  `model.warnings`) are computed by the validation half, kept in a WeakMap, and the cycles a
  model meets while ordering its entities are recorded as data; their text is the same.
- `compiled()` of `./compile` tells a generated check by a set of the functions it built, since
  the closures of a schema may now be compiled after the JIT was turned off.

### Fixed

- **A schema resolves its own name without a model.** `new Schema('Category', { name:
  'string', parent: '?Category' })` checked `parent` as `Entity "Category" is not found`; the
  schema is now the fallback of `findReference` after the attached models (which come first,
  so a schema that shares the name of their entity still reaches the entity). A projection of
  its own name is `ERR_PROJECTION`, not a crash.
- **A snapshot of a model whose alias type names another alias** (`cents: { js: 'money' }`)
  left out the type it names, so `fromJSON` could not restore it (`ERR_UNKNOWN_JS_TYPE`); the
  custom types down the chain of an alias are written now.
- `types.md` said the formats subpath registers nine formats; it registers 35.
- **A Schema reused as a field is consistent.** `checkConsistency()` and `model.warnings`
  resolved the references of a schema reused as a field (`{ inner: Inner }`) through the schema
  that reuses it, and warned that they were missing; a snapshot of a model left out the custom
  types of such a schema from another registry. They resolve as the fields do now.
- **A snapshot is data where it names a Date or a RegExp.** A value of a snapshot such as
  `{ "constructor": { "name": "Date" } }` passed `fromJSON`, and `toJSON`, `toSnapshot` and
  `diff` then threw a bare `TypeError`; a Date and a RegExp are told by their shape, as the
  checks tell them since 3.2.
- **`fromJSON` refuses what a model cannot be built from**: a field key `root` (a reserved key of
  a definition now, which replaced the schema of the field and made every later read of it
  throw), a kind that is no lowercase name, an entity named like the ones a model skips (`.x`),
  a parent that is no name; anything else the model cannot build is `ERR_INVALID_SNAPSHOT` with
  the cause. The parent of a kind other than a projection is restored, so such a model reads
  back to the same text.
- **A model of a chain of a few thousand entities** overflowed the stack while ordering them (a
  bare `RangeError` out of `new Model` and `fromJSON`); the order is a loop.
- **A schema derived or merged from one that names itself** reaches it: `partial(category)`
  checked the parent as a partial category, `pick()` under another name did not find it, and
  `extend()` and `merge()` lost the self-reference of the second schema.
- **The JSON Schema of an anonymous schema of a model** was defined under `''`; it is defined
  under the name the model gives it.
- **The TypeScript of a field with a `flags` option** of another type (`{ type: 'string', flags:
  'gi' }`) was an object of switches; a field is flags by its type.
- **The JIT wrote the numbers of `decimals` into the generated source** as they were; they are
  literals of the code builder now, and both backends run one test (`decimalsOff`).

## [3.3.0] - 2026-10-14

3.3 closes the gaps the comparison with the alternatives showed. `parse` converts the text of a
query string, a form or a file to the types of the fields when asked (coercion), schemas are
derived from schemas (`pick`, `omit`, `partial`, `required`, `extend`, `keyof`), the string
formats grow from nine to 35, and the `@alexify/metaschema/mongodb` subpath is the schema side
of a MongoDB program without a dependency on the driver. The review of the release before its
tag made the converters and five formats linear in the stack as well as in time on strings of
megabytes, capped the `regex` format, and closed the ways a document could carry a foreign
`_id` or throw on `null`. The changes in behaviour (`coerce` is a reserved key, `infer` writes
the more specific formats, a format of the program under the name of a new built-in takes its
place) are listed under Changed.

### Added

- **Coercion.** `parse(value, { coerce: true })`, the kind metadata
  `{ Form: { coerce: true } }` (so `~standard.validate` too) or a field's `coerce: true|false`
  converts the input to the types of the fields before the check: decimal strings to numbers
  and bigints, `'true'`/`'false'`/`'1'`/`'0'` to booleans, ISO dates with their zone (and epoch
  milliseconds) to `Date`, a single value to a list, an array to a `Set`, an object to a `Map`,
  the written form of an enum member to the member. The converters are strict and never touch
  the empty string; a value a union branch accepts as it is is not converted; `check` never
  converts, and `Infer` does not change. The core has the policy and a step in the pass before
  the check; the converters are the new `@alexify/metaschema/coerce` subpath's
  (`register(custom)` adds the program's own by type name, an alias type converts as its base),
  and `coerce(schema, value)` is that pass alone. A parse that coerces before `register()` is
  `ERR_NOT_REGISTERED` as it enters the schema, whatever the value holds (an empty body does
  not hide a missing `register()`); `register(custom)` checks every entry before it writes
  any; `ERR_INVALID_COERCION` and `ERR_COERCION_REGISTERED` are new codes. The converters are
  linear on hostile strings (a run of a hundred thousand digits that is not a number costs
  nothing), and `toMap` converts a plain object or a list of pairs only.
  `register(custom, { onError })` is told of a converter that threw (the value is left to the
  check either way), the policy is read from own keys only (a `coerce` set on
  `Object.prototype` elsewhere turns nothing on), and `coerce` on a reference checked as an id
  or on a field of `any`, `unknown`, `json` or `null` is a `dead-coerce` warning. The converter
  of a field is resolved once and kept with the field (a JIT parse that coerces is 11% faster
  than with a lookup per value, a parse of enums of 32 members 2.3 times: the members and their
  written forms are indexed once). `pnpm bench` has rows for a nested struct, plain unions,
  enums and a plain and a coercing parse in turn, and for `toDocument`/`fromDocument`.
  `coerce(schema, value, { report })` fills the array given with the path of every key the
  pass changed; `new Model(types, entities, database, { coercions })` gives a model converters
  of its own type names, read before the process-wide table for the fields of its entities
  (what an isolated registry is to the types); the branches of a plain union are prepared
  first and tried only when one of them changes the value, so a parse over a union of records
  that nest unions is linear where nothing applies (4 times faster at a depth of 12).
- **`@alexify/metaschema/derive`.** `pick`, `omit`, `partial` (`keys`, `deep`, `defaults`),
  `required`, `extend` and `keyof` build a new Schema from the definition a schema was built
  from: a stored kind or a projection becomes a struct without the id of the kind (unless
  named), `partial` leaves the defaults out, `pick`, `omit` and `partial` drop the schema's own
  functions, `extend` replaces fields in place (where `merge` unifies), indexes stay while their
  columns do. `register()` installs them as methods (`schema.omit(['id']).partial()`), typed by
  the definition. `ERR_UNKNOWN_FIELD` names a key the schema has no field of.
- **26 string formats.** `ulid`, `jwt`, `nanoid`, `cuid2`, `iso-date-time`, `iso-time`,
  `duration`, `cidrv4`, `cidrv6`, `mac`, `url`, `uri-reference`, `uri-template`,
  `json-pointer`, `relative-json-pointer`, `regex`, `e164`, `iban`, `hex-color`, `base64`,
  `base64url`, `hex`, `emoji`, `semver`, `slug` and `credit-card` (the expressions of
  ajv-formats, zod, valibot and semver.org, held to them value by value). A format entry may
  carry a `pattern`, which `toJSONSchema` writes beside a name JSON Schema does not know (the
  one assertion of the mongodb target) and `fromJSONSchema` drops again; OpenAPI's `byte` is
  `base64`. No built-in test overflows the stack of the regex engine on a string of
  megabytes: `email`, `json-pointer`, `relative-json-pointer`, `uri-template`, `slug` and
  `semver` are read by a scanner with the same verdicts, and a `regex` longer than 4096
  characters is not one (compiling it costs memory in proportion). `register()` returns the
  names of the built-in formats the call replaced with the program's own.
- **`@alexify/metaschema/mongodb`.** The BSON types `objectId`, `decimal128` and `binary`
  (recognized without importing bson), `register({ bson })` with the program's driver,
  `toDocument`/`fromDocument` (the id of a stored record as `_id`, ids of references as
  ObjectIds, and back), `indexesOf` for `createIndexes`, `checkUpdate`/`toUpdate` for the
  driver's updates by dotted path. No I/O and no dependency. An `_id` beside the id field of a
  record is not written (`toDocument` of a body checked with `unknown: 'ignore'` cannot
  choose the `_id`), `fromDocument(schema, null)` is a `type` issue rather than a throw, a
  value of a class at the root is `ERR_INVALID_TARGET`, reading a document and `ids:
  'string'` need no driver, and `binary` is coerced from text of the base64 shape only. The
  walks of a document stop at `maxDepth` (128, an option of `toDocument` and `toUpdate`) as
  the check does, instead of recursing until the stack ends; `checkUpdate` reports a path with
  an empty segment, into a part a field cannot have or to the `_id` of the document whatever
  the policy for unknown keys says, a path through more records than `maxDepth` as a `depth`
  issue, and names what an operator takes in its issues (`array` for a `$push` on a field
  that is no list, `number` for an `$inc` on a string); `register({ bson })` installs the
  converters of the BSON types the module can build only, `decimal128` is coerced from a
  decimal written as one or a finite number (`fromString` of the driver reads `NaN`, `inf`
  and an exponent), and an element of a list of ids (`partners.0`) is an id in `checkUpdate`
  and `toUpdate`. The subpath is tested against the real `bson` (a devDependency) as well as
  the fakes.
- **`ids: 'objectId'`** for the mongodb target of `toJSONSchema`: the validator of the
  documents `toDocument` writes.
- `pnpm size` measures a subpath on top of another it requires (`./mongodb` on `./coerce`).

### Changed

- **The core gate is 19 KB** (was 17.75 KB): coercion costs the core about 360 bytes; the core
  measures 18.6 KB. The formats gate is 5 KB (was 2 KB; the scanners of the review took the
  subpath to 4.0 KB), the compile gate 5 KB (was 4.25) and the model gate 13 KB (was 12): a
  gate is raised to the next whole KB when a fix needs it, and never sits a few bytes over a
  subpath. New gates: 2.5 KB for `./derive`, 2 KB for `./coerce`, 4 KB for `./mongodb` (3.5 before the review: the depth limit and the markers of the paths took the subpath over it).
- **`coerce` is a reserved key** of a field definition and of the kind metadata. A field
  `coerce` that is not a boolean is `ERR_INVALID_DEFINITION` (was an `unknown-option` warning),
  a kind metadata `coerce` that is not a boolean is `ERR_INVALID_OPTIONS` (was an ordinary
  custom key), and a kind metadata `coerce: true` makes every `parse` of the schema need
  `register()` of `./coerce`.
- **An option of a call that is not what it must be carries `code: 'ERR_INVALID_OPTION'`**
  (a new `RuntimeErrorCode`): the `TypeError` of `maxErrors`, `references`, `root`, the
  `coerce` of a parse, and of the options of `./stream`, `./derive` and `./mongodb` had no
  code. The options of `./derive` are the call's (`keys` that is no list, options that are no
  object are `ERR_INVALID_OPTION`, a `TypeError`; they were `ERR_INVALID_OPTIONS`, a
  `SchemaDefinitionError`); its `metadata` stays a definition (`ERR_INVALID_OPTIONS`), and
  `keyof` with a `metadata` is `ERR_INVALID_OPTIONS` (a schema of an enum has no kind; it was
  ignored).
- The rule of the id field of a stored kind (`orderId`, `id` for an anonymous schema) is
  `idFieldOf` of `kinds.js`, read by `./derive`, `./mongodb` and `toJSONSchema`; the alias
  chain of a custom type ends in `baseTypeOf` of `types.js`, read by the generators, `sample`
  and `checkUpdate`; the shapes of the walks of `./mongodb` are named once (`SHAPES`) and held
  to the core's by a test.
- **`infer` writes the more specific formats**: a column of http(s) addresses is `url` (was
  `uri`), local date-times are `iso-date-time`, ULIDs `ulid`, durations `duration`.
- **A format of the program under the name of a built-in takes its place** instead of throwing
  `ERR_FORMAT_REGISTERED`, so a format a program registered as `ulid` before 3.3 keeps working.
- `merge` and `derive` share the code that turns a schema back into a definition
  (`model/data.js`).

## [3.2.0] - 2026-10-12

3.2 takes a schema to the records around it. The new `@alexify/metaschema/stream` subpath runs
a schema over a sequence of records, lazily and in order, as generators and as a
`TransformStream`; `infer` in the model subpath reads a definition out of the values that
exist, the reverse of `sample`; and the two performance candidates the review of 3.0 left were
measured and done: independent async validators are in flight together, and the passes of
`parse` allocate nothing per container they visit. The review of the release before its tag
added the `format` rule of strings with the `@alexify/metaschema/formats` subpath, fixed a value
parsed from JSON that could throw out of `check`, made the ReDoS note true, and closed two
unhandled rejections. Nothing breaks; the changes in behaviour (the order of the issues of an
async check with a sync validator after an unrelated promise, a pattern no longer run past
`length.max`, the message of `unexpected` capped at ten keys) are listed under Changed.

### Added

- **The `format` rule of strings and the `@alexify/metaschema/formats` subpath.**
  `{ type: 'string', format: 'email' }` is a rule beside `length` and `pattern`: the core knows
  the rule and keeps an empty table (`FORMATS`), and `register()` of the subpath fills it with
  `uuid`, `email`, `date-time`, `date`, `time`, `ipv4`, `ipv6`, `uri` and `hostname` (the
  expressions of ajv-formats' fast mode, linear and anchored, with the date and time ranges
  checked and the leap second as RFC 3339 has it) and with the program's own
  (`register({ phone: { test, examples, infer } })`), once per name, process-wide; a name the
  table lacks is `ERR_INVALID_RULE` with the hint when the schema is built, an entry that is
  not a format `ERR_INVALID_FORMAT`, a name registered again with another test
  `ERR_FORMAT_REGISTERED`. A failed test is the new `format` issue (`params.format`, rendered
  by both locales); the rule runs after the pattern, under the bound of `length.max`, and the
  JIT reaches the test through its scope. `toJSONSchema` writes `format` (the built-in names
  are JSON Schema's; the strict profile drops it, a `$jsonSchema` has none) and
  `fromJSONSchema` reads a registered one back; `sample` draws one of the format's examples;
  `infer` writes the first registered format every string of a place passes (`formats: false`
  turns it off; `hostname`, which every word passes, is never inferred); `merge` refuses two
  formats and `diff` classifies one as a pattern. A rule, not a type: a type named `email`
  would make `{ email: 'string', name: 'string' }` read as a shorthand. The subpath is 1.3 KB
  min+gzip on top of the core, gated at 2 KB; the typings add `FormatDefinition`, the issue
  code and the two error codes.
- **`compiled(target)` in the `@alexify/metaschema/compile` subpath**: whether a schema (every
  entity of a model) runs generated code now, in place of the internal symbol the guide pointed
  at.
- **`result.toJSON()`**: `JSON.stringify(result)` writes `{ valid, issues }` (the verdict was a
  getter and was left out); `util.inspect(model)` prints the snapshot, as a schema prints its
  definition.
- **`sideEffects: false` in package.json**: nothing registers on import, so a bundler may drop
  a subpath a program imports and never calls.
- **`tests/unit/graph.test.js`**: the module graph of `src/` has no cycles (CLAUDE.md drew it
  by hand and said nothing checked it).
- **`infer(samples, options)` in the `@alexify/metaschema/model` subpath, the reverse of
  `sample`.** A definition (or a `Schema`, with `as: 'schema'`) that accepts every sample
  given, to bootstrap a model from the documents that exist: one pass summarizes the kinds of
  every place, the records of a place fuse into one struct with optional keys (absent or
  `undefined`) and nullable keys (`null` beside a type), arrays fuse their elements, values of
  several kinds are a `union` with the record last, whole numbers are `integer`, a string of
  few recurring values an `enum`, records whose keys are not names (or many sparse keys of one
  kind) a dictionary `{ object: { string: T } }`, `Set`, `Map`, `Date` and bigint their types,
  and what no type describes `any`; no bounds, patterns, references or tuples. Every key of the
  data is a key of the definition (`__proto__` through `define`, a struct wrapped as
  `{ schema }` where its first key would read otherwise, the root under its `kind`). The
  samples are input: a sample nested deeper than `maxDepth` (128) is `ERR_INFER_DEPTH` with its
  index and place, and the definition is checked against every sample before it is returned
  (`ERR_INFER_MISMATCH`, with `error.index`, names the id field a stored kind adds over a field
  of that name, or a bug). `register()` installs `Schema.infer`; the typings add
  `InferOptions` (`as`, `name`, `kind`, `enum`, `integer`, `map`, `maxDepth`) and the two codes.
- **The `@alexify/metaschema/stream` subpath: a schema over a sequence of records.**
  `checkEach(schema, records, options)` and `parseEach` run `check` or `parse` on every record
  of an iterable, lazily, and yield `{ index, record, result }` in the order of the records;
  `checkEachAsync` and `parseEachAsync` do the same over a sync or async iterable with the
  async methods, keeping `options.concurrency` records in flight (one by default), still in
  order, and observing the promises in flight when the iteration ends early; `maxInvalid` ends
  an iteration after that many invalid records. `transform(schema, options)` is a
  `TransformStream` (a global since Node.js 18, and in browsers) that passes every valid record
  on as its parsed value (or as it is with `mode: 'check'`), hands an invalid one to
  `onInvalid(record, result, index)`, or ends the stream with a `TypeError` of the new runtime
  code `ERR_INVALID_RECORD` (with `index`, `record` and `result` on it). `register()` installs
  the five as methods of `Schema`. The subpath is 1.0 KB min+gzip on top of the core, gated at
  1.5 KB; the typings add `EachOptions`, `ParseEachOptions`, `EachAsyncOptions`,
  `TransformOptions` and `RecordEntry<T, R>` (`T` the type of the records of the source:
  `checkEach<T>(schema, records: Iterable<T>)` and its kin).
- **Bench scenarios for the async path and for `strip`** (`pnpm bench`): `checkAsync` with
  sync, resolved and event-loop-bound validators, `parseAsync` with an async decoder, and
  `parse` under `unknown: 'strip'` over a nested value and a list of 100 records, each on both
  backends, through a `benchAsync` twin of the harness (one `await` per call).

### Changed

- **Independent async validators are in flight together.** `checkAsync` and `parseAsync` set a
  validator aside uncalled only when a promise is pending under its path (the `validate` of a
  struct whose field is still being checked, the schema's own); every other validator runs
  where `check` runs it, during the walk, and the promises are awaited together after it, so
  the latency of a check is the longest of the waits rather than their sum (`pnpm bench`:
  four independent validators awaiting `setImmediate` went from 18 K to 66 K checks a second,
  32 records with one each from 2.2 K to 45 K, four awaiting `setTimeout(1)` from 190 to
  845; the sync validators and the resolved promises are unchanged). What
  changes besides the latency: a synchronous validator met after an unrelated promise runs
  during the walk, so the issues of the walk come first, in walk order, and the promises after
  them, in field order; under a low `maxErrors`, and in a branch of a plain union that fails, a
  validator may be called whose result is dropped, as in `check`. The issues recorded are the
  same, on both backends.
- **A `pattern` is never run over a string longer than `length.max`.** The ReDoS note promised
  that the bound keeps a backtracking expression fast, but every rule of a field ran: a string
  past the bound got its length issue and then the pattern (2.5 s for `^(a+)+$` on 27
  characters). Both backends skip the pattern on such a string (twice the bound in UTF-16
  units with `unicode: true`), which is reported for its length alone: one issue where there
  were two. A field without `length.max` is unchanged. A `format` is run under the same bound.
- **The message of `unexpected` lists the first ten keys** and says how many more; `params.keys`
  keeps them all. The unexpected keys are one issue, so `maxErrors` never bounded the message,
  and a value with a million keys the schema does not have rendered a million of them.
- **The gate of the `./model` subpath is 12 KB** (was 10): `infer` costs 2.3 KB min+gzip and
  the subpath measures 11.7 KB (12.0 KB with the formats); the subpath is tooling, not the
  validation path, as for the move from 8.5 to 10 KB in 3.1. **The core gate is 17.75 KB**
  (was 17.5): the `format` rule, its issue and the fixes of the review measure 17.7 KB
  together, and a gate the next fix cannot fit under is no gate, as in 3.1.

### Performance

- **The passes of `parse` and `serialize` allocate nothing per container they visit.** The
  walkers of `codec.js` kept a state object per struct, list, dictionary or tuple whose bits a
  pass wanted (`{ context, key, value, clone, put, out, pending }`), even where nothing
  changed; the output under construction and the parts still decoding are locals of the walker
  now, written through two small helpers. `pnpm bench`: `parse` of 100 records under
  `unknown: 'strip'` from 61 K to 71 K a second on the closures and from 81 K to 100 K on the
  JIT, a nested struct under `strip` from 1.9 M to 2.2 M on the JIT, defaults and a decoder
  about 5% faster on both; the rest within the run-to-run band.

### Fixed

- **A value parsed from JSON could throw out of `check`.** A built-in was recognised by the
  name of its constructor alone, and `{ "constructor": { "name": "Map" } }` as the value of a
  `map`, `set` or `date` field was iterated, or asked for `getTime`, and threw a `TypeError`
  out of `check`, `parse`, a union branch and both backends, where the contract is that
  nothing in the value makes the check throw. The name is still tested first, then the shape
  (an iterator for a `Map` or a `Set`, `getTime` for a `Date`), which JSON cannot fake; such a
  value is a type issue. Since 2.0.
- **A walk that threw out of `checkAsync` or `parseAsync` left its promises unhandled.** A
  getter of the value that throws (or, before the fix above, a crafted value) ended the call
  with that error while the promise a validator had returned before it rejected with no
  handler. The walk of an async check releases what it queued on the way out.
- **A queued record of the async stream pair could reject unhandled.** With a window of
  records in flight, a later record whose parse threw while an earlier one still waited for
  its validator fired `unhandledRejection` before its turn, then rejected the iteration all
  the same; the promise is observed when it is queued.
- **Keys of untrusted input are shortened in every message.** The place of an `infer` error
  (a key of a sample), of a `fromJSON` error (a key of a snapshot) and of a `fromJSONSchema`
  error (a property name in the pointer) went into the message whole; they are truncated to
  100 characters as a key of a value under check is. A snapshot index named `__proto__` is
  written as a key instead of vanishing, and the `validate` method of a schema reports a
  thrown `null` as an exception instead of throwing on it.
- **A failed branch of a plain union observed none of the promises it dropped.** A validator
  of the branch that returned a promise was set aside, and when the branch failed on a later
  field the entry was cut from the list without a handler, so its rejection was an
  `unhandledRejection` while the value went on to match the next branch. Both backends now
  release such entries (`release` in `issues.js`, reached by the generated code through the
  scope), as the trial of `parse` and a `settle` stopped by `maxErrors` already did.
- **An object with no key that starts with a letter is a struct.** `Schema.from({})`,
  `{ _id: 'string' }` and a nested `{ a: {} }` threw a bare `TypeError` from the preprocessor
  (the first key is the first one that starts with a letter, and there was none); they are
  structs of those keys, or of none.
- **A nested struct may have a field named `required`.** `{ a: { required: 'boolean' } }`
  gave the field `a` the `required` of its nested definition (`'boolean'`), which showed in
  `toJSON()` and in the snapshot; the key and the parsers decide, as everywhere else.
- **`fromJSONSchema` wraps a nested struct whose first letter-led key reads as a type.** A
  nested object with the properties `_id` and `string` came back bare and was read as a
  `string` field; one with no properties came back as `{}` and could not be built. The rule
  the generator asks (`readsAsStruct` in `types.js`) follows the preprocessor's `firstKey`
  now, and the model subpath shares it.

- **`CheckContext` declares `renamed`.** The context has carried the slot (whether the check
  read a field from one of its aliases) since 3.1, and the migration guide says the type declares
  every slot; `tests/types/index.test-d.ts` pins it now.

### Tooling

- **A cross-library benchmark, charted.** `pnpm bench:compare` replaces `pnpm bench
  --compare-libs` (`bench/libs.js` is gone): metaschema on both backends beside Metarhia's
  metaschema 2.2.2, zod, Valibot, ArkType, Effect Schema, TypeBox (1.x, `Compile` and `Value`),
  Ajv, Yup, Joi and Superstruct, one adapter per library, each pair in a fresh process that
  checks the verdicts before it times anything, median of five one-second samples. The
  scenarios are the moltar object in its four modes, every issue of an invalid value, building
  a schema and a cold start; `pnpm size:compare` bundles the same schema per library and checks
  the bundle; `bench/releases.js` measures every release since Metarhia's 2.2.2 with one
  harness. `pnpm bench:report` turns the results into SVG charts for the README and the tables
  of the README and `docs/guide/benchmarks.md`; the docs render the same models as interactive
  charts. The libraries are devDependencies (`@sinclair/typebox` 0.34 gave way to `typebox`
  1.x).
- **A feature matrix of twenty alternatives.** `docs/guide/comparison.md` and the README compare
  metaschema with TypeScript-first validators, JSON Schema tools, IDLs and Mongoose in one
  table, every cell checked against the source of the published package; `pnpm docs:comparison`
  renders it from `docs/comparison.json`.
- **Docs.** New pages: Benchmarks, Compared with alternatives and Architecture (mermaid diagrams
  of the pipeline); the home page and the Why page were rewritten around "fast, zero-dependency";
  the package description says so too.

## [3.1.0] - 2026-10-11

3.1 makes the model data. `model.toJSON()` writes a snapshot of a model, the contract other
programs read it through, and the new `@alexify/metaschema/model` subpath builds on it:
`fromJSON` restores a model from a snapshot, `diff` and `compatibility` compare two versions by
the rules of schema evolution, `sample` draws a value a schema accepts, and `merge` unifies two
schemas. A field may carry `aliases`, read by `check` and renamed by `parse`, and
`fromJSONSchema` of the generators reads a JSON Schema document back into a definition. Nothing
breaks: the core, the generators and the compile subpath keep their 3.0 behaviour, with the
fixes listed below.

### Added

- **The snapshot.** `model.toJSON()` (what `JSON.stringify(model)` writes) is the model as
  data, format 1: the entities in dependency order with their metadata, fields (each
  `{ type, required, ...sorted keys }`), indexes and relations, and the types the entities use;
  a function is `{ $function: true }` wherever it stands, a bigint and a Date are tagged, a
  RegExp is its source. `tests/fixtures/snapshot.json` pins the format.
- **`aliases` on a field.** `check` reads a field from an alias the value carries when it has
  nothing under the field's own key, reporting under the key it found the value under; `parse`
  fills no default over it and writes the value under the field's own key, in the place of the
  alias, and only after a check that read an alias (a value without one comes back as it is,
  the same reference); `serialize` never reads an alias. The JIT emits the same lookup. An
  alias is a key of the struct (not a field, a calculated field or another alias:
  `ERR_INVALID_DEFINITION`); the generators and `Infer` name the field's own key only.
- **`@alexify/metaschema/model`**, a subpath of 9.5 KB min+gzip on top of the core:
  `fromJSON(snapshot, options)` restores a model from its snapshot (placeholders for the
  functions, listed by path in `model.placeholders`; the real custom types through
  `options.types`; an isolated registry unless `options.registry` says otherwise, and a shared
  one refuses a placeholder type). A snapshot is untrusted input: what does not read (a
  bigint, a date, a pattern, an entity without a kind, a nesting deeper than 128 levels, an
  index named like a field, a `custom` key that would override the kind metadata) is
  `ERR_INVALID_SNAPSHOT` with the entity and the field, and a key of the snapshot is defined,
  never assigned, so `__proto__` is a field. `diff(prev, next)` lists the changes between two
  models or snapshots as `{ kind, op, entity, name, from, to, detail }` (a field renamed
  through its aliases is `renamed`, a removed `deprecated` field carries `detail.deprecated`);
  `compatibility(changes)` classifies them as `full`, `backward`, `forward` or `none` by the
  rules of the Confluent Schema Registry (the table is in the Model evolution guide), and
  `compatibilityOf(change)` is the class of one change;
  `sample(schema, { seed, locale, references, maxDepth })` is a value the schema accepts, the
  same for a seed, drawn from the definition and verified field by field (a pattern from the
  subset of alternatives, groups, classes, escapes, control escapes and quantifiers, the
  letters of `.` and `\p{L}` those of the locale of the call; a custom type through
  `metadata.sample`; a union draws another branch when one cannot be satisfied; `maxDepth` 0
  to 32), with `ERR_UNSATISFIABLE`, `ERR_SAMPLE_PATTERN` and `ERR_SAMPLE_TYPE` for what cannot
  be drawn, each naming the seed (`error.seed`): a repetition over 10000, a pattern whose
  minimal length exceeds `length.max` (found before a string is built), groups nested deeper
  than 64; `merge(a, b, { name, metadata })` is the schema both schemas describe,
  by unification, with `ERR_MERGE_CONFLICT` for what no value can satisfy, located like a
  definition error (`error.field`, the message ending `in "Name.address.city"`; an alias that
  is a field of the other schema is a conflict too); `register()` installs `Model.fromJSON`,
  `Model.diff`, `Model.compatibility`, `Model.compatibilityOf`, `Schema.merge` and
  `schema.sample`.
- **`fromJSONSchema(document, { name, as, references, unsupported })`** of the generators
  subpath: a definition (or a Schema) from the subset of JSON Schema a validation schema is
  made of, the other direction of `toJSONSchema` (types and type lists, properties and
  required, enum and const, items, tuples and uniqueItems, anyOf/oneOf with OpenAPI's
  discriminator, `$ref` into the definitions, the rules, null, the annotations, the root's
  `additionalProperties` as the unknown-keys policy); a keyword outside the subset is
  `ERR_UNSUPPORTED_SCHEMA` with its place as a JSON pointer, and so are a `$ref` that is not
  `#` or `#/…` over own keys, a bad escape in one, a nesting deeper than 128 levels, a
  pattern that does not compile under the `u` flag and an unknown name in a type list;
  `onUnsupported(reason, pointer)` tells what `unsupported: 'ignore'` dropped. A `$ref` is
  converted once per pointer and shared where it is inlined, so a diamond of definitions is
  linear. `register()` adds `Schema.fromJSONSchema`. The subpath is 7.1 KB on top of the core
  now.
- The types `ModelSnapshot`, `EntitySnapshot`, `FieldSnapshot`, `FieldsSnapshot`,
  `FunctionSnapshot`, `TypeSnapshot`, `RestoreOptions`, `RestoredModel`, `SchemaChange`,
  `ChangeKind`, `ChangeOp`, `Compatibility`, `SampleOptions`, `SampleHook`, `TypeMetadata`
  (the `sample` hook of a custom type), `MergeOptions` and `FromJSONSchemaOptions`;
  `aliases` on `FieldType`; the codes `ERR_INVALID_SNAPSHOT`, `ERR_UNSATISFIABLE`,
  `ERR_SAMPLE_PATTERN`, `ERR_SAMPLE_TYPE`, `ERR_MERGE_CONFLICT` and `ERR_UNSUPPORTED_SCHEMA`.
- A `dead-aliases` warning for `aliases` anywhere but on a field of a struct (an element, a
  branch, a schema of one type), where nothing reads them.

### Changed

- Two fields of a struct with one key (`{ a: 'string', 'a?': 'number' }`, or a calculated
  field and a field of one name) are `ERR_INVALID_DEFINITION` ("is a field or an alias
  already"); the second silently replaced the first before.
- `aliases` is a key the struct reads: `{ type: 'string', aliases: 'old' }` is
  `ERR_INVALID_DEFINITION` where it was an `unknown-option` warning, and a custom type does not
  see an option of that name.
- `JSON.stringify(model)` writes the snapshot; it wrote the `Model` instance's own enumerable
  properties before.
- A function of a subpath given something other than what it takes (`toJSONSchema`,
  `toTypeScript`, `compile`, `sample`, `merge`, `compatibility`, `fromJSONSchema`) throws a
  `TypeError` with `code: 'ERR_INVALID_TARGET'` (the `RuntimeErrorCode` of `ERR_ASYNC_VALIDATOR`);
  the message is the same, and `fromJSONSchema` of a non-object document, which was
  `ERR_INVALID_OPTIONS`, is that error too.

### Fixed

- A `many` reference re-parsed from its built field (a projection copies its parent's fields
  that way, and the long form `{ type: 'Address', many: 'Address' }` reads the same) came back
  with both ends and validated as a single reference.
- The name of a named tuple element (`[{ x: 'number' }]`) was an `unknown-option` warning.
- A `validate` given on a `schema` field (`{ type: 'schema', schema, validate }`) was replaced
  by the one of the definition it holds; the field's own wins now, as its `parse` and
  `serialize` did.

### Tooling

- `pnpm size` has a fourth row and gate, `--max-gzip-model`; the CI gates are 17.5 KB per
  core entry, 7.5 KB for `./generators`, 4.25 KB for `./compile` and 10 KB for `./model` (the
  core, the compile and the model gates moved from 17 KB, 4 KB and 8.5 KB during the review
  of 3.1: the first two had 14 and 15 bytes of headroom left, the third did not hold the
  hardening of the subpath).
- The bench has a sparse-struct scenario and two alias scenarios of `parse`, and
  `bench/baseline.json` is re-saved after the review.
- The coverage job runs under `shell: bash`, so the c8 thresholds fail CI through the pipe
  into `tee`; before, the job took the status of `tee`.
- New suites: `snapshot`, `aliases`, `evolution`, `sample`, `fromjsonschema` and `merge`, on
  all three backends; the bundle test bundles the model subpath with the core.
- New guides: Model evolution (`diff`, `compatibility`, `aliases`, `deprecated`, the rules
  table), Sample values; the snapshot and `fromJSON` in Domain Models, the import in JSON
  Schema, merging in Schema Syntax.

## [3.0.0] - 2026-10-11

3.0 moves the generators of JSON Schema and TypeScript from the core entry to the
`@alexify/metaschema/generators` subpath, which takes `model.dts`, `schema.toInterface()`
and `saveTypes` with them (a breaking change, hence the major), and `schema['~standard'].validate`
is `parse` rather than `check` (a second one). The rest is additive: `parse`, `serialize`,
`checkAsync` and `parseAsync` in the core, the JIT backend of the new
`@alexify/metaschema/compile` subpath, the JSON Schema export with its four targets and the
strict profile, Standard JSON Schema, JSDoc and named types in the generated TypeScript, and a
fix in `check`.

### Upgrading from 2.0

The same guide with before-and-after examples is
[Migrating from 2.x](https://metaschema.vercel.app/guide/migrating-from-2).

- **`schema['~standard'].validate` is `parse`.** A consumer of Standard Schema (tRPC, TanStack
  Form, Hono, …) gets the value `parse` gives: the `default` of a missing key filled in and the
  `parse` function of every field applied, with the schema's own `unknown` metadata as the
  policy for other keys (`libraryOptions` are the options of `parse`, `unknown: 'strip'`
  included). A schema without defaults and decoders returns the value it was given, the same
  reference, as 2.0 did. A schema with an `async function` among its validators, decoders and
  custom `checkType`s (in it or in an entity it references) returns a promise of the result,
  which the specification allows and its consumers await; the typings of `validate` say
  `StandardResult<T> | Promise<StandardResult<T>>` now, with `types.input` as `Infer<D>` and
  `types.output` as `InferOutput<D>`.
- **`Infer<D>` leaves out a key with a `default`.** A field with a `default` is an optional
  property on the input side, because `parse` fills it; `InferOutput<D>` has it present. The
  generated TypeScript interfaces are unchanged (every field present), so a value typed from the
  dts is still assignable to `Infer`, and the output type to the dts.
- **`CheckContext` has `async`, `source`, `scratch`, `depth` and `maxDepth` slots** (`async`
  is `null` in a synchronous check), and `issues.exception` takes the key of the field, for
  code that builds on the internals.
- **A graph nested deeper than 128 embedded records is invalid.** `check`, `parse` and
  `serialize({ check: true })` record a `depth` issue at the first record past `maxDepth`
  (128 by default, an option of the call) instead of overflowing the stack; a program that
  validates deeper graphs passes a larger `maxDepth`.
- **A struct rejects an array** (see Fixed), and **the synchronous `check` and `parse` throw
  `ERR_ASYNC_VALIDATOR`** for a validator, a custom `checkType` or a decoder that returns a
  promise: use `checkAsync` and `parseAsync`.
- **Definitions that could never work are errors now:** an `object` or `map` without a key type
  of `'string'` or `'number'` (`ERR_INVALID_DEFINITION`), a `default` on the discriminator field
  of a union (`ERR_INVALID_UNION`). `maxErrors` must be a whole number (or `Infinity`).
- **The `validate`, `parse` and `serialize` of a nested struct are not keys of the value.** A
  value carrying `inner: { parse: ... }` was accepted under `unknown: 'reject'` and kept under
  `strip`; the key is `unexpected`, as it is at the root.
- **`compile()` reports what stopped the JIT:** `{ accelerated: false, error }` where a check
  could not be generated (the `ERR_JIT_BUILD` error, the generator's error as its `cause`), and
  `compile(target, { jit: false })` puts the closures back.
- **The generators moved to `@alexify/metaschema/generators`.** `model.dts`,
  `schema.toInterface()` and `saveTypes` are no longer in the core entry: the subpath exports
  `toTypeScript(target, options)` (a `Schema` or a `Model`), `saveTypes(outputFile, target,
  options)` and `toJSONSchema(target, options)`, and its `register()` installs the methods on
  the classes (`model.dts`, `model.toTypeScript`, `schema.toInterface`, `schema.toJSONSchema`,
  `model.toJSONSchema`) once per process. Replace `model.dts` with `toTypeScript(model)` or call
  `register()` at startup; import `saveTypes` from the subpath. The core entry no longer carries
  the generators (4.5 KB min+gzip in the subpath) nor any Node runtime; the browser entry is the
  same.

### Added

- **`parse`.** `schema.parse(value, options)` validates a value and builds the value of the
  program from it: `{ valid, value, issues }`, where `issues` is always an array and `value`
  is `undefined` for an invalid value. The pipeline is the `default` of every missing or
  `undefined` struct key (a value, or a function called on every parse, at any depth: nested
  structs, the elements of collections, the records a reference embeds), the check of the
  schema (whichever backend installed it: the passes validate nothing, so a compiled schema
  parses through its generated code), `unknown: 'strip'` (a third policy, of `parse` alone:
  the keys the schema does not have are accepted and left out of every struct of the output),
  the `parse` function of every field on its validated value, from the parts of a value up to
  the value (elements before the collection, the fields of a nested struct before its own
  `parse`, an embedded record through its entity), and the schema's own `parse` last. A
  decoder's exception is an `exception` issue at the field and makes the result invalid.
  `default` is applied by `parse` only: `check` still reports a missing required key. The value
  given is never written to, and it is the output itself when nothing was applied; otherwise
  the containers on the way to a change are new and the rest is shared. The options are those
  of `check`, with `unknown` also `'strip'`.
- **`serialize`.** `schema.serialize(value, options)` is the other direction: the schema's own
  `serialize`, then the `serialize` function of every field from the value down to its parts,
  through the same collections, tuples, nested structs and embedded references; `{ value }`
  without validation, or `{ valid, value, issues }` with `options.check`, the other options
  being those of `check`. `format` stays collected and uncalled. `parse` and `serialize` are
  known keys of every field for the lint, and a non-function one is `ERR_INVALID_DEFINITION`.
- **`checkAsync` and `parseAsync`.** A `validate` function (of a field or of the schema), a
  custom type's `checkType` and a decoder may return a promise. The walk of the value is
  synchronous; a validator that returns a promise is set aside with its path, and every
  validator met after it with it, so that a validator still runs only when nothing under it
  failed; after the walk they are settled one after the other, in field order, each recording
  at its path, and `maxErrors` stops the list. The synchronous `check` and `parse` throw a
  `TypeError` with the new code `ERR_ASYNC_VALIDATOR` for such a promise (`RuntimeErrorCode`
  in the typings). Both backends go through the same helper, so the JIT needed no change.
- **Typings for parse.** `InferOutput<D, E>` is the type of the value `parse` gives: `Infer`
  with the result of every `parse` function (`Awaited`) in place of the value it decodes and
  every defaulted key present (`null` stays where the key was optional); `ParseResult<T>`,
  `ParseOptions`, `SerializeOptions`, `Serialized<T>` and `SerializeChecked<T>` type the new
  methods, `FieldType` declares `parse`, `serialize` and `default`, and `Validator` and
  `TypeEntry.checkType` may return a promise.
- **The JIT backend.** `compile(target, options)` of the new `@alexify/metaschema/compile`
  subpath replaces the check of a schema, or of every entity of a model, with one straight-line
  function generated from the plan the closures walk and built with `new Function`; it records
  exactly the issues the closures record (codes, paths, params, order and messages) and returns
  `{ accelerated }`. `register(options)` compiles every schema built from then on (a later call
  replaces the options, `{ jit: false }` stops it; a schema built before is not touched), and
  `canEval()` says whether the environment allows code generation from strings. The `jit`
  option is `'auto'` (the default: where `new Function` is not allowed, under a Content
  Security Policy, in Cloudflare Workers or under `node --disallow-code-generation-from-strings`,
  the closures stay silently), `true` (throw `SchemaDefinitionError` with the new code
  `ERR_NO_EVAL` instead; `register` throws at the call) or `false` (never generate code).
  Nothing happens on import. The generated source holds identifiers, numbers, booleans and JSON
  strings only; regular expressions, enum sets, validate functions, custom types, references and
  the issue constructors reach it through a scope. Structs, every scalar with its rules, enums,
  collections, tuples, unions, `nullable` and optional fields and the limits of a check are
  inlined; a reference, a custom type's `checkType` and a `validate` function are the same
  calls as before. Measured on Node 24 (`bench/baseline.json`): 30.0 M checks a second of a flat
  struct (10.4 M on the closures), 17.4 M of a nested one (2.5 M), 5.6 M for a flat value with
  four problems (3.4 M), 24–33 M on the moltar scenarios (4–7 M). The subpath is 3.9 KB min+gzip
  on top of the core and
  has typings of its own (`CompileOptions`, `Compiled`); the core gains one internal slot,
  `Schema[Symbol.for('alexify.metaschema.hook')]`, that `register()` fills.
- **JSON Schema export.** `toJSONSchema(schema, options)` of the generators subpath renders the
  rules of `check` as a JSON Schema document and `toJSONSchema(model, options)` every entity of
  a model as a definition (`$defs`, `definitions` or `components.schemas` by target), or the
  document of `options.root`. Targets: `draft-2020-12` (the default), `draft-07`, `openapi-3.0`
  (a schema object: `nullable`, no type lists, `oneOf` with `discriminator` for a discriminated
  union) and `mongodb` (a `$jsonSchema` validator: `bsonType`, references inlined, no `$ref`,
  `format` or `default`, `_id` allowed at the root). A struct is a closed object with its
  required keys (open when the root says `unknown: 'ignore'`), an optional or nullable field
  accepts `null`, `length`/`pattern`/`min`/`max` are the matching keywords, a required
  `object` or `map` has `minProperties: 1` as `check` requires, a tuple is `prefixItems` (an
  `items` list before 2020-12), a union is `anyOf`, an enum of one value is `const`, and a
  reference follows the kind of its target (an id for a stored kind, a `$ref` for a memory
  kind; `references: 'kind' | 'embed' | 'id'` as in `check`). `title`, `description`,
  `default`, `examples` and `deprecated` pass through where the dialect has them; a custom type
  renders through `metadata.jsonSchema` (`metadata.bson` for mongodb) or the built-in it
  aliases. `io: 'input'` (the default) describes the JSON a value is parsed from (a `date` is a
  `date-time` string, a `set` an array of unique items, a `map` an object); `io: 'output'`
  describes the value itself, where those three have no form. What has no form in the target
  (`bigint`, a tuple for openapi-3.0, a cycle for mongodb, a custom type without metadata)
  throws `SchemaDefinitionError` with the new code `ERR_UNREPRESENTABLE`, located in the
  schema and the field, or renders as `{}` with `unrepresentable: 'any'`. `validate`
  functions, custom `checkType`s, calculated fields, indexes and kind metadata are not
  exported.
- **The strict profile.** `toJSONSchema(schema, { profile: 'strict' })` renders the dialect of
  LLM structured outputs (OpenAI, Anthropic): an object at the root, every property listed as
  required (an optional one as `['T', 'null']`, an optional `$ref` as an `anyOf` with null),
  `additionalProperties: false` on every object, and the structure only: `minLength`,
  `maxLength`, `pattern`, `minimum`, `maximum`, `minItems`, `maxItems`, `uniqueItems` and
  `minProperties` are left out, and a value without a type (`any`, `json`, an `object` or
  `map` of free keys) has no form. For the `draft-2020-12` and `draft-07` targets.
- **Standard JSON Schema.** After `register()` of the generators, `schema['~standard'].jsonSchema`
  is the converter of the specification: `input(options)` and `output(options)` are
  `toJSONSchema` for the `target` the consumer names (`draft-2020-12`, `draft-07` or
  `openapi-3.0`; anything else throws, as the specification asks) with `libraryOptions` as the
  other options. A `Schema<D>` is a `StandardJSONSchemaV1<Infer<D>, Infer<D>>`; the typings
  add `StandardConverter` and `StandardJSONSchemaOptions`.
- **JSDoc and named types in the generated TypeScript.** The `description` of a field is the
  JSDoc of its member and `deprecated: true` adds `@deprecated`. `toTypeScript(target, { named:
  true })` gives every enum a `type` and every nested struct an `interface`, named after the
  entity and the field (`type UserRole`, `interface UserName`) and rendered before the
  interface that uses them; `saveTypes(file, target, options)` passes the options on.
  `InterfaceOptions` is the type of the options.
- **`maxDepth`.** An option of `check`, `checkAsync`, `parse`, `parseAsync` and `serialize`
  (an integer of at least 1, 128 by default): how deep a value may nest through embedded
  references. A record past that depth is a `depth` issue (`{ max }` as params, `is nested
  deeper than 128 references`, rendered by both locales) instead of a `RangeError` from the
  stack; the passes of parse leave the record as it is for the check to report. The type
  `IssueCode` has `'depth'`.
- **`compile()` returns `{ accelerated, error }` and `register()` takes `onFallback`.** In the
  default mode a check that could not be generated keeps its closures and the reason comes
  back as `error` (a `SchemaDefinitionError` with the new code `ERR_JIT_BUILD`, the
  generator's error as its `cause`), or reaches `register({ onFallback(schema, error) })` for
  every such schema; with `jit: true` that error is thrown and nothing of a model is installed.
  `compile(target, { jit: false })` restores the closures a schema was built with. The
  generated source is strict and ends with a `sourceURL` named after the schema, so a stack
  trace through a compiled check names it.
- **Typings** for the generators: `JSONSchema` (`Record<string, unknown>`), `JSONSchemaOptions`,
  `ModelJSONSchemaOptions`, `JSONSchemaTarget`, `InterfaceOptions` in the core,
  `src/generators/index.d.ts` for the subpath, and `ERR_UNREPRESENTABLE` in
  `DefinitionErrorCode`. The methods `register()` installs are declared on `Schema` and `Model`.

### Changed

- **The core entry is 16.1 KB min+gzip** (2.0 was 12.6 KB: the TypeScript generator left it,
  3.9 KB; the array check of a struct and the hook of the compile subpath joined it; `parse`,
  `serialize` and the async calls added 3.1 KB, in the core rather than a subpath because
  `~standard.validate` is `parse` and every schema is a Standard Schema; the fixes of the
  review below, `maxDepth` and the lazy cycle set added about 1 KB and the loops, the shared
  tables and the trims gave 0.3 KB back), the generators subpath adds 4.5 KB and the compile
  subpath 3.9 KB. CI gates at 17 KB per core entry, 5 KB for the generators and 4 KB for the
  compile subpath (`pnpm size --max-gzip 17 --max-gzip-generators 5 --max-gzip-compile 4`).
- **Fewer allocations on the hot path.** The root value joins the cycle set only when a record
  is actually embedded (a check of an entity with references in the storage view allocated a
  `Set` each time); a validator or a custom `checkType` is called without a closure made per
  call, and the params of a failing `checkType` are built only when it fails; the pass over an
  `object` field iterates its own keys instead of allocating `Object.entries`; the trial that
  picks the branch of a plain union in `parse` uses one scratch context per parse instead of
  one per union value; the length of a value is measured by what the value is (an object with a
  `size` key is an object) and an object's keys are counted without listing them; the
  discriminator table of a union is built once and shared by the check, the passes and the JIT.
- **Loops instead of `forEach`, `map` and spreads** wherever a pass could be saved or a closure
  or a list per call avoided, and null-prototype dictionaries wherever a definition key or a
  code a validator makes up is looked up (the schema's `indexes` and `options`, the metadata of
  a type, the rule formatters, the parsers, the locale tables).

### Fixed

- **A struct rejects an array.** `check` accepted `[]` for a struct whose fields are all
  optional (`typeof [] === 'object'`, no keys to look at) and reported the missing keys of
  any other struct; an array is now `not of expected type: object`, whatever the fields.
  Found by the differential test against ajv.
- **A failed branch of a plain union left its deferred validators behind** in `checkAsync` and
  `parseAsync`, so a value that matched a later branch was reported invalid by the validators
  of a branch it did not match. Both backends drop them with the issues of the branch. A plain
  union picks the first branch whose synchronous checks pass; an async validator of that branch
  settles after the walk and may still fail the value, but no further branch is tried: use a
  `discriminator` where branches carry async validators.
- **A thenable in the data was taken for a promise.** Under `unknown: 'strip'`, and at a field
  with a decoder, any value with a `then` function was awaited: a synchronous `parse` returned a
  `Promise` as the valid value, and `parseAsync` ran the `then` of the data, which could replace
  the value. Only a `Promise` instance made by a decoder in an async parse is pending now, and
  the promises of the passes resolve to a box around the value, so a field called `then` is
  never adopted.
- **Unhandled rejections.** The synchronous `check` and `parse` threw `ERR_ASYNC_VALIDATOR` and
  dropped the promise; `settle` stopped at `maxErrors` before the promises it held; the trial of
  a union branch in `parseAsync` set validators aside it never ran. Every such promise is
  observed before it is left behind.
- **Async decoders respect `maxErrors`**, and the trial of a plain union branch in `parse` runs
  under the path and root of the parse (a validator met in it saw `"n"` instead of
  `"Doc.u.n"`), tolerates an async validator (`serialize` threw `ERR_ASYNC_VALIDATOR` for one
  inside a union with a serializer) and uses one context per parse.
- **`compile(target, { jit: false })` returned `{ accelerated: false }` and left the generated
  check installed;** it restores the closures. With `jit: true` a model is compiled all or
  nothing. An `object` or `map` without a valid key type made the JIT fail with a raw
  `TypeError` at construction under `register({ jit: true })`; the definition is rejected when
  the field is built.
- **The `validate`, `parse` and `serialize` of a nested struct were keys a value could carry**
  (see Upgrading). A calculated field declared as `'x?'` is stored under `x`.
- **`toJSONSchema`** lost a field called `__proto__`, wrote the segments of the `definitions`
  pointer onto the document the same way, left the name of an entity unescaped inside a `$ref`
  (RFC 6901: `A/b~c` is `#/$defs/A~1b~0c`), looked renderers up on a plain object (a custom type
  called `constructor` resolved to `Object`), pushed the null branch into the `anyOf` of a custom
  type's metadata on every export, and copied `deprecated: 'a note'` through (a boolean in every
  dialect). The `definitions` pointer merges into an object already on its path.
- **`toTypeScript`** wrote keys that are no identifiers bare (`a-b: string;`), let `*/` in a
  `description` close the JSDoc, dropped the note of a `deprecated` string (it is
  `@deprecated <note>` now), gave two nested types one name (`aB` and `AB` both `TAB`; the
  second is `TAB2`, and a nested type never takes the name of an entity of the model),
  stringified `NaN` and BigInt enum values through JSON (`number` and `10n` now), rendered an
  entity or an embedded reference whose name is no identifier (`ERR_UNREPRESENTABLE` now), and
  declared the alias of a one-type schema twice under `named`. `saveTypes` rejects instead of
  throwing, as its typing says.
- **An object with a `size` or `length` key was measured as a collection** by the `length`
  rule; a value is measured by what it is.
- **A validator's own code could break the rendering:** a code such as `'constructor'` or
  `'__proto__'` is rendered with the validator's message; what a validator throws or returns is
  rendered whatever it is (a symbol, an object without a prototype).
- **An index or a top-level option called like a method broke construction** (`indexes` and
  `options` were instances with an `extract` method); they are dictionaries. The metadata of a
  type is a dictionary too, so `__proto__` is a key of it.
- **`schema['~standard']` kept the first answer of `hasAsync`** after `attach` or `detach`; the
  props are rebuilt. **`schema.validate(value, path)`** ran the schema-level function without
  the schema as `this` and turned a promise into `"[object Promise]"`; it throws
  `ERR_ASYNC_VALIDATOR` for a promise. **`maxErrors: 1.5`** gave two issues and a bigint broke
  the option's error message.

### Removed

- `model.dts`, `schema.toInterface()` and `saveTypes` from the core entry: they are in
  `@alexify/metaschema/generators` (see Upgrading).

### Tooling

- `forEach` and `reduce` are lint errors everywhere oxlint runs (`no-restricted-properties`),
  `no-var` and `object-shorthand` errors rather than warnings; lint and format cover `index.js`
  and `browser.js`; `check:dts` compiles the typings of the generators and compile subpaths;
  `ci-success` fails on a skipped job; `pnpm bench --compare --fail-under=<percent>` exits
  non-zero on a scenario slower than the baseline by more than that.
- New tests: the async union, thenable data, the unhandled rejections (through an
  `unhandledRejection` listener), the union trial's path, `maxDepth` over a 3000-level chain on
  both backends, `jit: false` and the atomic model compile, the compile `error`/`onFallback`,
  the strict source, the key type of collections, the nested codec keys, the generator
  hardening cases (`__proto__` fields, odd `definitions` pointers, escaped `$ref`s, shared
  metadata, quoted keys, JSDoc, name collisions), `lengthOf` on objects with `size` keys,
  dictionaries called like methods, codes a validator makes up, and `maxErrors` as a whole number.
- `pnpm bench` has `parse — flat struct, valid`, `parse — nested struct, valid` and `parse —
  flat struct, defaults and a decoder` on both backends, measured as `check` is (through a
  megamorphic call site); `bench/baseline.json` is re-saved, and the performance guide quotes
  the rows.
- New test suites `parse`, `serialize` and `async`, the Standard Schema suite extended for
  `validate` as parse and for a promise, the compile suite holding `parse`, `parseAsync`,
  `checkAsync` and `serialize` to the same results on both backends, the bundle test running
  them through the minified bundles, and `tests/types/parse.test-d.ts` for the typings; all
  under `test`, `test:jit` and `test:nojit`.
- `pnpm run test:jit` runs the whole suite with every schema compiled by the JIT
  (`tests/helpers/jit.js` registers it before the suites) and `pnpm run test:nojit` the same
  under `--disallow-code-generation-from-strings`, through the fallback; CI runs both on Node
  22. `tests/unit/compile.test.js` holds the two backends to the same issues over every form of
  the language, the fixture model, every check option and keys and values that look like code,
  and covers the modes, the errors, `register()` and the no-eval environment in a child process;
  `tests/types/compile.test-d.ts` pins the typings. The bundle test, the export-parity test and
  the size script (`pnpm size --max-gzip-compile`) cover the subpath; the ajv differential test
  is skipped where ajv cannot generate code.
- **The moltar scenarios of `pnpm bench` measure a struct now.** The first key of their schema,
  `number`, made it a `number` field under the first-key rule of 2.0, so every check failed at
  the root, and the 14 M ops/s the 2.0 notes quoted for those rows measured that; marked as a
  struct, the closures do 7.1–7.4 M (flat) and 4.2–4.4 M (nested). Every `check` scenario runs
  on both backends (`check (jit) — …`), and `pnpm bench --compare-libs` runs the moltar
  scenarios through zod 4, valibot, ajv and @sinclair/typebox (devDependencies, `bench/libs.js`);
  the tables are in the performance guide, and `bench/baseline.json` is re-saved.
- `ajv` and `ajv-formats` are devDependencies, used by `tests/unit/jsonschema-ajv.test.js`: for
  values a deterministic generator produces from the schemas (every form of the language, the
  fixture model, references by kind, embedded and as ids), `check` and ajv over `toJSONSchema`
  must agree on every verdict, for draft 2020-12 and draft-07. The known differences (UTF-16
  units against code points, instances on the output side, number keys) are documented in the
  file and in the guide.
- New test suites: `generators` (the subpath: the functions, `register()`, the core without it),
  `jsonschema` (every form by target, the strict profile, the mongodb target, the fixture model,
  the Standard converter), `jsonschema-ajv`, `dts` (JSDoc and named types),
  `tests/types/jsonschema.test-d.ts`; the bundle test builds the core entry with the subpath,
  the export-parity test covers the subpath, `pnpm size` reports the generators on top of the
  core.

## [2.0.0] - 2026-10-10

2.0 rewrites the validation core and settles the semantics of the schema language. Every check
is compiled into a closure when the schema is built and runs in a context of its own; issues
are data (a code, the path as an array of keys, the params the message is made from), messages
are rendered through a locale at the end of a check, and `check` takes an options object. The
first key of a definition decides what it is, numbers are bounded by `min` and `max`, a
reference follows the kind of its target, and `integer`, `date`, `null`, `any`, `union`,
`nullable` and `pattern` join the language. TypeScript infers the type of a value from the
definition (`Infer`), and every schema is a Standard Schema. Everything that changes the shape
of a result or the meaning of a definition is listed under Upgrading; the rest is additive.

### Upgrading from 1.x

The same guide with before-and-after examples is
[Migrating from 1.x](https://metaschema.vercel.app/guide/migrating-from-1).

**Validation**

- **`check(value, path, options)` → `check(value, options)`.** The root label of the error
  lines is `options.root`: `schema.check(value, 'body', { maxErrors: 1 })` becomes
  `schema.check(value, { root: 'body', maxErrors: 1 })`, and a string in place of the options
  throws a `TypeError` that says so. The options are `root`, `maxErrors`, `unknown`,
  `references` and `messages`.
- **`issue.path` is an array of keys** (`['tags', 1, 'name']`, what Standard Schema expects),
  not a string, and it never includes the root. `issue.message` describes the problem without
  its location (`is required`) and `issue.params` carries what it was made from
  (`{ expected: 'number', received: 'string' }`); the line with the location is
  `result.errors[i]` (`Field "User.name" is required`), rendered on first use. A key that is
  not an identifier is bracketed (`o["a.b"]`, was `o.a.b`) and a tuple element is addressed by
  index (`point[1]`, was `point(item1)` or `point(y1)` for a named element). A `validate`
  function may return `{ code, message, path, params }` of its own; its `path` (a key or an
  array of keys) is relative to the field (`{ message, path: 'x' }` on `a` reports `a.x`; 1.x
  ignored it).
- **Unknown keys are one issue per struct**: `{ code: 'unexpected', params: { keys } }` at the
  path of the struct, rendered as `Field "" has unexpected keys: b, c` (was one
  `Field "b" is not expected` per key), and `maxErrors` counts them as one.
  `check(value, { unknown: 'ignore' })` accepts them, and `{ Form: { unknown: 'ignore' }, ... }`
  makes that the default of the schema.
- **A type failure cancels the rules and `validate` of the field.** A field is checked in the
  order type, rules, `validate`, each step only when the one before it passed; 1.x reported
  `not of expected type: string`, the `length` message and the validator's message together.
  The schema-level `validate` runs after the fields and only when every field passed (it used
  to run first, and always).
- **`new ValidationResult(path)` → `new ValidationResult(options?)`** (`{ root, messages }`). A
  result a `validate` function returns is relative to its field, so build it with no arguments
  and `add` messages. `ValidationResult.format` is gone;
  `ValidationResult.issuesOf(error, path?, code?)` takes the path as keys.
- **Cycle detection lives at references.** A value that refers back to itself is reported as
  `circular` where a reference (`'Category'`, `{ many }`) meets it again, as before; a schema
  without references cannot recurse, so such a value is walked as far as the schema goes and
  reported for what it is (unexpected keys, wrong types, or nothing) instead of as `circular`.
- **The tuple length message** is `exceeds the maximum length` with `params: { max, actual }`
  (was `value length is more than expected in tuple`). The wording of every other message is
  unchanged.
- **Warnings carry a code**: `Warning [missing-reference]: "Customer" referenced by "Order" is
  not found` (was `Warning: "Customer" ...`), `Warning [recursive-reference]: ...`, and the new
  lint adds `unknown-option`, `unbounded-pattern` and `missing-index-field` to `model.warnings`,
  which is computed on first use.
- **`field.check(value, context, key)`** is the compiled check of a field and records into the
  context of a check; call `schema.check`. `compile` joins the reserved keys of a field
  definition (`ERR_RESERVED_KEY`).

**The schema language**

- **The first key of an object decides what it is.** The long form is read only when `type` is
  the first key; a capitalized first key is a kind, a type name is that type's shorthand, and
  any other first key is a nested struct. `{ name: 'string', type: 'string' }` is a struct with
  two fields (1.x read it as a string); `{ required: false, type: 'string' }` throws
  `ERR_INVALID_DEFINITION`. A struct whose first field is called `type`, or named like a type
  (`date`, `null`, `any`, `unknown`, `integer` and `union` are type names now), needs a kind
  (`{ Struct: {}, ... }`) or the `schema` shorthand; `schema.warnings` reports the options such
  a struct would otherwise leave on the type.
- **`length` on a number is an error.** `number`, `bigint` and the new `integer` are bounded by
  `min` and `max`: `{ type: 'number', length: [18, 120] }` becomes
  `{ type: 'integer', min: 18, max: 120 }`. A `length` there throws `ERR_INVALID_RULE` with
  that hint, and a failed bound is a `range` issue (`is greater than 120`), not `length`
  (`exceeds the maximum length`). Every type lists the rules it accepts, so `min` on a string
  or `length` on a boolean throws too; a custom type opts in with `rules: [...]`, and an alias
  takes the rules of its base. A `length` whose `min` is above its `max` throws
  `ERR_INVALID_LENGTH` (1.x accepted it).
- **A reference follows the kind of its target.** A reference to a stored kind (`Entity`,
  `Registry`, ...) validates as an id (`employer: 'c1'`, `addresses: ['a1']`) and a reference
  to a memory kind (`Struct`, `Form`, ...) as the record; 1.x always expected the record and
  rejected an id as `not of expected type: object`. Validate a whole graph with
  `check(value, { references: 'embed' })`, rows with `{ references: 'id' }`, or fix one field
  with `embed: true`/`false`. An id never recurses, so a cyclic value through stored kinds is a
  type error, not `circular`. The generated TypeScript follows the same rule, so a memory-kind
  reference renders as its interface (`label: Tag`) instead of `labelId: string`.
- **`set` renders as `Set<T>`** in the generated TypeScript (it was `T[]` while `check`
  accepted only a `Set`; `map` was already `Map<K, V>`).
- **The `relations` labels are swapped** to the conventional direction, read from the
  referencing side: a `many` field is `'one-to-many'` and a single reference `'many-to-one'`.
- **A tuple element may be any definition**, not only a scalar. `[{ x: 'number' }]` is still a
  named number (one key holding a type name); `[{ x: 'number', y: 'number' }]` is a struct
  element (1.x read it as the named number `x` and reported `t(x0)`). `ERR_INVALID_TUPLE` is
  for a definition that is not an array or an element that is a function.
- **A `Schema` instance as a field keeps its schema-level `validate`** in every form (bare,
  `{ schema }`, the long form); 1.x dropped it, so a value that passed may now fail.

**Tooling**

- **The typings need TypeScript 5.0 or later.** `Schema` is generic over its definition
  (`Schema<D>`, a const type parameter); `Schema` written on its own is still any schema, and
  `Model.entities` is still a `Map<string, Schema>`.
- **The bundle is 12.6 KB min+gzip** (1.0 was under 8 KB), and CI gates at 13 KB.

### Added

- **Static inference.** `Infer<D>` is the TypeScript type of a value `check` accepts for the
  definition type `D`, over every form of the language: scalars (`integer` → `number`, `date`
  → `Date`, `json` → `unknown`), `'?T'`, `'key?'` and `required: false` as optional properties
  that accept `null`, `nullable: true` as `T | null`, the long form, `array`/`set`/`object`/`map`,
  `enum` as a union of literals, tuples (named elements included), nested structs, `schema`
  and `Schema` instances, `union`, and references as ids (`string`, `string[]`). A kind key,
  index definitions, calculated fields and the schema-level options are not fields. `Schema` is
  `Schema<D>` with a const type parameter, so `Schema.from({ ... })` keeps the literal types of
  an inline definition and `InferSchema<typeof schema>` reads them; a definition declared apart
  needs `as const`. `Infer<D, E>` takes an entity map and resolves a reference to a memory kind
  (or `embed: true`) as the record and a projection as its parent's fields;
  `InferEntity<E, 'Name'>` adds the id field of a stored kind. Custom types are declared for
  inference through module augmentation of `CustomTypes`; an unknown name infers as `unknown`.
- **Standard Schema v1.** Every `Schema` exposes `schema['~standard']`
  (`{ version: 1, vendor: 'alexify.metaschema', validate }`), the interface tRPC, TanStack Form,
  Hono and the other consumers of [standardschema.dev](https://standardschema.dev) accept
  without an adapter. `validate(value)` is `check(value)` read as the specification does:
  `{ value }` (the same reference) or `{ issues }`, the issues of the result themselves
  (`message` and an array `path`, plus `code` and `params`); the `libraryOptions` of a call are
  the options of `check`. The accessor lives on the prototype and stays out of `toJSON` and
  `Object.keys`. The typings declare it as `StandardProps<D>` (with `StandardResult<T>` and
  `StandardOptions`), and a `Schema<D>` is a `StandardSchemaV1<Infer<D>, Infer<D>>` of
  `@standard-schema/spec`, which the package does not depend on.
- **New built-in types.** `integer` (`Number.isInteger`), `date` (a `Date` with a valid time),
  `null`, `any` and `unknown` (one type under two names, differing in the TypeScript they
  render), and `union`: `{ union: ['string', 'number'] }` keeps the first branch that reports
  nothing; `{ union: [...], discriminator: 'kind' }` picks the branch from an enum field in one
  lookup, built when the schema is built, and reports an unknown value as one `union` issue at
  the discriminator's path. A definition that cannot discriminate throws `ERR_INVALID_UNION`.
- **`nullable: true`**: a required key whose value may be `null`, apart from optional (`'?type'`,
  `undefined` or `null`). It applies to any type, skips the rules and `validate` for `null`,
  and renders as `T | null`.
- **`min` and `max`** for `number`, `integer` and `bigint`, as numbers or bigints compared
  exactly (never through `Number`), with the `range` issue `{ min, max, actual }`.
- **`pattern`** for strings, a string or a `RegExp` compiled once with the `u` flag (and without
  `g`/`y`), with the `pattern` issue `{ pattern }`; the validation guide has a section on ReDoS.
- **`unicode: true`** measures a string's `length` in code points instead of UTF-16 units.
- **The unknown-keys policy as metadata**: `{ Form: { unknown: 'ignore' }, ... }` is the default
  of that schema's `check`; the option of a call still wins.
- **`check` options** `root`, `maxErrors`, `unknown` (`'reject'` | `'ignore'`), `references`
  (`'kind'`, `'embed'`, `'id'`) and `messages`, validated when the check starts, and the field
  option `embed` on a reference.
- **Issues with params.** `result.issues` is `{ code, path, message, params }`:
  `type { expected, received }` (plus `key` for a wrong key type in an `object` or `map`),
  `unexpected { keys }`, `enum { values }`, `length { min, max, actual }`,
  `range { min, max, actual }`, `pattern { pattern }`, `union { expected, discriminator }`,
  `reference { entity }`, `exception { error }`.
- **Locales.** Messages are rendered once, at the end of a check, from the code and params of
  each issue through `options.messages`: a locale table (partial tables fall back to English) or
  a function. English is built in, Ukrainian is exported as `@alexify/metaschema/locales/uk`
  (and English as `@alexify/metaschema/locales/en`).
- **`result.summary`, `result.flatten()` and `result.tree()`** for CLIs and forms, and
  `result.errors` as a lazy view rendered on first use.
- **Definition lint.** `schema.warnings` reports an option the field's type does not read
  (`unknown-option`; `default`, `unique`, `index`, `primary`, `title`, `description`, `examples`
  and `deprecated` are known annotations), a `pattern` without `length.max`
  (`unbounded-pattern`) and an index over a missing field (`missing-index-field`);
  `model.warnings` adds `missing-reference`, `missing-type` and `recursive-reference`. Both are
  computed on first use.
- **Definition error codes** `ERR_INVALID_RULE` and `ERR_INVALID_UNION`.
- **Types**: `Infer`, `InferSchema`, `InferEntity`, `CustomTypes`, `StandardProps`,
  `StandardResult`, `StandardOptions`, `IssueParams`, `IssueOf<Code>`, `Locale`, `Messages`,
  `ResultOptions`, `FlatIssues`, `IssueTree` and `CheckContext`; `ValidationIssue` is a union by
  code; `FieldType.nullable` and `embed`, `Schema.unknown` and `warnings`,
  `CheckOptions.references` and `KindMetadata.unknown`.
- **Benchmarks**: the four modes of the typescript-runtime-type-benchmarks suite (`parseSafe`,
  `parseStrict`, `assertLoose`, `assertStrict`) over its object, flat and nested, next to the
  `check`, `Schema.from` and `Model` scenarios.

### Changed

- **Validation is compiled.** `createStruct` builds a frozen plan and a dictionary of known keys
  and compiles the struct check as an index loop over the plan; every field's `check` is a
  closure chosen when the field is built (one `typeof` for a scalar without rules, a `Set` for
  an `enum` with more than eight values, `Map` and `Set` iterated directly, `object` through
  `for...in`, a lookup plus cycle tracking for a reference), and `Object.hasOwn` is consulted
  only for a required field set to `undefined` or a field named after a member of
  `Object.prototype`. A check runs in a context of its own
  (`{ issues, count, limit, path, seen, unknown, references, root, messages }`) instead of
  module globals, so two checks can no longer interfere and a validator may run another check.
  On the benchmark of the repository (Node 24, the same machine) `check` goes from 2.1 M to
  10.7 M ops/s for a valid flat value and from 0.87 M to 3.5 M for an invalid one, nested from
  0.33 M to 2.7 M; construction stays where it was. See
  [Performance](https://metaschema.vercel.app/guide/performance).
- **Generated TypeScript** follows the language: `integer` → `number`, `date` → `Date`, `null`,
  `any`, `unknown`, a `union` as `A | B`, a nullable field as `T | null`, a `set` as `Set<T>`, a
  reference by the kind of its target (see Upgrading).
- **Construction** reads the first key of a definition once, re-parses a projection's fields
  from their definitions so the copies belong to the projection, and lints on first use of
  `warnings`.

### Removed

- **The positional root path of `check`** and **`ValidationResult.format`** (see Upgrading).
- **`length` on `number` and `bigint`**, replaced by `min` and `max` (see Upgrading).
- **Module-level validation state.** Nothing in the package is global to a check any more; the
  type registry is still process-wide, as before.

### Fixed

- **A `Schema` instance used as a field lost its schema-level `validate`** (see Upgrading).
- **A `length` whose `min` is above its `max`**, which could never pass, is rejected when the
  schema is built instead of failing every value.
- **A `bigint` bound is compared exactly.** `length` on a `bigint` went through `Number` and
  lost precision past 2^53; `min` and `max` compare a bigint bound as a bigint.

### Tooling

- `pnpm size --max-gzip 13` is the CI gate (the entries are 12.6 KB min+gzip).
- `pnpm bench` reads the clock once per hundred calls and calls `check` through a megamorphic
  site, so it is measured as a callee instead of being inlined into the measuring loop;
  `bench/baseline.json` is the snapshot of this branch.
- `@standard-schema/spec` is a devDependency, used only by `tests/types/standard.test-d.ts`.
- New test suites: `context`, `issues`, `result`, `check-options`, `syntax`, `numbers`,
  `pattern`, `nullable`, `values`, `union`, `references`, `lint`, `standard`, and
  `tests/types/infer.test-d.ts`, which also compiles the examples of the TypeScript guide.

## [1.0.0] - 2026-10-09

The first release of `@alexify/metaschema`. It is a fork of
[`metaschema`](https://github.com/metarhia/metaschema) 2.2.2. The schema language and the
validation semantics are unchanged. The package around them now follows the other Alexis
libraries: zero runtime dependencies, one package for Node.js and browsers, and typings that match
the runtime.

### Upgrading from metaschema 2.x

Replace `metaschema` with `@alexify/metaschema`, then follow
[Migrating from metarhia](https://metaschema.vercel.app/guide/migrating-from-metarhia). The
breaking changes are the removed loader functions, the renamed `detouch`, the `exports` map,
`SchemaDefinitionError` for every broken definition, and the corrected and more precise
validation messages listed under Changed and Fixed.

### Added

- **`SchemaDefinitionError`.** Every broken definition throws this `TypeError` subclass with a
  `code` (`ERR_UNKNOWN_TYPE`, `ERR_INVALID_DEFINITION`, `ERR_MISSING_SCHEMA`, `ERR_INVALID_ENUM`,
  `ERR_INVALID_LENGTH`, `ERR_INVALID_TUPLE`, `ERR_INVALID_REFERENCE`, `ERR_RESERVED_KEY`,
  `ERR_PROJECTION`, `ERR_INVALID_CUSTOM_TYPE`, `ERR_TYPE_REGISTERED`, `ERR_UNKNOWN_JS_TYPE`,
  `ERR_INVALID_OPTIONS`) and the `schema` and `field` it was found in, and the message says
  where: `Unknown type "strng" in "Order.total"`. Previously a model with many
  entities threw a bare `Error: Unknown type strng` with no hint of the entity or field, and a
  `null` field definition threw `Cannot read properties of null`.
- **Structured issues.** `result.issues` holds `{ code, path, message }` for every message, with
  the codes `required`, `type`, `unexpected`, `enum`, `length`, `reference`, `circular`,
  `exception` and `custom`, so a form, a logger or an i18n layer need not parse the text. A
  `validate` function may return `{ code, message }` objects of its own.
- **`check(value, path, { maxErrors })`** stops collecting at that many messages and stops walking
  fields, elements and records as soon as the limit is reached.
- **An isolated type registry per model.** `new Model(types, entities, database, { registry:
  'isolated' })` gives the model its own copy of the built-in types to register into, so two
  models with conflicting custom types can live in one process. The default, `'shared'`, is the
  process-wide registry as before.
- **Readable `console.log`.** A schema or a field printed with `util.inspect` shows its definition
  (`Schema(User) { name: { required: true, type: 'string' } }`) instead of the whole graph with
  `[Circular]` markers.
- **`ValidationResult`** is exported, so a `validate` function can build the result it returns.
  The typings describe it as the class it is, with `add` and `ValidationResult.format`, instead of
  a two-property interface.
- **`Schema#detach`**, the correctly spelt replacement for `detouch`.
- **Exported types** for everything public: `Kind`, `KnownKind`, `Scope`, `Store`, `Allow`,
  `Cardinality`, `Relation`, `Fields`, `FieldType`, `CalculatedField`, `TypeTable`,
  `TypeConstructor`, `TypeEntry`, `KindMetadata`, `SchemaOptions`, `ModelOptions`,
  `CheckOptions`, `Validator`, `ValidationReturn`, `ValidationIssue`, `IssueInput`, `IssueCode`
  and `DefinitionErrorCode`.
- **Documentation site** at [metaschema.vercel.app](https://metaschema.vercel.app/).

### Changed

- **Package name** is `@alexify/metaschema`, published from `Alexis-Technologies/metaschema`.
- **Browser entry.** `dist.js` is replaced by `browser.js`, which exports the same names as the
  main entry. `saveTypes` lives in `src/runtime/node.js`, and its browser twin rejects. Both the
  `browser` field and the `browser` export condition point bundlers to it.
- **ESM named imports** work: the root barrel lists every export by name, so
  `import { Schema } from '@alexify/metaschema'` resolves.
- **`Model`** accepts any iterable of `[name, definition]` pairs, not only a `Map`.
- **Paths and coverage of messages.** An unexpected key inside a nested struct carries the parent
  path (`Field "nested.field2" is not expected`, was `Field "field2"`); records of a `many`
  reference carry their index (`Person.companies[1].name`, was `Person.companies.name`); every
  element of a tuple and every record of a `many` reference is reported instead of only the
  first; and a wrong key type in an `object` or `map` reads `Field "o" keys must be of type string`
  (was `Field "o" In object "o": type of key must be a string`).
- **`model.dts` keeps the shape of every field.** Arrays and sets render as `T[]`, an `enum` as
  a union of its values, `bigint` as `bigint`, a tuple as `[number, number]`, `object` as
  `Record<K, V>`, `map` as `Map<K, V>`, a nested struct inline and `json` as `unknown`; before,
  everything but `string`, `number` and `boolean` was rendered as `string`. References still
  become ids and custom scalar types still render as `string`.
- **Validation is faster.** A field chooses its rule checks once when it is built instead of
  scanning the rule table on every check, arrays are walked in place, and a schema caches the type
  table of its namespaces: `check` runs about 1.7× faster on flat values and 1.5× on nested ones
  than the 2.2.2 code on the same machine (`pnpm bench`).

### Removed

- **Loading schemas from files and strings.** `createSchema`, `loadSchema`, `readDirectory` and
  `loadModel` are gone, together with the `metavm` sandbox they ran schema sources in. Pass schema
  objects to `Schema` and `Model` directly.
- **Runtime dependencies.** `metautil`, `metavm` and `metaskills` are no longer installed. The
  `metautil` helpers metaschema uses are copied into `src/metautil.js`.
- **Deep imports.** The `exports` map exposes only the package root.
- **`Schema#detouch`.** It is renamed to `detach`, with no alias for the old spelling.

### Fixed

- **Error messages.** Typos and grammar in validation messages are fixed, with no compatibility
  for the old text:
  - `Filed "..." is required` → `Field "..." is required`;
  - `Filed "..." is not a object` (and `is not a map`) →
    `Field "..." not of expected type: object` (and `map`), like every other type error;
  - `more then expected in tuple` → `more than expected in tuple`.
- **Optional nested structs in collections.** A nested struct marked `required: false` (long form,
  `{ type: 'schema', schema, required: false }`) was still required as an array, set, object or map
  element, so `null` elements were rejected. It is now optional there too, like `{ array: '?string' }`.
  Optional nested struct fields (`'key?'`, `required: false`) already worked and are unchanged.
- **Silent and misleading type registration.** `{ string: { js: 'number' } }` was ignored without
  a word, and both an unknown alias (`{ js: 'strng' }`) and an alias of a custom type registered
  earlier in the table failed with `Custom type must contain "construct" and "checkType" methods`.
  Redefining a registered name now throws `ERR_TYPE_REGISTERED` (the same definition, or a
  metadata-only entry, is still accepted, so one table can serve every model), an unknown `js`
  throws `ERR_UNKNOWN_JS_TYPE`, and `js` may name any type registered earlier in the table.
- **Reserved keys in a field definition.** `{ type: 'string', constructor: 'x' }` silently
  switched validation of that field off, `check: 'x'` broke `check` with
  `type.check is not a function`, and a `__proto__` key (as `JSON.parse` produces) failed with
  `typeFormatters[key] is not a function`. A key that names a method of the field (`check`,
  `checkType`, `construct`, `isInstance`, `toJSON`, `constructor`, …) or `__proto__`/`prototype`
  is now rejected when the schema is built (`ERR_RESERVED_KEY`).
- **A validator returning more than ~110,000 messages lost all of them.** `ValidationResult#add`
  spread them into `push`, which throws past the engine's argument limit, and `check` reported a
  single `validation failed RangeError` instead. Every message is kept.
- **`JSON.stringify` of a schema whose definition is a single type** (`Schema.from('string')`,
  `Schema.from({ array: 'number' })`) threw `Schema cannot be serialized`. It serializes like a
  field now, and `toString()` is `JSON.stringify(schema)`.
- **A `Schema` instance passed to `new Schema(name, instance, namespaces)` lost the namespaces**,
  so a prebuilt schema given to a `Model` could not resolve its references through the model. The
  instance is still returned as is, keeping its own name; the namespaces are attached, and a
  different `name` is a definition error.
- **A huge input key made a huge message.** Key names taken from the value under check are
  truncated to 100 characters in `is not expected` messages and nested paths.
- **Circular values.** A value that referred back to itself through a reference, a nested struct
  or a collection was walked until the engine threw `RangeError`, reported as
  `validation failed RangeError` at whatever depth the stack ran out, with a path thousands of
  segments long. It is now reported where the cycle closes:
  `Field "Category.parent" is a circular reference`.
- **Ordinary bad input reported as an internal error.** `null` for a required `object` field
  produced `validation failed TypeError: Cannot convert undefined or null to object`, an array was
  accepted as an `object`, and a number for a `many` reference produced
  `validation failed TypeError: source is not iterable`. They are now type errors like any other:
  `Field "o" not of expected type: object` and
  `Field "Person.companies" not of expected type: array of Company`.
- **Broken definitions that only failed inside `check`.** `{ type: 'enum' }` without values
  reported `validation failed TypeError: Cannot read properties of undefined` for every value;
  `length: 'abc'` was silently ignored; `length: { max: 0 }` was ignored too because `0` is falsy;
  `{ many: 5 }` was accepted; and a projection naming a field its parent does not have failed with
  `Invalid definition: "undefined" of type undefined`. Each is now a `SchemaDefinitionError` when
  the schema is built (`ERR_INVALID_ENUM`, `ERR_INVALID_LENGTH`, `ERR_INVALID_REFERENCE`,
  `ERR_PROJECTION`), and `length: { max: 0 }` works.
- **Tuple fields in the short form were never required.** `point: ['number', 'number']` left
  `required` undefined, so a missing `point` passed validation and `model.dts` rendered it as
  optional; only the long form `{ type: 'tuple', value: [...] }` was required. The short form is now
  required by default like every other field, and `'point?': [...]` makes it optional.
- **Field names `check`, `name`, `constructor` and other `Object.prototype` names.** A struct was a
  class instance used as a dictionary, so a field named `check` replaced the method
  (`this.fields.check is not a function`), a field named `name` corrupted the message for a value
  that is not an object (`Field "[object Object]"`), and input keys such as `constructor`,
  `__proto__` or `check` were silently accepted instead of reported as not expected. Fields now
  live in a null-prototype dictionary. A value that is not an object is reported as
  `Field "<path>" not of expected type: object`, like every other type error (was
  `Value of "<path>" must be an object`).
- **Bundled and minified builds.** Schemas, fields and validation results were recognised by
  `constructor.name`. esbuild emits `class _Schema` for the self-referencing `Schema` class, so in
  any esbuild bundle (Vite, tsup, serverless builds) a `Schema` instance used as a field, or passed
  to `new Schema`, failed with `Unknown type struct`; with minification the `Type` class was
  renamed too and `check` accepted every value. Identity is now a global symbol brand
  (`Symbol.for`), which also recognises results from a second copy of the package.
  `tests/unit/bundle.test.js` validates through esbuild bundles of both entries, minified and not.
- **Reference cycles that do not pass through the first entity** (`A → B → C → B`) made `new Model`
  fail with `RangeError: Maximum call stack size exceeded`, and whether a cycle crashed or produced a
  warning depended on the order of the entities. Every cycle is now a warning, in the same format
  as a missing reference: `Warning: "C" depends on "B" recursively` (was
  `Recursive dependency: C.B`).
  `Model#preprocess` and `Model#reorderEntity` are constructor internals and are no longer public.
- **A schema type without a definition** (`data: 'schema'`, `{ type: 'schema' }`, or an alias
  such as `{ js: 'schema' }` used as `'address'`) failed with
  `Cannot convert undefined or null to object`, and a non-object `schema` with an unrelated
  `Unknown type` error. It now throws `SchemaDefinitionError` (`ERR_MISSING_SCHEMA`):
  `Type "address" needs a schema definition: { type: 'address', schema: { ... } } in "Order.delivery"`.
- **Typings.** `index.d.ts` matches the runtime:
  - the static `Schema.KIND`, `KIND_STORED`, `KIND_MEMORY`, `SCOPE`, `STORE` and `ALLOW` fields,
    which never existed, are removed;
  - `'system'` is removed from `Scope`;
  - `Schema.from` accepts strings and arrays;
  - `validate`, `findReference` and `Model#database` may be `null`;
  - `fields`, `indexes`, `custom`, the type table and the entries passed to `Model` are typed
    (`Fields`, `FieldType`, `TypeTable`, `TypeEntry`, ...) instead of `object` and `Function`;
  - `Cardinality` is the two values the runtime produces, and `Kind` admits a custom kind.

### Tooling

- pnpm, oxlint and oxfmt replace npm, ESLint and Prettier; c8, tsd and TypeScript (7.x) check
  coverage and the typings. oxlint runs with its `correctness` and `suspicious` categories on.
- Sources move to `src/`, tests to `tests/unit/` (with `tests/types/` for tsd), fixtures to
  `tests/fixtures/`.
- c8 coverage gate, tsd type tests, an export-parity test and a platform test that keeps Node
  builtins out of everything but `src/runtime/node.js`.
- CI runs lint, types, tests on Node 18–24 (Ubuntu) and 22–24 (Windows), coverage and the docs
  build, with a single `ci-success` check.
- `pnpm size` reports bundle sizes and, with `--max-gzip <KB>`, fails over budget (CI gates at
  8 KB; the bundles are under 8 KB). `pnpm bench` runs the benchmarks and, with `--json`, `--save`
  and `--compare`, snapshots them to `bench/baseline.json` and reports the change. The coverage
  table appears in the CI job summary.

## Upstream history (metarhia/metaschema)

Releases of [`metaschema`](https://github.com/metarhia/metaschema) before the fork, kept as
published.

### [metaschema 2.2.2][upstream-2.2.2] - 2025-05-24

- Add node.js 23 and 24 to CI
- Update dependencies

### [metaschema 2.2.1][upstream-2.2.1] - 2024-08-31

- Update eslint to 9.x and prettier with configs
- Add node.js 22 to CI

### [metaschema 2.2.0][upstream-2.2.0] - 2024-03-27

- Add browser support
- Rename `SchemaError` to `ValidationResult`
- Update dependencies

### [metaschema 2.1.5][upstream-2.1.5] - 2023-07-15

- Fix: remove debug output
- Update dependencies
- Package maintenance: AUTHORS, .prettierignore

### [metaschema 2.1.4][upstream-2.1.4] - 2023-05-01

- Drop node.js 14 support, add node.js 20
- Convert package_lock.json to lockfileVersion 2
- Update dependencies

### [metaschema 2.1.3][upstream-2.1.3] - 2023-03-13

- Add `BigInt` to known glabals
- Add `node:` prefix in require for built-in modules

### [metaschema 2.1.2][upstream-2.1.2] - 2023-02-18

- Update dependencies and security issues
- Package maintenance: json autoformatting, CI, license

### [metaschema 2.1.1][upstream-2.1.1] - 2022-08-16

- Non required fields can be `null`
- Using optional chaining operator

### [metaschema 2.1.0][upstream-2.1.0] - 2022-07-11

- Test fixups from <https://github.com/metarhia/metaschema/pull/420/commits/5732714114a14e0f8a71617c779d73eb4b345fb4>
- toJSON and toString methods implementation for Schema

### [metaschema 2.0.2][upstream-2.0.2] - 2022-06-25

- Hotfix: added missed exports to metaschema.js

### [metaschema 2.0.1][upstream-2.0.1] - 2022-06-24

- json type for any plain javascript object
- fix names issue while using built-in prototypes for custom types

### [metaschema 2.0.0][upstream-2.0.0] - 2022-06-22

- Struct implementation
- Refactoring and code quality improvement
- Metadata handled separetely
- Error handling improved now errors are chained
- Custom Kinds support implemented with custom metadata
  `{ CustomKind: { customMetadata: 'meta' } }`
- Update dependencies: "eslint", "eslint-config-metarhia"
- Custom types syntax changed. No more hardcoded `pg`.
  Now you must use `metadata` which is static property of Type constructor.
- Nested schema with relations bugfix
- Tuple type implementation
- Properly report error if trying to use `field: 'type'` shorthand for
  `'enum', 'array', 'set', 'map', 'object'` types
- Rewrite schemas and implement custom types
  - elegant syntax/format for custom types and internal types
  - custom types support
  - preprocessor to reduce Schema preprocess complexity
  - any kind of nested arrays, array of references https://github.com/metarhia/metaschema/issues/378
  - nested schemas with Schema instances support
  - any level of complex nested types support
  - custom validate for field
  - changed validate for schema, simplified for user
  - all user's validate functions support 4 types of syntax: boolean return, throw Error, error message as string return and array of error messages
  - reserved words permitted in schema if kind provided
  - function fields stored in schema
  - shorthand required key for collections support `{ 'array?': 'string' }`
  - many relation now checks in runtime
  - model now loads projections at the end, to fix bug
  - schema kinds moved to separate file and kinds now have logic to remove hardcoded projection from Schema
  - ts interfaces from schema now have relation ids as well
  - deps update metautil
  - nested object support https://github.com/metarhia/metaschema/issues/395
  - syntax for validate function changed
  - Model no more require metavm for browser compatibility: need `impress` update
  - loadModel moved to loader: need `impress` update
  - Model no more writes d.ts file to disk moved to loader as well: need `metasql` update
  - syntax for pg types changed a bit, no more not-working types: need `metasql` update

### [metaschema 1.4.1][upstream-1.4.1] - 2022-03-17

- Skip calculated fields in schemas
- Update dependencies
- Fix tests after update metatests to 0.8.1

### [metaschema 1.4.0][upstream-1.4.0] - 2022-02-23

- Fix nullable field long-form
- Optional for nested structures
- Shorthand for optional nested structure
- Fix paths in validation errors
- Unify nested schema fields to
  `{ type: 'schema', schema: Schema, /* other fields */ }`
- Support Schema#validate function

### [metaschema 1.3.4][upstream-1.3.4] - 2021-09-10

- Show path to the field in warnings
- Remove spread operator in `toLongForm`
- Update dependencies

### [metaschema 1.3.3][upstream-1.3.3] - 2021-07-19

- Improve code style
- Move types to package root
- Package maintenance: update dependencies, update engines, security

### [metaschema 1.3.2][upstream-1.3.2] - 2021-06-30

- Schema projection
- Schema.prototype.relations: Set<{ to: string, type: string }>

### [metaschema 1.3.1][upstream-1.3.1] - 2021-06-26

- Add namespaces to Schema.from factory
- Fix "not expected" warning

### [metaschema 1.3.0][upstream-1.3.0] - 2021-06-25

- Check schemas with references to schemas from attached models
- Add Schema.prototype.namespaces and attach/detouch methods to add/remove
- Add types to Schema.prototype.references (in addition to entities)
- Move Model.prototype.checkReferences to Schema.prototype.checkConsistency
- Fix lost json subfields checking
- Improve Schema kinds

### [metaschema 1.2.3][upstream-1.2.3] - 2021-05-22

- Restrict 'type' property in db schemas
- Simplify schema examples

### [metaschema 1.2.2][upstream-1.2.2] - 2021-05-17

- Fix unique alternative keys

### [metaschema 1.2.1][upstream-1.2.1] - 2021-05-15

- Move Identifier ahead of entity order
- Collect all references: Schema.prototype.references
- Improve check references for Model
- Reorder entities including many-to-many references
- Fix recursion detection on many-to-many and parent

### [metaschema 1.2.0][upstream-1.2.0] - 2021-05-13

- Change Schema metadata `{ kind, scope, store, allow }`
- Update dependencies and fix security issue

### [metaschema 1.1.2][upstream-1.1.2] - 2021-05-08

- Shorthand for optional (not required) fields
- Nested schema of json type (for pg json fields)

### [metaschema 1.1.1][upstream-1.1.1] - 2021-05-07

- Support nested schemas for Model class

### [metaschema 1.1.0][upstream-1.1.0] - 2021-05-06

- Move Schema.prototype.toInterface from metasql
- Move Directory loader from metasql
- Move Model class from metasql (previous name DomainModel)
- Move Reference checker from metasql
- Move Entity reordering algorithm from metasql
- Improve Model and Schema classes

### [metaschema 1.0.3][upstream-1.0.3] - 2021-04-13

- Add .d.ts typings
- Update metavm (added typings)

### [metaschema 1.0.2][upstream-1.0.2] - 2021-03-11

- Support enumerated type
- Fix single value validation
- Fix bugs in not required fields checking

### [metaschema 1.0.1][upstream-1.0.1] - 2021-03-06

- Fix database schema: index detection
- Add loaders from string and file

### [metaschema 1.0.0][upstream-1.0.0] - 2021-03-02

- See specs: https://github.com/metarhia/Contracts
- Moved implementation from impress
  - Implement schemas for structures and scalars
  - Schema field shorthand
  - Schema for collections: array, object, set, map
  - Schema custom validation method

### [metaschema 0.x][upstream-0.x] - First generation of metaschema

[unreleased]: https://github.com/Alexis-Technologies/metaschema/compare/v3.4.0...HEAD
[3.4.0]: https://github.com/Alexis-Technologies/metaschema/compare/v3.3.0...v3.4.0
[3.3.0]: https://github.com/Alexis-Technologies/metaschema/compare/v3.2.0...v3.3.0
[3.2.0]: https://github.com/Alexis-Technologies/metaschema/compare/v3.1.0...v3.2.0
[3.1.0]: https://github.com/Alexis-Technologies/metaschema/compare/v3.0.0...v3.1.0
[3.0.0]: https://github.com/Alexis-Technologies/metaschema/compare/v2.0.0...v3.0.0
[2.0.0]: https://github.com/Alexis-Technologies/metaschema/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/Alexis-Technologies/metaschema/releases/tag/v1.0.0
[upstream-2.2.2]: https://github.com/metarhia/metaschema/compare/v2.2.1...v2.2.2
[upstream-2.2.1]: https://github.com/metarhia/metaschema/compare/v2.2.0...v2.2.1
[upstream-2.2.0]: https://github.com/metarhia/metaschema/compare/v2.1.5...v2.2.0
[upstream-2.1.5]: https://github.com/metarhia/metaschema/compare/v2.1.4...v2.1.5
[upstream-2.1.4]: https://github.com/metarhia/metaschema/compare/v2.1.3...v2.1.4
[upstream-2.1.3]: https://github.com/metarhia/metaschema/compare/v2.1.2...v2.1.3
[upstream-2.1.2]: https://github.com/metarhia/metaschema/compare/v2.1.1...v2.1.2
[upstream-2.1.1]: https://github.com/metarhia/metaschema/compare/v2.1.0...v2.1.1
[upstream-2.1.0]: https://github.com/metarhia/metaschema/compare/v2.0.2...v2.1.0
[upstream-2.0.2]: https://github.com/metarhia/metaschema/compare/v2.0.1...v2.0.2
[upstream-2.0.1]: https://github.com/metarhia/metaschema/compare/v2.0.0...v2.0.1
[upstream-2.0.0]: https://github.com/metarhia/metaschema/compare/v1.4.1...v2.0.0
[upstream-1.4.1]: https://github.com/metarhia/metaschema/compare/v1.4.0...v1.4.1
[upstream-1.4.0]: https://github.com/metarhia/metaschema/compare/v1.3.4...v1.4.0
[upstream-1.3.4]: https://github.com/metarhia/metaschema/compare/v1.3.3...v1.3.4
[upstream-1.3.3]: https://github.com/metarhia/metaschema/compare/v1.3.2...v1.3.3
[upstream-1.3.2]: https://github.com/metarhia/metaschema/compare/v1.3.1...v1.3.2
[upstream-1.3.1]: https://github.com/metarhia/metaschema/compare/v1.3.0...v1.3.1
[upstream-1.3.0]: https://github.com/metarhia/metaschema/compare/v1.2.3...v1.3.0
[upstream-1.2.3]: https://github.com/metarhia/metaschema/compare/v1.2.2...v1.2.3
[upstream-1.2.2]: https://github.com/metarhia/metaschema/compare/v1.2.1...v1.2.2
[upstream-1.2.1]: https://github.com/metarhia/metaschema/compare/v1.2.0...v1.2.1
[upstream-1.2.0]: https://github.com/metarhia/metaschema/compare/v1.1.2...v1.2.0
[upstream-1.1.2]: https://github.com/metarhia/metaschema/compare/v1.1.1...v1.1.2
[upstream-1.1.1]: https://github.com/metarhia/metaschema/compare/v1.1.0...v1.1.1
[upstream-1.1.0]: https://github.com/metarhia/metaschema/compare/v1.0.3...v1.1.0
[upstream-1.0.3]: https://github.com/metarhia/metaschema/compare/v1.0.2...v1.0.3
[upstream-1.0.2]: https://github.com/metarhia/metaschema/compare/v1.0.1...v1.0.2
[upstream-1.0.1]: https://github.com/metarhia/metaschema/compare/v1.0.0...v1.0.1
[upstream-1.0.0]: https://github.com/metarhia/metaschema/compare/v0.x...v1.0.0
[upstream-0.x]: https://github.com/metarhia/metaschema/releases/tag/v0.x
