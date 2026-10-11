// Loaded with --require before the suites (`pnpm run test:jit`): every schema
// built from here on is compiled, so the whole suite runs on the JIT
// backend. With eval available the mode is strict, so a schema the JIT
// cannot build fails the test instead of falling back; under
// --disallow-code-generation-from-strings (`pnpm run test:nojit`) the same
// helper registers the fallback and the suite passes through the closures.
// A test that pins the closure backend itself reads the backend from here.
const { register, canEval } = require('../../src/compile/index.js');

const jit = canEval();
process.env.METASCHEMA_BACKEND = jit ? 'jit' : 'closure';
register({ jit: jit ? true : 'auto' });
