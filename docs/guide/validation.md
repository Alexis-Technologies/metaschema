# Validation

`schema.check(value, options?)` validates a value and returns a `ValidationResult`:

```js
const { Schema } = require('@alexify/metaschema');

const user = new Schema('User', { name: 'string', age: '?number' });

const result = user.check({ age: 'old' });
result.valid; // false
result.errors;
// [
//   'Field "User.name" is required',
//   'Field "User.age" not of expected type: number'
// ]
```

## The result

| Member | Type | Meaning |
| --- | --- | --- |
| `valid` | `boolean` | `true` when there are no issues |
| `issues` | `ValidationIssue[]` | one `{ code, path, message, params }` per problem |
| `errors` | `string[]` | one line per issue, the message with its location; rendered on first use |
| `summary` | `string` | the error lines joined with newlines |
| `flatten()` | `{ formErrors, fieldErrors }` | messages by dotted path, for forms |
| `tree()` | `{ errors, properties?, items? }` | messages as a tree that follows the value |

An issue is data. `path` is the array of keys from the root of the value (a key, or an index for
an array, set or tuple element), `message` describes the problem without its location, and
`params` carries what the message was made from:

```js
user.check({ age: 'old' }).issues;
// [
//   { code: 'required', path: ['name'], message: 'is required', params: {} },
//   {
//     code: 'type',
//     path: ['age'],
//     message: 'not of expected type: number',
//     params: { expected: 'number', received: 'string' },
//   },
// ]
```

The codes the library produces, and their `params`:

| Code | Meaning | `params` |
| --- | --- | --- |
| `required` | a required field is missing, or a required `object`/`map` is empty | `{}` |
| `type` | the value is not of the field's type (also a message from a custom type's `checkType`) | `{ expected, received }`, plus `key` when a key of an `object` or `map` has the wrong type |
| `unexpected` | keys the schema does not have; one issue per struct | `{ keys }` |
| `enum` | the value is not one of the `enum` values | `{ values }` |
| `length` | a `length` rule failed, or a tuple has too many elements | `{ min, max, actual }` |
| `range` | a `min` or `max` rule failed | `{ min, max, actual }` |
| `pattern` | a `pattern` rule failed | `{ pattern }`, the source of the expression |
| `reference` | the referenced entity is not in any attached model | `{ entity }` |
| `circular` | the value refers back to itself through a reference | `{}` |
| `exception` | a `validate` or `checkType` function threw | `{ error }` |
| `custom` | a message from a `validate` function | whatever the function gave, or `{}` |

`errors` adds the location to each message: `Field "<root><path>" <message>`, where the path is
rendered in dotted form (`name.first`, `tags[2]`, `companies[1].name`, `["a.b"]` for a key that is
not an identifier) after the root, which is the schema name or the [`root`](#options) option.
A message that already starts with `Field` (the convention of custom types) is kept as it is.

For a form, `flatten()` groups the messages by dotted path without the root, and `tree()`
follows the value:

```js
const form = Schema.from({ name: 'string', tags: { array: { label: 'string' } } });
const result = form.check({ name: 1, tags: [{ label: 'ok' }, { label: 2 }], extra: true });

result.flatten();
// {
//   formErrors: ['has unexpected keys: extra'],
//   fieldErrors: {
//     name: ['not of expected type: string'],
//     'tags[1].label': ['not of expected type: string'],
//   },
// }

result.tree().properties.tags.items[1];
// { errors: [], properties: { label: { errors: ['not of expected type: string'] } } }
```

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `root` | the schema name | the label the error lines start with; `''` for none. Issue paths never include it |
| `maxErrors` | unlimited | stop collecting after that many issues (at least 1), and stop walking fields, elements and records as soon as the limit is reached |
| `unknown` | `'reject'` | what to do with keys the schema does not have: report them as one `unexpected` issue per struct, or `'ignore'` them at every depth |
| `messages` | English | the [locale](#messages-and-locales) of the messages, or a function that renders every message |

```js
user.check({}, { root: 'body' }).errors; // [ 'Field "body.name" is required' ]
user.check({}, { maxErrors: 1 }).errors; // [ 'Field "User.name" is required' ]
user.check({ name: 'Marcus', extra: true }, { unknown: 'ignore' }).valid; // true
```

`check` collects every problem it finds instead of stopping at the first one, and it never throws
because of the value. An exception means the **definition** is broken (for example, an unknown
type), and is raised when the schema is built, not when data is checked. It is a
[`SchemaDefinitionError`](/api/exports#schemadefinitionerror): a `TypeError` with a `code` and the
`schema` and `field` it was found in:

```js
new Schema('Order', { total: 'strng' });
// SchemaDefinitionError: Unknown type "strng" in "Order.total"
//   code: 'ERR_UNKNOWN_TYPE', schema: 'Order', field: 'total'
```

An option with a value it does not accept also throws a `TypeError`, as does a string in place of
the options (the second argument of `check` was the root path in 1.x).

## Messages and locales

Messages are rendered once, at the end of a check, from the code and the `params` of each issue
through a locale: a table of one renderer per code. English is built in, Ukrainian ships as
`@alexify/metaschema/locales/uk`:

```js
const uk = require('@alexify/metaschema/locales/uk');

user.check({ age: 'old' }, { messages: uk }).errors;
// [
//   'Поле "User.name" є обовʼязковим',
//   'Поле "User.age" не відповідає типу: number'
// ]
```

A locale is a plain object, so one of your own can be partial (missing codes fall back to
English) or you can render every message yourself with a function:

```js
user.check({}, { messages: { required: () => 'please fill this in' } }).errors;
// [ 'Field "User.name" please fill this in' ]

user.check({ age: 'old' }, { messages: (issue) => `${issue.code}!` }).errors;
// [ 'Field "User.name" required!', 'Field "User.age" type!' ]
```

A renderer gets the `params` of the issue and the issue itself; `field(path)` renders the
location prefix of an error line. The text a `validate` function returns is kept as it is.

## Custom validation

### On a field

Give a field a `validate(value, path)` function in the long form:

```js
const schema = Schema.from({
  password: {
    type: 'string',
    validate: (value) => value.length >= 8 || 'must be at least 8 characters',
  },
});
```

A field is checked in order: its type, then its rules (`length`, `pattern`, `min`, `max`), then `validate`. A type failure
is reported once and cancels the rest, and `validate` runs only on a value that passed everything
before it, so it can rely on the type and the rules. `path` is the dotted path of the field,
including the root. The function can return:

| Return value | Result |
| --- | --- |
| `true`, `null` or `undefined` | valid |
| `false` | `'validation error'` |
| a string | that message, with code `custom` |
| `{ code, message, path?, params? }` | that message with your own code and params; `path` (a key or an array of keys) is relative to the field |
| an array of strings or `{ code, message }` objects | one issue per entry |
| a `ValidationResult` | its issues, relative to the field |

`ValidationResult` is exported, so a function can build the result it returns:

```js
const { Schema, ValidationResult } = require('@alexify/metaschema');

const schema = Schema.from({
  range: {
    type: 'string',
    validate: (value) => {
      const result = new ValidationResult();
      if (!value.includes('-')) result.add('needs a dash');
      if (value.length > 9) result.add('is too long');
      return result;
    },
  },
});

schema.check({ range: '0123456789' }).errors;
// [ 'Field "range" needs a dash', 'Field "range" is too long' ]
```

If the function throws, the error becomes an `exception` issue (`validation failed Error: ...`)
instead of propagating.

### On a schema

A top-level `validate` function checks the whole value, for rules that span several fields. It
runs after the fields, and only when every field passed, so it can rely on their shape. A relative
`path` in the returned issue points at the field it is about:

```js
const signup = Schema.from({
  password: { type: 'string', validate: (value) => value.length >= 8 || 'must be at least 8 characters' },
  confirm: 'string',
  validate: (value) =>
    value.password === value.confirm || { message: 'does not match', path: 'confirm' },
});

signup.check({ password: 'secret', confirm: 'other' }).errors;
// [ 'Field "password" must be at least 8 characters' ]
signup.check({ password: 'secretsecret', confirm: 'other' }).errors;
// [ 'Field "confirm" does not match' ]
```

`schema.validate(value, path?)` runs only that function and returns `null` when the schema has
none.

## Patterns and ReDoS

A `pattern` runs a regular expression over input you do not control. An expression with nested or
overlapping repetition (`^(a+)+$`, `^(\w+\s?)*$`) backtracks exponentially on a crafted string,
and one such field is enough to stall the process: a regular expression denial of service. Two
habits keep a schema safe:

- **Bound the input.** Give every `pattern` field a `length.max`. Backtracking is a function of
  input length, and a bound of a few hundred characters keeps even a bad expression fast. A
  schema with a `pattern` and no `length.max` is reported in [`schema.warnings`](/guide/model#warnings).
- **Write linear patterns.** Avoid a quantifier over a group that itself contains a quantifier,
  and alternatives that can match the same text (`(a|a)*`). Anchor with `^` and `$`, and prefer
  character classes (`[a-z0-9-]+`) over `.*`.

metaschema compiles the pattern once and runs `RegExp#test` on the value, nothing more; it does
not analyse the expression. A pattern that needs lookbehind or a long alternation is often better
written as a `validate` function with explicit checks.

## Calculated fields

A function as a field value is a calculated field. It is part of the definition but never
validated, so the data does not need to contain it:

```js
const file = Schema.from({
  size: 'number',
  compressed: 'number',
  ratio: (value) => value.compressed / value.size,
});

file.check({ size: 100, compressed: 25 }).valid; // true
file.fields.ratio({ size: 100, compressed: 25 }); // 0.25
```
