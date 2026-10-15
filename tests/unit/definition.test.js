// The `./definition` subpath: the half of the core that builds and reads
// schemas, alone. Every suite of this process loads the core entry (and the
// JIT helper of `test:jit` does too), which installs the validation half
// into the same classes, so what the definition does on its own is run in
// a child process that requires nothing else.
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const { Schema, Model } = require('../../index.js');
const definition = require('../../src/definition/index.js');
const fixture = require('../fixtures/schemas/index.js');

const ROOT = path.join(__dirname, '../..');

// Runs `body` in a process of its own with the definition entry as
// `definition` (and nothing else of the package), and reads back what it
// writes as JSON.
const alone = (body) => {
  const source = [
    "const definition = require('./src/definition/index.js');",
    'const out = (value) => process.stdout.write(JSON.stringify(value));',
    'const codeOf = (fn) => { try { fn(); return null; } catch (error) { return error.code; } };',
    body,
  ].join('\n');
  const output = execFileSync(process.execPath, ['-e', source], { cwd: ROOT, encoding: 'utf8' });
  return JSON.parse(output);
};

// A definition of every form of the language, for both processes.
const FORMS = "require('./tests/fixtures/forms.js')()";
const forms = require('../fixtures/forms.js');

test('Definition: the core own classes and kinds, not copies', () => {
  assert.strictEqual(definition.Schema, Schema);
  assert.strictEqual(definition.Model, Model);
  assert.strictEqual(definition.KIND, require('../../index.js').KIND);
  assert.strictEqual(
    definition.SchemaDefinitionError,
    require('../../index.js').SchemaDefinitionError,
  );
});

test('Definition: alone, a schema builds and reads, and nothing validates', () => {
  const result = alone(`
    const { Schema, Model, SchemaDefinitionError } = definition;
    const doc = new Schema('Doc', ${FORMS});
    const model = new Model({ money: { js: 'number' } }, [
      ['Tag', { Struct: {}, label: 'string', total: 'money' }],
      ['Item', { Entity: {}, tag: 'Tag' }],
    ], null, { registry: 'isolated' });
    const item = model.entities.get('Item');
    let invalid = null;
    try { new Schema('X', { a: { type: 'number', min: 2, max: 1 } }); } catch (error) {
      invalid = [error instanceof SchemaDefinitionError, error.code];
    }
    const field = doc.fields.name;
    const rejected = [];
    const settled = Promise.all([
      doc.checkAsync({}).catch((error) => rejected.push(error.code)),
      doc.parseAsync({}).catch((error) => rejected.push(error.code)),
    ]);
    settled.then(() => out({
      fields: Object.keys(doc.fields),
      kind: doc.kind,
      store: doc.store,
      indexes: Object.keys(doc.indexes),
      root: doc.toSnapshot().root,
      json: JSON.stringify(doc.toSnapshot()).length > 0,
      model: Object.keys(model.toJSON().entities),
      order: [...model.order],
      reached: Object.keys(item.toSnapshot().entities),
      types: Object.keys(item.toSnapshot().types),
      invalid,
      standard: '~standard' in doc,
      codes: [
        codeOf(() => doc.check({})),
        codeOf(() => doc.parse({})),
        codeOf(() => doc.serialize({})),
        codeOf(() => doc.validate({})),
        codeOf(() => doc.warnings),
        codeOf(() => doc.checkConsistency()),
        codeOf(() => model.warnings),
        codeOf(() => field.check),
        // The check a reference reaches a schema through.
        codeOf(() => doc[Symbol.for('alexify.metaschema.run')]({}, {})),
      ],
      message: (() => {
        try {
          doc.check({});
        } catch (error) {
          return error.message;
        }
      })(),
      rejected,
    }));
  `);
  assert.deepStrictEqual(result.fields, [
    'name',
    'price',
    'count',
    'big',
    'data',
    'perms',
    'role',
    'ids',
    'byId',
    'scores',
    'point',
    'shape',
    'either',
    'when',
    'inner',
    'note',
    'parent',
    'ratio',
    'docId',
  ]);
  assert.strictEqual(result.kind, 'entity');
  assert.strictEqual(result.store, 'persistent');
  assert.deepStrictEqual(result.indexes, ['byName']);
  assert.strictEqual(result.root, 'Doc');
  assert.strictEqual(result.json, true);
  assert.deepStrictEqual(result.model, ['Tag', 'Item']);
  assert.deepStrictEqual(result.order, ['Tag', 'Item']);
  assert.deepStrictEqual(result.reached, ['Tag', 'Item']);
  assert.deepStrictEqual(result.types, ['money']);
  // A definition error is the builder's, with or without validation.
  assert.deepStrictEqual(result.invalid, [true, 'ERR_INVALID_RULE']);
  assert.strictEqual(result.standard, false);
  assert.deepStrictEqual(result.codes, Array(9).fill('ERR_NOT_REGISTERED'));
  assert.deepStrictEqual(result.rejected, ['ERR_NOT_REGISTERED', 'ERR_NOT_REGISTERED']);
  assert.strictEqual(
    result.message,
    'check needs the core entry @alexify/metaschema: ./definition alone does not validate',
  );
});

test('Definition: the core loaded later validates the schemas built before it', () => {
  const result = alone(`
    const { Schema, Model } = definition;
    const before = new Schema('Tag', { label: { type: 'string', length: 3 }, 'parent?': 'Tag' });
    const model = new Model({ money: { js: 'number' } }, [
      ['Order', { Struct: {}, total: { type: 'money', decimals: 2 } }],
    ], null, { registry: 'isolated' });
    const core = require('./index.js');
    const order = model.entities.get('Order');
    out({
      same: core.Schema === Schema,
      valid: before.check({ label: 'abc', parent: { label: 'def' } }).valid,
      errors: before.check({ label: 'abcd', parent: { label: 1 } }).errors,
      order: [order.check({ total: 1.25 }).valid, order.check({ total: 1.255 }).valid],
      parsed: before.parse({ label: 'abc' }).valid,
      warnings: before.warnings,
      model: model.warnings,
      standard: '~standard' in before,
      after: core.Schema.from({ a: 'string' }).check({ a: 1 }).valid,
    });
  `);
  assert.deepStrictEqual(result, {
    same: true,
    valid: true,
    errors: [
      'Field "Tag.label" exceeds the maximum length',
      'Field "Tag.parent.label" not of expected type: string',
    ],
    order: [true, false],
    parsed: true,
    warnings: [],
    model: [],
    standard: true,
    after: false,
  });
});

test('Definition: alone and with the core, the same fields and the same snapshot', () => {
  // The fixture model and a schema of every form, written by a process that
  // has the definition alone and by this one, which has the core.
  const fixtureText = alone(`
    const { inspect } = require('node:util');
    const { database, types, ...schemas } = require('./tests/fixtures/schemas/index.js');
    const table = {
      string: { metadata: { pg: 'varchar' } },
      datetime: { js: 'string', metadata: { pg: 'timestamp with time zone' } },
      ...types,
    };
    const model = new definition.Model(table, Object.entries(schemas), database, {
      registry: 'isolated',
    });
    const doc = new definition.Schema('Doc', ${FORMS});
    out([JSON.stringify(model), JSON.stringify(doc.toSnapshot()), inspect(doc, { depth: Infinity })]);
  `);
  const { inspect } = require('node:util');
  const { database, types, ...schemas } = fixture;
  const table = {
    string: { metadata: { pg: 'varchar' } },
    datetime: { js: 'string', metadata: { pg: 'timestamp with time zone' } },
    ...types,
  };
  const model = new Model(table, Object.entries(schemas), database, { registry: 'isolated' });
  const doc = new Schema('Doc', forms());
  assert.strictEqual(fixtureText[0], JSON.stringify(model));
  assert.strictEqual(fixtureText[1], JSON.stringify(doc.toSnapshot()));
  assert.strictEqual(fixtureText[2], inspect(doc, { depth: Infinity }));
});
