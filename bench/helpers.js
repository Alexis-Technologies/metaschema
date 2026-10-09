const { performance } = require('node:perf_hooks');

const WARMUP_ITERATIONS = 2_000;
const MEASURE_MS = 1_000;

const bench = (name, fn, { warmup = WARMUP_ITERATIONS, measureMs = MEASURE_MS } = {}) => {
  for (let i = 0; i < warmup; i++) fn();
  let iterations = 0;
  const start = performance.now();
  while (performance.now() - start < measureMs) {
    fn();
    iterations++;
  }
  const elapsed = performance.now() - start;
  const opsPerSec = Math.round((iterations / elapsed) * 1000);
  const ops = opsPerSec.toLocaleString('en-US').padStart(12);
  console.log(`${name.padEnd(52)} ${ops} ops/sec`);
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

const loadModelFixture = () => {
  const fixture = require('../tests/fixtures/schemas/index.js');
  const { database, types: customTypes, ...schemas } = fixture;
  const types = Object.assign(Object.create(null), SYSTEM_TYPES, customTypes);
  const entities = Object.entries(schemas);
  return { types, entities, database };
};

module.exports = {
  bench,
  FLAT_SCHEMA,
  NESTED_SCHEMA,
  FLAT_VALID,
  FLAT_INVALID,
  NESTED_VALID,
  NESTED_INVALID,
  loadModelFixture,
};
