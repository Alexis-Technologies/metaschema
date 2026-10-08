const { test } = require('node:test');
const assert = require('node:assert');

const metautil = require('../../src/metautil.js');

test('metautil: inRange', () => {
  assert.strictEqual(metautil.inRange(5, 1, 10), true);
  assert.strictEqual(metautil.inRange(1, 1, 10), true);
  assert.strictEqual(metautil.inRange(10, 1, 10), true);
  assert.strictEqual(metautil.inRange(11, 1, 10), false);
  assert.strictEqual(metautil.inRange('B', 'A', 'Z'), true);
});

test('metautil: isFirstUpper, isFirstLower, isFirstLetter', () => {
  assert.strictEqual(metautil.isFirstUpper('Account'), true);
  assert.strictEqual(metautil.isFirstUpper('account'), false);
  assert.strictEqual(metautil.isFirstUpper(''), false);
  assert.strictEqual(metautil.isFirstLower('account'), true);
  assert.strictEqual(metautil.isFirstLower('Account'), false);
  assert.strictEqual(metautil.isFirstLower(''), false);
  assert.strictEqual(metautil.isFirstLetter('Account'), true);
  assert.strictEqual(metautil.isFirstLetter('account'), true);
  assert.strictEqual(metautil.isFirstLetter('_id'), false);
  assert.strictEqual(metautil.isFirstLetter('1st'), false);
});

test('metautil: toLowerCamel', () => {
  assert.strictEqual(metautil.toLowerCamel('Account'), 'account');
  assert.strictEqual(metautil.toLowerCamel('PersonName'), 'personName');
  assert.strictEqual(metautil.toLowerCamel(''), '');
});

test('metautil: firstKey', () => {
  assert.strictEqual(metautil.firstKey({ _hidden: 1, Registry: {}, name: 'string' }), 'Registry');
  assert.strictEqual(metautil.firstKey({ name: 'string' }), 'name');
  assert.strictEqual(metautil.firstKey({ $id: 1 }), undefined);
});

test('metautil: isInstanceOf', () => {
  class Schema {}
  assert.strictEqual(metautil.isInstanceOf(new Schema(), 'Schema'), true);
  assert.strictEqual(metautil.isInstanceOf({}, 'Schema'), false);
  assert.strictEqual(metautil.isInstanceOf(null, 'Schema'), false);
  assert.strictEqual(metautil.isInstanceOf(undefined, 'Object'), false);
});
