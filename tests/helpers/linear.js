const assert = require('node:assert/strict');

// A relative bound, not one in milliseconds: the input of full size is timed
// against an input of an eighth of it, and a walk that is linear takes about
// eight times as long where a quadratic one takes 64 times. That holds on a
// slow or loaded machine (c8, a Windows runner, files run in parallel), where
// a bound of 50 ms did not. The smaller time is floored, so that runs too
// short to time cannot fail the bound, and the full size is the size the test
// had, so that a regression costs what it cost before.
const RUNS = 5;
const RATIO = 32;
const FLOOR_MS = 0.5;

const medianMs = (run, input) => {
  const times = [];
  for (let index = 0; index < RUNS; index += 1) {
    const started = performance.now();
    run(input);
    times.push(performance.now() - started);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(RUNS / 2)];
};

// `make(fraction)` builds the input at that fraction of the full size.
const assertLinear = (label, run, make) => {
  const small = Math.max(medianMs(run, make(1 / 8)), FLOOR_MS);
  const large = medianMs(run, make(1));
  const reason = `${label}: ${large.toFixed(1)} ms at full size, ${small.toFixed(1)} ms at an eighth`;
  assert.ok(large < RATIO * small, reason);
};

module.exports = { assertLinear };
