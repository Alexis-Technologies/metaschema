/**
 * Cold start of ONE library in a fresh process: loading it, building the
 * strict nested schema and the first check of the valid value. The adapter
 * and the scenario are loaded before the clock starts, so only the library's
 * own cost is measured; `process.hrtime`, because loading `node:perf_hooks`
 * would be charged to nobody.
 *
 * Usage (spawned by bench/compare.js): node bench/compare/coldstart-worker.js <adapter>
 */
const { getAdapter } = require('./adapters/index.js');
const { getScenario } = require('./scenarios.js');

const now = () => Number(process.hrtime.bigint()) / 1e6;

const main = () => {
  const adapter = getAdapter(process.argv[2]);
  const scenario = getScenario('build');
  const t0 = now();
  const lib = adapter.load();
  const t1 = now();
  const check = adapter.builder(lib, scenario.shape)();
  const t2 = now();
  const verdict = check(scenario.value);
  const t3 = now();
  if (verdict !== true) throw new Error(`${adapter.id}: the first check rejected the valid value`);
  const result = { load: t1 - t0, build: t2 - t1, firstCheck: t3 - t2, total: t3 - t0 };
  process.stdout.write(`${JSON.stringify(result)}\n`);
};

try {
  main();
} catch (error) {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exitCode = 1;
}
