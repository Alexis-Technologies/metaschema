const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '../..');

// Bundlers rename classes (esbuild emits `class _Schema` for a class that
// refers to itself) and minifiers mangle them, so any identity check based on
// a class name silently breaks in a consumer's build. These tests load both
// entry points the way a bundler would and validate through the result.
const bundle = async (entry, options) => {
  const result = await esbuild.build({
    entryPoints: [path.join(ROOT, entry)],
    bundle: true,
    write: false,
    logLevel: 'silent',
    ...options,
  });
  return result.outputFiles[0].text;
};

const loadBrowser = async (minify) => {
  const code = await bundle('browser.js', {
    platform: 'browser',
    format: 'iife',
    globalName: 'metaschema',
    minify,
  });
  const context = vm.createContext({});
  vm.runInContext(code, context);
  return context.metaschema;
};

const loadNode = async (minify) => {
  const code = await bundle('index.js', { platform: 'node', format: 'cjs', minify });
  const module = { exports: {} };
  const load = vm.compileFunction(code, ['module', 'exports', 'require']);
  load(module, module.exports, require);
  return module.exports;
};

// Arrays built inside another vm context have that context's Array.prototype,
// which deepStrictEqual rejects, so results are copied into this realm first.
const errorsOf = (result) => Array.from(result.errors);

const checkBundle = ({ Schema, Model }) => {
  const flat = Schema.from({ name: 'string', age: 'number' });
  assert.deepStrictEqual(errorsOf(flat.check({ name: 1, age: 'x' })), [
    'Field "name" not of expected type: string',
    'Field "age" not of expected type: number',
  ]);
  const nested = Schema.from({ inner: { a: 'string' } });
  assert.deepStrictEqual(errorsOf(nested.check({ inner: { a: 1 } })), [
    'Field "inner.a" not of expected type: string',
  ]);

  const inner = Schema.from({ a: 'string' });
  assert.strictEqual(Schema.extractSchema(inner), inner);
  assert.strictEqual(Schema.from(inner), inner);
  assert.deepStrictEqual(errorsOf(Schema.from({ part: inner }).check({ part: { a: 1 } })), [
    'Field "part.a" not of expected type: string',
  ]);
  const long = new Schema('Outer', { part: { schema: inner } });
  assert.deepStrictEqual(errorsOf(long.check({ part: { a: 1 } })), [
    'Field "Outer.part.a" not of expected type: string',
  ]);

  const withValidate = Schema.from({
    a: { type: 'string', validate: (value) => value.length > 1 || 'too short' },
  });
  assert.deepStrictEqual(errorsOf(withValidate.check({ a: 'x' })), ['Field "a" too short']);

  const model = new Model({}, [
    ['Company', { Entity: {}, name: 'string' }],
    ['Person', { Entity: {}, employer: 'Company' }],
  ]);
  const person = model.entities.get('Person');
  assert.deepStrictEqual(errorsOf(person.check({ employer: { name: 1 } })), [
    'Field "Person.employer.name" not of expected type: string',
  ]);
};

for (const minify of [false, true]) {
  const label = minify ? 'minified' : 'unminified';
  test(`Bundle: browser entry, ${label}`, async () => checkBundle(await loadBrowser(minify)));
  test(`Bundle: node entry, ${label}`, async () => checkBundle(await loadNode(minify)));
}
