const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');

const run = (script, args) =>
  spawnSync(process.execPath, [path.join(ROOT, script), ...args], { cwd: ROOT, encoding: 'utf8' });

test('Scripts: a subpath is measured on top of the core and the subpaths it requires', async () => {
  const { SUBPATHS, extrasOf } = require('../../scripts/size.js');
  // A fake measure: a size per subpath in the bundle, over a core of 1000.
  const sizes = {
    './src/coerce/index.js': 300,
    './src/mongodb/index.js': 400,
    './src/generators/index.js': 70,
  };
  const size = (entry, subpaths) => {
    let total = 1000;
    for (const subpath of subpaths) total += sizes[subpath] ?? 10;
    return { label: entry.label, raw: total * 3, min: total * 2, gzip: total };
  };
  const core = size({ label: 'core' }, []);
  const extras = await extrasOf(core, size);
  const byLabel = new Map(extras.map((row) => [row.label, row]));
  const mongodb = byLabel.get('MongoDB (./mongodb) on top of the Node entry and ./coerce');
  // (core + coerce + mongodb) − (core + coerce): the base is not charged.
  assert.deepStrictEqual([mongodb.gzip, mongodb.min, mongodb.raw], [400, 800, 1200]);
  assert.strictEqual(byLabel.get('Coerce (./coerce) on top of the Node entry').gzip, 300);
  assert.strictEqual(byLabel.get('Generators (./generators) on top of the Node entry').gzip, 70);
  assert.strictEqual(extras.length, SUBPATHS.length);
  assert.deepStrictEqual(SUBPATHS.find((entry) => entry.flag === '--max-gzip-mongodb').base, [
    './src/coerce/index.js',
  ]);
});

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
    '--max-gzip-derive',
    '100',
    '--max-gzip-coerce',
    '100',
    '--max-gzip-mongodb',
    '100',
    '--max-gzip-definition',
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
  assert.match(ok.stdout, /\| Derive \(\.\/derive\) on top of the Node entry \| [1-9]/);
  assert.match(ok.stdout, /\| Coerce \(\.\/coerce\) on top of the Node entry \| [1-9]/);
  assert.match(
    ok.stdout,
    /\| MongoDB \(\.\/mongodb\) on top of the Node entry and \.\/coerce \| [1-9]/,
  );
  assert.match(ok.stdout, /\| Definition \(\.\/definition\) on its own \| [1-9]/);

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

  const derive = run('scripts/size.js', ['--max-gzip-derive', '1']);
  assert.strictEqual(derive.status, 1);
  assert.match(derive.stderr, /Bundle budget exceeded: Derive \(\.\/derive\)/);
  assert.doesNotMatch(derive.stderr, /exceeded: Formats/);

  const coerce = run('scripts/size.js', ['--max-gzip-coerce', '0.5']);
  assert.strictEqual(coerce.status, 1);
  assert.match(coerce.stderr, /Bundle budget exceeded: Coerce \(\.\/coerce\)/);
  assert.doesNotMatch(coerce.stderr, /exceeded: Derive/);

  const mongodb = run('scripts/size.js', ['--max-gzip-mongodb', '1']);
  assert.strictEqual(mongodb.status, 1);
  assert.match(mongodb.stderr, /Bundle budget exceeded: MongoDB \(\.\/mongodb\)/);
  assert.doesNotMatch(mongodb.stderr, /exceeded: Coerce/);

  const definition = run('scripts/size.js', ['--max-gzip-definition', '1']);
  assert.strictEqual(definition.status, 1);
  assert.match(definition.stderr, /Bundle budget exceeded: Definition \(\.\/definition\)/);
  assert.doesNotMatch(definition.stderr, /exceeded: (Node|Browser) entry/);

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
  const badDerive = run('scripts/size.js', ['--max-gzip-derive', 'none']);
  assert.strictEqual(badDerive.status, 1);
  assert.match(badDerive.stderr, /--max-gzip-derive needs a positive number/);
  const badCoerce = run('scripts/size.js', ['--max-gzip-coerce', '-1']);
  assert.strictEqual(badCoerce.status, 1);
  assert.match(badCoerce.stderr, /--max-gzip-coerce needs a positive number/);
  const badMongodb = run('scripts/size.js', ['--max-gzip-mongodb', 'x']);
  assert.strictEqual(badMongodb.status, 1);
  assert.match(badMongodb.stderr, /--max-gzip-mongodb needs a positive number/);
});
