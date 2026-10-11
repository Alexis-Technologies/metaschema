/**
 * Cross-library comparison: the scenarios of bench/compare/scenarios.js (the
 * moltar object flat and nested in its four modes, every issue of an invalid
 * value, building a schema), implemented idiomatically in every library under
 * bench/compare/adapters, plus a cold start. The results land in
 * bench/results/compare.json, which feeds the charts and the tables of the
 * docs and the README (pnpm bench:report).
 *
 * Run: pnpm bench:compare [--only zod,valibot] [--scenarios nested,invalid]
 *        [--samples 5] [--sample-ms 1000] [--warmup-ms 1000] [--cold-runs 20]
 *        [--no-write]
 *
 * The method, also published with the results in docs/guide/performance.md:
 * - every (library, scenario) pair runs in a FRESH process, so no library's
 *   JIT feedback or heap state leaks into the next measurement;
 * - each adapter must give the scenario's verdicts (the valid value accepted,
 *   unknown keys accepted or rejected as the mode says, a wrong field
 *   rejected, the four issues at their paths) before it is timed, and a
 *   mismatch aborts the run;
 * - the measured function is called through a megamorphic call site, the
 *   same for every library (bench/compare/measure.js);
 * - after a warmup, calls are timed in samples and the median is reported.
 *
 * `--scenarios` takes scenario ids (`nested-assertStrict`) or groups (`nested`).
 */
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs, promisify } = require('node:util');

const { ADAPTERS } = require('./compare/adapters/index.js');
const { SCENARIOS } = require('./compare/scenarios.js');
const { median } = require('./compare/measure.js');
const { describeMachine } = require('./machine.js');

const run = promisify(execFile);
const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'results', 'compare.json');

const { values: args } = parseArgs({
  options: {
    only: { type: 'string' },
    scenarios: { type: 'string' },
    samples: { type: 'string', default: '5' },
    'sample-ms': { type: 'string', default: '1000' },
    'warmup-ms': { type: 'string', default: '1000' },
    'cold-runs': { type: 'string', default: '20' },
    'no-write': { type: 'boolean', default: false },
  },
});

const list = (value) => (value ? value.split(',').map((item) => item.trim()) : null);

const method = {
  warmupMs: Number(args['warmup-ms']),
  sampleMs: Number(args['sample-ms']),
  samples: Number(args.samples),
  coldStartRuns: Number(args['cold-runs']),
};

const versionOf = (name) => {
  const file = path.join(ROOT, 'node_modules', name, 'package.json');
  return JSON.parse(fs.readFileSync(file, 'utf8')).version;
};

const ownVersion = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'))).version;

const libraryInfo = (adapter) => ({
  id: adapter.id,
  name: adapter.name,
  package: adapter.package,
  version: adapter.package === '@alexify/metaschema' ? ownVersion() : versionOf(adapter.package),
  variant: adapter.variant,
});

const format = (value) => Math.round(value).toLocaleString('en-US');

const worker = async (script, argv) => {
  const file = path.join(__dirname, 'compare', script);
  try {
    const { stdout } = await run(process.execPath, [file, ...argv], { maxBuffer: 1 << 20 });
    return JSON.parse(stdout.trim().split('\n').pop());
  } catch (error) {
    const detail = error.stderr || error.message;
    throw new Error(`${script} ${argv.join(' ')} failed:\n${detail}`, { cause: error });
  }
};

const printTable = (libraries, scenarios) => {
  const header = ['Library', ...scenarios.map((scenario) => scenario.title)];
  console.log(`\n| ${header.join(' | ')} |`);
  console.log(`| ${header.map((_, i) => (i === 0 ? '---' : '---:')).join(' | ')} |`);
  for (const library of libraries) {
    const cells = scenarios.map((scenario) => {
      const result = scenario.results[library.id];
      return result ? format(result.median) : '—';
    });
    console.log(`| ${library.name} · ${library.variant} | ${cells.join(' | ')} |`);
  }
};

// Merges this run into the file, so a partial run (--only, --scenarios)
// keeps the other rows.
const writeResults = (report) => {
  let existing = null;
  try {
    existing = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  } catch {
    // the first run
  }
  if (existing) {
    const libraries = new Map(existing.libraries.map((library) => [library.id, library]));
    for (const library of report.libraries) libraries.set(library.id, library);
    report.libraries = ADAPTERS.map((adapter) => libraries.get(adapter.id)).filter(Boolean);
    report.scenarios = SCENARIOS.map(({ id }) => {
      const fresh = report.scenarios.find((scenario) => scenario.id === id);
      const old = existing.scenarios.find((scenario) => scenario.id === id);
      if (!fresh) return old;
      return { ...fresh, results: { ...old?.results, ...fresh.results } };
    }).filter(Boolean);
    report.coldStart = { ...existing.coldStart, ...report.coldStart };
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nWrote ${path.relative(ROOT, OUT)}`);
};

const measureScenarios = async (adapters, scenarios) => {
  const measured = [];
  for (const scenario of scenarios) {
    console.log(`\n${scenario.title} — ${scenario.description}`);
    const results = {};
    for (const adapter of adapters) {
      const options = { adapter: adapter.id, scenario: scenario.id, ...method };
      const result = await worker('worker.js', [JSON.stringify(options)]);
      const label = `${adapter.name} · ${adapter.variant}`.padEnd(56);
      if (result.unsupported) {
        console.log(`  ${label} ${'—'.padStart(14)}`);
        continue;
      }
      const spread = ((result.max - result.min) / result.median) * 100;
      results[adapter.id] = { median: result.median, min: result.min, max: result.max };
      console.log(
        `  ${label} ${format(result.median).padStart(14)} ${scenario.unit}  ±${spread.toFixed(1)}%`,
      );
    }
    const { id, group, groupTitle, mode, title, description, unit } = scenario;
    measured.push({ id, group, groupTitle, mode, title, description, unit, results });
  }
  return measured;
};

const measureColdStart = async (adapters) => {
  const coldStart = {};
  if (method.coldStartRuns <= 0) return coldStart;
  console.log(
    `\nCold start — load + build the strict nested schema + first check, ` +
      `${method.coldStartRuns} fresh processes`,
  );
  for (const adapter of adapters) {
    const runs = [];
    for (let i = 0; i < method.coldStartRuns; i++) {
      runs.push(await worker('coldstart-worker.js', [adapter.id]));
    }
    const phases = {};
    for (const phase of ['load', 'build', 'firstCheck', 'total']) {
      phases[phase] = median(runs.map((sample) => sample[phase]));
    }
    coldStart[adapter.id] = phases;
    const label = `${adapter.name} · ${adapter.variant}`.padEnd(56);
    console.log(`  ${label} ${phases.total.toFixed(2).padStart(8)} ms`);
  }
  return coldStart;
};

const main = async () => {
  const only = list(args.only);
  const wanted = list(args.scenarios);
  const adapters = ADAPTERS.filter((adapter) => !only || only.includes(adapter.id));
  const scenarios = SCENARIOS.filter(
    (scenario) => !wanted || wanted.includes(scenario.id) || wanted.includes(scenario.group),
  );
  const machine = describeMachine();
  console.log(`Cross-library comparison · ${machine.cpu} · Node ${machine.node}`);
  console.log(
    `${method.samples} × ${method.sampleMs} ms samples after ${method.warmupMs} ms warmup, ` +
      'median reported',
  );
  const measured = await measureScenarios(adapters, scenarios);
  const coldStart = wanted ? {} : await measureColdStart(adapters);
  const libraries = adapters.map(libraryInfo);
  printTable(libraries, measured);
  if (args['no-write']) return;
  writeResults({
    generatedAt: new Date().toISOString(),
    machine,
    method,
    libraries,
    scenarios: measured,
    coldStart,
  });
};

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
