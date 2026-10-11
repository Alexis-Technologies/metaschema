/**
 * The scenarios of the cross-library comparison. The schema is the object of
 * the typescript-runtime-type-benchmarks (moltar) suite, flat and with its
 * nested part, as a library-neutral shape every adapter translates into its
 * own idiom (bench/compare/adapters). The modes are the suite's:
 *
 * - parseSafe:    unknown keys allowed, the value returned
 * - parseStrict:  unknown keys rejected, the value returned
 * - assertLoose:  a value with unknown keys, the verdict only
 * - assertStrict: unknown keys rejected, the verdict only
 *
 * Two more scenarios go past the suite: an invalid value with four problems,
 * where every library is asked for every issue with its path (the call a
 * form or an API makes to report them), and building the strict nested
 * schema, which is what a program pays per schema at start-up (and per call
 * when it builds schemas on the fly).
 */
const {
  MOLTAR_FLAT_VALUE,
  MOLTAR_NESTED_VALUE,
  MOLTAR_FLAT_LOOSE,
  MOLTAR_NESTED_LOOSE,
} = require('../helpers.js');

const FLAT = {
  number: 'number',
  negNumber: 'number',
  maxNumber: 'number',
  string: 'string',
  longString: 'string',
  boolean: 'boolean',
};

const NESTED = { ...FLAT, deeplyNested: { foo: 'string', num: 'number', bool: 'boolean' } };

const INVALID_VALUE = {
  ...MOLTAR_NESTED_VALUE,
  number: '1',
  string: 2,
  deeplyNested: { foo: 'bar', num: 'one', bool: null },
};

const INVALID_PATHS = ['number', 'string', 'deeplyNested.num', 'deeplyNested.bool'];

const MODES = [
  { id: 'parseSafe', title: 'parseSafe', description: 'unknown keys allowed, the value returned' },
  {
    id: 'parseStrict',
    title: 'parseStrict',
    description: 'unknown keys rejected, the value returned',
  },
  {
    id: 'assertLoose',
    title: 'assertLoose',
    description: 'unknown keys allowed, the verdict only',
  },
  {
    id: 'assertStrict',
    title: 'assertStrict',
    description: 'unknown keys rejected, the verdict only',
  },
];

const GROUPS = [
  {
    id: 'flat',
    title: 'Flat object',
    description: 'A valid object of 6 fields.',
    shape: FLAT,
    value: MOLTAR_FLAT_VALUE,
    loose: MOLTAR_FLAT_LOOSE,
  },
  {
    id: 'nested',
    title: 'Nested object',
    description: 'A valid object of 6 fields and a nested object of 3.',
    shape: NESTED,
    value: MOLTAR_NESTED_VALUE,
    loose: MOLTAR_NESTED_LOOSE,
  },
];

const SCENARIOS = [];
for (const group of GROUPS) {
  for (const mode of MODES) {
    SCENARIOS.push({
      id: `${group.id}-${mode.id}`,
      group: group.id,
      groupTitle: group.title,
      mode: mode.id,
      title: `${group.title}, ${mode.title}`,
      description: `${group.description} ${mode.title}: ${mode.description}.`,
      unit: 'ops/s',
      type: 'mode',
      shape: group.shape,
      value: group.value,
      loose: group.loose,
    });
  }
}

SCENARIOS.push({
  id: 'invalid',
  group: 'invalid',
  groupTitle: 'Every issue',
  mode: null,
  title: 'Every issue of an invalid value',
  description:
    'The nested object with four wrong fields, unknown keys rejected; every issue collected ' +
    'with its path.',
  unit: 'ops/s',
  type: 'issues',
  shape: NESTED,
  value: INVALID_VALUE,
  valid: MOLTAR_NESTED_VALUE,
  paths: INVALID_PATHS,
});

SCENARIOS.push({
  id: 'build',
  group: 'build',
  groupTitle: 'Build a schema',
  mode: null,
  title: 'Build a schema',
  description: 'The strict nested schema built from its definition, ready to check.',
  unit: 'schemas/s',
  type: 'build',
  shape: NESTED,
  value: MOLTAR_NESTED_VALUE,
  invalid: INVALID_VALUE,
});

const getScenario = (id) => {
  const scenario = SCENARIOS.find((candidate) => candidate.id === id);
  if (!scenario) throw new Error(`unknown scenario "${id}"`);
  return scenario;
};

module.exports = { SCENARIOS, GROUPS, MODES, NESTED, INVALID_VALUE, getScenario };
