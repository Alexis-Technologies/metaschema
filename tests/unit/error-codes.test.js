const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Every code the source throws is a union of index.d.ts and a row of the tables of the API
// reference, and the three are held to one set here. A code set on a plain TypeError
// (`error.code = '…'`) is a runtime code; every other one is the code of a
// SchemaDefinitionError. The codes of 3.x keep the `ERR_` prefix (CLAUDE.md, Conventions):
// the list there is the rename of 4.0, and a new code is `ALX_ERR_*`.

const ROOT = path.join(__dirname, '..', '..');
const CODE = /\b(?:ALX_)?ERR_[A-Z0-9_]+\b/g;
const ASSIGNED = /\.code = '((?:ALX_)?ERR_[A-Z0-9_]+)'/g;
const MEMBER = /'((?:ALX_)?ERR_[A-Z0-9_]+)'/g;
const ROW = /^\| `((?:ALX_)?ERR_[A-Z0-9_]+)` \|/gm;
const LEGACY = /^ERR_/;

const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const sorted = (codes) => [...codes].sort();

const codesOfSource = () => {
  const all = new Set();
  const assigned = new Set();
  for (const name of fs.readdirSync(path.join(ROOT, 'src'), { recursive: true })) {
    if (!name.endsWith('.js')) continue;
    const text = read(path.join('src', name));
    for (const code of text.match(CODE) ?? []) all.add(code);
    for (const match of text.matchAll(ASSIGNED)) assigned.add(match[1]);
  }
  return { all, assigned };
};

// The members of `export type <name> = | '…' | '…';`, its comments left out.
const unionOf = (text, name) => {
  const start = text.indexOf(`export type ${name} =`);
  assert.notEqual(start, -1, `index.d.ts declares ${name}`);
  const lines = text.slice(start).split('\n');
  const codes = new Set();
  for (const line of lines) {
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

  it('should declare the codes set on a plain TypeError as RuntimeErrorCode', () => {
    assert.deepEqual(sorted(source.assigned), sorted(runtime));
  });

  it('should document every code in the table of its kind', () => {
    assert.deepEqual(sorted(tableOf(docs, '`SchemaDefinitionError`')), sorted(definition));
    assert.deepEqual(sorted(tableOf(docs, 'Runtime errors')), sorted(runtime));
  });

  it('should list in CLAUDE.md every code of the ERR_ prefix, to rename in 4.0', () => {
    const text = read('CLAUDE.md');
    const start = text.indexOf('<!-- codes:4.0:start -->');
    const end = text.indexOf('<!-- codes:4.0:end -->');
    assert.ok(start !== -1 && end > start, 'CLAUDE.md has the list between its markers');
    const listed = new Set(text.slice(start, end).match(CODE));
    const legacy = new Set();
    for (const code of source.all) if (LEGACY.test(code)) legacy.add(code);
    assert.deepEqual(sorted(listed), sorted(legacy));
  });
});
