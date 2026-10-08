/**
 * Zero-dependency ops/sec benchmark for metaschema's hot paths.
 *
 * Run: pnpm bench (or: node bench/bench.js [filter])
 *
 * An optional argument runs only the scenarios whose name contains it, e.g.
 * `node bench/bench.js check`. Manual only, not part of CI.
 */

const { Schema, Model } = require('../index.js');
const {
  bench,
  FLAT_SCHEMA,
  NESTED_SCHEMA,
  FLAT_VALID,
  FLAT_INVALID,
  NESTED_VALID,
  NESTED_INVALID,
  loadModelFixture,
} = require('./helpers.js');

const filter = process.argv[2] || '';

const main = () => {
  console.log(`Node ${process.version} | ${new Date().toISOString()}\n`);
  const flat = Schema.from(FLAT_SCHEMA);
  const nested = Schema.from(NESTED_SCHEMA);
  const { types, entities, database } = loadModelFixture();
  const model = new Model(types, entities, database);

  const scenarios = [
    ['Schema.from — flat struct (4 fields)', () => Schema.from(FLAT_SCHEMA)],
    ['Schema.from — nested struct, collections, tuple', () => Schema.from(NESTED_SCHEMA)],
    ['check — flat struct, valid', () => flat.check(FLAT_VALID)],
    ['check — flat struct, invalid', () => flat.check(FLAT_INVALID)],
    ['check — nested struct, valid', () => nested.check(NESTED_VALID)],
    ['check — nested struct, invalid', () => nested.check(NESTED_INVALID)],
    ['new Model — fixture model (6 entities)', () => new Model(types, entities, database)],
    ['model.dts — fixture model (6 entities)', () => model.dts],
  ];

  for (const [name, fn] of scenarios) {
    if (name.includes(filter)) bench(name, fn);
  }
};

main();
