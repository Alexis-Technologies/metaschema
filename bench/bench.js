/**
 * Zero-dependency ops/sec benchmark for metaschema's hot paths.
 *
 * Run: pnpm bench [filter] [--json] [--save] [--compare]
 *
 * An optional filter runs only the scenarios whose name contains it, e.g.
 * `pnpm bench check`. `--json` prints the results as JSON, `--save` writes
 * them to bench/baseline.json, and `--compare` prints the change against
 * that baseline (numbers are machine-specific: compare on one machine, before
 * and after a change). Manual only, not part of CI.
 */

const fs = require('node:fs');
const path = require('node:path');

const { Schema, Model } = require('../index.js');
const {
  bench,
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

// The four modes of the moltar suite over one schema and its values.
const modes = (label, schema, value, loose) => [
  [`parseSafe — ${label}`, () => (schema.check(value, LOOSE).valid ? value : null)],
  [`parseStrict — ${label}`, () => (schema.check(value).valid ? value : null)],
  [`assertLoose — ${label}`, () => schema.check(loose, LOOSE).valid],
  [`assertStrict — ${label}`, () => schema.check(value).valid],
];

const main = () => {
  if (!json) console.log(`Node ${process.version} | ${new Date().toISOString()}\n`);
  const flat = Schema.from(FLAT_SCHEMA);
  const nested = Schema.from(NESTED_SCHEMA);
  const moltarFlat = Schema.from(MOLTAR_FLAT_SCHEMA);
  const moltarNested = Schema.from(MOLTAR_NESTED_SCHEMA);
  const { types, entities, database } = loadModelFixture();
  const model = new Model(types, entities, database);

  const scenarios = [
    ['Schema.from — flat struct (4 fields)', () => Schema.from(FLAT_SCHEMA)],
    ['Schema.from — nested struct, collections, tuple', () => Schema.from(NESTED_SCHEMA)],
    ['check — flat struct, valid', () => flat.check(FLAT_VALID)],
    ['check — flat struct, invalid', () => flat.check(FLAT_INVALID)],
    ['check — nested struct, valid', () => nested.check(NESTED_VALID)],
    ['check — nested struct, invalid', () => nested.check(NESTED_INVALID)],
    ...modes('moltar flat (6 fields)', moltarFlat, MOLTAR_FLAT_VALUE, MOLTAR_FLAT_LOOSE),
    ...modes(
      'moltar nested (6 + 3 fields)',
      moltarNested,
      MOLTAR_NESTED_VALUE,
      MOLTAR_NESTED_LOOSE,
    ),
    ['new Model — fixture model (6 entities)', () => new Model(types, entities, database)],
    ['model.dts — fixture model (6 entities)', () => model.dts],
  ];

  const results = [];
  for (const [name, fn] of scenarios) {
    if (name.includes(filter)) results.push(bench(name, fn, { quiet: json }));
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
