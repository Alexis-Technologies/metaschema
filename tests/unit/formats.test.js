const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { Schema, Model } = require('../../index.js');
const { FORMATS, register } = require('../../src/formats/index.js');
const { compile, canEval } = require('../../src/compile/index.js');
const { fromJSON, sample, infer, merge, diff, compatibility } = require('../../src/model/index.js');
const { toJSONSchema, fromJSONSchema } = require('../../src/generators/index.js');
const { fullFormats } = require('ajv-formats/dist/formats.js');
const z = require('zod');
const v = require('valibot');
const uk = require('../../src/locales/uk.js');

// A schema of one formatted field, and a copy on the other backend.
const pair = (format, extra = {}) => {
  const definition = { s: { type: 'string', format, ...extra } };
  const a = new Schema('S', definition);
  const b = new Schema('S', definition);
  assert.equal(compile(b, { jit: canEval() ? true : 'auto' }).accelerated, canEval());
  return [a, b];
};

// The verdict of ajv-formats' full mode on a string, for the cross-check.
const ajvOf = (name) => {
  const given = fullFormats[name];
  const check = typeof given === 'function' || given instanceof RegExp ? given : given.validate;
  return check instanceof RegExp ? (text) => check.test(text) : check;
};

// The table of values: what every built-in format accepts and rejects.
const TABLE = {
  uuid: {
    valid: [
      '550e8400-e29b-41d4-a716-446655440000',
      'URN:UUID:123E4567-E89B-12D3-A456-426614174000',
    ],
    invalid: ['550e8400-e29b-41d4-a716', '550e8400e29b41d4a716446655440000', 'xyz', ''],
  },
  email: {
    valid: ['ann@example.com', 'a.b+c_d@sub.example.org', "o'neil@example.co.uk"],
    invalid: [
      'ann@',
      '@example.com',
      'ann@@example.com',
      'ann example@x.com',
      'ann@-x.com',
      'nope',
    ],
  },
  'date-time': {
    valid: [
      '2026-10-11T12:00:00Z',
      '2026-10-11t12:00:00.123+02:00',
      '2024-02-29T18:59:60-05:00',
      '2026-10-11 12:00:00Z',
    ],
    invalid: [
      '2026-10-11',
      '2026-02-29T12:00:00Z',
      '2026-10-11T25:00:00Z',
      '2026-10-11T12:00:00',
      '2026-10-11T12:00Z',
      'today',
    ],
  },
  date: {
    valid: ['2026-10-11', '2000-02-29', '1999-12-31'],
    invalid: ['2026-02-29', '1900-02-29', '2026-13-01', '2026-10-32', '26-10-11', '2026-1-1', ''],
  },
  time: {
    valid: [
      '12:00:00Z',
      '23:59:60Z',
      '18:59:60-05:00',
      '00:00:00.5+00:00',
      '12:00:00-0530',
      '07:30:15+14:00',
    ],
    invalid: [
      '24:00:00Z',
      '12:60:00Z',
      '12:00:61Z',
      '12:00:60Z',
      '23:59:60-05:00',
      '12:00:00',
      '12:00Z',
      'noon',
    ],
  },
  ipv4: {
    valid: ['0.0.0.0', '192.168.0.1', '255.255.255.255', '10.0.0.255'],
    invalid: ['256.0.0.1', '1.2.3', '01.2.3.4', '1.2.3.4.5', '1.2.3.-4', 'localhost'],
  },
  ipv6: {
    valid: ['::1', '2001:db8::ff00:42:8329', 'fe80::1ff:fe23:4567:890a', '::ffff:192.168.0.1'],
    invalid: ['2001:db8::ff00::8329', 'g::1', '1.2.3.4', '12345::', ':::', ''],
  },
  uri: {
    valid: ['https://example.com/path?q=1#x', 'mailto:ann@example.com', 'urn:isbn:0451450523'],
    invalid: ['example.com', '/relative/path', 'ht tp://x', '', '://x'],
  },
  hostname: {
    valid: ['example.com', 'api.example.org', 'localhost', 'xn--80ak6aa92e.com', 'a-b.c'],
    invalid: ['-example.com', 'exa mple.com', 'example..com', `${'a'.repeat(64)}.com`, ''],
  },
};

// The formats of 3.3, each with the verdict of another library on a string
// (ajv-formats' full mode for the names of JSON Schema, zod or valibot for
// the others, a browser's URL for `url`): what both accept, what both
// reject, and where they differ on purpose (`pinned`, our verdict the
// opposite of the other's).
const zodOf = (schema) => (text) => schema.safeParse(text).success;
const valibotOf = (action) => (text) => v.safeParse(v.pipe(v.string(), action), text).success;
const header = (object) => Buffer.from(JSON.stringify(object)).toString('base64url');
const whatwg = (text) => {
  if (!/^https?:\/\//i.test(text)) return false;
  try {
    return new URL(text).protocol.startsWith('http');
  } catch {
    return false;
  }
};

const MORE = {
  ulid: {
    oracle: zodOf(z.ulid()),
    valid: [
      '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      '01hzx8q4n0j5w6y2t9k3m7p1rb',
      '7ZZZZZZZZZZZZZZZZZZZZZZZZZ',
    ],
    invalid: [
      '81ARZ3NDEKTSV4RRFFQ69G5FAV',
      '01ARZ3NDEKTSV4RRFFQ69G5FA',
      '01ARZ3NDEKTSV4RRFFQ69G5FAVX',
      '01ARZ3NDEKTSV4RRFFQ69G5FAI',
      '',
    ],
  },
  jwt: {
    oracle: zodOf(z.jwt()),
    valid: [
      'eyJhbGciOiJub25lIn0.e30.',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl',
      `${header({ alg: 'RS256' })}.e30.sig`,
    ],
    invalid: [
      'abc',
      'a.b',
      `${header({ typ: 'JWT' })}.e30.`,
      'bm90IGpzb24.e30.',
      `${header({ alg: 'HS256' })}.e30`,
      '',
    ],
    // A `typ` of its own is allowed (RFC 7519), an `alg` must be a string.
    pinned: [`${header({ alg: 'RS256', typ: 'at+jwt' })}.e30.`, `${header({ alg: 1 })}.e30.`],
  },
  'iso-date-time': {
    oracle: ajvOf('iso-date-time'),
    valid: [
      '2026-10-11T12:00:00',
      '2026-10-11 12:00:00.5',
      '2026-10-11T12:00:00Z',
      '2026-10-11t12:00:00+02:00',
    ],
    invalid: [
      '2026-10-11',
      '2026-02-30T12:00:00',
      '2026-10-11T25:00:00',
      '2026-10-11X12:00:00',
      '',
    ],
    // T, t or a space, as RFC 3339 says; not any white space.
    pinned: ['2026-10-11\t12:00:00'],
  },
  'iso-time': {
    oracle: ajvOf('iso-time'),
    valid: ['12:00:00', '23:59:59.999+02:00', '23:59:60', '12:00:00z'],
    invalid: ['24:00:00', '12:60:00', '12:00', '12:00:00+25:00', ''],
  },
  duration: {
    oracle: ajvOf('duration'),
    valid: ['P1Y2M3DT4H5M6S', 'PT15M', 'P1W', 'P1D', 'PT0S'],
    invalid: ['P', 'PT', '1D', 'P1H', 'P1DT', 'P1W2D', 'PT0.5S', ''],
  },
  'uri-reference': {
    oracle: ajvOf('uri-reference'),
    valid: ['/users/42?tab=info', '../up#top', 'https://example.com/a', '#frag', ''],
    invalid: ['\\\\host', 'a b', '#a b'],
  },
  'uri-template': {
    oracle: ajvOf('uri-template'),
    valid: ['https://example.com/users/{id}', '/search{?q,page}', 'plain', '{+path}/x'],
    invalid: ['{', '{a b}', 'a b', '}'],
  },
  'json-pointer': {
    oracle: ajvOf('json-pointer'),
    valid: ['', '/users/0/name', '/a~1b', '/~0', '/'],
    invalid: ['users', '/a~', '/a~2'],
  },
  'relative-json-pointer': {
    oracle: ajvOf('relative-json-pointer'),
    valid: ['0', '1/name', '0#', '10/a~1b'],
    invalid: ['', '01', '/a', '-1', '0##'],
  },
  regex: {
    oracle: ajvOf('regex'),
    valid: ['^[a-z]+$', '\\d{3}-\\d{4}', '(a|b)*', '', `^${'a'.repeat(4000)}$`],
    invalid: ['(', '[', '*a'],
    // A pattern of JSON Schema 2020-12 compiles in unicode mode, where the
    // forms Annex B allows are errors; and a text longer than 4 KB is not a
    // pattern a program wrote (compiling one costs memory in proportion).
    pinned: ['{', '\\a', ']', '\\p{L}'.repeat(2000)],
  },
  cidrv4: {
    oracle: zodOf(z.cidrv4()),
    valid: ['192.168.0.0/24', '10.0.0.0/8', '0.0.0.0/0', '255.255.255.255/32'],
    invalid: ['192.168.0.0', '192.168.0.0/33', '192.168.0.0/', '256.0.0.0/8', '/24', '1.1.1.1/01'],
  },
  cidrv6: {
    oracle: zodOf(z.cidrv6()),
    valid: ['2001:db8::/32', 'fe80::/10', '::/0', '::1/128'],
    invalid: ['2001:db8::', '2001:db8::/129', 'g::/32', '/32', '1.1.1.1/24'],
  },
  mac: {
    oracle: valibotOf(v.mac48()),
    valid: ['00:1a:2b:3c:4d:5e', '00-1A-2B-3C-4D-5E', '001a.2b3c.4d5e'],
    invalid: ['00:1a:2b:3c:4d', '00:1a:2b:3c:4d:5g', '00:1a-2b:3c:4d:5e', '001a2b3c4d5e', ''],
  },
  e164: {
    oracle: zodOf(z.e164()),
    valid: ['+380501234567', '+14155552671', '+1234567'],
    invalid: ['380501234567', '+0123456789', '+12345', '+1234567890123456', '+1 415 555 2671'],
  },
  iban: {
    oracle: zodOf(z.iban()),
    valid: ['DE89370400440532013000', 'GB82WEST12345698765432', 'FR1420041010050500013M02606'],
    invalid: [
      'DE89370400440532013001',
      'de89370400440532013000',
      'DE00370400440532013000',
      'DE8937040044',
      '',
    ],
  },
  'hex-color': {
    oracle: valibotOf(v.hexColor()),
    valid: ['#7c5cff', '#fff', '#FFFA', '#11223344'],
    invalid: ['7c5cff', '#ff', '#fffff', '#ggg', ''],
  },
  url: {
    oracle: whatwg,
    valid: [
      'https://example.com/path?q=1',
      'http://localhost:3000/',
      'https://[::1]:8080/x',
      'http://192.168.0.1',
      'https://a.b.example.org/#x',
    ],
    invalid: [
      'ftp://example.com',
      'example.com',
      'https://',
      'https://exa mple.com',
      'http://example.com:99999',
      'mailto:a@b.c',
    ],
    // Stricter than a browser: a hostname of letters, digits and hyphens, no
    // shorthand IPv4, a port when there is a colon, no backslash, one `@`.
    pinned: [
      'http://a_b.com',
      'http://1.2.3',
      'http://example.com:/',
      'http://ex\\ample.com',
      'http://a@b@c.com',
    ],
  },
  nanoid: {
    oracle: zodOf(z.nanoid()),
    valid: ['V1StGXR8_Z5jdHi6B-myT', 'a3Fk9_LmQz-7xYpR2tWn0'],
    invalid: ['V1StGXR8_Z5jdHi6B-my', 'V1StGXR8_Z5jdHi6B-myT1', 'V1StGXR8 Z5jdHi6B-myT', ''],
  },
  cuid2: {
    oracle: valibotOf(v.cuid2()),
    valid: ['tz4a98xxat96iws9zmbrgj3a', 'ab'],
    invalid: ['Tz4a98xxat96iws9zmbrgj3a', '1z4a98', 'tz4a-98', ''],
    // 2 to 32 characters, the lengths cuid2 makes.
    pinned: ['a', 'a'.repeat(33)],
  },
  base64: {
    oracle: zodOf(z.base64()),
    valid: ['aGVsbG8=', 'TWFu', '', 'AB==', 'AAA='],
    invalid: ['aGVsbG8', 'a===', 'aGVs bG8=', 'aGVs*G8=', '='],
  },
  base64url: {
    oracle: zodOf(z.base64url()),
    valid: ['aGVsbG8', 'PDw_Pz8-', '', 'AB'],
    invalid: ['aGVsbG8=', 'a+b/', 'A', 'AAAAA'],
  },
  hex: {
    oracle: zodOf(z.hex()),
    valid: ['deadbeef', '0A1B2C', '', 'f'],
    invalid: ['0x1f', 'xyz', 'de ad'],
  },
  emoji: {
    oracle: zodOf(z.emoji()),
    valid: ['👍', '🇺🇦', '😀😃', '❤️'],
    invalid: ['a', '1', ':)', '👍a', ''],
  },
  semver: {
    // ArkType's string.semver, loaded where code generation is allowed.
    oracle: null,
    valid: ['1.0.0', '2.1.3-beta.1+build.5', '0.0.0', '1.0.0-alpha'],
    invalid: ['1.0', '01.0.0', '1.0.0-', 'v1.0.0', '1.0.0-01'],
  },
  slug: {
    oracle: valibotOf(v.slug()),
    valid: ['hello-world', 'metaschema-3-3', 'a_b', 'abc'],
    invalid: ['Hello', 'a--b', '-a', 'a-', 'a b', ''],
  },
  'credit-card': {
    oracle: zodOf(z.creditCard()),
    valid: ['4111111111111111', '5555 5555 5555 4444', '4111-1111-1111-1111', '378282246310005'],
    invalid: ['4111111111111112', '1234', '4111 1111 1111 111x', ''],
  },
};

// The order of the table, which is the order infer tries the formats in,
// and the formats infer never reads.
const NAMES = [
  'uuid',
  'ulid',
  'jwt',
  'email',
  'date-time',
  'iso-date-time',
  'date',
  'time',
  'iso-time',
  'duration',
  'ipv4',
  'cidrv4',
  'ipv6',
  'cidrv6',
  'mac',
  'e164',
  'iban',
  'hex-color',
  'url',
  'uri',
  'hostname',
  'uri-reference',
  'uri-template',
  'json-pointer',
  'relative-json-pointer',
  'regex',
  'nanoid',
  'cuid2',
  'base64',
  'base64url',
  'hex',
  'emoji',
  'semver',
  'slug',
  'credit-card',
];
const NOT_INFERRED = NAMES.slice(NAMES.indexOf('hostname'));

describe('Formats', () => {
  it('should require a registered format for the rule, and fill the table once with register()', () => {
    assert.deepEqual(Object.keys(FORMATS), []);
    assert.throws(() => Schema.from({ s: { type: 'string', format: 'email' } }), {
      name: 'SchemaDefinitionError',
      code: 'ALX_ERR_INVALID_RULE',
      message:
        'Rule "format" names a format that is not registered: "email" (register() of @alexify/metaschema/formats) in "s"',
    });
    assert.throws(() => Schema.from({ s: { type: 'string', format: /email/ } }), {
      code: 'ALX_ERR_INVALID_RULE',
      message: 'Rule "format" needs the name of a format in "s"',
    });
    // The call names the built-in formats it replaced: none here.
    assert.deepEqual(register(), []);
    const names = NAMES;
    assert.deepEqual(Object.keys(FORMATS), names);
    for (const name of names) {
      const entry = FORMATS[name];
      assert.equal(Object.isFrozen(entry), true, name);
      assert.equal(typeof entry.test, 'function', name);
      assert.ok(entry.examples.length >= 2, name);
      assert.equal(Object.isFrozen(entry.examples), true, name);
      for (const example of entry.examples) assert.equal(entry.test(example), true, example);
      assert.equal(entry.infer, !NOT_INFERRED.includes(name), name);
      // The pattern of the export is a shape: it never rejects what the test
      // accepts.
      if (entry.pattern !== undefined) {
        const shape = new RegExp(entry.pattern, 'u');
        for (const example of entry.examples) assert.ok(shape.test(example), `${name} ${example}`);
      }
    }
    // Once: the same table, the same entries.
    const before = names.map((name) => FORMATS[name]);
    register();
    assert.deepEqual(Object.keys(FORMATS), names);
    assert.deepEqual(
      names.map((name) => FORMATS[name]),
      before,
    );
    // A format is a rule of strings only, and a known option (no lint warning).
    assert.throws(() => Schema.from({ n: { type: 'number', format: 'email' } }), {
      code: 'ALX_ERR_INVALID_RULE',
      message: 'Rule "format" does not apply to type "number" in "n"',
    });
    assert.throws(() => Schema.from({ s: { type: 'string', format: 'phone' } }), {
      code: 'ALX_ERR_INVALID_RULE',
    });
    assert.deepEqual(Schema.from({ s: { type: 'string', format: 'email' } }).warnings, []);
    assert.equal(Schema.from({ s: { type: 'string', format: 'email' } }).fields.s.format, 'email');
  });

  it('should accept the values of every built-in format and reject the others, on both backends', () => {
    register();
    for (const [name, { valid, invalid }] of Object.entries(TABLE)) {
      const schemas = pair(name);
      const ajv = ajvOf(name);
      for (const value of valid) {
        for (const schema of schemas) {
          assert.equal(schema.check({ s: value }).valid, true, `${name}: ${value}`);
        }
        assert.equal(ajv(value), true, `ajv-formats rejects ${name} ${JSON.stringify(value)}`);
      }
      for (const value of invalid) {
        for (const schema of schemas) {
          assert.deepEqual(
            schema.check({ s: value }).errors,
            [`Field "S.s" is not a valid ${name}`],
            `${name}: ${value}`,
          );
        }
        assert.equal(ajv(value), false, `ajv-formats accepts ${name} ${JSON.stringify(value)}`);
      }
      // A value of another type is a type issue, never a format one.
      for (const schema of schemas) {
        assert.deepEqual(schema.check({ s: 42 }).errors, [
          'Field "S.s" not of expected type: string',
        ]);
      }
    }
  });

  it('should agree with another library on the formats of 3.3, but where they differ on purpose', async () => {
    register();
    // ArkType generates code: its verdicts are read where that is allowed.
    if (canEval()) {
      const { type } = await import('arktype');
      const semver = type('string.semver');
      MORE.semver.oracle = (text) => !(semver(text) instanceof type.errors);
    }
    for (const [name, { oracle, valid, invalid, pinned = [] }] of Object.entries(MORE)) {
      const schemas = pair(name);
      const pattern = FORMATS[name].pattern;
      const shape = pattern === undefined ? null : new RegExp(pattern, 'u');
      for (const value of valid) {
        for (const schema of schemas) {
          assert.equal(schema.check({ s: value }).valid, true, `${name}: ${value}`);
        }
        if (oracle !== null) {
          assert.equal(oracle(value), true, `the oracle of ${name}: ${value}`);
        }
        if (shape !== null) assert.ok(shape.test(value), `the pattern of ${name}: ${value}`);
      }
      for (const value of invalid) {
        for (const schema of schemas) {
          assert.deepEqual(
            schema.check({ s: value }).errors,
            [`Field "S.s" is not a valid ${name}`],
            `${name}: ${value}`,
          );
        }
        if (oracle !== null) {
          assert.equal(oracle(value), false, `the oracle of ${name}: ${value}`);
        }
      }
      for (const value of pinned) {
        const ours = FORMATS[name].test(value);
        assert.notEqual(ours, oracle(value), `${name} agrees on ${JSON.stringify(value)}`);
      }
    }
  });

  it('should report the issue in both locales, in the order of the rules, within the bound of length.max', () => {
    register();
    const [schema] = pair('email', { length: { min: 2, max: 20 }, pattern: /^[a-z@.]+$/ });
    const result = schema.check({ s: 'A@' });
    assert.deepEqual(result.issues, [
      {
        code: 'pattern',
        path: ['s'],
        message: 'does not match the pattern ^[a-z@.]+$',
        params: { pattern: '^[a-z@.]+$' },
      },
      { code: 'format', path: ['s'], message: 'is not a valid email', params: { format: 'email' } },
    ]);
    assert.deepEqual(schema.check({ s: 'A@' }, { messages: uk }).errors, [
      'Поле "S.s" не відповідає шаблону ^[a-z@.]+$',
      'Поле "S.s" не є коректним email',
    ]);
    assert.deepEqual(
      schema.check({ s: 'A@' }, { maxErrors: 1 }).issues.map((issue) => issue.code),
      ['pattern'],
    );
    // Too short: length, then the pattern and the format over a short string.
    assert.deepEqual(
      schema.check({ s: 'A' }).issues.map((issue) => issue.code),
      ['length', 'pattern', 'format'],
    );
    // Past length.max neither the pattern nor the format is run.
    const calls = [];
    register({
      counted: { test: (value) => calls.push(value) > 0, examples: ['x'], infer: false },
    });
    const [bounded] = pair('counted', { length: { max: 4 } });
    assert.deepEqual(
      bounded.check({ s: 'abcde' }).issues.map((issue) => issue.code),
      ['length'],
    );
    assert.deepEqual(calls, []);
    assert.equal(bounded.check({ s: 'abcd' }).valid, true);
    assert.deepEqual(calls, ['abcd']);
    // The validate function runs after the format, on a value that passed it.
    const checked = Schema.from({
      s: {
        type: 'string',
        format: 'email',
        validate: (value) => !value.endsWith('.test') || 'is a test address',
      },
    });
    assert.deepEqual(checked.check({ s: 'ann@example.test' }).errors, [
      'Field "s" is a test address',
    ]);
    assert.deepEqual(checked.check({ s: 'nope' }).errors, ['Field "s" is not a valid email']);
    // An optional or nullable formatted field.
    const optional = Schema.from({
      's?': { type: 'string', format: 'uuid' },
      n: { type: 'string', format: 'uuid', nullable: true },
    });
    assert.equal(optional.check({ n: null }).valid, true);
    assert.equal(optional.check({ s: null, n: null }).valid, true);
    assert.equal(optional.check({ s: 'x', n: null }).valid, false);
  });

  it('should register the own formats of the program, once per name', () => {
    register();
    const phone = { test: (value) => /^\+\d{9,15}$/.test(value), examples: ['+380501234567'] };
    register({ phone });
    const schema = Schema.from({ s: { type: 'string', format: 'phone' } });
    assert.equal(schema.check({ s: '+380501234567' }).valid, true);
    assert.deepEqual(schema.check({ s: '050' }).errors, ['Field "s" is not a valid phone']);
    assert.equal(FORMATS.phone.infer, true);
    // The same test again is nothing; another test under a name the program
    // registered is an error (a built-in name is formats-override.test.js's).
    register({ phone });
    assert.throws(() => register({ phone: { test: () => true, examples: ['x'] } }), {
      code: 'ALX_ERR_FORMAT_REGISTERED',
      message: 'Format "phone" is already registered with another test',
    });
    assert.equal(schema.check({ s: '050' }).valid, false);
    // What is not a format.
    const bad = [
      ['phone2', null, 'Format "phone2" needs { test, examples }'],
      ['phone2', { examples: ['x'] }, 'Format "phone2" needs a test function'],
      ['phone2', { test: () => true }, 'Format "phone2" needs a list of example strings'],
      [
        'phone2',
        { test: () => true, examples: [] },
        'Format "phone2" needs a list of example strings',
      ],
      [
        'phone2',
        { test: () => true, examples: [1] },
        'Format "phone2" needs a list of example strings',
      ],
      [
        'phone2',
        { test: () => true, examples: ['x'], infer: 1 },
        'Format "phone2" needs a boolean infer',
      ],
      ['', { test: () => true, examples: ['x'] }, 'Format "" needs a name'],
    ];
    for (const [name, entry, message] of bad) {
      assert.throws(() => register({ [name]: entry }), {
        name: 'SchemaDefinitionError',
        code: 'ALX_ERR_INVALID_FORMAT',
        message,
      });
      assert.equal(FORMATS.phone2, undefined);
    }
    assert.throws(() => register(null), { code: 'ALX_ERR_INVALID_FORMAT' });
    assert.throws(() => register('phone'), { code: 'ALX_ERR_INVALID_FORMAT' });
    // A name is a key of a table without a prototype.
    const odd = Object.defineProperty({}, '__proto__', {
      value: { test: (value) => value === 'p', examples: ['p'] },
      enumerable: true,
    });
    register(odd);
    assert.equal(Object.hasOwn(FORMATS, '__proto__'), true);
    assert.equal(
      Schema.from({ s: { type: 'string', format: '__proto__' } }).check({ s: 'p' }).valid,
      true,
    );
    register({ constructor: { test: (value) => value === 'c', examples: ['c'] } });
    assert.equal(Object.hasOwn(FORMATS, 'constructor'), true);
    assert.equal(
      Schema.from({ s: { type: 'string', format: 'constructor' } }).check({ s: 'c' }).valid,
      true,
    );
  });

  it('should write the format to JSON Schema and read a registered one back', () => {
    register();
    const schema = Schema.from({
      email: { type: 'string', format: 'email', length: { max: 64 } },
      'site?': { type: 'string', format: 'uri' },
    });
    for (const target of ['draft-2020-12', 'draft-07', 'openapi-3.0']) {
      const json = toJSONSchema(schema, { target });
      assert.deepEqual(
        json.properties.email,
        { type: 'string', maxLength: 64, format: 'email' },
        target,
      );
    }
    assert.deepEqual(toJSONSchema(schema, { target: 'mongodb' }).properties.email, {
      bsonType: 'string',
      maxLength: 64,
    });
    assert.deepEqual(toJSONSchema(schema, { profile: 'strict' }).properties.email, {
      type: 'string',
    });
    // Back: a registered format is the rule, any other the annotation it was.
    const document = toJSONSchema(schema);
    assert.deepEqual(fromJSONSchema(document), {
      Struct: {},
      email: { type: 'string', length: { min: undefined, max: 64 }, format: 'email' },
      site: { type: 'string', format: 'uri', required: false },
    });
    assert.deepEqual(
      fromJSONSchema({
        type: 'object',
        properties: { x: { type: 'string', format: 'int32' } },
        required: ['x'],
        additionalProperties: false,
      }),
      { Struct: {}, x: 'string' },
    );
    assert.deepEqual(
      fromJSONSchema({
        type: 'object',
        properties: { x: { type: 'integer', format: 'int32' } },
        required: ['x'],
        additionalProperties: false,
      }),
      { Struct: {}, x: 'integer' },
    );
    const imported = fromJSONSchema(document, { as: 'schema', name: 'User' });
    assert.deepEqual(imported.check({ email: 'nope' }).errors, [
      'Field "User.email" is not a valid email',
    ]);
  });

  it('should write the shape of a format beside its name in the export and drop it in the import', () => {
    register();
    const schema = Schema.from({
      id: { type: 'string', format: 'ulid' },
      mail: { type: 'string', format: 'email' },
      blob: { type: 'string', format: 'base64' },
      own: { type: 'string', format: 'ulid', pattern: '^0' },
    });
    const json = toJSONSchema(schema);
    assert.deepEqual(json.properties.id, {
      type: 'string',
      pattern: FORMATS.ulid.pattern,
      format: 'ulid',
    });
    // A format of JSON Schema has no shape; a pattern of the field wins.
    assert.deepEqual(json.properties.mail, { type: 'string', format: 'email' });
    assert.deepEqual(json.properties.own, { type: 'string', pattern: '^0', format: 'ulid' });
    // The strict profile drops it with every rule; mongodb keeps it, its only
    // assertion; OpenAPI names base64 `byte`.
    assert.deepEqual(toJSONSchema(schema, { profile: 'strict' }).properties.id, {
      type: 'string',
    });
    assert.deepEqual(toJSONSchema(schema, { target: 'mongodb' }).properties.id, {
      bsonType: 'string',
      pattern: FORMATS.ulid.pattern,
    });
    const openapi = toJSONSchema(schema, { target: 'openapi-3.0' });
    assert.equal(openapi.properties.blob.format, 'byte');
    // The import reads the format back without its shape, `byte` as base64.
    for (const document of [json, openapi]) {
      const definition = fromJSONSchema(document);
      assert.deepEqual(definition.id, { type: 'string', format: 'ulid' });
      assert.deepEqual(definition.blob, { type: 'string', format: 'base64' });
      assert.deepEqual(definition.own, { type: 'string', pattern: '^0', format: 'ulid' });
    }
    // Ajv in strict mode refuses a format it does not know; the table is the
    // one to give it.
    if (!canEval()) return;
    const Ajv = require('ajv/dist/2020');
    const ajv = new Ajv({ strict: true });
    assert.throws(() => ajv.compile(json), /unknown format "ulid"/);
    for (const name in FORMATS) if (!ajv.formats[name]) ajv.addFormat(name, FORMATS[name].test);
    const validate = ajv.compile(json);
    const value = {
      id: MORE.ulid.valid[0],
      mail: 'ann@example.com',
      blob: 'TWFu',
      own: MORE.ulid.valid[0],
    };
    assert.equal(validate(value), true);
    assert.equal(validate({ ...value, id: '81ARZ3NDEKTSV4RRFFQ69G5FAV' }), false);
  });

  it('should draw an example in sample and read a format out of the strings in infer', () => {
    register();
    for (const name of Object.keys(TABLE)) {
      const schemas = pair(name);
      for (const seed of [1, 2, 3, 42]) {
        const value = sample(schemas[0], { seed });
        assert.ok(FORMATS[name].examples.includes(value.s), `${name} seed ${seed}: ${value.s}`);
        for (const schema of schemas) assert.equal(schema.check(value).valid, true);
      }
    }
    // The other rules of the field decide whether an example is a value.
    const [tight] = pair('email', { length: { max: 5 } });
    assert.throws(() => sample(tight), { code: 'ALX_ERR_UNSATISFIABLE' });
    const [patterned] = pair('email', { pattern: /example\.com$/, length: 64 });
    assert.equal(sample(patterned).s, 'ann@example.com');
    // infer: a place whose every string passes a format is that format, the
    // first registered one; a mixed place, a place with the option off, and a
    // place of hostnames (every word is one) are strings.
    const emails = [
      { e: 'ann@example.com' },
      { e: 'bob@example.org' },
      { e: 'cy@mail.example.net' },
    ];
    assert.deepEqual(infer(emails), { Struct: {}, e: { type: 'string', format: 'email' } });
    assert.deepEqual(infer(emails, { formats: false }), { Struct: {}, e: 'string' });
    assert.deepEqual(infer([...emails, { e: 'nope' }]), { Struct: {}, e: 'string' });
    assert.deepEqual(infer([{ h: 'example.com' }, { h: 'foo.org' }]), {
      Struct: {},
      h: 'string',
    });
    const ids = [
      { id: '550e8400-e29b-41d4-a716-446655440000' },
      { id: '123e4567-e89b-12d3-a456-426614174000' },
    ];
    assert.deepEqual(infer(ids), { Struct: {}, id: { type: 'string', format: 'uuid' } });
    assert.deepEqual(infer([{ at: '2026-10-11T12:00:00Z' }, { at: null }, {}]), {
      Struct: {},
      at: { type: 'string', format: 'date-time', required: false },
    });
    assert.deepEqual(infer([{ ip: '10.0.0.1' }, { ip: '::1' }]), { Struct: {}, ip: 'string' });
    assert.deepEqual(infer(['2026-10-11', '2000-02-29']), { type: 'string', format: 'date' });
    // The formats of 3.3: the specific ones first, the ones words pass never.
    const column = (values) => infer(values.map((value) => ({ v: value })));
    const formatOf = (values) => column(values).v.format ?? column(values).v;
    assert.equal(formatOf(MORE.ulid.valid), 'ulid');
    assert.equal(formatOf(MORE.jwt.valid), 'jwt');
    assert.equal(formatOf(['2026-10-11T12:00:00', '2026-10-12T08:30:00']), 'iso-date-time');
    assert.equal(formatOf(['2026-10-11T12:00:00Z', '2026-10-12T08:30:00']), 'iso-date-time');
    assert.equal(formatOf(['12:00:00', '08:30:00']), 'iso-time');
    assert.equal(formatOf(['P1D', 'PT15M']), 'duration');
    assert.equal(formatOf(['https://example.com/a', 'http://localhost:3000/']), 'url');
    assert.equal(formatOf(['https://example.com/a', 'mailto:ann@example.com']), 'uri');
    assert.equal(formatOf(['+380501234567', '+14155552671']), 'e164');
    assert.equal(formatOf(['#fff', '#7c5cff']), 'hex-color');
    assert.equal(formatOf(['10.0.0.0/8', '192.168.0.0/24']), 'cidrv4');
    assert.equal(formatOf(MORE.nanoid.valid), 'string');
    assert.equal(formatOf(['hello-world', 'abc']), 'string');
    assert.equal(formatOf(['1.2.3', '2.0.0']), 'string');
    // An enum of few recurring values wins over a format; a union keeps the format.
    const same = Array.from({ length: 4 }, () => ({ e: 'ann@example.com' }));
    assert.deepEqual(infer(same), { Struct: {}, e: { enum: ['ann@example.com'] } });
    assert.deepEqual(infer([{ v: 1 }, { v: 'ann@example.com' }]), {
      Struct: {},
      v: { union: ['integer', { type: 'string', format: 'email' }] },
    });
    // The elements of lists and the values of dictionaries fuse their formats.
    assert.deepEqual(infer([{ to: ['a@x.io', 'b@x.io'] }, { to: ['c@x.io'] }]), {
      Struct: {},
      to: { array: { type: 'string', format: 'email' } },
    });
    assert.deepEqual(infer([{ '2026-01-01': 'a@x.io', '2026-01-02': 'b@x.io' }]), {
      object: { string: { type: 'string', format: 'email' } },
    });
    // The inferred schema accepts the samples (the self-check), on both backends.
    const inferred = infer(emails, { as: 'schema' });
    assert.equal(compile(inferred, { jit: canEval() ? true : 'auto' }).accelerated, canEval());
    for (const value of emails) assert.equal(inferred.check(value).valid, true);
    assert.throws(() => infer(emails, { formats: 'no' }), {
      code: 'ALX_ERR_INVALID_OPTIONS',
      message: 'Infer option "formats" must be a boolean',
    });
    // A custom format infers unless it says not to.
    register({
      word: { test: (value) => /^[a-z]+$/.test(value), examples: ['word'], infer: false },
      shout: { test: (value) => /^[A-Z]+$/.test(value), examples: ['HEY'] },
    });
    assert.deepEqual(infer([{ w: 'hello' }, { w: 'world' }]), { Struct: {}, w: 'string' });
    assert.deepEqual(infer([{ w: 'HEY' }, { w: 'HO' }]), {
      Struct: {},
      w: { type: 'string', format: 'shout' },
    });
  });

  it('should keep one format in merge and refuse two, and classify it as a pattern in diff', () => {
    register();
    const a = new Schema('S', { a: { type: 'string', format: 'email', length: { max: 64 } } });
    const b = new Schema('S', { a: { type: 'string', format: 'email', length: { min: 3 } } });
    assert.deepEqual(merge(a, b).fields.a.toJSON(), {
      type: 'string',
      required: true,
      format: 'email',
      length: { min: 3, max: 64 },
    });
    const c = new Schema('S', { a: { type: 'string', format: 'uri' } });
    assert.throws(() => merge(a, c), {
      code: 'ALX_ERR_MERGE_CONFLICT',
      message: 'The format differs between the schemas in "S.a"',
    });
    const model = (def) => new Model({}, [['A', { Struct: {}, ...def }]]);
    const added = diff(model({ a: 'string' }), model({ a: { type: 'string', format: 'email' } }));
    assert.equal(added.length, 1);
    assert.equal(added[0].kind, 'field');
    assert.equal(added[0].op, 'changed');
    assert.equal(added[0].name, 'a');
    assert.deepEqual(added[0].detail, { keys: ['format'] });
    assert.deepEqual(added[0].to, { type: 'string', required: true, format: 'email' });
    assert.equal(compatibility(added), 'forward');
    const removed = diff(model({ a: { type: 'string', format: 'email' } }), model({ a: 'string' }));
    assert.equal(compatibility(removed), 'backward');
    const changed = diff(
      model({ a: { type: 'string', format: 'email' } }),
      model({ a: { type: 'string', format: 'uri' } }),
    );
    assert.equal(compatibility(changed), 'none');
  });

  it('should keep the format in a snapshot and restore it with the formats registered', () => {
    register();
    const model = new Model({}, [
      ['User', { Entity: {}, email: { type: 'string', format: 'email' } }],
    ]);
    const snapshot = JSON.parse(JSON.stringify(model));
    assert.deepEqual(snapshot.entities.User.fields.email, {
      type: 'string',
      required: true,
      format: 'email',
    });
    const restored = fromJSON(snapshot);
    assert.deepEqual(restored.entities.get('User').check({ email: 'nope' }).errors, [
      'Field "User.email" is not a valid email',
    ]);
    assert.deepEqual(restored.toJSON(), snapshot);
  });

  it('should run the built-in tests in linear time', () => {
    register();
    const hostile = [
      `${'a'.repeat(10_000)}@`,
      `${'a.'.repeat(5_000)}!`,
      `${'1'.repeat(10_000)}:`,
      `${'a-'.repeat(5_000)}`,
      `2026-10-11T12:00:00.${'0'.repeat(10_000)}!`,
      `${':1'.repeat(5_000)}g`,
      `P${'1'.repeat(10_000)}!`,
      `/${'a'.repeat(10_000)}~`,
      `/${'~0'.repeat(5_000)}~`,
      `0${'/a'.repeat(5_000)}~`,
      `{${'a'.repeat(10_000)}`,
      `1.2.3-${'a.'.repeat(5_000)}!`,
      `1.2.3-${'0'.repeat(10_000)}!`,
      `1.2.3+${'a.'.repeat(5_000)}!`,
      `${'👍'.repeat(5_000)}a`,
      `${'1 '.repeat(5_000)}x`,
      `https://${'a.'.repeat(5_000)}!`,
      `https://${'a'.repeat(10_000)}:`,
      `https://${'a:'.repeat(5_000)}@`,
      `${'('.repeat(10_000)}`,
      `${'a*'.repeat(5_000)}(`,
      `DE${'1'.repeat(10_000)}`,
      `1.1.1.1/${'1'.repeat(10_000)}`,
      `${'00:'.repeat(3_000)}`,
      `${'a'.repeat(10_000)}.${'b'.repeat(10)}.`,
      `${'A'.repeat(10_001)}=`,
      `#${'f'.repeat(10_000)}`,
    ];
    for (const name of NAMES) {
      const { test: check } = FORMATS[name];
      for (const text of hostile) {
        const started = performance.now();
        check(text);
        const took = performance.now() - started;
        assert.ok(took < 50, `${name} took ${took.toFixed(0)} ms on ${text.length} characters`);
      }
    }
  });

  // A repeated group with an alternative in it is linear in time but grows
  // the stack of the engine by one frame per repetition, and a string of
  // megabytes overflowed it out of `check` as a RangeError (a JSON pointer, a
  // URI template, a slug, a semantic version, an email). No built-in test
  // throws on a string of 20 million characters shaped for it.
  it('should never overflow the stack of the engine in a built-in test', () => {
    register();
    const n = 10_000_000;
    const shaped = {
      'json-pointer': `/${'a'.repeat(2 * n)}~`,
      'relative-json-pointer': `0/${'a'.repeat(2 * n)}~`,
      'uri-template': `${'a'.repeat(n)}{${'a,'.repeat(n / 2)}}`,
      slug: 'a-'.repeat(n),
      semver: `1.2.3-${'a.'.repeat(n)}!`,
      email: `${'a'.repeat(n)}@${'a.'.repeat(n / 2)}!`,
    };
    for (const name of Object.keys(shaped)) {
      assert.doesNotThrow(() => FORMATS[name].test(shaped[name]), name);
    }
    const plain = 'a'.repeat(n);
    for (const name of NAMES) assert.doesNotThrow(() => FORMATS[name].test(plain), name);
  });
});
