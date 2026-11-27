# Migrating from 3.x

4.0 changes the errors, and the hooks that watch a call. Every code carries the `ALX_` prefix of
the Alexis libraries, a wrong call throws a class of its own, `SchemaUsageError`, where it threw
a plain `TypeError` (or, for a wrong option of some calls, a `SchemaDefinitionError`), and a hook
that throws no longer fails the call it watches. The schema language, `check`, `parse`, the shape of a result and the typings of the
schemas stay as they are, and so do the issue codes of a result (`required`, `type`,
`unexpected`, …), which are data, not error codes. This page shows each change with the 3.x
behaviour first and the 4.0 behaviour after it; the condensed list is under "Upgrading from 3.x"
in the [CHANGELOG](https://github.com/Alexis-Technologies/metaschema/blob/main/CHANGELOG.md). A
project coming from 2.x goes through [Migrating from 2.x](/guide/migrating-from-2) first.

## The codes have the `ALX_` prefix

Every `error.code` of the package starts with `ALX_ERR_`, and what follows the prefix is the
name it had: the 31 codes of a [`SchemaDefinitionError`](/api/exports#schemadefinitionerror)
and the 5 of a wrong call, now a [`SchemaUsageError`](/api/exports#schemausageerror). Matching on a code is where a program changes:

```js
const { Schema } = require('@alexify/metaschema');

try {
  Schema.from({ name: { type: 'string', min: 1 } });
} catch (error) {
  error.code;
  // 3.x: 'ERR_INVALID_RULE'
  // 4.0: 'ALX_ERR_INVALID_RULE'
  error.message; // 'Rule "min" does not apply to type "string" in "name"', in both
}
```

A search for `'ERR_` in the program finds every comparison to change. The types
`DefinitionErrorCode` and `RuntimeErrorCode` hold the new names, so once an error is narrowed
with `instanceof SchemaDefinitionError` or `instanceof SchemaUsageError`, TypeScript reports a
comparison of its `code` with an old name as one that can never be true.

## A wrong call is a `SchemaUsageError`

A target or an option a call does not take, a method that needs what a `register()` installs, a
promise returned to a synchronous `check` or `parse`, an invalid record a stream was not told to
drop: each was a plain `TypeError` with a `code`. It is a `SchemaUsageError` now, exported by the
core and by `@alexify/metaschema/definition`, a subclass of `TypeError`:

```js
const { Schema, SchemaUsageError } = require('@alexify/metaschema');

const schema = Schema.from({ name: 'string' });

try {
  schema.check({ name: 'Ada' }, { maxErrors: 'all' });
} catch (error) {
  // 3.x
  error.name; // 'TypeError'
  error.code; // 'ERR_INVALID_OPTION'
  // 4.0
  error.name; // 'SchemaUsageError'
  error.code; // 'ALX_ERR_INVALID_OPTION'
  error instanceof SchemaUsageError; // true
  error instanceof TypeError; // true, as in 3.x
  error.message; // 'maxErrors must be an integer of at least 1, got "all"', in both
}
```

A check of `instanceof TypeError` keeps working; a check of `error.name === 'TypeError'` does
not. The fields that travelled on these errors are where they were: `index`, `record` and
`result` on the `ALX_ERR_INVALID_RECORD` of a stream, `method` on the `ALX_ERR_NOT_REGISTERED`
of a schema of the definition entry.

## Every option of a call is `ALX_ERR_INVALID_OPTION`

In 3.x a wrong option of `compile` and `register` of the compile subpath, of `toJSONSchema` and
`fromJSONSchema`, of `fromJSON`, `merge`, `sample` and `infer`, of the `Model` constructor and of
`register` of the coerce subpath was a `SchemaDefinitionError` with the code
`ERR_INVALID_OPTIONS` (`ERR_INVALID_COERCION` for coerce), as if the definition were broken. The
call is what is wrong, so it is a `SchemaUsageError` with `ALX_ERR_INVALID_OPTION` now, as the
options of `check`, the stream, derive and mongodb subpaths already were:

```js
const { register } = require('@alexify/metaschema/compile');

try {
  register({ jit: 'yes' });
} catch (error) {
  // 3.x
  error.name; // 'SchemaDefinitionError'
  error.code; // 'ERR_INVALID_OPTIONS'
  // 4.0
  error.name; // 'SchemaUsageError'
  error.code; // 'ALX_ERR_INVALID_OPTION'
  error.message; // 'Compile option "jit" must be "auto", true or false, got "yes"', in both
}
```

`ALX_ERR_INVALID_OPTIONS` stays the code of a broken piece of a definition: the `unknown` or
`coerce` metadata of a schema, and the `metadata` of `merge` and `derive`.

## The cause of an error is the standard `cause`

An error that wraps another (a pattern the engine cannot compile, a snapshot value that does not
read, a check the JIT could not generate) carries it as `error.cause`, set by the option of the
`Error` constructor: not an own enumerable key any more, so `JSON.stringify(error)` and
`Object.keys(error)` leave it out, and the errors of a snapshot that did not read keep the
error of the engine, which 3.x dropped.

## The error classes take the arguments of `Error`

A program that builds the errors itself (a custom type that throws one, a test) writes the
message first and the code among the options, as `new Error(message, { cause })` does:

```js
const { SchemaDefinitionError } = require('@alexify/metaschema');

// 3.x
new SchemaDefinitionError('ERR_INVALID_RULE', 'Rule "min" does not apply');
// 4.0
new SchemaDefinitionError('Rule "min" does not apply', { code: 'ALX_ERR_INVALID_RULE' });
```

`options` also holds the `cause` and the fields of the class (`schema`, `field`, `seed`,
`index` of a `SchemaDefinitionError`; `index`, `record`, `result`, `method` of a
`SchemaUsageError`). Without a code a `SchemaDefinitionError` is `ALX_ERR_INVALID_DEFINITION`
and a `SchemaUsageError` `ALX_ERR_INVALID_TARGET`.

## A hook never fails the call it watches

`onFallback` of `register()` of the compile subpath, `onError` of `register()` of the coerce
subpath and `onUnsupported` of `fromJSONSchema` are told of what happened; one that throws, or
returns a promise that rejects, no longer makes the call throw (3.x let a throwing `onFallback`
out of `new Schema`). `onInvalid` of a stream `transform` is a step of the stream, not a hook:
what it throws still ends the stream, as before.

## `saveTypes` in a browser has a code

`saveTypes` of the generators subpath rejects in a browser, where there is no file system. It
rejected with a bare `Error`; it rejects with a `SchemaUsageError` of the code
`ALX_ERR_UNSUPPORTED_RUNTIME` now:

```js
const { saveTypes } = require('@alexify/metaschema/generators');

saveTypes('./types.d.ts', model).catch((error) => {
  // 3.x: Error, no code
  // 4.0: SchemaUsageError, error.code === 'ALX_ERR_UNSUPPORTED_RUNTIME'
  error.message; // 'saveTypes is not available in the browser', in both
});
```
