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

The core entry is 17.2 KB min+gzip in either environment, and CI keeps it under 17.5 KB; the
`@alexify/metaschema/generators` subpath (JSON Schema, TypeScript) adds 7.1 KB where it is
imported, under a budget of 7.5 KB, the `@alexify/metaschema/compile` subpath (the JIT backend)
4.0 KB, under 4.25 KB, and the `@alexify/metaschema/model` subpath (snapshots, diff, samples,
merge) 9.5 KB, under 10 KB. `pnpm size` in the repository prints the exact numbers.

## Content Security Policy

The [JIT backend](/guide/compile) builds a check with `new Function`, which a Content Security
Policy without `'unsafe-eval'` forbids. The subpath probes it once (`canEval()`) and keeps the
closure backend where it is forbidden: `compile` returns `{ accelerated: false }`, `register()`
installs nothing, and `check` behaves exactly as before, at the speed of the closures. Nothing in
the core entry evaluates code, so a policy without `'unsafe-eval'` is the right default; add the
subpath where the policy allows it and let the probe decide, or pass `{ jit: false }` where
generated code is not wanted at all.
