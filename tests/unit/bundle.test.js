const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '../..');

// Bundlers rename classes (esbuild emits `class _Schema` for a class that
// refers to itself) and minifiers mangle them, so any identity check based on
// a class name silently breaks in a consumer's build. These tests load both
// entry points the way a bundler would and validate through the result.
// One bundle of the core entry and the three subpaths, the way an
// application that uses them gets them: a subpath shares the core's modules,
// and its register() reaches the same Schema and Model classes.
const bundle = async (entry, options) => {
  const contents = [
    'module.exports = {',
    `core: require('./${entry}'),`,
    "generators: require('./src/generators/index.js'),",
    "compile: require('./src/compile/index.js'),",
    "model: require('./src/model/index.js'),",
    '};',
  ].join(' ');
  const result = await esbuild.build({
    stdin: { contents, resolveDir: ROOT },
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

// Whether this process may build a function from source: not under
// --disallow-code-generation-from-strings (pnpm run test:nojit), which binds
// the main context; a vm context of its own, where the browser bundle runs,
// is not bound by it, so that bundle is held to its own probe.
const evaluates = (() => {
  try {
    // oxlint-disable-next-line no-new-func
    return typeof new Function('') === 'function';
  } catch {
    return false;
  }
})();

const checkBundle = async ({ core, generators, compile, model: tools }, browser) => {
  const { Schema, Model } = core;
  assert.strictEqual('saveTypes' in core, false);
  // The model subpath through the bundle: a snapshot of the bundled Model
  // class comes back as one, and the changes between two versions classify.
  const prev = new Model({}, [['Item', { Entity: {}, name: 'string', qty: 'integer' }]]);
  const snapshot = JSON.parse(JSON.stringify(prev));
  assert.strictEqual(snapshot.format, 1);
  assert.deepStrictEqual(Array.from(Object.keys(snapshot.entities.Item.fields)), [
    'name',
    'qty',
    'itemId',
  ]);
  const restored = tools.fromJSON(snapshot);
  assert.strictEqual(JSON.stringify(restored), JSON.stringify(snapshot));
  assert.strictEqual(restored.entities.get('Item').check({ name: 'x', qty: 1 }).valid, true);
  const next = new Model({}, [
    ['Item', { Entity: {}, name: 'string', qty: 'number', 'note?': 'string' }],
  ]);
  const changes = tools.diff(snapshot, next);
  assert.deepStrictEqual(
    Array.from(changes, (change) => `${change.op} ${change.name}`),
    ['changed qty', 'added note'],
  );
  assert.strictEqual(tools.compatibility(changes), 'backward');
  // A sample passes the check it was drawn for; a merge takes both fields.
  const item = next.entities.get('Item');
  assert.strictEqual(item.check(tools.sample(item, { seed: 3 })).valid, true);
  const merged = tools.merge(item, Schema.from({ qty: { type: 'number', max: 9 }, tag: 'string' }));
  assert.deepStrictEqual(Array.from(Object.keys(merged.fields)), [
    'name',
    'qty',
    'note',
    'itemId',
    'tag',
  ]);
  assert.strictEqual(merged.check({ name: 'x', qty: 10, tag: 't' }).valid, false);
  assert.strictEqual(Model.diff, undefined);
  tools.register();
  assert.strictEqual(Model.compatibility(Model.diff(prev, next)), 'backward');
  assert.strictEqual(typeof item.sample, 'function');
  assert.strictEqual(Schema.merge, tools.merge);
  // The compile subpath through the bundle: the generated check validates
  // like the closures, inside a vm context too, or the fallback does.
  const fast = Schema.from({ name: 'string', 'age?': 'number', tags: { array: 'string' } });
  const accelerated = browser ? compile.canEval() : evaluates;
  assert.strictEqual(compile.canEval(), accelerated);
  // The result is an object of the bundle's realm, so its fields are read.
  assert.strictEqual(compile.compile(fast).accelerated, accelerated);
  assert.deepStrictEqual(errorsOf(fast.check({ name: 1, tags: ['a', 2], age: null })), [
    'Field "name" not of expected type: string',
    'Field "tags[1]" not of expected type: string',
  ]);
  assert.strictEqual(fast.check({ name: 'x', tags: [] }).valid, true);
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
  assert.strictEqual(compile.compile(model).accelerated, accelerated);
  assert.deepStrictEqual(errorsOf(person.check({ employer: { name: 1 } })), [
    'Field "Person.employer.name" not of expected type: string',
  ]);

  // parse, parseAsync, checkAsync and serialize through the bundle, over the
  // compiled check where there is one.
  const event = Schema.from({
    name: 'string',
    'level?': { type: 'integer', default: 1 },
    when: {
      type: 'string',
      parse: (text) => new Date(text).getTime(),
      serialize: (time) => new Date(time).toISOString(),
    },
    'note?': { type: 'string', validate: async (text) => text !== 'bad' || 'is bad' },
  });
  assert.strictEqual(compile.compile(event).accelerated, accelerated);
  const parsed = event.parse(
    { name: 'x', when: '1970-01-01T00:00:01.000Z', extra: 1 },
    { unknown: 'strip' },
  );
  assert.strictEqual(parsed.valid, true);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(parsed.value)), {
    name: 'x',
    when: 1000,
    level: 1,
  });
  assert.strictEqual(parsed.issues.length, 0);
  assert.strictEqual(event.parse({ name: 1 }).valid, false);
  const settled = await event.parseAsync({
    name: 'x',
    when: '1970-01-01T00:00:01.000Z',
    note: 'bad',
  });
  assert.strictEqual(settled.valid, false);
  assert.deepStrictEqual(errorsOf({ errors: settled.issues.map((issue) => issue.message) }), [
    'is bad',
  ]);
  const checked = await event.checkAsync({ name: 'x', when: 'w', note: 'ok' });
  assert.strictEqual(checked.valid, true);
  assert.throws(() => event.check({ name: 'x', when: 'w', note: 'ok' }), {
    code: 'ERR_ASYNC_VALIDATOR',
  });
  assert.strictEqual(
    event.serialize({ name: 'x', when: 1000, level: 1 }).value.when,
    '1970-01-01T00:00:01.000Z',
  );
  // A promise of the bundle's realm.
  assert.strictEqual(typeof event['~standard'].validate({ name: 'x', when: 'w' }).then, 'function');

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

  // The generators through the bundle: the functions, then the methods
  // register() installs on the bundled classes.
  assert.strictEqual(typeof flat.toJSONSchema, 'undefined');
  assert.strictEqual(generators.toJSONSchema(flat, { target: 'draft-07' }).type, 'object');
  assert.strictEqual(generators.toTypeScript(person).startsWith('interface Person {'), true);
  generators.register();
  const json = flat.toJSONSchema({ target: 'draft-07' });
  assert.strictEqual(json.$schema, 'http://json-schema.org/draft-07/schema#');
  assert.deepStrictEqual(Array.from(json.required), ['name', 'age']);
  // The converter joins the props the core built before registration.
  assert.strictEqual(flat['~standard'], standard);
  assert.strictEqual(standard.jsonSchema.input({ target: 'draft-2020-12' }).type, 'object');
  assert.deepStrictEqual(Object.keys(standard.jsonSchema), ['input', 'output']);
  const mongo = model.toJSONSchema({ target: 'mongodb' });
  assert.strictEqual(mongo.Person.properties.employer.bsonType, 'object');
  // The import of a document, and the export of the import.
  const imported = generators.fromJSONSchema(json, { as: 'schema' });
  assert.strictEqual(imported.check({ name: 'x', age: 1 }).valid, true);
  assert.strictEqual(imported.check({ name: 1 }).valid, false);
  assert.strictEqual(
    JSON.stringify(imported.toJSONSchema({ target: 'draft-07' })),
    JSON.stringify(json),
  );
  assert.strictEqual(Schema.fromJSONSchema, generators.fromJSONSchema);
  assert.strictEqual(JSON.stringify(person.toJSONSchema().$defs.Company.required), '["name"]');
  const named = new Model({}, [['Doc', { Struct: {}, status: { enum: ['a'] } }]]);
  assert.strictEqual(named.toTypeScript({ named: true }).startsWith('type DocStatus = "a";'), true);
  // The browser map swaps the runtime behind saveTypes; the Node runtime writes.
  if (browser) {
    const written = generators.saveTypes('model.d.ts', named);
    await assert.rejects(written, { message: 'saveTypes is not available in the browser' });
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metaschema-'));
  const file = path.join(dir, 'model.d.ts');
  await generators.saveTypes(file, named);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), generators.toTypeScript(named));
  fs.rmSync(dir, { recursive: true, force: true });
};

for (const minify of [false, true]) {
  const label = minify ? 'minified' : 'unminified';
  test(`Bundle: browser entry, ${label}`, async () => checkBundle(await loadBrowser(minify), true));
  test(`Bundle: node entry, ${label}`, async () => checkBundle(await loadNode(minify), false));
}
