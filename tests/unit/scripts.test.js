const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');

const run = (script, args) =>
  spawnSync(process.execPath, [path.join(ROOT, script), ...args], { cwd: ROOT, encoding: 'utf8' });

test('Scripts: size reports the entries and the subpaths and enforces the budgets', () => {
  const budgets = [
    '--max-gzip',
    '100',
    '--max-gzip-generators',
    '100',
    '--max-gzip-compile',
    '100',
    '--max-gzip-model',
    '100',
    '--max-gzip-stream',
    '100',
    '--max-gzip-formats',
    '100',
  ];
  const ok = run('scripts/size.js', budgets);
  assert.strictEqual(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /\| Node entry \(index\.js\) \|/);
  assert.match(ok.stdout, /\| Browser entry \(browser\.js\) \|/);
  assert.match(ok.stdout, /\| Generators \(\.\/generators\) on top of the Node entry \| [1-9]/);
  assert.match(ok.stdout, /\| Compile \(\.\/compile\) on top of the Node entry \| [1-9]/);
  assert.match(ok.stdout, /\| Model \(\.\/model\) on top of the Node entry \| [1-9]/);
  assert.match(ok.stdout, /\| Stream \(\.\/stream\) on top of the Node entry \| [1-9]/);
  assert.match(ok.stdout, /\| Formats \(\.\/formats\) on top of the Node entry \| [1-9]/);

  const over = run('scripts/size.js', ['--max-gzip', '1']);
  assert.strictEqual(over.status, 1);
  assert.match(over.stderr, /Bundle budget exceeded: Node entry/);
  assert.match(over.stderr, /Bundle budget exceeded: Browser entry/);
  assert.doesNotMatch(over.stderr, /Generators/);

  const generators = run('scripts/size.js', ['--max-gzip-generators', '1']);
  assert.strictEqual(generators.status, 1);
  assert.match(generators.stderr, /Bundle budget exceeded: Generators/);
  assert.doesNotMatch(generators.stderr, /exceeded: Node entry/);
  assert.doesNotMatch(generators.stderr, /exceeded: Compile/);

  const compile = run('scripts/size.js', ['--max-gzip-compile', '1']);
  assert.strictEqual(compile.status, 1);
  assert.match(compile.stderr, /Bundle budget exceeded: Compile \(\.\/compile\)/);
  assert.doesNotMatch(compile.stderr, /exceeded: Generators/);
  assert.doesNotMatch(compile.stderr, /exceeded: Model/);

  const model = run('scripts/size.js', ['--max-gzip-model', '1']);
  assert.strictEqual(model.status, 1);
  assert.match(model.stderr, /Bundle budget exceeded: Model \(\.\/model\)/);
  assert.doesNotMatch(model.stderr, /exceeded: Compile/);
  assert.doesNotMatch(model.stderr, /exceeded: Stream/);

  const stream = run('scripts/size.js', ['--max-gzip-stream', '0.5']);
  assert.strictEqual(stream.status, 1);
  assert.match(stream.stderr, /Bundle budget exceeded: Stream \(\.\/stream\)/);
  assert.doesNotMatch(stream.stderr, /exceeded: Model/);

  const formats = run('scripts/size.js', ['--max-gzip-formats', '1']);
  assert.strictEqual(formats.status, 1);
  assert.match(formats.stderr, /Bundle budget exceeded: Formats \(\.\/formats\)/);
  assert.doesNotMatch(formats.stderr, /exceeded: Stream/);

  const bad = run('scripts/size.js', ['--max-gzip', 'lots']);
  assert.strictEqual(bad.status, 1);
  assert.match(bad.stderr, /--max-gzip needs a positive number of kilobytes/);
  const badGenerators = run('scripts/size.js', ['--max-gzip-generators', 'x']);
  assert.strictEqual(badGenerators.status, 1);
  assert.match(badGenerators.stderr, /--max-gzip-generators needs a positive number/);
  const badCompile = run('scripts/size.js', ['--max-gzip-compile', '-2']);
  assert.strictEqual(badCompile.status, 1);
  assert.match(badCompile.stderr, /--max-gzip-compile needs a positive number/);
  const badModel = run('scripts/size.js', ['--max-gzip-model', '0']);
  assert.strictEqual(badModel.status, 1);
  assert.match(badModel.stderr, /--max-gzip-model needs a positive number/);
  const badStream = run('scripts/size.js', ['--max-gzip-stream', 'no']);
  assert.strictEqual(badStream.status, 1);
  assert.match(badStream.stderr, /--max-gzip-stream needs a positive number/);
  const badFormats = run('scripts/size.js', ['--max-gzip-formats', '']);
  assert.strictEqual(badFormats.status, 1);
  assert.match(badFormats.stderr, /--max-gzip-formats needs a positive number/);
});
