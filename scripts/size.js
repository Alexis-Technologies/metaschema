/**
 * Bundle-size report, run with `pnpm size`.
 *
 * Bundles each shipped entry point with esbuild the way a consumer's bundler
 * would, then reports:
 *   - raw:      bundled, un-minified
 *   - min:      fully minified (whitespace + identifier mangling + syntax)
 *   - min+gzip: the number that matters for download and cold-start budgets
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

const bundle = async (entry, platform, minify) => {
  const result = await esbuild.build({
    entryPoints: [path.join(ROOT, entry)],
    bundle: true,
    minify,
    platform,
    write: false,
    logLevel: 'silent',
  });
  return Buffer.from(result.outputFiles[0].contents);
};

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

const main = async () => {
  const rows = [];
  for (const { label, entry, platform } of ENTRIES) {
    const raw = await bundle(entry, platform, false);
    const min = await bundle(entry, platform, true);
    const gzip = gzipSync(min, { level: 9 });
    rows.push({ label, raw: kb(raw.length), min: kb(min.length), gzip: kb(gzip.length) });
  }
  console.log('| Entry | raw | min | min+gzip |');
  console.log('| ----- | ---:| ---:| --------:|');
  for (const row of rows) {
    console.log(`| ${row.label} | ${row.raw} | ${row.min} | ${row.gzip} |`);
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
