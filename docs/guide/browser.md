# Browser

`@alexify/metaschema` runs in the browser without configuration. Nothing in the package touches a
Node.js builtin except the file write behind `saveTypes`, which lives in `src/runtime/node.js`.

Bundlers that honor the `browser` field or the `browser` export condition (Vite, webpack, esbuild,
Rollup with the node-resolve plugin) pick `browser.js` and swap `src/runtime/node.js` for its
browser twin automatically.

```js
import { Schema } from '@alexify/metaschema';

const form = Schema.from({ email: 'string', age: '?number' });
const { valid, errors } = form.check({ email: 'marcus@example.com', age: 42 });
```

Everything works the same as in Node.js, with one exception: `saveTypes` of the generators subpath
has no file system to write to, so it returns a rejected promise. Read `toTypeScript(model)` and
send it wherever you need instead.

Bundling and minification are safe: metaschema recognises its own schemas, fields and results by a
global symbol brand (`Symbol.for`), not by class names, so a bundler that renames a class or a
minifier that mangles it cannot switch validation off. The repository's `tests/unit/bundle.test.js`
builds both entry points with esbuild, minified and not, and validates through the result.

The core entry is 12.0 KB min+gzip in either environment, and CI keeps it under 13 KB; the
`@alexify/metaschema/generators` subpath (JSON Schema, TypeScript) adds 3.9 KB where it is
imported, under a budget of 5 KB.
`pnpm size` in the repository prints the exact numbers.
