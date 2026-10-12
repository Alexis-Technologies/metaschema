/**
 * One (release, scenario) pair of bench/releases.js in a fresh process: the
 * release is loaded from its directory (`index.js` of a checkout, or the main
 * entry of Metarhia's package), the scenario's verdicts are checked, then the
 * call is measured with the comparison's harness.
 *
 * Usage (spawned by bench/releases.js): node bench/compare/releases-worker.js '<json options>'
 */
const path = require('node:path');

const {
  FLAT_SCHEMA,
  NESTED_SCHEMA,
  FLAT_VALID,
  FLAT_INVALID,
  NESTED_VALID,
  NESTED_INVALID,
} = require('../helpers.js');

const RELEASE_SCENARIOS = [
  { id: 'from-flat', title: 'Schema.from — flat struct', build: FLAT_SCHEMA },
  { id: 'from-nested', title: 'Schema.from — nested struct', build: NESTED_SCHEMA },
  { id: 'flat-valid', title: 'check — flat struct, valid', schema: FLAT_SCHEMA, value: FLAT_VALID },
  {
    id: 'flat-invalid',
    title: 'check — flat struct, invalid',
    schema: FLAT_SCHEMA,
    value: FLAT_INVALID,
    invalid: true,
  },
  {
    id: 'nested-valid',
    title: 'check — nested struct, valid',
    schema: NESTED_SCHEMA,
    value: NESTED_VALID,
  },
  {
    id: 'nested-invalid',
    title: 'check — nested struct, invalid',
    schema: NESTED_SCHEMA,
    value: NESTED_INVALID,
    invalid: true,
  },
].map((scenario) => ({ ...scenario, unit: scenario.build ? 'schemas/s' : 'ops/s' }));

const load = (src, jit) => {
  const pkg = require(path.join(src, 'package.json'));
  const { Schema } = require(path.join(src, pkg.name === 'metaschema' ? pkg.main : 'index.js'));
  const compile = jit ? require(path.join(src, 'src', 'compile', 'index.js')).compile : null;
  return { Schema, compile };
};

const main = () => {
  const { measure } = require('./measure.js');
  const options = JSON.parse(process.argv[2]);
  const scenario = RELEASE_SCENARIOS.find((candidate) => candidate.id === options.scenario);
  const { Schema, compile } = load(options.src, options.jit);
  let fn = null;
  if (scenario.build) {
    const definition = scenario.build;
    fn = () => Schema.from(definition);
  } else {
    const schema = Schema.from(scenario.schema);
    if (compile) compile(schema, { jit: true });
    const { value } = scenario;
    if (schema.check(value).valid === Boolean(scenario.invalid)) {
      throw new Error(
        `${scenario.id}: the verdict is not ${scenario.invalid ? 'invalid' : 'valid'}`,
      );
    }
    fn = () => schema.check(value);
  }
  process.stdout.write(`${JSON.stringify(measure(fn, options))}\n`);
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exitCode = 1;
  }
}

module.exports = { RELEASE_SCENARIOS };
