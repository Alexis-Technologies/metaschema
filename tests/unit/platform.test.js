const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '../../src');
const NODE_RUNTIME = path.join(SRC, 'runtime/node.js');

const listFiles = (dir) => {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(fullPath));
    else if (entry.name.endsWith('.js')) files.push(fullPath);
  }
  return files;
};

test('Platform: only src/runtime/node.js requires Node builtins', () => {
  const offenders = [];
  for (const file of listFiles(SRC)) {
    if (file === NODE_RUNTIME) continue;
    const source = fs.readFileSync(file, 'utf8');
    if (/require\(\s*['"]node:/.test(source)) offenders.push(path.relative(SRC, file));
  }
  assert.deepStrictEqual(offenders, []);
});

test('Platform: runtime twins share one interface', () => {
  const node = require('../../src/runtime/node.js');
  const browser = require('../../src/runtime/browser.js');
  assert.deepStrictEqual(Object.keys(browser), Object.keys(node));
});

test('Platform: browser saveTypes rejects', async () => {
  const { saveTypes } = require('../../src/runtime/browser.js');
  await assert.rejects(saveTypes('model.d.ts', { dts: '' }), {
    message: 'saveTypes is not available in the browser',
  });
});
