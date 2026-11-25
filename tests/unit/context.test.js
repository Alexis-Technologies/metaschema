const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { Schema, Model } = require('../../index.js');
const { createContext, UNLIMITED } = require('../../src/context.js');
const util = require('../../src/util.js');

describe('Context', () => {
  it('should run a check in a context of its own, not in module globals', () => {
    assert.equal(util.ancestors, undefined);
    assert.equal(util.limits, undefined);
    const context = createContext({ maxErrors: 3 }, 'User');
    assert.deepEqual(Object.keys(context), [
      'issues',
      'count',
      'limit',
      'depth',
      'maxDepth',
      'path',
      'seen',
      'source',
      'unknown',
      'references',
      'root',
      'messages',
      'async',
      'scratch',
      'renamed',
    ]);
    assert.equal(context.limit, 3);
    assert.equal(context.root, 'User');
    assert.equal(context.seen, null);
    assert.equal(context.async, null);
    assert.equal(createContext().limit, UNLIMITED);
    assert.equal(UNLIMITED, 2 ** 30 - 1);
    assert.equal(createContext({ maxErrors: Infinity }).limit, UNLIMITED);
    for (const maxErrors of [0, -1, '3', NaN, null]) {
      assert.throws(() => createContext({ maxErrors }), {
        name: 'TypeError',
        message: `maxErrors must be an integer of at least 1, got ${JSON.stringify(maxErrors) ?? maxErrors}`,
      });
    }
  });

  it('should keep a check started by a validator from affecting the outer one', () => {
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
    assert.deepEqual(seen, [1]);
    assert.deepEqual(result.errors, [
      'Field "x" is required',
      'Field "y" is required',
      'Field "z" rejected',
    ]);
  });

  it('should track the objects on the path per check', () => {
    const model = new Model({}, [['Node', { Struct: {}, name: 'string', next: '?Node' }]]);
    const node = model.entities.get('Node');
    const shared = { name: 'leaf' };
    const first = { name: 'a', next: shared };
    const second = { name: 'b', next: shared };
    // The same object checked twice, each time inside a different value, is not
    // a cycle: the set of objects on the path belongs to the check.
    assert.equal(node.check(first).valid, true);
    assert.equal(node.check(second).valid, true);
    const loop = { name: 'root' };
    loop.next = loop;
    assert.deepEqual(node.check(loop).errors, ['Field "Node.next" is a circular reference']);
    assert.equal(node.check(first).valid, true);
  });

  it('should require maxErrors to be a whole number and name a bigint option as one', () => {
    assert.throws(() => createContext({ maxErrors: 1.5 }), {
      message: 'maxErrors must be an integer of at least 1, got 1.5',
    });
    assert.throws(() => createContext({ maxErrors: 10n }), {
      message: 'maxErrors must be an integer of at least 1, got 10n',
    });
    assert.equal(createContext({ maxErrors: 2 }).limit, 2);
    const schema = Schema.from({ a: 'string', b: 'string' });
    assert.equal(schema.check({}, { maxErrors: 1 }).issues.length, 1);
  });
});
