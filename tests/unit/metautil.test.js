const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const metautil = require('../../src/metautil.js');

describe('metautil', () => {
  it('should tell with inRange whether a value is within the bounds, inclusive', () => {
    assert.equal(metautil.inRange(5, 1, 10), true);
    assert.equal(metautil.inRange(1, 1, 10), true);
    assert.equal(metautil.inRange(10, 1, 10), true);
    assert.equal(metautil.inRange(11, 1, 10), false);
    assert.equal(metautil.inRange('B', 'A', 'Z'), true);
  });

  it('should tell the first character with isFirstUpper, isFirstLower, isFirstLetter', () => {
    assert.equal(metautil.isFirstUpper('Account'), true);
    assert.equal(metautil.isFirstUpper('account'), false);
    assert.equal(metautil.isFirstUpper(''), false);
    assert.equal(metautil.isFirstLower('account'), true);
    assert.equal(metautil.isFirstLower('Account'), false);
    assert.equal(metautil.isFirstLower(''), false);
    assert.equal(metautil.isFirstLetter('Account'), true);
    assert.equal(metautil.isFirstLetter('account'), true);
    assert.equal(metautil.isFirstLetter('_id'), false);
    assert.equal(metautil.isFirstLetter('1st'), false);
  });

  it('should lower the first letter with toLowerCamel', () => {
    assert.equal(metautil.toLowerCamel('Account'), 'account');
    assert.equal(metautil.toLowerCamel('PersonName'), 'personName');
    assert.equal(metautil.toLowerCamel(''), '');
  });

  it('should find with firstKey the first key that starts with a letter', () => {
    assert.equal(metautil.firstKey({ _hidden: 1, Registry: {}, name: 'string' }), 'Registry');
    assert.equal(metautil.firstKey({ name: 'string' }), 'name');
    assert.equal(metautil.firstKey({ $id: 1 }), undefined);
  });
});
