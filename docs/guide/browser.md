# Browser

`@alexify/metaschema` runs in the browser without configuration. Nothing in the package touches a
Node.js builtin except `saveTypes`, which lives in `src/runtime/node.js`.

Bundlers that honor the `browser` field or the `browser` export condition (Vite, webpack, esbuild,
Rollup with the node-resolve plugin) pick `browser.js` and swap `src/runtime/node.js` for its
browser twin automatically.

```js
import { Schema } from '@alexify/metaschema';

const form = Schema.from({ email: 'string', age: '?number' });
const { valid, errors } = form.check({ email: 'marcus@example.com', age: 42 });
```

Everything works the same as in Node.js, with one exception: `saveTypes` has no file system to write
to, so it returns a rejected promise. Read `model.dts` and send it wherever you need instead.

The whole package is about 6 KB min+gzip in either environment. `pnpm size` in the repository
prints the exact numbers.
