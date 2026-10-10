const { performance } = require('node:perf_hooks');

const WARMUP_ITERATIONS = 2_000;
const MEASURE_MS = 1_000;
const BATCH = 100;

// Schema#check is measured as a callee. Called straight from a scenario
// closure, V8 inlines it, createContext, the walk and ValidationResult into
// the measuring loop, and in that fused loop a few bytes of bytecode in
// check swing the moltar scenarios by 10–20% either way, scenario by
// scenario. Two things keep it a real call here, the way any program calls
// it: the schema under measurement sits in a holder that `bench` writes, so
// the receiver is never a constant V8 can fold the method out of, and the
// call site is made megamorphic once, with five `check` methods on objects
// of five shapes, so V8 calls whatever it finds there generically.
const subject = { schema: null };

const callCheck = (value, options) => subject.schema.check(value, options);

const DECOYS = [
  { check: () => 0 },
  { a: 1, check: () => 1 },
  { a: 1, b: 1, check: () => 2 },
  { a: 1, b: 1, c: 1, check: () => 3 },
  { a: 1, b: 1, c: 1, d: 1, check: () => 4 },
];
for (let round = 0; round < 2_000; round++) {
  for (const decoy of DECOYS) {
    subject.schema = decoy;
    callCheck(null, undefined);
  }
}

// The clock is read once per batch, not once per call: at ten million calls
// a second the clock itself would be a visible share of every measurement.
// `schema` is the schema a scenario measures through callCheck.
const bench = (name, fn, options = {}) => {
  const { warmup = WARMUP_ITERATIONS, measureMs = MEASURE_MS, quiet = false, schema } = options;
  if (schema !== undefined) subject.schema = schema;
  for (let i = 0; i < warmup; i++) fn();
  let iterations = 0;
  const start = performance.now();
  let now = start;
  while (now - start < measureMs) {
    for (let i = 0; i < BATCH; i++) fn();
    iterations += BATCH;
    now = performance.now();
  }
  const elapsed = now - start;
  const opsPerSec = Math.round((iterations / elapsed) * 1000);
  const ops = opsPerSec.toLocaleString('en-US').padStart(12);
  if (!quiet) console.log(`${name.padEnd(52)} ${ops} ops/sec`);
  return { name, opsPerSec };
};

const SYSTEM_TYPES = {
  string: { metadata: { pg: 'varchar' } },
  number: { metadata: { pg: 'integer' } },
  boolean: { metadata: { pg: 'boolean' } },
  datetime: { js: 'string', metadata: { pg: 'timestamp with time zone' } },
  text: { js: 'string', metadata: { pg: 'text' } },
  json: { metadata: { pg: 'jsonb' } },
};

const FLAT_SCHEMA = {
  name: 'string',
  email: { type: 'string', length: { min: 5, max: 64 } },
  age: '?number',
  active: 'boolean',
};

const NESTED_SCHEMA = {
  name: { first: 'string', last: 'string', third: '?string' },
  age: 'number',
  levelOne: { levelTwo: { levelThree: { type: 'enum', enum: [1, 2, 3] } } },
  tags: { array: 'string' },
  matrix: { array: { array: 'number' } },
  point: ['number', 'number'],
};

const FLAT_VALID = { name: 'Marcus', email: 'marcus@example.com', age: 42, active: true };
const FLAT_INVALID = { name: 7, email: 'm@x', extra: true };

const NESTED_VALID = {
  name: { first: 'Marcus', last: 'Aurelius' },
  age: 58,
  levelOne: { levelTwo: { levelThree: 2 } },
  tags: ['emperor', 'stoic'],
  matrix: [
    [1, 2, 3],
    [4, 5, 6],
  ],
  point: [10, 20],
};

const NESTED_INVALID = {
  name: { first: 'Marcus' },
  age: '58',
  levelOne: { levelTwo: { levelThree: 4 } },
  tags: ['emperor', 1],
  matrix: [[1, 'two']],
  point: [10],
};

// The object of the typescript-runtime-type-benchmarks (moltar) suite, as a
// flat schema and with its nested part, so the numbers line up with that
// suite's four modes: parseSafe (unknown keys ignored, the value returned),
// parseStrict (unknown keys rejected, the value returned), assertLoose and
// assertStrict (the verdict only). metaschema has no parse step yet, so the
// parse modes return the value when it is valid.
const MOLTAR_FLAT_SCHEMA = {
  number: 'number',
  negNumber: 'number',
  maxNumber: 'number',
  string: 'string',
  longString: 'string',
  boolean: 'boolean',
};

const MOLTAR_NESTED_SCHEMA = {
  ...MOLTAR_FLAT_SCHEMA,
  deeplyNested: { foo: 'string', num: 'number', bool: 'boolean' },
};

const MOLTAR_FLAT_VALUE = {
  number: 1,
  negNumber: -1,
  maxNumber: Number.MAX_VALUE,
  string: 'string',
  longString:
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ' +
    'ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ' +
    'ullamco laboris nisi ut aliquip ex ea commodo consequat.',
  boolean: true,
};

const MOLTAR_NESTED_VALUE = {
  ...MOLTAR_FLAT_VALUE,
  deeplyNested: { foo: 'bar', num: 1, bool: false },
};

// The loose modes see a value with keys the schema does not have.
const MOLTAR_FLAT_LOOSE = { ...MOLTAR_FLAT_VALUE, extra: 'key' };
const MOLTAR_NESTED_LOOSE = {
  ...MOLTAR_NESTED_VALUE,
  deeplyNested: { ...MOLTAR_NESTED_VALUE.deeplyNested, extra: 'key' },
  extra: 'key',
};

const loadModelFixture = () => {
  const fixture = require('../tests/fixtures/schemas/index.js');
  const { database, types: customTypes, ...schemas } = fixture;
  const types = Object.assign(Object.create(null), SYSTEM_TYPES, customTypes);
  const entities = Object.entries(schemas);
  return { types, entities, database };
};

module.exports = {
  bench,
  callCheck,
  FLAT_SCHEMA,
  NESTED_SCHEMA,
  FLAT_VALID,
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
};
