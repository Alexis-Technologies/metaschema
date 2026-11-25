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

  it('should replace the file whole and leave nothing behind, a failed write included', async () => {
    const model = new Model({}, [['Note', { Struct: {}, text: 'string' }]]);
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'metaschema-'));
    try {
      const outputFile = path.join(dir, 'model.d.ts');
      await fs.promises.writeFile(outputFile, 'the old text');
      // A link to the old file keeps the old text: the new one took its
      // place by a rename, it was not written into the file a reader holds.
      const link = path.join(dir, 'link');
      await fs.promises.link(outputFile, link);
      await saveTypes(outputFile, model);
      assert.equal(await fs.promises.readFile(link, 'utf8'), 'the old text');
      await fs.promises.rm(link);
      await Promise.all([saveTypes(outputFile, model), saveTypes(outputFile, model)]);
      assert.equal(await fs.promises.readFile(outputFile, 'utf8'), toTypeScript(model));
      assert.deepEqual(await fs.promises.readdir(dir), ['model.d.ts']);
      // A directory where the file goes: the rename fails, the temporary
      // file is removed and the directory is what it was.
      const taken = path.join(dir, 'taken.d.ts');
      await fs.promises.mkdir(taken);
      await fs.promises.writeFile(path.join(taken, 'inside'), 'x');
      await assert.rejects(saveTypes(taken, model));
      assert.deepEqual((await fs.promises.readdir(dir)).sort(), ['model.d.ts', 'taken.d.ts']);
      assert.deepEqual(await fs.promises.readdir(taken), ['inside']);
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  });

  it('should reject on an error of the rendering, never throw', async () => {
    await assert.rejects(saveTypes(path.join(os.tmpdir(), 'never.d.ts'), {}), {
      name: 'SchemaUsageError',
      code: 'ALX_ERR_INVALID_TARGET',
      message: 'A Schema or a Model is expected',
    });
  });
});
