/**
 * The sampling harness the comparison workers share. Calls are timed in
 * chunks, grown during the warmup until one chunk takes about a millisecond,
 * so reading the clock never dominates a call of a few nanoseconds.
 *
 * The measured function is called through a megamorphic call site: the
 * harness primes `call` with five functions of five closures before it times
 * anything, so V8 calls whatever it finds there generically instead of
 * inlining a library's check into the measuring loop, the way a program calls
 * a validator (bench/helpers.js explains why this matters for metaschema's
 * own harness). Every library is measured through the same site.
 */
const { performance } = require('node:perf_hooks');

const MAX_CHUNK = 1 << 16;

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const holder = { fn: null };

const call = () => holder.fn();

const DECOYS = [() => 0, () => 1, () => 2, () => 3, () => 4];
for (let round = 0; round < 2_000; round++) {
  for (let i = 0; i < DECOYS.length; i++) {
    holder.fn = DECOYS[i];
    call();
  }
}

// `sink` keeps every result alive, so no call is dead code.
let sink = 0;

const run = (count) => {
  for (let i = 0; i < count; i++) if (call()) sink++;
};

const measure = (fn, { warmupMs, sampleMs, samples }) => {
  holder.fn = fn;
  let chunk = 1;
  const warmupEnd = performance.now() + warmupMs;
  while (performance.now() < warmupEnd) {
    const start = performance.now();
    run(chunk);
    if (performance.now() - start < 1 && chunk < MAX_CHUNK) chunk *= 2;
  }
  const rates = [];
  for (let s = 0; s < samples; s++) {
    let iterations = 0;
    let elapsed = 0;
    const start = performance.now();
    do {
      run(chunk);
      iterations += chunk;
      elapsed = performance.now() - start;
    } while (elapsed < sampleMs);
    rates.push((iterations / elapsed) * 1000);
  }
  if (sink < 0) throw new Error('unreachable');
  return {
    median: median(rates),
    min: Math.min(...rates),
    max: Math.max(...rates),
    samples: rates,
  };
};

module.exports = { measure, median };
