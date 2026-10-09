const { test } = require('node:test');
const assert = require('node:assert');

const { Schema, Model } = require('../../index.js');
const { createContext, UNLIMITED } = require('../../src/context.js');
const util = require('../../src/util.js');

test('Context: a check runs in a context of its own, not in module globals', () => {
  assert.strictEqual(util.ancestors, undefined);
  assert.strictEqual(util.limits, undefined);
  const context = createContext({ maxErrors: 3 }, 'User');
  assert.deepStrictEqual(Object.keys(context), [
    'issues',
    'count',
    'limit',
    'path',
    'seen',
    'unknown',
    'root',
    'messages',
  ]);
  assert.strictEqual(context.limit, 3);
  assert.strictEqual(context.root, 'User');
  assert.strictEqual(context.seen, null);
  assert.strictEqual(createContext().limit, UNLIMITED);
  assert.strictEqual(UNLIMITED, 2 ** 30 - 1);
  assert.strictEqual(createContext({ maxErrors: Infinity }).limit, UNLIMITED);
  for (const maxErrors of [0, -1, '3', NaN, null]) {
    assert.throws(() => createContext({ maxErrors }), {
      name: 'TypeError',
      message: `maxErrors must be a number of at least 1, got ${JSON.stringify(maxErrors) ?? maxErrors}`,
    });
  }
});

test('Context: a check started by a validator does not affect the outer one', () => {
  const inner = Schema.from({ a: 'string', b: 'string', c: 'string' });
  const seen = [];
  const outer = Schema.from({
    x: 'string',
    y: 'string',
    z: {
      type: 'string',
      validate: () => {
        seen.push(inner.check({}, { maxErrors: 1 }).errors.length);
        return 'rejected';
      },
    },
  });
  const result = outer.check({ z: 'v' });
  assert.deepStrictEqual(seen, [1]);
  assert.deepStrictEqual(result.errors, [
    'Field "x" is required',
    'Field "y" is required',
    'Field "z" rejected',
  ]);
});

test('Context: the objects on the path are tracked per check', () => {
  const model = new Model({}, [['Node', { Entity: {}, name: 'string', next: '?Node' }]]);
  const node = model.entities.get('Node');
  const shared = { name: 'leaf' };
  const first = { name: 'a', next: shared };
  const second = { name: 'b', next: shared };
  // The same object checked twice, each time inside a different value, is not
  // a cycle: the set of objects on the path belongs to the check.
  assert.strictEqual(node.check(first).valid, true);
  assert.strictEqual(node.check(second).valid, true);
  const loop = { name: 'root' };
  loop.next = loop;
  assert.deepStrictEqual(node.check(loop).errors, ['Field "Node.next" is a circular reference']);
  assert.strictEqual(node.check(first).valid, true);
});
