const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
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

describe('Platform', () => {
  it('should require Node builtins only in src/runtime/node.js', () => {
    const offenders = [];
    for (const file of listFiles(SRC)) {
      if (file === NODE_RUNTIME) continue;
      const source = fs.readFileSync(file, 'utf8');
      if (/require\(\s*['"]node:/.test(source)) offenders.push(path.relative(SRC, file));
    }
    assert.deepEqual(offenders, []);
  });

  it('should give the runtime twins one interface', () => {
    const node = require('../../src/runtime/node.js');
    const browser = require('../../src/runtime/browser.js');
    assert.deepEqual(Object.keys(browser), Object.keys(node));
  });

  it('should reject a file write in the browser runtime', async () => {
    const { writeFile } = require('../../src/runtime/browser.js');
    await assert.rejects(writeFile('model.d.ts', ''), {
      message: 'saveTypes is not available in the browser',
    });
  });

  it('should have no Node runtime behind the core entry', () => {
    const core = fs.readFileSync(path.join(SRC, 'index.js'), 'utf8');
    assert.equal(core.includes('runtime'), false);
    const generators = fs.readFileSync(path.join(SRC, 'generators/index.js'), 'utf8');
    assert.equal(generators.includes("require('../runtime/node.js')"), true);
  });
});
