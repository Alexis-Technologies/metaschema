const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Model } = require('../../index.js');
const { saveTypes, toTypeScript } = require('../../src/generators/index.js');

test('saveTypes: writes the TypeScript of a model or a schema to a file', async () => {
  const entities = new Map([
    [
      'Company',
      { Dictionary: {}, name: { type: 'string', unique: true }, kind: { enum: ['llc'] } },
    ],
  ]);
  const model = new Model({ string: { metadata: { pg: 'varchar' } } }, entities);
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'metaschema-'));
  try {
    const outputFile = path.join(dir, 'model.d.ts');
    await saveTypes(outputFile, model);
    assert.strictEqual(await fs.promises.readFile(outputFile, 'utf8'), toTypeScript(model));
    await saveTypes(outputFile, model, { named: true });
    const named = await fs.promises.readFile(outputFile, 'utf8');
    assert.strictEqual(named, toTypeScript(model, { named: true }));
    assert.strictEqual(named.startsWith('type CompanyKind = '), true);
    await saveTypes(outputFile, model.entities.get('Company'));
    const one = await fs.promises.readFile(outputFile, 'utf8');
    assert.strictEqual(one, toTypeScript(model.entities.get('Company')));
    assert.strictEqual(one.startsWith('interface Company {'), true);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

test('saveTypes: an error of the rendering is a rejection, never a throw', async () => {
  await assert.rejects(saveTypes(path.join(os.tmpdir(), 'never.d.ts'), {}), {
    name: 'TypeError',
    code: 'ERR_INVALID_TARGET',
    message: 'A Schema or a Model is expected',
  });
});
