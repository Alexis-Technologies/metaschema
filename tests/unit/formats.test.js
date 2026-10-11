const { test } = require('node:test');
const assert = require('node:assert');

const { Schema, Model } = require('../../index.js');
const { FORMATS, register } = require('../../src/formats/index.js');
const { compile, canEval } = require('../../src/compile/index.js');
const { fromJSON, sample, infer, merge, diff, compatibility } = require('../../src/model/index.js');
const { toJSONSchema, fromJSONSchema } = require('../../src/generators/index.js');
const { fullFormats } = require('ajv-formats/dist/formats.js');
const uk = require('../../src/locales/uk.js');

// A schema of one formatted field, and a copy on the other backend.
const pair = (format, extra = {}) => {
  const definition = { s: { type: 'string', format, ...extra } };
  const a = new Schema('S', definition);
  const b = new Schema('S', definition);
  assert.strictEqual(compile(b, { jit: canEval() ? true : 'auto' }).accelerated, canEval());
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

test('Formats: the rule needs a registered format, and register() fills the table once', () => {
  assert.deepStrictEqual(Object.keys(FORMATS), []);
  assert.throws(() => Schema.from({ s: { type: 'string', format: 'email' } }), {
    name: 'SchemaDefinitionError',
    code: 'ERR_INVALID_RULE',
    message:
      'Rule "format" names a format that is not registered: "email" (register() of @alexify/metaschema/formats) in "s"',
  });
  assert.throws(() => Schema.from({ s: { type: 'string', format: /email/ } }), {
    code: 'ERR_INVALID_RULE',
    message: 'Rule "format" needs the name of a format in "s"',
  });
  register();
  const names = ['uuid', 'email', 'date-time', 'date', 'time', 'ipv4', 'ipv6', 'uri', 'hostname'];
  assert.deepStrictEqual(Object.keys(FORMATS), names);
  for (const name of names) {
    const entry = FORMATS[name];
    assert.strictEqual(Object.isFrozen(entry), true, name);
    assert.strictEqual(typeof entry.test, 'function', name);
    assert.ok(entry.examples.length >= 2, name);
    assert.strictEqual(Object.isFrozen(entry.examples), true, name);
    for (const example of entry.examples) assert.strictEqual(entry.test(example), true, example);
    assert.strictEqual(entry.infer, name !== 'hostname', name);
  }
  // Once: the same table, the same entries.
  const before = names.map((name) => FORMATS[name]);
  register();
  assert.deepStrictEqual(Object.keys(FORMATS), names);
  assert.deepStrictEqual(
    names.map((name) => FORMATS[name]),
    before,
  );
  // A format is a rule of strings only, and a known option (no lint warning).
  assert.throws(() => Schema.from({ n: { type: 'number', format: 'email' } }), {
    code: 'ERR_INVALID_RULE',
    message: 'Rule "format" does not apply to type "number" in "n"',
  });
  assert.throws(() => Schema.from({ s: { type: 'string', format: 'phone' } }), {
    code: 'ERR_INVALID_RULE',
  });
  assert.deepStrictEqual(Schema.from({ s: { type: 'string', format: 'email' } }).warnings, []);
  assert.strictEqual(
    Schema.from({ s: { type: 'string', format: 'email' } }).fields.s.format,
    'email',
  );
});

test('Formats: every built-in format accepts its values and rejects the others, on both backends', () => {
  register();
  for (const [name, { valid, invalid }] of Object.entries(TABLE)) {
    const schemas = pair(name);
    const ajv = ajvOf(name);
    for (const value of valid) {
      for (const schema of schemas) {
        assert.strictEqual(schema.check({ s: value }).valid, true, `${name}: ${value}`);
      }
      assert.strictEqual(ajv(value), true, `ajv-formats rejects ${name} ${JSON.stringify(value)}`);
    }
    for (const value of invalid) {
      for (const schema of schemas) {
        assert.deepStrictEqual(
          schema.check({ s: value }).errors,
          [`Field "S.s" is not a valid ${name}`],
          `${name}: ${value}`,
        );
      }
      assert.strictEqual(ajv(value), false, `ajv-formats accepts ${name} ${JSON.stringify(value)}`);
    }
    // A value of another type is a type issue, never a format one.
    for (const schema of schemas) {
      assert.deepStrictEqual(schema.check({ s: 42 }).errors, [
        'Field "S.s" not of expected type: string',
      ]);
    }
  }
});

test('Formats: the issue, both locales, the order of the rules and the bound of length.max', () => {
  register();
  const [schema] = pair('email', { length: { min: 2, max: 20 }, pattern: /^[a-z@.]+$/ });
  const result = schema.check({ s: 'A@' });
  assert.deepStrictEqual(result.issues, [
    {
      code: 'pattern',
      path: ['s'],
      message: 'does not match the pattern ^[a-z@.]+$',
      params: { pattern: '^[a-z@.]+$' },
    },
    { code: 'format', path: ['s'], message: 'is not a valid email', params: { format: 'email' } },
  ]);
  assert.deepStrictEqual(schema.check({ s: 'A@' }, { messages: uk }).errors, [
    'Поле "S.s" не відповідає шаблону ^[a-z@.]+$',
    'Поле "S.s" не є коректним email',
  ]);
  assert.deepStrictEqual(
    schema.check({ s: 'A@' }, { maxErrors: 1 }).issues.map((issue) => issue.code),
    ['pattern'],
  );
  // Too short: length, then the pattern and the format over a short string.
  assert.deepStrictEqual(
    schema.check({ s: 'A' }).issues.map((issue) => issue.code),
    ['length', 'pattern', 'format'],
  );
  // Past length.max neither the pattern nor the format is run.
  const calls = [];
  register({ counted: { test: (value) => calls.push(value) > 0, examples: ['x'], infer: false } });
  const [bounded] = pair('counted', { length: { max: 4 } });
  assert.deepStrictEqual(
    bounded.check({ s: 'abcde' }).issues.map((issue) => issue.code),
    ['length'],
  );
  assert.deepStrictEqual(calls, []);
  assert.strictEqual(bounded.check({ s: 'abcd' }).valid, true);
  assert.deepStrictEqual(calls, ['abcd']);
  // The validate function runs after the format, on a value that passed it.
  const checked = Schema.from({
    s: {
      type: 'string',
      format: 'email',
      validate: (value) => !value.endsWith('.test') || 'is a test address',
    },
  });
  assert.deepStrictEqual(checked.check({ s: 'ann@example.test' }).errors, [
    'Field "s" is a test address',
  ]);
  assert.deepStrictEqual(checked.check({ s: 'nope' }).errors, ['Field "s" is not a valid email']);
  // An optional or nullable formatted field.
  const optional = Schema.from({
    's?': { type: 'string', format: 'uuid' },
    n: { type: 'string', format: 'uuid', nullable: true },
  });
  assert.strictEqual(optional.check({ n: null }).valid, true);
  assert.strictEqual(optional.check({ s: null, n: null }).valid, true);
  assert.strictEqual(optional.check({ s: 'x', n: null }).valid, false);
});

test('Formats: the program registers its own, once per name', () => {
  register();
  const phone = { test: (value) => /^\+\d{9,15}$/.test(value), examples: ['+380501234567'] };
  register({ phone });
  const schema = Schema.from({ s: { type: 'string', format: 'phone' } });
  assert.strictEqual(schema.check({ s: '+380501234567' }).valid, true);
  assert.deepStrictEqual(schema.check({ s: '050' }).errors, ['Field "s" is not a valid phone']);
  assert.strictEqual(FORMATS.phone.infer, true);
  // The same test again is nothing; another test under the name is an error,
  // for a custom and a built-in name alike.
  register({ phone });
  assert.throws(() => register({ phone: { test: () => true, examples: ['x'] } }), {
    code: 'ERR_FORMAT_REGISTERED',
    message: 'Format "phone" is already registered with another test',
  });
  assert.throws(() => register({ email: { test: () => true, examples: ['x'] } }), {
    code: 'ERR_FORMAT_REGISTERED',
  });
  assert.strictEqual(schema.check({ s: '050' }).valid, false);
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
      code: 'ERR_INVALID_FORMAT',
      message,
    });
    assert.strictEqual(FORMATS.phone2, undefined);
  }
  assert.throws(() => register(null), { code: 'ERR_INVALID_FORMAT' });
  assert.throws(() => register('phone'), { code: 'ERR_INVALID_FORMAT' });
  // A name is a key of a table without a prototype.
  const odd = Object.defineProperty({}, '__proto__', {
    value: { test: (value) => value === 'p', examples: ['p'] },
    enumerable: true,
  });
  register(odd);
  assert.strictEqual(Object.hasOwn(FORMATS, '__proto__'), true);
  assert.strictEqual(
    Schema.from({ s: { type: 'string', format: '__proto__' } }).check({ s: 'p' }).valid,
    true,
  );
  register({ constructor: { test: (value) => value === 'c', examples: ['c'] } });
  assert.strictEqual(Object.hasOwn(FORMATS, 'constructor'), true);
  assert.strictEqual(
    Schema.from({ s: { type: 'string', format: 'constructor' } }).check({ s: 'c' }).valid,
    true,
  );
});

test('Formats: JSON Schema writes the format and reads a registered one back', () => {
  register();
  const schema = Schema.from({
    email: { type: 'string', format: 'email', length: { max: 64 } },
    'site?': { type: 'string', format: 'uri' },
  });
  for (const target of ['draft-2020-12', 'draft-07', 'openapi-3.0']) {
    const json = toJSONSchema(schema, { target });
    assert.deepStrictEqual(
      json.properties.email,
      { type: 'string', maxLength: 64, format: 'email' },
      target,
    );
  }
  assert.deepStrictEqual(toJSONSchema(schema, { target: 'mongodb' }).properties.email, {
    bsonType: 'string',
    maxLength: 64,
  });
  assert.deepStrictEqual(toJSONSchema(schema, { profile: 'strict' }).properties.email, {
    type: 'string',
  });
  // Back: a registered format is the rule, any other the annotation it was.
  const document = toJSONSchema(schema);
  assert.deepStrictEqual(fromJSONSchema(document), {
    Struct: {},
    email: { type: 'string', length: { min: undefined, max: 64 }, format: 'email' },
    site: { type: 'string', format: 'uri', required: false },
  });
  assert.deepStrictEqual(
    fromJSONSchema({
      type: 'object',
      properties: { x: { type: 'string', format: 'int32' } },
      required: ['x'],
      additionalProperties: false,
    }),
    { Struct: {}, x: 'string' },
  );
  assert.deepStrictEqual(
    fromJSONSchema({
      type: 'object',
      properties: { x: { type: 'integer', format: 'int32' } },
      required: ['x'],
      additionalProperties: false,
    }),
    { Struct: {}, x: 'integer' },
  );
  const imported = fromJSONSchema(document, { as: 'schema', name: 'User' });
  assert.deepStrictEqual(imported.check({ email: 'nope' }).errors, [
    'Field "User.email" is not a valid email',
  ]);
});

test('Formats: sample draws an example, infer reads a format out of the strings', () => {
  register();
  for (const name of Object.keys(TABLE)) {
    const schemas = pair(name);
    for (const seed of [1, 2, 3, 42]) {
      const value = sample(schemas[0], { seed });
      assert.ok(FORMATS[name].examples.includes(value.s), `${name} seed ${seed}: ${value.s}`);
      for (const schema of schemas) assert.strictEqual(schema.check(value).valid, true);
    }
  }
  // The other rules of the field decide whether an example is a value.
  const [tight] = pair('email', { length: { max: 5 } });
  assert.throws(() => sample(tight), { code: 'ERR_UNSATISFIABLE' });
  const [patterned] = pair('email', { pattern: /example\.com$/, length: 64 });
  assert.strictEqual(sample(patterned).s, 'ann@example.com');
  // infer: a place whose every string passes a format is that format, the
  // first registered one; a mixed place, a place with the option off, and a
  // place of hostnames (every word is one) are strings.
  const emails = [{ e: 'ann@example.com' }, { e: 'bob@example.org' }, { e: 'cy@mail.example.net' }];
  assert.deepStrictEqual(infer(emails), { Struct: {}, e: { type: 'string', format: 'email' } });
  assert.deepStrictEqual(infer(emails, { formats: false }), { Struct: {}, e: 'string' });
  assert.deepStrictEqual(infer([...emails, { e: 'nope' }]), { Struct: {}, e: 'string' });
  assert.deepStrictEqual(infer([{ h: 'example.com' }, { h: 'foo.org' }]), {
    Struct: {},
    h: 'string',
  });
  const ids = [
    { id: '550e8400-e29b-41d4-a716-446655440000' },
    { id: '123e4567-e89b-12d3-a456-426614174000' },
  ];
  assert.deepStrictEqual(infer(ids), { Struct: {}, id: { type: 'string', format: 'uuid' } });
  assert.deepStrictEqual(infer([{ at: '2026-10-11T12:00:00Z' }, { at: null }, {}]), {
    Struct: {},
    at: { type: 'string', format: 'date-time', required: false },
  });
  assert.deepStrictEqual(infer([{ ip: '10.0.0.1' }, { ip: '::1' }]), { Struct: {}, ip: 'string' });
  assert.deepStrictEqual(infer(['2026-10-11', '2000-02-29']), { type: 'string', format: 'date' });
  // An enum of few recurring values wins over a format; a union keeps the format.
  const same = Array.from({ length: 4 }, () => ({ e: 'ann@example.com' }));
  assert.deepStrictEqual(infer(same), { Struct: {}, e: { enum: ['ann@example.com'] } });
  assert.deepStrictEqual(infer([{ v: 1 }, { v: 'ann@example.com' }]), {
    Struct: {},
    v: { union: ['integer', { type: 'string', format: 'email' }] },
  });
  // The elements of lists and the values of dictionaries fuse their formats.
  assert.deepStrictEqual(infer([{ to: ['a@x.io', 'b@x.io'] }, { to: ['c@x.io'] }]), {
    Struct: {},
    to: { array: { type: 'string', format: 'email' } },
  });
  assert.deepStrictEqual(infer([{ '2026-01-01': 'a@x.io', '2026-01-02': 'b@x.io' }]), {
    object: { string: { type: 'string', format: 'email' } },
  });
  // The inferred schema accepts the samples (the self-check), on both backends.
  const inferred = infer(emails, { as: 'schema' });
  assert.strictEqual(compile(inferred, { jit: canEval() ? true : 'auto' }).accelerated, canEval());
  for (const value of emails) assert.strictEqual(inferred.check(value).valid, true);
  assert.throws(() => infer(emails, { formats: 'no' }), {
    code: 'ERR_INVALID_OPTIONS',
    message: 'Infer option "formats" must be a boolean',
  });
  // A custom format infers unless it says not to.
  register({
    word: { test: (value) => /^[a-z]+$/.test(value), examples: ['word'], infer: false },
    shout: { test: (value) => /^[A-Z]+$/.test(value), examples: ['HEY'] },
  });
  assert.deepStrictEqual(infer([{ w: 'hello' }, { w: 'world' }]), { Struct: {}, w: 'string' });
  assert.deepStrictEqual(infer([{ w: 'HEY' }, { w: 'HO' }]), {
    Struct: {},
    w: { type: 'string', format: 'shout' },
  });
});

test('Formats: merge keeps one format and refuses two, diff classifies it as a pattern', () => {
  register();
  const a = new Schema('S', { a: { type: 'string', format: 'email', length: { max: 64 } } });
  const b = new Schema('S', { a: { type: 'string', format: 'email', length: { min: 3 } } });
  assert.deepStrictEqual(merge(a, b).fields.a.toJSON(), {
    type: 'string',
    required: true,
    format: 'email',
    length: { min: 3, max: 64 },
  });
  const c = new Schema('S', { a: { type: 'string', format: 'uri' } });
  assert.throws(() => merge(a, c), {
    code: 'ERR_MERGE_CONFLICT',
    message: 'The format differs between the schemas in "S.a"',
  });
  const model = (def) => new Model({}, [['A', { Struct: {}, ...def }]]);
  const added = diff(model({ a: 'string' }), model({ a: { type: 'string', format: 'email' } }));
  assert.strictEqual(added.length, 1);
  assert.strictEqual(added[0].kind, 'field');
  assert.strictEqual(added[0].op, 'changed');
  assert.strictEqual(added[0].name, 'a');
  assert.deepStrictEqual(added[0].detail, { keys: ['format'] });
  assert.deepStrictEqual(added[0].to, { type: 'string', required: true, format: 'email' });
  assert.strictEqual(compatibility(added), 'forward');
  const removed = diff(model({ a: { type: 'string', format: 'email' } }), model({ a: 'string' }));
  assert.strictEqual(compatibility(removed), 'backward');
  const changed = diff(
    model({ a: { type: 'string', format: 'email' } }),
    model({ a: { type: 'string', format: 'uri' } }),
  );
  assert.strictEqual(compatibility(changed), 'none');
});

test('Formats: a snapshot keeps the format and restores with the formats registered', () => {
  register();
  const model = new Model({}, [
    ['User', { Entity: {}, email: { type: 'string', format: 'email' } }],
  ]);
  const snapshot = JSON.parse(JSON.stringify(model));
  assert.deepStrictEqual(snapshot.entities.User.fields.email, {
    type: 'string',
    required: true,
    format: 'email',
  });
  const restored = fromJSON(snapshot);
  assert.deepStrictEqual(restored.entities.get('User').check({ email: 'nope' }).errors, [
    'Field "User.email" is not a valid email',
  ]);
  assert.deepStrictEqual(restored.toJSON(), snapshot);
});

test('Formats: the built-in tests are linear', () => {
  register();
  const hostile = [
    `${'a'.repeat(10_000)}@`,
    `${'a.'.repeat(5_000)}!`,
    `${'1'.repeat(10_000)}:`,
    `${'a-'.repeat(5_000)}`,
    `2026-10-11T12:00:00.${'0'.repeat(10_000)}!`,
    `${':1'.repeat(5_000)}g`,
  ];
  for (const name of Object.keys(TABLE)) {
    const { test: check } = FORMATS[name];
    for (const text of hostile) {
      const started = performance.now();
      check(text);
      const took = performance.now() - started;
      assert.ok(took < 50, `${name} took ${took.toFixed(0)} ms on ${text.length} characters`);
    }
  }
});
