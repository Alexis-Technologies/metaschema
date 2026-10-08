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
| `{ js: '<builtin>', metadata }` | a new type that validates like `<builtin>` |
| `{ construct, checkType, ...proto }` | a new type with its own logic |

A prototype for a new type must have `construct(def, preprocessor)` and
`checkType(value, path)` methods, or `Model` throws. `checkType` returns `null` when the value is
valid, or an error string (or an array of them). `kind` (`'scalar'` or `'struct'`) and
`rules` (for example `['length']`) are optional. Other keys, like `symbols` below, are copied onto
every field of the type and are available as `this.<key>` inside the methods:

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

## Types are registered globally

Type registration is process-wide: once a `Model` registers `ip` or adds metadata to `string`,
every schema in the process sees it, including ones built with `Schema.from`. Register your types
once, at startup, and use the same table everywhere.
