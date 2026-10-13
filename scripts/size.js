/**
 * Bundle-size report, run with `pnpm size`. With `--max-gzip <KB>` it also fails
 * when either core entry exceeds that min+gzip budget, with
 * `--max-gzip-generators <KB>` when the `./generators` subpath adds more than
 * that on top of the core, with `--max-gzip-compile <KB>` when the `./compile`
 * subpath does, with `--max-gzip-model <KB>` when the `./model` subpath does,
 * with `--max-gzip-stream <KB>` when the `./stream` subpath does, with
 * `--max-gzip-formats <KB>` when the `./formats` subpath does, with
 * `--max-gzip-derive <KB>` when the `./derive` subpath does, with
 * `--max-gzip-coerce <KB>` when the `./coerce` subpath does and with
 * `--max-gzip-mongodb <KB>` when the `./mongodb` subpath does on top of
 * `./coerce`, which it requires (CI uses the nine as gates). The budgets are
 * 19 KB per core entry, 7.5 KB for the generators, 5 KB for the compile
 * subpath, 13 KB for the model subpath, 1.5 KB for the stream subpath, 5 KB
 * for the formats subpath, 2.5 KB for the derive subpath, 2 KB for the
 * coerce subpath and 3.5 KB for the mongodb subpath (CLAUDE.md "Budgets").
 *
 * Bundles each shipped entry point with esbuild the way a consumer's bundler
 * would, then reports:
 *   - raw:      bundled, un-minified
 *   - min:      fully minified (whitespace + identifier mangling + syntax)
 *   - min+gzip: the number that matters for download and cold-start budgets
 *
 * The subpaths require the core (register() reaches Schema and Model), so on
 * their own they would bundle the core again; each is measured as the
 * difference between a bundle of the core entry plus the subpath and the core
 * entry alone, which is what a consumer that imports both pays for it. A
 * subpath that requires another (`base`) is measured on top of both.
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

const SUBPATHS = [
  {
    label: 'Generators (./generators) on top of the Node entry',
    entry: 'index.js',
    platform: 'node',
    subpath: './src/generators/index.js',
    flag: '--max-gzip-generators',
  },
  {
    label: 'Compile (./compile) on top of the Node entry',
    entry: 'index.js',
    platform: 'node',
    subpath: './src/compile/index.js',
    flag: '--max-gzip-compile',
  },
  {
    label: 'Model (./model) on top of the Node entry',
    entry: 'index.js',
    platform: 'node',
    subpath: './src/model/index.js',
    flag: '--max-gzip-model',
  },
  {
    label: 'Stream (./stream) on top of the Node entry',
    entry: 'index.js',
    platform: 'node',
    subpath: './src/stream/index.js',
    flag: '--max-gzip-stream',
  },
  {
    label: 'Formats (./formats) on top of the Node entry',
    entry: 'index.js',
    platform: 'node',
    subpath: './src/formats/index.js',
    flag: '--max-gzip-formats',
  },
  {
    label: 'Derive (./derive) on top of the Node entry',
    entry: 'index.js',
    platform: 'node',
    subpath: './src/derive/index.js',
    flag: '--max-gzip-derive',
  },
  {
    label: 'Coerce (./coerce) on top of the Node entry',
    entry: 'index.js',
    platform: 'node',
    subpath: './src/coerce/index.js',
    flag: '--max-gzip-coerce',
  },
  {
    label: 'MongoDB (./mongodb) on top of the Node entry and ./coerce',
    entry: 'index.js',
    platform: 'node',
    subpath: './src/mongodb/index.js',
    base: ['./src/coerce/index.js'],
    flag: '--max-gzip-mongodb',
  },
];

// `entry` alone, or `entry` plus subpaths in one bundle, exported so that
// the bundle keeps them: the package says `sideEffects: false`, and esbuild
// drops a require whose result nothing uses.
const bundle = async (entry, platform, minify, subpaths = []) => {
  let extra = '';
  for (const subpath of subpaths) extra += `, require('${subpath}')`;
  const contents = `module.exports = [require('./${entry}')${extra}];`;
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

const measure = async ({ label, entry, platform }, subpaths) => {
  const raw = await bundle(entry, platform, false, subpaths);
  const min = await bundle(entry, platform, true, subpaths);
  const gzip = gzipSync(min, { level: 9 });
  return { label, raw: raw.length, min: min.length, gzip: gzip.length };
};

const exceeded = (row, max) => {
  console.error(`Bundle budget exceeded: ${row.label} is ${kb(row.gzip)} min+gzip, max ${kb(max)}`);
  process.exitCode = 1;
};

const main = async () => {
  const maxGzip = budget('--max-gzip');
  const rows = [];
  for (const entry of ENTRIES) rows.push(await measure(entry));
  const core = rows[0];
  const extras = [];
  for (const entry of SUBPATHS) {
    const { base = [] } = entry;
    const under = base.length === 0 ? core : await measure(entry, base);
    const both = await measure(entry, [...base, entry.subpath]);
    extras.push({
      label: entry.label,
      max: budget(entry.flag),
      raw: both.raw - under.raw,
      min: both.min - under.min,
      gzip: both.gzip - under.gzip,
    });
  }
  console.log('| Entry | raw | min | min+gzip |');
  console.log('| ----- | ---:| ---:| --------:|');
  for (const row of [...rows, ...extras]) {
    console.log(`| ${row.label} | ${kb(row.raw)} | ${kb(row.min)} | ${kb(row.gzip)} |`);
  }
  if (maxGzip !== null) {
    for (const row of rows) if (row.gzip > maxGzip) exceeded(row, maxGzip);
  }
  for (const row of extras) {
    if (row.max !== null && row.gzip > row.max) exceeded(row, row.max);
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
