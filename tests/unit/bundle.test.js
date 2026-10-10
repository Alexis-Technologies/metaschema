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
    ['Company', { Struct: {}, name: 'string' }],
    ['Person', { Entity: {}, employer: 'Company' }],
  ]);
  const person = model.entities.get('Person');
  assert.deepStrictEqual(errorsOf(person.check({ employer: { name: 1 } })), [
    'Field "Person.employer.name" not of expected type: string',
  ]);

  // The Standard Schema accessor survives the bundler: a computed key on the
  // class and a private field behind it.
  const standard = flat['~standard'];
  assert.strictEqual(standard.version, 1);
  assert.strictEqual(standard.vendor, 'alexify.metaschema');
  assert.strictEqual('~standard' in person, true);
  const value = { name: 'Marcus', age: 1 };
  assert.strictEqual(standard.validate(value).value, value);
  const failed = standard.validate({ name: 1, age: 1 });
  const issues = Array.from(failed.issues, (issue) => [issue.message, Array.from(issue.path)]);
  assert.deepStrictEqual(issues, [['not of expected type: string', ['name']]]);
  assert.strictEqual(JSON.stringify(flat).includes('~standard'), false);

  // The JSON Schema export and the dts options through the bundle.
  const json = flat.toJSONSchema({ target: 'draft-07' });
  assert.strictEqual(json.$schema, 'http://json-schema.org/draft-07/schema#');
  assert.deepStrictEqual(Array.from(json.required), ['name', 'age']);
  assert.strictEqual(standard.jsonSchema.input({ target: 'draft-2020-12' }).type, 'object');
  assert.deepStrictEqual(Object.keys(standard.jsonSchema), ['input', 'output']);
  const mongo = model.toJSONSchema({ target: 'mongodb' });
  assert.strictEqual(mongo.Person.properties.employer.bsonType, 'object');
  assert.strictEqual(JSON.stringify(person.toJSONSchema().$defs.Company.required), '["name"]');
};

for (const minify of [false, true]) {
  const label = minify ? 'minified' : 'unminified';
  test(`Bundle: browser entry, ${label}`, async () => checkBundle(await loadBrowser(minify)));
  test(`Bundle: node entry, ${label}`, async () => checkBundle(await loadNode(minify)));
}
