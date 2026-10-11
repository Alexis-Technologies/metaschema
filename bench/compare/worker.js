/**
 * Runs ONE (library, scenario) pair in a fresh process, so no library's JIT
 * feedback or heap state leaks into the next one; checks that the library
 * gives the scenario's verdicts, then measures. Prints one JSON line:
 * `{ median, min, max, samples }`, or `{ unsupported: true }` when the library
 * has no way to express the mode.
 *
 * Usage (spawned by bench/compare.js): node bench/compare/worker.js '<json options>'
 */
const { getAdapter } = require('./adapters/index.js');
const { getScenario } = require('./scenarios.js');
const { measure } = require('./measure.js');

const fail = (adapter, scenario, message) => {
  throw new Error(`${adapter.id} on ${scenario.id}: ${message}`);
};

// A library that disagrees with the scenario is measuring something else (a
// failing check is fast), so every verdict is checked before anything is timed.
const verifyMode = (adapter, scenario, fn) => {
  const { mode, value, loose } = scenario;
  const bad = { ...value, number: '1' };
  const parsing = mode.startsWith('parse');
  const accepted = (input) => (parsing ? fn(input) !== null : fn(input) === true);
  const expect = (input, verdict, what) => {
    if (accepted(input) !== verdict) {
      fail(adapter, scenario, `${what} should be ${verdict ? 'accepted' : 'rejected'}`);
    }
  };
  if (mode !== 'assertLoose') expect(value, true, 'the valid value');
  expect(loose, mode.endsWith('Safe') || mode.endsWith('Loose'), 'the value with unknown keys');
  expect(bad, false, 'a value with a wrong field');
};

const verifyIssues = (adapter, scenario, impl) => {
  const found = new Set(impl.paths(impl.issues(scenario.value)));
  const expected = scenario.paths;
  const same = found.size === expected.length && expected.every((path) => found.has(path));
  if (!same) fail(adapter, scenario, `expected issues at ${expected}, got ${[...found]}`);
};

const verifyBuild = (adapter, scenario, make) => {
  const check = make();
  if (check(scenario.value) !== true) fail(adapter, scenario, 'the valid value was rejected');
  if (check(scenario.invalid) !== false) fail(adapter, scenario, 'the invalid value passed');
};

const prepare = (adapter, scenario, lib) => {
  if (scenario.type === 'build') {
    const make = adapter.builder(lib, scenario.shape);
    verifyBuild(adapter, scenario, make);
    return make;
  }
  const impl = adapter.setup(lib, scenario.shape);
  if (scenario.type === 'issues') {
    verifyIssues(adapter, scenario, impl);
    const { value } = scenario;
    return () => impl.issues(value);
  }
  const fn = impl[scenario.mode];
  if (!fn) return null;
  verifyMode(adapter, scenario, fn);
  const input = scenario.mode === 'assertLoose' ? scenario.loose : scenario.value;
  return () => fn(input);
};

const main = () => {
  const options = JSON.parse(process.argv[2]);
  const adapter = getAdapter(options.adapter);
  const scenario = getScenario(options.scenario);
  const fn = prepare(adapter, scenario, adapter.load());
  const result = fn ? measure(fn, options) : { unsupported: true };
  process.stdout.write(`${JSON.stringify(result)}\n`);
};

try {
  main();
} catch (error) {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exitCode = 1;
}
