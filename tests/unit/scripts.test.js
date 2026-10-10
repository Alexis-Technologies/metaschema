const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');

const run = (script, args) =>
  spawnSync(process.execPath, [path.join(ROOT, script), ...args], { cwd: ROOT, encoding: 'utf8' });

test('Scripts: size reports the entries and the generators and enforces the budgets', () => {
  const ok = run('scripts/size.js', ['--max-gzip', '100', '--max-gzip-generators', '100']);
  assert.strictEqual(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /\| Node entry \(index\.js\) \|/);
  assert.match(ok.stdout, /\| Browser entry \(browser\.js\) \|/);
  assert.match(ok.stdout, /\| Generators \(\.\/generators\) on top of the Node entry \| [1-9]/);

  const over = run('scripts/size.js', ['--max-gzip', '1']);
  assert.strictEqual(over.status, 1);
  assert.match(over.stderr, /Bundle budget exceeded: Node entry/);
  assert.match(over.stderr, /Bundle budget exceeded: Browser entry/);
  assert.doesNotMatch(over.stderr, /Generators/);

  const generators = run('scripts/size.js', ['--max-gzip-generators', '1']);
  assert.strictEqual(generators.status, 1);
  assert.match(generators.stderr, /Bundle budget exceeded: Generators/);
  assert.doesNotMatch(generators.stderr, /exceeded: Node entry/);

  const bad = run('scripts/size.js', ['--max-gzip', 'lots']);
  assert.strictEqual(bad.status, 1);
  assert.match(bad.stderr, /--max-gzip needs a positive number of kilobytes/);
  const badGenerators = run('scripts/size.js', ['--max-gzip-generators', 'x']);
  assert.strictEqual(badGenerators.status, 1);
  assert.match(badGenerators.stderr, /--max-gzip-generators needs a positive number/);
});
