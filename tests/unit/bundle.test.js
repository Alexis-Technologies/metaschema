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
// One bundle of the core entry and the subpaths, the way an
// application that uses them gets them: a subpath shares the core's modules,
// and its register() reaches the same Schema and Model classes.
const bundle = async (entry, options) => {
  const contents = [
    'module.exports = {',
    `core: require('./${entry}'),`,
    "generators: require('./src/generators/index.js'),",
    "compile: require('./src/compile/index.js'),",
    "model: require('./src/model/index.js'),",
    "stream: require('./src/stream/index.js'),",
    "formats: require('./src/formats/index.js'),",
    "derive: require('./src/derive/index.js'),",
    "coerce: require('./src/coerce/index.js'),",
    "mongodb: require('./src/mongodb/index.js'),",
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
  // A browser has the Web Streams and atob; a bare context has not.
  const context = vm.createContext({ TransformStream, atob });
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

const checkBundle = async (
  { core, generators, compile, model: tools, stream, formats, derive, coerce, mongodb },
  browser,
) => {
  const { Schema, Model } = core;
  assert.strictEqual('saveTypes' in core, false);
  // The coerce subpath through the bundle: the policy is the core's, the
  // converters the subpath's, and a parse that coerces before register()
  // says so.
  const query = new Schema('Query', { Form: { coerce: true }, page: 'integer', all: 'boolean' });
  assert.throws(() => query.parse({ page: '2' }), { code: 'ERR_NOT_REGISTERED' });
  coerce.register();
  assert.deepStrictEqual({ ...query.parse({ page: '2', all: '1' }).value }, { page: 2, all: true });
  assert.deepStrictEqual(
    { ...coerce.coerce(query, { page: '3', all: 'false' }) },
    {
      page: 3,
      all: false,
    },
  );
  assert.strictEqual(query.check({ page: '2', all: true }).valid, false);
  // The mongodb subpath through the bundle, with a driver of its own: the
  // id of a stored record is `_id`, an ObjectId, and comes back.
  class ObjectId {
    constructor(hex) {
      this.hex = hex;
    }

    get _bsontype() {
      return 'ObjectId';
    }

    toHexString() {
      return this.hex;
    }
  }
  const stores = new Model({ ...mongodb.types }, [
    ['Shop', { Entity: {}, name: { type: 'string', unique: true } }],
  ]);
  const shop = stores.entities.get('Shop');
  assert.throws(() => mongodb.toDocument(shop, {}), { code: 'ERR_NOT_REGISTERED' });
  mongodb.register({ bson: { ObjectId } });
  const id = 'c'.repeat(24);
  const stored = mongodb.toDocument(shop, { shopId: id, name: 'x' });
  assert.deepStrictEqual(Object.keys(stored), ['_id', 'name']);
  assert.strictEqual(stored['_id'].toHexString(), id);
  assert.deepStrictEqual(
    { ...mongodb.fromDocument(shop, stored).value },
    { shopId: id, name: 'x' },
  );
  assert.strictEqual(mongodb.checkUpdate(shop, { $set: { name: 1 } }).valid, false);
  // The derive subpath through the bundle: a stored kind becomes a struct
  // without its id, the index whose columns stay stays, and the methods
  // chain once registered.
  const member = new Model({}, [
    ['Member', { Entity: {}, login: 'string', password: 'string', byLogin: { unique: ['login'] } }],
  ]).entities.get('Member');
  const created = derive.omit(member, ['password']);
  assert.strictEqual(created.kind, 'struct');
  assert.deepStrictEqual(Object.keys(created.fields), ['login']);
  assert.deepStrictEqual(Object.keys(created.indexes), ['byLogin']);
  assert.strictEqual(member.partial, undefined);
  derive.register();
  assert.strictEqual(member.omit(['password']).partial().check({}).valid, true);
  // The stream subpath through the bundle: an entry per record, and a
  // transform of a stream that lets the valid records through.
  const streamRows = [{ name: 'x', qty: 1 }, { name: 1 }];
  const streamed = Schema.from({ name: 'string', qty: '?integer' });
  assert.deepStrictEqual(
    Array.from(stream.checkEach(streamed, streamRows), (entry) => entry.result.valid),
    [true, false],
  );
  const dropped = [];
  const source = new ReadableStream({
    start(controller) {
      for (const row of streamRows) controller.enqueue(row);
      controller.close();
    },
  });
  const passed = [];
  const piped = source.pipeThrough(
    stream.transform(streamed, { onInvalid: (record, result, index) => dropped.push(index) }),
  );
  for await (const value of piped) passed.push(value);
  assert.deepStrictEqual(passed, [{ name: 'x', qty: 1 }]);
  assert.deepStrictEqual(dropped, [1]);
  assert.strictEqual(streamed.checkEach, undefined);
  stream.register();
  assert.strictEqual(typeof streamed.checkEach, 'function');
  // The formats subpath through the bundle: the rule is the core's, the
  // table the subpath's, and a check reads the registered test.
  assert.throws(() => Schema.from({ email: { type: 'string', format: 'email' } }), {
    code: 'ERR_INVALID_RULE',
  });
  formats.register();
  const formatted = Schema.from({ email: { type: 'string', format: 'email' } });
  assert.strictEqual(formatted.check({ email: 'ann@example.com' }).valid, true);
  assert.deepStrictEqual(errorsOf(formatted.check({ email: 'nope' })), [
    'Field "email" is not a valid email',
  ]);
  const token = Schema.from({
    jwt: { type: 'string', format: 'jwt' },
    id: { type: 'string', format: 'ulid' },
  });
  assert.strictEqual(
    token.check({ jwt: 'eyJhbGciOiJub25lIn0.e30.', id: '01ARZ3NDEKTSV4RRFFQ69G5FAV' }).valid,
    true,
  );
  assert.strictEqual(
    token.check({ jwt: 'e30.e30.', id: '01ARZ3NDEKTSV4RRFFQ69G5FAV' }).valid,
    false,
  );
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
  // A definition inferred from values accepts them, through the bundle.
  const inferred = tools.infer([{ name: 'x', qty: 1 }, { name: 'y' }], { as: 'schema' });
  assert.strictEqual(inferred.check({ name: 'z', qty: 2 }).valid, true);
  assert.strictEqual(inferred.check({ name: 1 }).valid, false);
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
  // Bytes of this realm in the bundle's, flags and decimals, compiled or not.
  const binary = Schema.from({
    data: 'bytes',
    perms: { flags: ['read'] },
    price: { type: 'number', decimals: 2 },
  });
  compile.compile(binary);
  assert.strictEqual(
    binary.check({ data: new Uint8Array(1), perms: { read: true }, price: 0.1 + 0.2 }).valid,
    true,
  );
  assert.deepStrictEqual(errorsOf(binary.check({ data: [1], perms: { x: true }, price: 0.123 })), [
    'Field "data" not of expected type: bytes',
    'Field "perms" has unexpected keys: x',
    'Field "price" has more than 2 decimals',
  ]);
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

// The definition entry bundled on its own, the way a browser client that
// only reads schemas gets it, and run in a bare context: it builds and
// writes snapshots, and says that it does not validate.
const loadDefinition = async (minify, withCore = false) => {
  const contents = withCore
    ? "module.exports = { definition: require('./src/definition/index.js'), core: require('./browser.js') };"
    : "module.exports = { definition: require('./src/definition/index.js') };";
  const result = await esbuild.build({
    stdin: { contents, resolveDir: ROOT },
    bundle: true,
    write: false,
    logLevel: 'silent',
    platform: 'browser',
    format: 'iife',
    globalName: 'metaschema',
    minify,
  });
  const code = result.outputFiles[0].text;
  const context = vm.createContext({});
  vm.runInContext(code, context);
  return { ...context.metaschema, size: code.length };
};

const codeOf = (fn) => {
  try {
    fn();
    return null;
  } catch (error) {
    return error.code;
  }
};

for (const minify of [false, true]) {
  const label = minify ? 'minified' : 'unminified';
  test(`Bundle: the definition entry alone, ${label}`, async () => {
    const { definition } = await loadDefinition(minify);
    const { Schema, Model } = definition;
    const model = new Model({}, [
      ['Tag', { Struct: {}, label: 'string', data: '?bytes', 'parent?': 'Tag' }],
      ['Item', { Entity: {}, tag: 'Tag', perms: { flags: ['read'] } }],
    ]);
    const item = model.entities.get('Item');
    // The brand of the core, read across the copy of the bundle.
    assert.strictEqual(Schema.extractSchema(item), item);
    const snapshot = JSON.parse(JSON.stringify(item.toSnapshot()));
    assert.strictEqual(snapshot.root, 'Item');
    assert.deepStrictEqual(Object.keys(snapshot.entities), ['Tag', 'Item']);
    assert.strictEqual(snapshot.entities.Item.fields.perms.type, 'flags');
    assert.strictEqual('~standard' in item, false);
    for (const fn of [() => item.check({}), () => item.parse({}), () => model.warnings]) {
      assert.strictEqual(codeOf(fn), 'ERR_NOT_REGISTERED');
    }
  });

  test(`Bundle: the definition entry with the core, ${label}`, async () => {
    const { definition, core, size } = await loadDefinition(minify, true);
    assert.strictEqual(definition.Schema, core.Schema);
    const tag = new definition.Schema('Tag', { label: 'string', 'parent?': 'Tag' });
    assert.deepStrictEqual(errorsOf(tag.check({ label: 'a', parent: { label: 1 } })), [
      'Field "Tag.parent.label" not of expected type: string',
    ]);
    assert.strictEqual('~standard' in tag, true);
    // One copy of each module: the bundle of both is the core's, and the
    // few lines of the definition entry.
    const coreAlone = await esbuild.build({
      stdin: { contents: "module.exports = require('./browser.js');", resolveDir: ROOT },
      bundle: true,
      write: false,
      logLevel: 'silent',
      platform: 'browser',
      format: 'iife',
      globalName: 'metaschema',
      minify,
    });
    assert.ok(size - coreAlone.outputFiles[0].text.length < 1024);
  });
}

// The core entry imported for what it installs, the way the definition guide
// says to turn validation on (`import '@alexify/metaschema'`), in an ES
// module bundle: a bundler reads `sideEffects` of the package and drops an
// import of a module it believes free of them, so the entries and the
// validation half are listed there.
for (const platform of ['node', 'browser']) {
  test(`Bundle: the core imported for its side effects, ${platform}`, async () => {
    const entry = platform === 'node' ? 'index.js' : 'browser.js';
    const contents = [
      "import { Schema } from './src/definition/index.js';",
      `import './${entry}';`,
      "const tag = new Schema('Tag', { label: 'string' });",
      'export const errors = Array.from(tag.check({ label: 1 }).errors);',
    ].join('\n');
    const result = await esbuild.build({
      stdin: { contents, resolveDir: ROOT, loader: 'js' },
      bundle: true,
      write: false,
      logLevel: 'silent',
      platform,
      format: 'cjs',
    });
    assert.deepStrictEqual(result.warnings, []);
    const module = { exports: {} };
    const load = vm.compileFunction(result.outputFiles[0].text, ['module', 'exports', 'require']);
    load(module, module.exports, require);
    assert.deepStrictEqual(Array.from(module.exports.errors), [
      'Field "Tag.label" not of expected type: string',
    ]);
  });
}
