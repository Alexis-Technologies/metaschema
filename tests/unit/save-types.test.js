const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Model, saveTypes } = require('../../index.js');

test('saveTypes: writes model.dts to a file', async () => {
  const entities = new Map([
    ['Company', { Dictionary: {}, name: { type: 'string', unique: true } }],
  ]);
  const model = new Model({ string: { metadata: { pg: 'varchar' } } }, entities);
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'metaschema-'));
  try {
    const outputFile = path.join(dir, 'model.d.ts');
    await saveTypes(outputFile, model);
    assert.strictEqual(await fs.promises.readFile(outputFile, 'utf8'), model.dts);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});
