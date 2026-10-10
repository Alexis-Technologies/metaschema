# Custom Types

`Model` takes a table of types as its first argument. Each entry either annotates a built-in type
or defines a new one.

```js
const { Model } = require('@alexify/metaschema');

const types = {
  // Metadata on a built-in type
  string: { metadata: { pg: 'varchar' } },

  // A new type that behaves like a built-in one
  datetime: { js: 'string', metadata: { pg: 'timestamp with time zone' } },
  ip: { js: 'string', metadata: { pg: 'inet' } },

  // A new type with its own check
  decimal: {
    metadata: { pg: 'decimal' },
    kind: 'scalar',
    rules: ['length'],
    construct() {},
    checkType(value, path) {
      if (typeof value !== 'string') return `Field "${path}" not a decimal`;
      if (!/^-?\d+(\.\d+)?$/.test(value)) return `Field "${path}" not a decimal`;
      return null;
    },
  },
};

const entities = new Map([
  ['Payment', { Entity: {}, amount: 'decimal', createdAt: 'datetime', clientIp: '?ip' }],
]);

const model = new Model(types, entities);
const payment = model.entities.get('Payment');

payment.check({ amount: 10.5, createdAt: 1 }).errors;
// [
//   'Field "Payment.amount" not a decimal',
//   'Field "Payment.createdAt" not of expected type: string'
// ]
```

## Entry forms

| Entry | Effect |
| --- | --- |
| `{ metadata }` on a built-in name | merges `metadata` into the built-in type |
| `{ js: '<type>', metadata }` | a new type that validates like `<type>`: a built-in, or a type registered earlier in the table |
| `{ construct, checkType, ...proto }` | a new type with its own logic |

An alias takes the same arguments as the type it aliases. An alias of `schema` names a kind of
nested struct, and every field of that type supplies its own fields in the long form:

```js
const types = { address: { js: 'schema', metadata: { pg: 'jsonb' } } };

const entities = new Map([
  ['Order', { Struct: {}, delivery: { type: 'address', schema: { city: 'string' } } }],
]);
```

Writing the field as just `delivery: 'address'` throws
`SchemaDefinitionError: Type "address" needs a schema definition: { type: 'address', schema: { ... } } in "Order.delivery"`
(code `ERR_MISSING_SCHEMA`). The same error is thrown for the built-in `'schema'` type without a
definition.

A prototype for a new type must have `construct(def, preprocessor)` and
`checkType(value, path)` methods, or `Model` throws `SchemaDefinitionError` (code
`ERR_INVALID_CUSTOM_TYPE`). `checkType` gets the value and the dotted path of the field and
returns `null` (or `true`) when the value is valid, `false` for a `type` issue
(`not of expected type: <name>`), or a message string, a `{ code, message }` object or an array of
them, like a [`validate` function](/guide/validation#on-a-field); an exception becomes an
`exception` issue. Its issues carry the code `type` unless they bring their own. `kind`
(`'scalar'` or `'struct'`) and `rules` (for example `['length']`) are optional; the rules and a
field's `validate` run only when `checkType` passed. Other keys, like `symbols` below, are copied
onto every field of the type and are available as `this.<key>` inside the methods:

```js
const types = {
  hex: {
    kind: 'scalar',
    symbols: '0123456789abcdef',
    construct() {},
    checkType(value, path) {
      const valid = [...value].every((char) => this.symbols.includes(char));
      return valid ? null : `Field "${path}" is not hex`;
    },
  },
};
```

## Reading metadata

Type metadata is what a database or code generator reads:

```js
model.types.decimal.metadata; // { pg: 'decimal' }
model.types.datetime.metadata; // { pg: 'timestamp with time zone' }
payment.fields.amount.constructor.metadata; // { pg: 'decimal' }
```

Two keys are read by metaschema itself, by the [JSON Schema export](/guide/json-schema#custom-types):
`metadata.jsonSchema` is the schema of the type (`{ type: 'string', format: 'date-time' }` for
`datetime`) and `metadata.bson` its BSON type for the `mongodb` target (`'date'`). An alias
without them renders as the type it aliases; a type with its own `checkType` and no
`jsonSchema` has no JSON Schema form.

## Types are registered globally

Type registration is process-wide: once a `Model` registers `ip` or adds metadata to `string`,
every schema in the process sees it, including ones built with `Schema.from`. Register your types
once, at startup, and use the same table everywhere.

Passing the same table to several models is fine: an entry that repeats the definition a type was
created from (the same `js`, the same `construct` and `checkType` functions) or only adds
`metadata` is accepted. A different definition for a name that is already registered, including a
built-in (`{ string: { js: 'number' } }`), throws `SchemaDefinitionError` with code
`ERR_TYPE_REGISTERED`, and a `js` that names no registered type throws `ERR_UNKNOWN_JS_TYPE`.

## An isolated registry

When two models in one process need different definitions for the same type name (two tenants,
two domains in a monorepo, tests that build conflicting models), give each its own registry:

```js
const payments = new Model(paymentTypes, paymentEntities, null, { registry: 'isolated' });
const catalog = new Model(catalogTypes, catalogEntities, null, { registry: 'isolated' });
```

An isolated model starts from its own copy of the built-in types and registers its table into
that copy. Its entities, and any schema that attaches it as a namespace, resolve types through
it; the shared registry, and `Schema.from` without a namespace, are untouched.
