const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');

// index.d.ts is written by hand: every runtime export must be declared in it,
// and every declared value export must exist at runtime. `export type` and
// `export interface` have no runtime counterpart and are not compared.
const declaredValueExports = (dtsFile) => {
  const source = fs.readFileSync(path.join(ROOT, dtsFile), 'utf8');
  const pattern = /^export (?:declare )?(?:abstract )?(?:class|function|const|let|var) ([\w$]+)/gm;
  const names = new Set();
  for (const match of source.matchAll(pattern)) names.add(match[1]);
  return names;
};

const entryPoints = [
  ['index.js', 'index.d.ts'],
  ['browser.js', 'index.d.ts'],
  ['src/generators/index.js', 'src/generators/index.d.ts'],
  ['src/compile/index.js', 'src/compile/index.d.ts'],
  ['src/model/index.js', 'src/model/index.d.ts'],
  ['src/stream/index.js', 'src/stream/index.d.ts'],
  ['src/formats/index.js', 'src/formats/index.d.ts'],
];

for (const [runtimeFile, dtsFile] of entryPoints) {
  test(`Exports: ${runtimeFile} matches ${dtsFile}`, () => {
    const runtime = new Set(Object.keys(require(path.join(ROOT, runtimeFile))));
    const declared = declaredValueExports(dtsFile);
    const undeclared = [...runtime].filter((name) => !declared.has(name)).sort();
    const phantom = [...declared].filter((name) => !runtime.has(name)).sort();
    assert.deepStrictEqual(undeclared, [], `missing from ${dtsFile}`);
    assert.deepStrictEqual(phantom, [], `absent from ${runtimeFile} at runtime`);
  });
}

test('Exports: the generators are reachable through their subpath export', () => {
  const generators = require('@alexify/metaschema/generators');
  assert.strictEqual(generators, require(path.join(ROOT, 'src/generators/index.js')));
  assert.deepStrictEqual(Object.keys(generators), [
    'toJSONSchema',
    'toTypeScript',
    'saveTypes',
    'fromJSONSchema',
    'register',
  ]);
  const source = [
    "import { toJSONSchema, toTypeScript, saveTypes, register } from '@alexify/metaschema/generators';",
    "import { Schema } from '@alexify/metaschema';",
    "const schema = Schema.from({ name: 'string' });",
    'register();',
    'const document = toJSONSchema(schema);',
    'process.stdout.write(JSON.stringify([document.type, toTypeScript(schema), typeof saveTypes, schema.toJSONSchema().type]));',
  ].join('\n');
  const args = ['--input-type=module', '-e', source];
  const output = execFileSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
  assert.deepStrictEqual(JSON.parse(output), [
    'object',
    'interface  {\n  name: string;\n}',
    'function',
    'object',
  ]);
});

test('Exports: the compile subpath is reachable through its subpath export', () => {
  const compile = require('@alexify/metaschema/compile');
  assert.strictEqual(compile, require(path.join(ROOT, 'src/compile/index.js')));
  assert.deepStrictEqual(Object.keys(compile), ['compile', 'register', 'canEval']);
  const source = [
    "import { compile, register, canEval } from '@alexify/metaschema/compile';",
    "import { Schema } from '@alexify/metaschema';",
    "const schema = Schema.from({ name: 'string' });",
    'const { accelerated } = compile(schema);',
    'const errors = schema.check({ name: 1 }).errors;',
    'process.stdout.write(JSON.stringify([accelerated, canEval(), typeof register, errors]));',
  ].join('\n');
  const args = ['--input-type=module', '-e', source];
  const output = execFileSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
  assert.deepStrictEqual(JSON.parse(output), [
    true,
    true,
    'function',
    ['Field "name" not of expected type: string'],
  ]);
});

test('Exports: the model subpath is reachable through its subpath export', () => {
  const model = require('@alexify/metaschema/model');
  assert.strictEqual(model, require(path.join(ROOT, 'src/model/index.js')));
  assert.deepStrictEqual(Object.keys(model), [
    'fromJSON',
    'diff',
    'compatibility',
    'compatibilityOf',
    'sample',
    'merge',
    'infer',
    'register',
  ]);
  const source = [
    "import { fromJSON, diff, compatibility, register } from '@alexify/metaschema/model';",
    "import { Model } from '@alexify/metaschema';",
    "const prev = new Model({}, [['A', { Struct: {}, x: 'string' }]]);",
    "const next = new Model({}, [['A', { Struct: {}, x: 'string', y: '?string' }]]);",
    'const changes = diff(JSON.parse(JSON.stringify(prev)), next);',
    'register();',
    'const restored = Model.fromJSON(prev.toJSON());',
    'process.stdout.write(JSON.stringify([changes.length, compatibility(changes), fromJSON === Model.fromJSON, [...restored.order]]));',
  ].join('\n');
  const args = ['--input-type=module', '-e', source];
  const output = execFileSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
  assert.deepStrictEqual(JSON.parse(output), [1, 'full', true, ['A']]);
});

test('Exports: the stream subpath is reachable through its subpath export', () => {
  const stream = require('@alexify/metaschema/stream');
  assert.strictEqual(stream, require(path.join(ROOT, 'src/stream/index.js')));
  assert.deepStrictEqual(Object.keys(stream), [
    'checkEach',
    'parseEach',
    'checkEachAsync',
    'parseEachAsync',
    'transform',
    'register',
  ]);
  const source = [
    "import { checkEach, parseEach, transform, register } from '@alexify/metaschema/stream';",
    "import { Schema } from '@alexify/metaschema';",
    "const schema = Schema.from({ name: 'string', 'n?': { type: 'number', default: 1 } });",
    "const rows = [{ name: 'a' }, { name: 1 }];",
    'const verdicts = Array.from(checkEach(schema, rows), (entry) => entry.result.valid);',
    'const values = Array.from(parseEach(schema, rows), (entry) => entry.result.value);',
    'register();',
    'process.stdout.write(JSON.stringify([verdicts, values, typeof schema.checkEach, transform(schema) instanceof TransformStream]));',
  ].join('\n');
  const args = ['--input-type=module', '-e', source];
  const output = execFileSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
  assert.deepStrictEqual(JSON.parse(output), [
    [true, false],
    [{ name: 'a', n: 1 }, null],
    'function',
    true,
  ]);
});

test('Exports: the formats subpath is reachable through its subpath export', () => {
  const formats = require('@alexify/metaschema/formats');
  assert.strictEqual(formats, require(path.join(ROOT, 'src/formats/index.js')));
  assert.deepStrictEqual(Object.keys(formats), ['FORMATS', 'register']);
  const source = [
    "import { FORMATS, register } from '@alexify/metaschema/formats';",
    "import { Schema } from '@alexify/metaschema';",
    'const before = Object.keys(FORMATS).length;',
    'register();',
    "const schema = Schema.from({ email: { type: 'string', format: 'email' } });",
    "const verdicts = ['ann@example.com', 'nope'].map((email) => schema.check({ email }).valid);",
    'process.stdout.write(JSON.stringify([before, Object.keys(FORMATS).length, verdicts]));',
  ].join('\n');
  const args = ['--input-type=module', '-e', source];
  const output = execFileSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
  assert.deepStrictEqual(JSON.parse(output), [0, 9, [true, false]]);
});

test('Exports: the locales are reachable through their subpath exports', () => {
  for (const name of ['en', 'uk']) {
    const locale = require(`@alexify/metaschema/locales/${name}`);
    assert.strictEqual(locale, require(path.join(ROOT, `src/locales/${name}.js`)));
    assert.strictEqual(typeof locale.required, 'function');
  }
  const source = [
    "import uk from '@alexify/metaschema/locales/uk';",
    "import { required } from '@alexify/metaschema/locales/en';",
    'process.stdout.write(JSON.stringify([uk.required({}), required({})]));',
  ].join('\n');
  const args = ['--input-type=module', '-e', source];
  const output = execFileSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
  assert.deepStrictEqual(JSON.parse(output), ['є обовʼязковим', 'is required']);
});

test('Exports: named imports work from ESM', () => {
  const names = [...declaredValueExports('index.d.ts')].sort();
  const source = [
    `import { ${names.join(', ')} } from '@alexify/metaschema';`,
    `const values = { ${names.join(', ')} };`,
    'const missing = Object.keys(values).filter((name) => values[name] === undefined);',
    'process.stdout.write(JSON.stringify(missing));',
  ].join('\n');
  const args = ['--input-type=module', '-e', source];
  const output = execFileSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
  assert.deepStrictEqual(JSON.parse(output), []);
});
