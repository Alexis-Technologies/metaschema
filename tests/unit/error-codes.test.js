const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { Schema, SchemaDefinitionError, SchemaUsageError } = require('../../index.js');
const { toJSONSchema } = require('../../src/generators/index.js');
const { transform } = require('../../src/stream/index.js');
const { noValidation } = require('../../src/errors.js');
const browser = require('../../src/runtime/browser.js');

// Every code the source throws is a union of index.d.ts and a row of the tables of the API
// reference, and the three are held to one set here. A code a SchemaUsageError is built with
// (`new SchemaUsageError(message, { code: '…' })`, the constructor of Error) is a code of a
// wrong call (RuntimeErrorCode); every other one is the code of a SchemaDefinitionError
// (DefinitionErrorCode). Every code is `ALX_ERR_*` since 4.0.

const ROOT = path.join(__dirname, '..', '..');
const CODE = /\bALX_ERR_[A-Z0-9_]+\b/g;
const BARE = /(?<![A-Z_])ERR_[A-Z0-9_]+/g;
const USAGE = /new SchemaUsageError\([\s\S]*?\bcode: '(ALX_ERR_[A-Z0-9_]+)'/g;
const MEMBER = /'(ALX_ERR_[A-Z0-9_]+)'/g;
const ROW = /^\| `(ALX_ERR_[A-Z0-9_]+)` \|/gm;

// A Windows checkout writes the text files with CRLF (core.autocrlf), and the
// headings of the API reference are found by their line breaks.
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');

const sorted = (codes) => [...codes].sort();

// A walk of its own: `readdirSync` reads subdirectories (`recursive`) from Node.js 18.17 on,
// and CI runs the 18.12 of the floor.
const sourceFiles = (dir = 'src', files = []) => {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const name = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(name, files);
    else if (name.endsWith('.js') || name.endsWith('.d.ts')) files.push(name);
  }
  return files;
};

const codesOfSource = () => {
  const all = new Set();
  const usage = new Set();
  const bare = new Set();
  for (const file of sourceFiles()) {
    const text = read(file);
    if (file.endsWith('.js')) for (const code of text.match(CODE) ?? []) all.add(code);
    for (const match of text.matchAll(USAGE)) usage.add(match[1]);
    for (const code of text.match(BARE) ?? []) bare.add(`${file}: ${code}`);
  }
  return { all, usage, bare };
};

// The members of `export type <name> = | '…' | '…';`, its comments left out.
const unionOf = (text, name) => {
  const start = text.indexOf(`export type ${name} =`);
  assert.notEqual(start, -1, `index.d.ts declares ${name}`);
  const codes = new Set();
  for (const line of text.slice(start).split('\n')) {
    const code = line.trim();
    if (code.startsWith('//')) continue;
    for (const match of code.matchAll(MEMBER)) codes.add(match[1]);
    if (code.endsWith(';')) break;
  }
  return codes;
};

// The codes of the table under the heading `## <title>` of the API reference.
const tableOf = (text, title) => {
  const start = text.indexOf(`\n## ${title}\n`);
  assert.notEqual(start, -1, `docs/api/exports.md has a section ${title}`);
  const end = text.indexOf('\n## ', start + 1);
  const section = text.slice(start, end === -1 ? text.length : end);
  const codes = new Set();
  for (const match of section.matchAll(ROW)) codes.add(match[1]);
  return codes;
};

const usageError = (code) => (error) => {
  assert.ok(error instanceof SchemaUsageError, `${code} is a SchemaUsageError`);
  assert.ok(error instanceof TypeError);
  assert.equal(error.name, 'SchemaUsageError');
  assert.equal(error.code, code);
  return true;
};

describe('Error codes', () => {
  const source = codesOfSource();
  const dts = read('index.d.ts');
  const definition = unionOf(dts, 'DefinitionErrorCode');
  const runtime = unionOf(dts, 'RuntimeErrorCode');
  const docs = read('docs/api/exports.md');

  it('should declare every code of the source in one union of index.d.ts', () => {
    for (const code of runtime) assert.ok(!definition.has(code), `${code} is in both unions`);
    assert.deepEqual(sorted(source.all), sorted([...definition, ...runtime]));
  });

  it('should declare the codes a SchemaUsageError is built with as RuntimeErrorCode', () => {
    assert.deepEqual(sorted(source.usage), sorted(runtime));
  });

  it('should document every code in the table of its kind', () => {
    assert.deepEqual(sorted(tableOf(docs, '`SchemaDefinitionError`')), sorted(definition));
    assert.deepEqual(sorted(tableOf(docs, '`SchemaUsageError`')), sorted(runtime));
  });

  it('should have no code of the library without the ALX_ prefix', () => {
    assert.deepEqual(sorted(source.bare), []);
  });

  it('should throw every code of a wrong call as a SchemaUsageError', async () => {
    const pending = Schema.from({ a: { type: 'string', validate: async () => true } });
    assert.throws(() => pending.check({ a: 'x' }), usageError('ALX_ERR_ASYNC_VALIDATOR'));
    assert.throws(() => toJSONSchema(42), usageError('ALX_ERR_INVALID_TARGET'));
    const text = Schema.from('string');
    const limited = () => text.check('x', { maxErrors: 'many' });
    assert.throws(limited, usageError('ALX_ERR_INVALID_OPTION'));
    const count = Schema.from({ n: 'number' });
    const coerced = () => count.parse({ n: '1' }, { coerce: true });
    assert.throws(coerced, usageError('ALX_ERR_NOT_REGISTERED'));
    assert.ok(usageError('ALX_ERR_NOT_REGISTERED')(noValidation('check')));
    const stream = transform(count);
    const writer = stream.writable.getWriter();
    writer.write({ n: 'x' }).catch(() => {});
    const reader = stream.readable.getReader();
    await assert.rejects(reader.read(), usageError('ALX_ERR_INVALID_RECORD'));
    const write = browser.writeFile('types.d.ts', '');
    await assert.rejects(write, usageError('ALX_ERR_UNSUPPORTED_RUNTIME'));
  });

  it('should throw a definition that cannot work as a SchemaDefinitionError', () => {
    const unknown = () => Schema.from({ a: 'strng' });
    assert.throws(unknown, (error) => {
      assert.ok(error instanceof SchemaDefinitionError);
      assert.ok(!(error instanceof SchemaUsageError));
      assert.equal(error.code, 'ALX_ERR_UNKNOWN_TYPE');
      return true;
    });
  });
});
