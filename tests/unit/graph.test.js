// The module graph of src/ has no cycles: a module that requires, through
// the requires of what it requires, a module still being loaded would get a
// partial module object. CLAUDE.md "Architecture" draws the graph by hand
// and says nothing checks it; this does. Only relative requires are edges:
// the one Node builtin lives in runtime/node.js (platform.test.js).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '../../src');
const REQUIRE = /require\('(\.{1,2}\/[^']+)'\)/g;

const modulesOf = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) modulesOf(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
};

const edgesOf = (file) => {
  const source = fs.readFileSync(file, 'utf8');
  const targets = [];
  for (const match of source.matchAll(REQUIRE)) {
    targets.push(path.resolve(path.dirname(file), match[1]));
  }
  return targets;
};

// POSIX separators on every platform, so the names compare the same on
// Windows, where path.relative joins with a backslash.
const relative = (file) => path.relative(SRC, file).split(path.sep).join('/');

// The graph as `{ cycles, leaves }`: every cycle as the path that closes
// it, and the modules that require nothing of src/.
const inspect = (graph) => {
  const VISITING = 1;
  const DONE = 2;
  const state = new Map();
  const stack = [];
  const cycles = [];
  const visit = (file) => {
    const seen = state.get(file);
    if (seen === DONE) return;
    if (seen === VISITING) {
      cycles.push([...stack.slice(stack.indexOf(file)), file].map(relative).join(' -> '));
      return;
    }
    state.set(file, VISITING);
    stack.push(file);
    for (const target of graph.get(file)) {
      assert.ok(graph.has(target), `${relative(file)} requires ${target}, not a module of src/`);
      visit(target);
    }
    stack.pop();
    state.set(file, DONE);
  };
  for (const file of graph.keys()) visit(file);
  const leaves = [];
  for (const [file, edges] of graph) if (edges.length === 0) leaves.push(relative(file));
  return { cycles, leaves: leaves.sort() };
};

test('Graph: the modules of src/ require each other without a cycle', () => {
  const graph = new Map();
  for (const file of modulesOf(SRC)) graph.set(file, edgesOf(file));
  assert.ok(graph.size > 30);
  const { cycles, leaves } = inspect(graph);
  assert.deepStrictEqual(cycles, []);
  assert.deepStrictEqual(leaves, [
    'errors.js',
    'metautil.js',
    'prototypes/json.js',
    'runtime/browser.js',
    'runtime/node.js',
    'util.js',
  ]);
  // The check sees a cycle when there is one.
  const a = path.join(SRC, 'a.js');
  const b = path.join(SRC, 'b.js');
  const looped = new Map([
    [a, [b]],
    [b, [a]],
  ]);
  assert.deepStrictEqual(inspect(looped).cycles, ['a.js -> b.js -> a.js']);
});

// The directories of the subpaths: nothing in the core requires them, and a
// subpath requires another only along the edges below (CLAUDE.md
// "Architecture"), so a program that imports one subpath carries no other.
const SUBPATHS = [
  'generators',
  'compile',
  'model',
  'stream',
  'formats',
  'derive',
  'coerce',
  'mongodb',
  'definition',
];
const SUBPATH_EDGES = ['derive/index.js -> model/data.js', 'mongodb/bson.js -> coerce/index.js'];

const subpathOf = (name) => {
  const top = name.split('/')[0];
  return SUBPATHS.includes(top) ? top : null;
};

test('Graph: the core requires no subpath, a subpath another only where allowed', () => {
  const crossings = [];
  for (const file of modulesOf(SRC)) {
    const from = relative(file);
    for (const target of edgesOf(file)) {
      const to = relative(target);
      const source = subpathOf(from);
      const destination = subpathOf(to);
      if (destination !== null && destination !== source) crossings.push(`${from} -> ${to}`);
    }
  }
  assert.deepStrictEqual(crossings.sort(), [...SUBPATH_EDGES].sort());
});

// The modules a file reaches through its requires, itself included.
const closureOf = (file, graph = new Map(), seen = new Set()) => {
  if (seen.has(file)) return seen;
  seen.add(file);
  for (const target of edgesOf(file)) closureOf(target, graph, seen);
  return seen;
};

// What validates: the half of the core `validation.js` installs. The
// definition half (what `./definition` loads, and what builds a schema)
// reaches none of it, so that a bundle of the definition alone has none.
const VALIDATION = [
  'validation.js',
  'checks.js',
  'codec.js',
  'context.js',
  'issues.js',
  'result.js',
  'lint.js',
  'locales/en.js',
];

test('Graph: the definition half reaches no module of the validation half', () => {
  for (const entry of ['definition/index.js', 'schema.js', 'model.js', 'types.js']) {
    const reached = [...closureOf(path.join(SRC, entry))].map(relative);
    const validating = reached.filter((name) => VALIDATION.includes(name));
    assert.deepStrictEqual(validating, [], `${entry} reaches the validation half`);
  }
  // The core entry carries both halves.
  const core = [...closureOf(path.join(SRC, 'index.js'))].map(relative);
  for (const name of VALIDATION) assert.ok(core.includes(name), name);
  assert.deepStrictEqual(
    [...closureOf(path.join(SRC, 'definition/index.js'))].map(relative).sort(),
    [
      'definition/index.js',
      'errors.js',
      'kinds.js',
      'metadata.js',
      'metautil.js',
      'model.js',
      'preprocessor.js',
      'prototypes/abstract.js',
      'prototypes/collections.js',
      'prototypes/flags.js',
      'prototypes/json.js',
      'prototypes/reference.js',
      'prototypes/scalars.js',
      'prototypes/schema.js',
      'prototypes/tuple.js',
      'prototypes/union.js',
      'rules.js',
      'schema.js',
      'snapshot.js',
      'struct.js',
      'types.js',
      'util.js',
    ],
  );
});
