# Migrating from 3.x

4.0 changes the errors and nothing else. Every code carries the `ALX_` prefix of the Alexis
libraries, and a wrong call throws a class of its own, `SchemaUsageError`, where it threw a plain
`TypeError`. The schema language, `check`, `parse`, the shape of a result and the typings of the
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
