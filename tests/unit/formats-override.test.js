// A format of the program under the name of a built-in one. The table is
// process-wide, and node:test runs a file in a process of its own, so this
// file is where a built-in is replaced.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { Schema } = require('../../index.js');
const { FORMATS, register } = require('../../src/formats/index.js');
const { infer } = require('../../src/model/index.js');

describe('Formats', () => {
  it('should put a format of the program in the place of a built-in of its name', () => {
    // A format registered before its name was built in (3.2 had no ulid)
    // keeps working, in the place of the built-in.
    const ulid = { test: (value) => /^[0-9A-Z]{26}$/.test(value), examples: ['0'.repeat(26)] };
    // The call says which built-in it replaced, so that a program can log it:
    // none here, since nothing was in the table before this first call.
    assert.deepEqual(register({ ulid }), []);
    assert.deepEqual(register({ ulid }), []);
    assert.equal(FORMATS.ulid.test, ulid.test);
    const names = Object.keys(FORMATS);
    assert.equal(names.indexOf('ulid'), 1);
    assert.equal(
      Schema.from({ s: { type: 'string', format: 'ulid' } }).check({ s: '9'.repeat(26) }).valid,
      true,
    );
    // A later register() keeps it: a built-in displaces nothing.
    register();
    assert.equal(FORMATS.ulid.test, ulid.test);
    assert.deepEqual(Object.keys(FORMATS), names);
    // An override after the schemas were built: they keep the built-in test.
    const before = Schema.from({ s: { type: 'string', format: 'email' } });
    const email = { test: (value) => value.endsWith('@example.com'), examples: ['a@example.com'] };
    assert.deepEqual(register({ email, phone: { test: () => true, examples: ['1'] } }), ['email']);
    assert.equal(FORMATS.email.test, email.test);
    assert.equal(before.check({ s: 'ann@mail.org' }).valid, true);
    const after = Schema.from({ s: { type: 'string', format: 'email' } });
    assert.equal(after.check({ s: 'ann@mail.org' }).valid, false);
    // Its own infer flag is the one that counts.
    register({ uuid: { test: FORMATS.uuid.test, examples: FORMATS.uuid.examples.slice() } });
    const slug = { test: (value) => /^[a-z]+$/.test(value), examples: ['abc'], infer: true };
    register({ slug });
    assert.deepEqual(infer([{ s: 'abc' }, { s: 'def' }]), {
      Struct: {},
      s: { type: 'string', format: 'slug' },
    });
    // Over the program's own, another test is still an error.
    assert.throws(() => register({ email: { test: () => true, examples: ['x'] } }), {
      code: 'ERR_FORMAT_REGISTERED',
      message: 'Format "email" is already registered with another test',
    });
    assert.throws(() => register({ slug: { test: () => true, examples: ['x'], pattern: '(' } }), {
      code: 'ERR_FORMAT_REGISTERED',
    });
  });

  it('should require the pattern of an entry to be a string that compiles in unicode mode', () => {
    for (const pattern of [/x/, '(', '\\a']) {
      assert.throws(() => register({ code: { test: () => true, examples: ['x'], pattern } }), {
        code: 'ERR_INVALID_FORMAT',
        message: 'Format "code" needs a pattern string that compiles under the u flag',
      });
    }
    register({
      code: { test: (value) => /^[A-Z]{3}$/.test(value), examples: ['ABC'], pattern: '^[A-Z]{3}$' },
    });
    assert.equal(FORMATS.code.pattern, '^[A-Z]{3}$');
    assert.equal(Object.isFrozen(FORMATS.code), true);
  });
});
