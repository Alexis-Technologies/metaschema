/**
 * Zero-dependency ops/sec benchmark for metaschema's hot paths.
 *
 * Run: pnpm bench [filter] [--json] [--save] [--compare]
 *
 * An optional filter runs only the scenarios whose name contains it, e.g.
 * `pnpm bench check`. `--json` prints the results as JSON, `--save` writes
 * them to bench/baseline.json, and `--compare` prints the change against
 * that baseline (numbers are machine-specific: compare on one machine, before
 * and after a change). Manual only, not part of CI. The comparison with
 * other libraries is bench/compare.js (pnpm bench:compare), and
 * bench/report.js charts the baseline with the rest (pnpm bench:report).
 *
 * The `check` and `parse` scenarios run twice: on the closure backend and,
 * as `(jit)`, on a second schema compiled by the ./compile subpath. The
 * `checkAsync`/`parseAsync` scenarios go through `benchAsync` (one await per
 * call): the sync-validator rows beside them give the cost of the async path
 * itself, the setImmediate/setTimeout rows the latency of settling.
 */

const fs = require('node:fs');
const path = require('node:path');

const { Schema, Model } = require('../index.js');
const { toTypeScript } = require('../src/generators/index.js');
const { compile } = require('../src/compile/index.js');
const { checkEach } = require('../src/stream/index.js');
const coercion = require('../src/coerce/index.js');
const mongodb = require('../src/mongodb/index.js');
const {
  bench,
  benchAsync,
  callCheck,
  callParse,
  callCheckAsync,
  callParseAsync,
  callCoerce,
  COERCE_VALUE,
  COERCE,
  NESTED_COERCE_VALUE,
  UNION_SCHEMA,
  UNION_COERCE_VALUE,
  ENUM_SCHEMA,
  ENUM_COERCE_VALUE,
  BSON_FAKE,
  MONGODB_ENTITIES,
  MONGODB_VALUE,
  SYNC_VALIDATORS_SCHEMA,
  RESOLVED_VALIDATORS_SCHEMA,
  LATER_VALIDATORS_SCHEMA,
  TIMER_VALIDATORS_SCHEMA,
  LATER_RECORDS_SCHEMA,
  LATER_RECORDS_VALUE,
  ASYNC_DECODER_SCHEMA,
  RECORDS_SCHEMA,
  RECORDS_VALUE,
  NESTED_LOOSE,
  STRIP,
  FLAT_SCHEMA,
  NESTED_SCHEMA,
  CODEC_SCHEMA,
  FLAT_VALID,
  CODEC_VALID,
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
  SPARSE_SCHEMA,
  ALIAS_SCHEMA,
  SPARSE_VALID,
  ALIASED_VALID,
} = require('./helpers.js');

const BASELINE = path.join(__dirname, 'baseline.json');

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith('--')));
const filter = args.find((arg) => !arg.startsWith('--')) || '';
const json = flags.has('--json');

// `--fail-under=<percent>` with `--compare`: a scenario slower than the
// baseline by more than that fails the run (a non-zero exit code).
const failUnder = (() => {
  const flag = args.find((arg) => arg.startsWith('--fail-under='));
  if (flag === undefined) return null;
  const value = Number(flag.slice('--fail-under='.length));
  if (!(value >= 0)) {
    console.error(`--fail-under needs a percentage, got ${JSON.stringify(flag)}`);
    process.exit(1);
  }
  return value;
})();

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
  const regressions = [];
  for (const { name, opsPerSec } of results) {
    const before = base.get(name);
    const change = before ? percent(opsPerSec, before) : 'no baseline';
    console.log(`${name.padEnd(64)} ${change.padStart(12)}`);
    if (before && failUnder !== null && ((opsPerSec - before) / before) * 100 < -failUnder) {
      regressions.push(name);
    }
  }
  if (regressions.length > 0) {
    console.error(
      `\n${regressions.length} scenario(s) slower than the baseline by more than ${failUnder}%`,
    );
    process.exitCode = 1;
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

// The async scenarios over one schema (with its validators) and its values,
// on one backend: the sync row of the same schema is the reference.
const asyncRows = (schemas, tag = '') => {
  const { sync, resolved, later, timer, records, decoder } = schemas;
  const value = FLAT_VALID;
  const codec = { ...FLAT_VALID, since: '2020-01-01T00:00:00.000Z' };
  return [
    [`check${tag} — 4 sync validators`, () => callCheck(value), sync],
    [`checkAsync${tag} — 4 sync validators`, () => callCheckAsync(value), sync, true],
    [
      `checkAsync${tag} — 4 async validators, resolved promises`,
      () => callCheckAsync(value),
      resolved,
      true,
    ],
    [
      `checkAsync${tag} — 4 independent validators, setImmediate`,
      () => callCheckAsync(value),
      later,
      true,
    ],
    [
      `checkAsync${tag} — 4 independent validators, setTimeout(1)`,
      () => callCheckAsync(value),
      timer,
      true,
      { warmup: 50 },
    ],
    [
      `checkAsync${tag} — 32 records, a validator each, setImmediate`,
      () => callCheckAsync(LATER_RECORDS_VALUE),
      records,
      true,
    ],
    [`parseAsync${tag} — an async decoder`, () => callParseAsync(codec), decoder, true],
  ];
};

const asyncSchemas = (build) => ({
  sync: build(SYNC_VALIDATORS_SCHEMA),
  resolved: build(RESOLVED_VALIDATORS_SCHEMA),
  later: build(LATER_VALIDATORS_SCHEMA),
  timer: build(TIMER_VALIDATORS_SCHEMA),
  records: build(LATER_RECORDS_SCHEMA),
  decoder: build(ASYNC_DECODER_SCHEMA),
});

const main = async () => {
  if (!json) console.log(`Node ${process.version} | ${new Date().toISOString()}\n`);
  coercion.register();
  mongodb.register({ bson: BSON_FAKE });
  const flat = Schema.from(FLAT_SCHEMA);
  const nested = Schema.from(NESTED_SCHEMA);
  const union = Schema.from(UNION_SCHEMA);
  const enumeration = Schema.from(ENUM_SCHEMA);
  const store = new Model({ ...mongodb.types }, MONGODB_ENTITIES);
  const account = store.entities.get('Account');
  const document = mongodb.toDocument(account, MONGODB_VALUE);
  // A call site that sees a plain parse and a coercing one in turn.
  let turn = 0;
  const alternating = () => {
    turn ^= 1;
    return turn === 1 ? callParse(FLAT_VALID) : callParse(COERCE_VALUE, COERCE);
  };
  const moltarFlat = Schema.from(MOLTAR_FLAT_SCHEMA);
  const moltarNested = Schema.from(MOLTAR_NESTED_SCHEMA);
  const codec = Schema.from(CODEC_SCHEMA);
  const sparse = Schema.from(SPARSE_SCHEMA);
  const aliased = Schema.from(ALIAS_SCHEMA);
  const flatJit = jit(FLAT_SCHEMA);
  const nestedJit = jit(NESTED_SCHEMA);
  const codecJit = jit(CODEC_SCHEMA);
  const sparseJit = jit(SPARSE_SCHEMA);
  const aliasedJit = jit(ALIAS_SCHEMA);
  const moltarFlatJit = jit(MOLTAR_FLAT_SCHEMA);
  const moltarNestedJit = jit(MOLTAR_NESTED_SCHEMA);
  const records = Schema.from(RECORDS_SCHEMA);
  const recordsJit = jit(RECORDS_SCHEMA);
  // A thousand records through the stream subpath, and through a loop of
  // check: what the generator and its entries cost per record.
  const thousand = Array.from({ length: 1_000 }, (_, i) => ({ ...FLAT_VALID, age: i }));
  const loop = () => {
    let valid = 0;
    for (let i = 0; i < thousand.length; i += 1) if (callCheck(thousand[i]).valid) valid += 1;
    return valid;
  };
  const eachOf = (schema) => () => {
    let valid = 0;
    for (const entry of checkEach(schema, thousand)) if (entry.result.valid) valid += 1;
    return valid;
  };
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
    ['check — sparse struct, two optional fields absent', () => callCheck(SPARSE_VALID), sparse],
    [
      'check (jit) — sparse struct, two optional fields absent',
      () => callCheck(SPARSE_VALID),
      sparseJit,
    ],
    ['parse — flat struct, valid', () => callParse(FLAT_VALID), flat],
    ['parse — nested struct, valid', () => callParse(NESTED_VALID), nested],
    ['parse — flat struct, defaults and a decoder', () => callParse(CODEC_VALID), codec],
    [
      'parse — flat struct with an alias, no alias in the input',
      () => callParse(FLAT_VALID),
      aliased,
    ],
    [
      'parse — flat struct with an alias, the alias in the input',
      () => callParse(ALIASED_VALID),
      aliased,
    ],
    ['parse (jit) — flat struct, valid', () => callParse(FLAT_VALID), flatJit],
    ['parse (jit) — nested struct, valid', () => callParse(NESTED_VALID), nestedJit],
    ['parse (jit) — flat struct, defaults and a decoder', () => callParse(CODEC_VALID), codecJit],
    [
      'parse (jit) — flat struct with an alias, no alias in the input',
      () => callParse(FLAT_VALID),
      aliasedJit,
    ],
    [
      'parse (jit) — flat struct with an alias, the alias in the input',
      () => callParse(ALIASED_VALID),
      aliasedJit,
    ],
    [
      'parse — nested struct, strip (extra keys at every level)',
      () => callParse(NESTED_LOOSE, STRIP),
      nested,
    ],
    ['parse — array of 100 records, strip', () => callParse(RECORDS_VALUE, STRIP), records],
    [
      'parse (jit) — nested struct, strip (extra keys at every level)',
      () => callParse(NESTED_LOOSE, STRIP),
      nestedJit,
    ],
    [
      'parse (jit) — array of 100 records, strip',
      () => callParse(RECORDS_VALUE, STRIP),
      recordsJit,
    ],
    // Coercion last among the parse rows: its options give parse the feedback
    // of an object with `coerce`, which the rows of 3.2 did not have.
    [
      'parse — flat struct, coerce: two strings converted',
      () => callParse(COERCE_VALUE, COERCE),
      flat,
    ],
    ['parse — flat struct, coerce: nothing to convert', () => callParse(FLAT_VALID, COERCE), flat],
    ['coerce — flat struct, two strings converted', () => callCoerce(COERCE_VALUE), flat],
    [
      'parse (jit) — flat struct, coerce: two strings converted',
      () => callParse(COERCE_VALUE, COERCE),
      flatJit,
    ],
    [
      'parse (jit) — flat struct, coerce: nothing to convert',
      () => callParse(FLAT_VALID, COERCE),
      flatJit,
    ],
    [
      'parse — nested struct, coerce: the numbers as text',
      () => callParse(NESTED_COERCE_VALUE, COERCE),
      nested,
    ],
    [
      'parse (jit) — nested struct, coerce: the numbers as text',
      () => callParse(NESTED_COERCE_VALUE, COERCE),
      nestedJit,
    ],
    [
      'parse — plain unions, coerce: a number and a boolean as text',
      () => callParse(UNION_COERCE_VALUE, COERCE),
      union,
    ],
    [
      'parse — enums of 32 members, coerce: a member as text',
      () => callParse(ENUM_COERCE_VALUE, COERCE),
      enumeration,
    ],
    ['parse — flat struct, plain and coerce in turn', alternating, flat],
    [
      'mongodb — toDocument, an entity with a reference, a struct and a list',
      () => mongodb.toDocument(account, MONGODB_VALUE),
      account,
    ],
    [
      'mongodb — fromDocument, the same document (parse with coerce)',
      () => mongodb.fromDocument(account, document),
      account,
    ],
    ...asyncRows(asyncSchemas(Schema.from)),
    ...asyncRows(asyncSchemas(jit), ' (jit)'),
    ['check — 1 000 flat records in a loop', loop, flat],
    ['checkEach — 1 000 flat records', eachOf(flat), flat],
    ['check (jit) — 1 000 flat records in a loop', loop, flatJit],
    ['checkEach (jit) — 1 000 flat records', eachOf(flatJit), flatJit],
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
  for (const [name, fn, schema, async, extra] of scenarios) {
    if (!name.includes(filter)) continue;
    const options = { quiet: json, schema, ...extra };
    results.push(async ? await benchAsync(name, fn, options) : bench(name, fn, options));
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
