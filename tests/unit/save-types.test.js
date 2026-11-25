const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Model } = require('../../index.js');
const { saveTypes, toTypeScript } = require('../../src/generators/index.js');

describe('saveTypes', () => {
  it('should write the TypeScript of a model or a schema to a file', async () => {
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
      assert.equal(await fs.promises.readFile(outputFile, 'utf8'), toTypeScript(model));
      await saveTypes(outputFile, model, { named: true });
      const named = await fs.promises.readFile(outputFile, 'utf8');
      assert.equal(named, toTypeScript(model, { named: true }));
      assert.equal(named.startsWith('type CompanyKind = '), true);
      await saveTypes(outputFile, model.entities.get('Company'));
      const one = await fs.promises.readFile(outputFile, 'utf8');
      assert.equal(one, toTypeScript(model.entities.get('Company')));
      assert.equal(one.startsWith('interface Company {'), true);
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  });

  it('should reject on an error of the rendering, never throw', async () => {
    await assert.rejects(saveTypes(path.join(os.tmpdir(), 'never.d.ts'), {}), {
      name: 'TypeError',
      code: 'ERR_INVALID_TARGET',
      message: 'A Schema or a Model is expected',
    });
  });
});
