# Validation

`schema.check(value)` validates a value and returns a `ValidationResult`:

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

| Property | Type | Meaning |
| --- | --- | --- |
| `valid` | `boolean` | `true` when there are no errors |
| `errors` | `string[]` | one message per problem, prefixed with the field path |
| `issues` | `{ code, path, message }[]` | the same problems with a code and the path on their own |

```js
user.check({ age: 'old' }).issues;
// [
//   { code: 'required', path: 'User.name', message: 'Field "User.name" is required' },
//   { code: 'type', path: 'User.age', message: 'Field "User.age" not of expected type: number' }
// ]
```

The codes the library produces:

| Code | Meaning |
| --- | --- |
| `required` | a required field is missing, or a required `object`/`map` is empty |
| `type` | the value is not of the field's type (also a message from a custom type's `checkType`) |
| `unexpected` | a key the schema does not have |
| `enum` | the value is not one of the `enum` values |
| `length` | a `length` rule failed, or a tuple has too many elements |
| `reference` | the referenced entity is not in any attached model |
| `circular` | the value refers back to itself |
| `exception` | a `validate` function threw; the message carries the error |
| `custom` | a message from a `validate` function |

## Limiting the number of errors

`check(value, path, { maxErrors })` stops collecting after that many messages and stops walking
fields, elements and records as soon as the limit is reached. The result is still `valid: false`
with the messages found so far:

```js
user.check({}, 'User', { maxErrors: 1 }).errors; // [ 'Field "User.name" is required' ]
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

## Paths

Each message starts with `Field "<path>"`. The path begins with the schema name, or is empty for
an anonymous schema, and follows the value down: `name.first`, `tags[2]`, `companies[1].name`,
`point(x0)`. Pass a second argument to choose the root:

```js
user.check({}, 'body').errors; // [ 'Field "body.name" is required' ]
```

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

The function runs after the type check and can return:

| Return value | Result |
| --- | --- |
| `true`, `null` or `undefined` | valid |
| `false` | `'validation error'` |
| a string | that message, with code `custom` |
| `{ code, message }` | that message with your own code (`path` is optional) |
| an array of strings or `{ code, message }` objects | one error per entry |
| a `ValidationResult` | its errors and issues |

`ValidationResult` is exported, so a function can build the result it returns:

```js
const { Schema, ValidationResult } = require('@alexify/metaschema');

const schema = Schema.from({
  range: {
    type: 'string',
    validate: (value, path) => {
      const result = new ValidationResult(path);
      if (!value.includes('-')) result.add('needs a dash');
      if (value.length > 9) result.add('is too long');
      return result;
    },
  },
});
```

Messages are prefixed with `Field "<path>"` unless they already start with `Field`. If the
function throws, the error becomes a message (`validation failed Error: ...`) instead of
propagating.

### On a schema

A top-level `validate` function checks the whole value, for rules that span several fields:

```js
const signup = Schema.from({
  password: { type: 'string', validate: (value) => value.length >= 8 || 'must be at least 8 characters' },
  confirm: 'string',
  validate: (value) => value.password === value.confirm || 'passwords do not match',
});

signup.check({ password: 'secret', confirm: 'other' }).errors;
// [
//   'Field "" passwords do not match',
//   'Field "password" must be at least 8 characters'
// ]
```

`schema.validate(value, path)` runs only that function and returns `null` when the schema has
none.

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
