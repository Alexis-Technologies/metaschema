/**
 * Chart models for the benchmark results in bench/results/*.json and
 * bench/baseline.json: the one place that decides what a chart shows (rows,
 * order, grouping, scale, formatting). Two renderers read it: the docs
 * components (docs/.vitepress/theme/components/Bench*.vue, HTML bars) and the
 * README images (bench/report/svg.mjs). ESM so that Vite can import it; the
 * CommonJS report script loads it with import().
 *
 * A row's `tone` says how it is emphasized: `primary` for metaschema on the
 * JIT backend, `secondary` for metaschema on the closures, none for the rest.
 */

const TONES = { 'metaschema-jit': 'primary', metaschema: 'secondary' };

const trim = (value) => String(Number(value.toPrecision(3)));

/** 779878 → "780k", 16685662 → "16.7M", 1219 → "1,219". */
export const compact = (value) => {
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${trim(value / 1e6)}M`;
  if (abs >= 1e4) return `${trim(value / 1e3)}k`;
  return Math.round(value).toLocaleString('en-US');
};

/** A full integer with thousands separators, for tables. */
export const grouped = (value) => Math.round(value).toLocaleString('en-US');

/** Three significant figures, thousands-separated: 779878 → "780,000". */
export const approx = (value) => {
  const digits = Math.max(0, Math.floor(Math.log10(Math.abs(value))) + 1 - 3);
  return (Math.round(value / 10 ** digits) * 10 ** digits).toLocaleString('en-US');
};

/** The time one call takes at `perSecond` calls a second. */
export const perCall = (perSecond) => {
  const seconds = 1 / perSecond;
  if (seconds >= 1e-3) return `${trim(seconds * 1e3)} ms`;
  if (seconds >= 1e-6) return `${trim(seconds * 1e6)} µs`;
  return `${trim(seconds * 1e9)} ns`;
};

export const formatValue = (value, unit) => {
  if (unit === 'ms') return `${value < 10 ? value.toFixed(1) : Math.round(value)} ms`;
  if (unit === 'KB') return `${value.toFixed(1)} KB`;
  if (unit === '×') return `×${value < 10 ? value.toFixed(1) : Math.round(value)}`;
  return compact(value);
};

// ─── Scales ─────────────────────────────────────────────────────────────────

const niceStep = (raw) => {
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const residual = raw / magnitude;
  const nice = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10;
  return nice * magnitude;
};

/**
 * `{ ticks: [{ value, label, at }], at(value) }`, where `at` maps a value to
 * 0..1 along the bar track. A linear scale starts at zero; a log scale spans
 * whole decades around the data (the bars then encode orders of magnitude,
 * which the subtitle says).
 */
export const createScale = (values, kind, unit) => {
  const max = Math.max(...values);
  if (kind === 'log') {
    const min = Math.min(...values.filter((value) => value > 0));
    const lo = Math.floor(Math.log10(min));
    const hi = Math.max(lo + 1, Math.ceil(Math.log10(max)));
    const at = (value) => (Math.log10(Math.max(value, 10 ** lo)) - lo) / (hi - lo);
    const ticks = [];
    for (let exp = lo; exp <= hi; exp++) {
      ticks.push({ value: 10 ** exp, label: compact(10 ** exp), at: at(10 ** exp) });
    }
    return { kind, at, ticks };
  }
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const at = (value) => value / top;
  const ticks = [];
  for (let value = 0; value <= top + step / 2; value += step) {
    let label = compact(value);
    if (unit === '×' && value > 0) label = `×${trim(value)}`;
    else if (unit === 'ms' || unit === 'KB') label = `${trim(value)} ${unit}`;
    ticks.push({ value, label, at: at(value) });
  }
  return { kind, at, ticks };
};

// ─── Captions ───────────────────────────────────────────────────────────────

const day = (iso) => iso.slice(0, 10);

export const machineCaption = (machine) =>
  [machine.cpu, `${machine.cores} cores`, `Node ${machine.node}`].join(' · ');

export const compareCaption = (compare) => {
  const { method } = compare;
  const samples = `median of ${method.samples} × ${method.sampleMs / 1000} s samples`;
  return `${machineCaption(compare.machine)} · ${samples}, each library in a fresh process · ${day(compare.generatedAt)}`;
};

export const releasesCaption = (releases) => {
  const { method } = releases;
  const samples = `median of ${method.samples} × ${method.sampleMs / 1000} s samples`;
  return `${machineCaption(releases.machine)} · ${samples}, each release in a fresh process · ${day(releases.generatedAt)}`;
};

// ─── Cross-library comparison ───────────────────────────────────────────────

const byValueDesc = (a, b) => b.value - a.value;
const byValueAsc = (a, b) => a.value - b.value;

const libraryRow = (library, value, extra) => ({
  id: library.id,
  label: library.name,
  sublabel: library.variant,
  value,
  tone: TONES[library.id],
  ...extra,
});

const versionNote = (library) => `${library.package}@${library.version}`;

/** The groups of scenarios and, for a group with modes, the modes: what the tabs show. */
export const compareGroups = (compare) => {
  const groups = [];
  for (const scenario of compare.scenarios) {
    let group = groups.find((candidate) => candidate.id === scenario.group);
    if (!group) {
      group = { id: scenario.group, title: scenario.groupTitle, modes: [], scenario: scenario.id };
      groups.push(group);
    }
    if (scenario.mode) group.modes.push({ id: scenario.mode, scenario: scenario.id });
  }
  return groups;
};

export const compareScenarios = (compare) =>
  compare.scenarios.map(({ id, title, description, unit }) => ({ id, title, description, unit }));

const PER_WHAT = { 'ops/s': 'per call', 'schemas/s': 'per schema' };

export const compareModel = (compare, scenarioId, scale = 'log') => {
  const scenario =
    compare.scenarios.find((candidate) => candidate.id === scenarioId) ?? compare.scenarios[0];
  const rows = compare.libraries
    .filter((library) => scenario.results[library.id])
    .map((library) => {
      const result = scenario.results[library.id];
      return libraryRow(library, result.median, {
        details: [
          `${grouped(result.median)} ${scenario.unit}`,
          `${perCall(result.median)} ${PER_WHAT[scenario.unit] ?? 'per call'}`,
          `samples ${compact(result.min)} – ${compact(result.max)}`,
          versionNote(library),
        ],
      });
    })
    .sort(byValueDesc);
  const missing = compare.libraries.filter((library) => !scenario.results[library.id]);
  const note = missing.length
    ? ` Not shown, the mode cannot be expressed: ${missing.map((library) => library.name).join(', ')}.`
    : '';
  const axis = scale === 'log' ? 'log scale' : 'linear scale';
  return {
    id: `compare-${scenario.id}`,
    title: scenario.title,
    subtitle: `${scenario.description} ${scenario.unit}, ${axis}, higher is better.${note}`,
    unit: scenario.unit,
    scale,
    groups: [{ id: 'all', label: null, rows }],
  };
};

export const coldStartModel = (compare) => {
  const rows = compare.libraries
    .filter((library) => compare.coldStart[library.id])
    .map((library) => {
      const phases = compare.coldStart[library.id];
      const ms = (value) => `${value.toFixed(1)} ms`;
      return libraryRow(library, phases.total, {
        details: [
          `${ms(phases.total)} in total`,
          `load ${ms(phases.load)} · build ${ms(phases.build)} · first check ${ms(phases.firstCheck)}`,
          versionNote(library),
        ],
      });
    })
    .sort(byValueAsc);
  return {
    id: 'coldstart',
    title: 'Cold start',
    subtitle:
      'Load the library, build the strict nested schema, check one value: a fresh process, ' +
      `median of ${compare.method.coldStartRuns} runs. Lower is better.`,
    unit: 'ms',
    scale: 'linear',
    groups: [{ id: 'all', label: null, rows }],
  };
};

export const sizeModel = (size) => {
  const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
  const rows = size.libraries
    .map((library) =>
      libraryRow(library, library.gzip / 1024, {
        details: [
          `${kb(library.gzip)} min+gzip`,
          `${kb(library.min)} minified`,
          `${library.package}@${library.version}`,
          ...(library.note ? [library.note] : []),
        ],
      }),
    )
    .sort(byValueAsc);
  return {
    id: 'size',
    title: 'Bundle size',
    subtitle:
      'A browser bundle that builds the strict nested schema and checks a value (esbuild, ' +
      'minified, tree-shaken), min+gzip. Lower is better.',
    unit: 'KB',
    scale: 'linear',
    groups: [{ id: 'all', label: null, rows }],
  };
};

// ─── Release over release ───────────────────────────────────────────────────

const versionKey = (entry) => {
  const parts = entry.version.split('.').map(Number);
  const own = entry.name === 'Metarhia metaschema' ? 0 : 1;
  return own * 1e6 + parts[0] * 1e4 + parts[1] * 1e2 + parts[2];
};

/** Releases oldest first, the closures before the JIT of the same release. */
export const releaseList = (releases) =>
  [...releases.releases].sort((a, b) => versionKey(a) - versionKey(b));

const releaseLabel = (entry) =>
  entry.name === 'Metarhia metaschema' ? `Metarhia ${entry.version}` : entry.version;

export const releaseScenarios = (releases) => releases.scenarios;

export const releaseModel = (releases, scenarioId) => {
  const scenario =
    releases.scenarios.find((candidate) => candidate.id === scenarioId) ?? releases.scenarios[0];
  const all = releaseList(releases).filter((entry) => entry.results[scenario.id]);
  const first = all[0];
  const base = first.results[scenario.id].median;
  const row = (entry) => {
    const result = entry.results[scenario.id];
    const speed = result.median / base;
    return {
      id: entry.id,
      label: releaseLabel(entry),
      sublabel:
        entry === first
          ? entry.name
          : `×${speed < 10 ? speed.toFixed(1) : Math.round(speed)} vs ${releaseLabel(first)}`,
      value: result.median,
      tone: entry.current ? (entry.backend === 'jit' ? 'primary' : 'secondary') : undefined,
      details: [
        `${grouped(result.median)} ${scenario.unit}`,
        `${perCall(result.median)} ${PER_WHAT[scenario.unit] ?? 'per call'}`,
        `samples ${compact(result.min)} – ${compact(result.max)}`,
      ],
    };
  };
  const closures = all.filter((entry) => entry.backend === 'closures').map(row);
  const jit = all.filter((entry) => entry.backend === 'jit').map(row);
  const groups = [{ id: 'closures', label: 'Closures, every schema', rows: closures }];
  if (jit.length) groups.push({ id: 'jit', label: 'JIT, after compile()', rows: jit });
  return {
    id: `releases-${scenario.id}`,
    title: `${scenario.title}, release over release`,
    subtitle: `${scenario.unit}, linear scale, higher is better. The same harness and machine for every release.`,
    unit: scenario.unit,
    scale: 'linear',
    groups,
  };
};

/** The current tree against Metarhia's 2.2.2, scenario by scenario, on both backends. */
export const speedupModel = (releases) => {
  const list = releaseList(releases);
  const base = list.find((entry) => entry.name === 'Metarhia metaschema');
  const current = list.filter((entry) => entry.current);
  const groups = [];
  for (const entry of current) {
    const rows = [];
    for (const scenario of releases.scenarios) {
      const now = entry.results[scenario.id];
      const before = base?.results[scenario.id];
      if (!now || !before) continue;
      const speed = now.median / before.median;
      rows.push({
        id: `${entry.id}-${scenario.id}`,
        label: scenario.title,
        sublabel: `${compact(before.median)} → ${compact(now.median)} ${scenario.unit}`,
        value: speed,
        tone: entry.backend === 'jit' ? 'primary' : 'secondary',
        details: [
          `×${speed.toFixed(1)} the speed of Metarhia ${base.version}`,
          `${grouped(before.median)} → ${grouped(now.median)} ${scenario.unit}`,
        ],
      });
    }
    const label = entry.backend === 'jit' ? 'JIT, after compile()' : 'Closures, every schema';
    if (rows.length) groups.push({ id: entry.backend, label, rows });
  }
  const version = current[0]?.version ?? '';
  return {
    id: 'speedup',
    title: `metaschema ${version} against Metarhia's metaschema ${base?.version ?? ''}`,
    subtitle: 'How many times faster, scenario by scenario (1 = as fast). Higher is better.',
    unit: '×',
    scale: 'linear',
    reference: 1,
    groups,
  };
};

// ─── metaschema's own hot paths ─────────────────────────────────────────────

// The scenarios of `pnpm bench` the chart pairs up; the table on the
// performance page has the rest (the moltar modes are the comparison's, and
// the validators that wait for the event loop measure the wait).
const ENGINE = [
  'check — flat struct, valid',
  'check — flat struct, invalid',
  'check — nested struct, valid',
  'check — nested struct, invalid',
  'check — sparse struct, two optional fields absent',
  'parse — flat struct, valid',
  'parse — flat struct, defaults and a decoder',
  'parse — flat struct with an alias, the alias in the input',
  'parse — nested struct, strip (extra keys at every level)',
  'parse — array of 100 records, strip',
  'check — 4 sync validators',
  'checkAsync — 4 async validators, resolved promises',
  'check — 1 000 flat records in a loop',
  'checkEach — 1 000 flat records',
];

const BACKENDS = [
  { tone: 'secondary', label: 'closures' },
  { tone: 'primary', label: 'JIT' },
];

/** `pnpm bench` (bench/baseline.json) on both backends: a row per scenario, a bar per backend. */
export const engineModel = (baseline) => {
  const byName = new Map(baseline.results.map((row) => [row.name, row.opsPerSec]));
  const rows = [];
  for (const name of ENGINE) {
    const [api, ...rest] = name.split(' — ');
    const closures = byName.get(name);
    const jit = byName.get(`${api} (jit) — ${rest.join(' — ')}`);
    if (closures === undefined || jit === undefined) continue;
    rows.push({
      id: name,
      label: api,
      sublabel: rest.join(' — '),
      value: jit,
      bars: [
        { value: closures, tone: 'secondary' },
        { value: jit, tone: 'primary' },
      ],
      details: [
        `closures ${grouped(closures)} ops/s · ${perCall(closures)} per call`,
        `JIT ${grouped(jit)} ops/s · ${perCall(jit)} per call`,
        `×${(jit / closures).toFixed(1)} on the JIT`,
      ],
    });
  }
  return {
    id: 'engine',
    title: 'metaschema on its two backends',
    subtitle: 'pnpm bench: ops/s, log scale, higher is better.',
    unit: 'ops/s',
    scale: 'log',
    legend: BACKENDS,
    groups: [{ id: 'all', label: null, rows }],
  };
};

/** The bars of a row: one, unless the row compares several. */
export const barsOf = (row) => row.bars ?? [{ value: row.value, tone: row.tone }];

export const allValues = (model) =>
  model.groups.flatMap((group) => group.rows.flatMap((row) => barsOf(row).map((bar) => bar.value)));

export const allRows = (model) => model.groups.flatMap((group) => group.rows);
