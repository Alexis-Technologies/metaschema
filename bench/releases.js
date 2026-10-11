/**
 * Release over release: metaschema's own scenarios (bench/helpers.js: a flat
 * struct of four fields, a nested struct with collections and a tuple, each
 * valid and invalid, and `Schema.from` of both) measured on a checkout of
 * another release with today's harness, so every release is measured on one
 * machine the same way. Metarhia's metaschema 2.2.2 (the devDependency
 * `metaschema`) is the starting point. The current tree is measured on both
 * backends, and so is a release that has the `./compile` subpath.
 *
 * Run:
 *   node bench/releases.js                          # the current tree
 *   node bench/releases.js --src node_modules/metaschema
 *   git archive v1.0.0 | tar -x -C ../metaschema-1.0.0
 *   node bench/releases.js --src ../metaschema-1.0.0
 *
 * Each run merges its release into bench/results/releases.json.
 */
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs, promisify } = require('node:util');

const { RELEASE_SCENARIOS } = require('./compare/releases-worker.js');
const { describeMachine } = require('./machine.js');

const run = promisify(execFile);
const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'results', 'releases.json');

const { values: args } = parseArgs({
  options: {
    src: { type: 'string', default: ROOT },
    samples: { type: 'string', default: '5' },
    'sample-ms': { type: 'string', default: '1000' },
    'warmup-ms': { type: 'string', default: '1000' },
    'no-write': { type: 'boolean', default: false },
  },
});

const method = {
  warmupMs: Number(args['warmup-ms']),
  sampleMs: Number(args['sample-ms']),
  samples: Number(args.samples),
};

const src = path.resolve(args.src);
const pkg = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'));
const metarhia = pkg.name === 'metaschema';
const hasJit = fs.existsSync(path.join(src, 'src', 'compile', 'index.js'));

const format = (value) => Math.round(value).toLocaleString('en-US');

const worker = async (options) => {
  const file = path.join(__dirname, 'compare', 'releases-worker.js');
  try {
    const { stdout } = await run(process.execPath, [file, JSON.stringify(options)]);
    return JSON.parse(stdout.trim().split('\n').pop());
  } catch (error) {
    throw new Error(`releases-worker failed:\n${error.stderr || error.message}`, {
      cause: error,
    });
  }
};

const release = (backend) => ({
  id: `${metarhia ? 'metarhia-' : ''}${pkg.version}${backend === 'jit' ? '-jit' : ''}`,
  name: metarhia ? 'Metarhia metaschema' : '@alexify/metaschema',
  version: pkg.version,
  backend,
  current: src === ROOT,
});

const writeResults = (entries, machine) => {
  let existing = { releases: [] };
  try {
    existing = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  } catch {
    // the first run
  }
  const ids = new Set(entries.map((entry) => entry.id));
  const kept = existing.releases.filter((entry) => !ids.has(entry.id));
  // A tree that is no longer current (the next release was cut) is history.
  const current = entries.some((entry) => entry.current);
  if (current) for (const entry of kept) entry.current = false;
  const report = {
    generatedAt: new Date().toISOString(),
    machine,
    method,
    scenarios: RELEASE_SCENARIOS.map(({ id, title, unit }) => ({ id, title, unit })),
    releases: [...kept, ...entries],
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nWrote ${path.relative(ROOT, OUT)}`);
};

const main = async () => {
  const machine = describeMachine();
  const backends = hasJit ? ['closures', 'jit'] : ['closures'];
  console.log(`${pkg.name} ${pkg.version} from ${src} · ${machine.cpu} · Node ${machine.node}`);
  const entries = [];
  for (const backend of backends) {
    const entry = { ...release(backend), results: {} };
    console.log(`\n${entry.name} ${entry.version} · ${backend}`);
    for (const scenario of RELEASE_SCENARIOS) {
      if (backend === 'jit' && scenario.build) continue;
      const result = await worker({
        src,
        jit: backend === 'jit',
        scenario: scenario.id,
        ...method,
      });
      entry.results[scenario.id] = { median: result.median, min: result.min, max: result.max };
      console.log(`  ${scenario.title.padEnd(48)} ${format(result.median).padStart(14)} ops/s`);
    }
    entries.push(entry);
  }
  if (!args['no-write']) writeResults(entries, machine);
};

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
