/**
 * Zero-dependency ops/sec benchmark for metaschema's hot paths.
 *
 * Run: pnpm bench [filter] [--json] [--save] [--compare] [--compare-libs]
 *
 * An optional filter runs only the scenarios whose name contains it, e.g.
 * `pnpm bench check`. `--json` prints the results as JSON, `--save` writes
 * them to bench/baseline.json, and `--compare` prints the change against
 * that baseline (numbers are machine-specific: compare on one machine, before
 * and after a change). `--compare-libs` runs the moltar scenarios through
 * zod, valibot, ajv and typebox instead (bench/libs.js). Manual only, not
 * part of CI.
 *
 * The `check` scenarios run twice: on the closure backend and, as
 * `(jit)`, on a second schema compiled by the ./compile subpath.
 */

const fs = require('node:fs');
const path = require('node:path');

const { Schema, Model } = require('../index.js');
const { toTypeScript } = require('../src/generators/index.js');
const { compile } = require('../src/compile/index.js');
const {
  bench,
  callCheck,
  FLAT_SCHEMA,
  NESTED_SCHEMA,
  FLAT_VALID,
  FLAT_INVALID,
  NESTED_VALID,
  NESTED_INVALID,
  MOLTAR_FLAT_SCHEMA,
  MOLTAR_NESTED_SCHEMA,
  MOLTAR_FLAT_VALUE,
  MOLTAR_NESTED_VALUE,
  MOLTAR_FLAT_LOOSE,
  MOLTAR_NESTED_LOOSE,
  loadModelFixture,
} = require('./helpers.js');

const BASELINE = path.join(__dirname, 'baseline.json');

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith('--')));
const filter = args.find((arg) => !arg.startsWith('--')) || '';
const json = flags.has('--json');

const percent = (current, base) => {
  const delta = ((current - base) / base) * 100;
  const sign = delta >= 0 ? '+' : '';
  return `${sign}${delta.toFixed(1)}%`;
};

const compare = (results) => {
  if (!fs.existsSync(BASELINE)) {
    console.error(`No baseline at ${BASELINE}; run with --save first`);
    process.exitCode = 1;
    return;
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const base = new Map(baseline.results.map((row) => [row.name, row.opsPerSec]));
  console.log(`\nAgainst baseline from ${baseline.date} (${baseline.node}):`);
  for (const { name, opsPerSec } of results) {
    const before = base.get(name);
    const change = before ? percent(opsPerSec, before) : 'no baseline';
    console.log(`${name.padEnd(52)} ${change.padStart(12)}`);
  }
};

const LOOSE = { unknown: 'ignore' };

// The four modes of the moltar suite over one schema and its values; check
// is called through the harness so that it is measured as a callee.
const modes = (label, schema, value, loose, tag = '') => [
  [`parseSafe${tag} — ${label}`, () => (callCheck(value, LOOSE).valid ? value : null), schema],
  [`parseStrict${tag} — ${label}`, () => (callCheck(value).valid ? value : null), schema],
  [`assertLoose${tag} — ${label}`, () => callCheck(loose, LOOSE).valid, schema],
  [`assertStrict${tag} — ${label}`, () => callCheck(value).valid, schema],
];

// A second schema of the same definition, compiled by the JIT backend.
const jit = (definition) => {
  const schema = Schema.from(definition);
  compile(schema, { jit: true });
  return schema;
};

const main = () => {
  if (flags.has('--compare-libs')) {
    require('./libs.js').compareLibraries({ json });
    return;
  }
  if (!json) console.log(`Node ${process.version} | ${new Date().toISOString()}\n`);
  const flat = Schema.from(FLAT_SCHEMA);
  const nested = Schema.from(NESTED_SCHEMA);
  const moltarFlat = Schema.from(MOLTAR_FLAT_SCHEMA);
  const moltarNested = Schema.from(MOLTAR_NESTED_SCHEMA);
  const flatJit = jit(FLAT_SCHEMA);
  const nestedJit = jit(NESTED_SCHEMA);
  const moltarFlatJit = jit(MOLTAR_FLAT_SCHEMA);
  const moltarNestedJit = jit(MOLTAR_NESTED_SCHEMA);
  const { types, entities, database } = loadModelFixture();
  const model = new Model(types, entities, database);

  const scenarios = [
    ['Schema.from — flat struct (4 fields)', () => Schema.from(FLAT_SCHEMA)],
    ['Schema.from — nested struct, collections, tuple', () => Schema.from(NESTED_SCHEMA)],
    ['check — flat struct, valid', () => callCheck(FLAT_VALID), flat],
    ['check — flat struct, invalid', () => callCheck(FLAT_INVALID), flat],
    ['check — nested struct, valid', () => callCheck(NESTED_VALID), nested],
    ['check — nested struct, invalid', () => callCheck(NESTED_INVALID), nested],
    ['check (jit) — flat struct, valid', () => callCheck(FLAT_VALID), flatJit],
    ['check (jit) — flat struct, invalid', () => callCheck(FLAT_INVALID), flatJit],
    ['check (jit) — nested struct, valid', () => callCheck(NESTED_VALID), nestedJit],
    ['check (jit) — nested struct, invalid', () => callCheck(NESTED_INVALID), nestedJit],
    ...modes('moltar flat (6 fields)', moltarFlat, MOLTAR_FLAT_VALUE, MOLTAR_FLAT_LOOSE),
    ...modes(
      'moltar nested (6 + 3 fields)',
      moltarNested,
      MOLTAR_NESTED_VALUE,
      MOLTAR_NESTED_LOOSE,
    ),
    ...modes(
      'moltar flat (6 fields)',
      moltarFlatJit,
      MOLTAR_FLAT_VALUE,
      MOLTAR_FLAT_LOOSE,
      ' (jit)',
    ),
    ...modes(
      'moltar nested (6 + 3 fields)',
      moltarNestedJit,
      MOLTAR_NESTED_VALUE,
      MOLTAR_NESTED_LOOSE,
      ' (jit)',
    ),
    ['new Model — fixture model (6 entities)', () => new Model(types, entities, database)],
    // The scenario keeps its name from the baseline; the rendering is the
    // generators subpath's now.
    ['model.dts — fixture model (6 entities)', () => toTypeScript(model)],
  ];

  const results = [];
  for (const [name, fn, schema] of scenarios) {
    if (name.includes(filter)) results.push(bench(name, fn, { quiet: json, schema }));
  }
  if (json) console.log(JSON.stringify(results, null, 2));
  if (flags.has('--save')) {
    const snapshot = { node: process.version, date: new Date().toISOString(), results };
    fs.writeFileSync(BASELINE, `${JSON.stringify(snapshot, null, 2)}\n`);
    if (!json) console.log(`\nSaved ${results.length} results to ${BASELINE}`);
  }
  if (flags.has('--compare')) compare(results);
};

main();
