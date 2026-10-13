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

The core entry is 18.1 KB min+gzip in either environment, and CI keeps it under 19 KB; the
`@alexify/metaschema/generators` subpath (JSON Schema, TypeScript) adds 7.4 KB where it is
imported, under a budget of 7.5 KB, the `@alexify/metaschema/compile` subpath (the JIT backend)
4.2 KB, under 5 KB, the `@alexify/metaschema/model` subpath (snapshots, diff, samples,
merge, inference) 12.0 KB, under 13 KB, the `@alexify/metaschema/stream` subpath (records and
streams) 1.0 KB, under 1.5 KB, the `@alexify/metaschema/formats` subpath (string formats)
4.0 KB, under 5 KB, the `@alexify/metaschema/derive` subpath (pick, omit, partial) 1.9 KB,
under 2.5 KB, the `@alexify/metaschema/coerce` subpath (the converters of coercion) 1.4 KB,
under 2 KB, and the `@alexify/metaschema/mongodb` subpath 3.5 KB on top of `./coerce`, under
4 KB. `pnpm size` in the repository prints the exact numbers. The package says
`sideEffects: false`: nothing registers on import, so a bundler may drop a subpath an ESM
program imports and never calls (a CommonJS `require` of a subpath keeps it whole: there is no
tree shaking of one format or one converter out of its table).

## Content Security Policy

The [JIT backend](/guide/compile) builds a check with `new Function`, which a Content Security
Policy without `'unsafe-eval'` forbids. The subpath probes it once (`canEval()`) and keeps the
closure backend where it is forbidden: `compile` returns `{ accelerated: false }`, `register()`
installs nothing, and `check` behaves exactly as before, at the speed of the closures. Nothing in
the core entry evaluates code, so a policy without `'unsafe-eval'` is the right default; add the
subpath where the policy allows it and let the probe decide, or pass `{ jit: false }` where
generated code is not wanted at all.
