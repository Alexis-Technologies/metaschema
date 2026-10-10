/**
 * Bundle-size report, run with `pnpm size`. With `--max-gzip <KB>` it also fails
 * when either core entry exceeds that min+gzip budget, and with
 * `--max-gzip-generators <KB>` when the `./generators` subpath adds more than
 * that on top of the core (CI uses both as gates). The budgets for 3.0 are
 * 13 KB per core entry and 5 KB for the generators (CLAUDE.md "Budgets"); the
 * `./compile` entry will be measured separately with a budget of its own.
 *
 * Bundles each shipped entry point with esbuild the way a consumer's bundler
 * would, then reports:
 *   - raw:      bundled, un-minified
 *   - min:      fully minified (whitespace + identifier mangling + syntax)
 *   - min+gzip: the number that matters for download and cold-start budgets
 *
 * The generators subpath requires the core (its register() reaches Schema and
 * Model), so on its own it would bundle the core again; it is measured as the
 * difference between a bundle of the core entry plus the subpath and the core
 * entry alone, which is what a consumer that imports both pays for it.
 *
 * The browser entry is bundled with `platform: 'browser'`, which resolves the
 * package.json `browser` map (src/runtime/node.js → src/runtime/browser.js).
 * That makes this report a tripwire: if a Node builtin ever leaks into the
 * browser graph, esbuild cannot resolve it and the script fails.
 */

const { gzipSync } = require('node:zlib');
const path = require('node:path');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..');

const ENTRIES = [
  { label: 'Node entry (index.js)', entry: 'index.js', platform: 'node' },
  { label: 'Browser entry (browser.js)', entry: 'browser.js', platform: 'browser' },
];

const GENERATORS = {
  label: 'Generators (./generators) on top of the Node entry',
  entry: 'index.js',
  platform: 'node',
};

const GENERATORS_ENTRY = './src/generators/index.js';

// `entry` alone, or `entry` plus the generators subpath in one bundle.
const bundle = async (entry, platform, minify, withGenerators = false) => {
  const contents = `require('./${entry}');${withGenerators ? ` require('${GENERATORS_ENTRY}');` : ''}`;
  const result = await esbuild.build({
    stdin: { contents, resolveDir: ROOT },
    bundle: true,
    minify,
    platform,
    write: false,
    logLevel: 'silent',
  });
  return Buffer.from(result.outputFiles[0].contents);
};

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

const budget = (flag) => {
  const args = process.argv.slice(2);
  const index = args.indexOf(flag);
  if (index === -1) return null;
  const limit = Number(args[index + 1]);
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error(`${flag} needs a positive number of kilobytes`);
  }
  return limit * 1024;
};

const measure = async ({ label, entry, platform }, withGenerators) => {
  const raw = await bundle(entry, platform, false, withGenerators);
  const min = await bundle(entry, platform, true, withGenerators);
  const gzip = gzipSync(min, { level: 9 });
  return { label, raw: raw.length, min: min.length, gzip: gzip.length };
};

const exceeded = (row, max) => {
  console.error(`Bundle budget exceeded: ${row.label} is ${kb(row.gzip)} min+gzip, max ${kb(max)}`);
  process.exitCode = 1;
};

const main = async () => {
  const maxGzip = budget('--max-gzip');
  const maxGenerators = budget('--max-gzip-generators');
  const rows = [];
  for (const entry of ENTRIES) rows.push(await measure(entry));
  const core = rows[0];
  const both = await measure(GENERATORS, true);
  const generators = {
    label: GENERATORS.label,
    raw: both.raw - core.raw,
    min: both.min - core.min,
    gzip: both.gzip - core.gzip,
  };
  console.log('| Entry | raw | min | min+gzip |');
  console.log('| ----- | ---:| ---:| --------:|');
  for (const row of [...rows, generators]) {
    console.log(`| ${row.label} | ${kb(row.raw)} | ${kb(row.min)} | ${kb(row.gzip)} |`);
  }
  if (maxGzip !== null) {
    for (const row of rows) if (row.gzip > maxGzip) exceeded(row, maxGzip);
  }
  if (maxGenerators !== null && generators.gzip > maxGenerators) {
    exceeded(generators, maxGenerators);
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
