const { test } = require('node:test');
const assert = require('node:assert');

const { Schema, Model } = require('../../index.js');
const {
  fromJSON,
  diff,
  compatibility,
  compatibilityOf,
  register,
} = require('../../src/model/index.js');
const committed = require('../fixtures/snapshot.json');

const json = (value) => JSON.parse(JSON.stringify(value));

// A model of one entity `A` from the fields given, and the class of the
// changes from one to another.
const one = (fields, kind = { Struct: {} }) => new Model({}, [['A', { ...kind, ...fields }]]);

const classOf = (prev, next) => compatibility(diff(prev, next));

test('Evolution: fromJSON restores the fixture model from its snapshot', () => {
  const model = fromJSON(committed);
  assert.deepStrictEqual(json(model), committed);
  assert.deepStrictEqual([...model.order], Object.keys(committed.entities));
  assert.deepStrictEqual(model.warnings, []);
  assert.deepStrictEqual(model.database, committed.database);
  // The structure validates as the original does.
  const account = model.entities.get('Account');
  const row = { login: 'x', password: 'y', blocked: false, company: 'c1', fullName: {}, birth: {} };
  assert.strictEqual(account.check({ ...row, addresses: ['a1'] }).valid, true);
  assert.deepStrictEqual(account.check({ ...row, addresses: [{ city: 'c' }] }).errors, [
    'Field "Account.addresses[0]" not of expected type: string',
  ]);
  const graph = { ...row, company: { name: 'n' }, addresses: [{ city: 'c' }] };
  assert.strictEqual(account.check(graph, { references: 'embed' }).valid, true);
  assert.deepStrictEqual(account.check({ login: 1 }).errors.length, 7);
  // The projection has its parent's fields; the types came back as aliases.
  assert.deepStrictEqual(Object.keys(model.entities.get('Signin').fields), ['login', 'password']);
  assert.strictEqual(model.entities.get('Identifier').fields.creation.type, 'datetime');
  assert.strictEqual(model.types.datetime.metadata.pg, 'timestamp with time zone');
  assert.strictEqual(model.types.string.metadata.pg, 'varchar');
  // Its own registry: the shared one has no `datetime`.
  assert.strictEqual(Schema.from({ a: 'string' }).types.datetime, undefined);
});

test('Evolution: fromJSON revives tags and stands placeholders in for functions', () => {
  const original = new Model({}, [
    [
      'Doc',
      {
        Entity: { table: 'docs', unknown: 'ignore' },
        name: { type: 'string', pattern: /^[a-z]+$/i, length: { min: 1, max: 8 } },
        big: { type: 'bigint', min: 1n },
        at: { type: 'date', default: new Date('2026-10-11T00:00:00.000Z') },
        when: { type: 'date', default: () => new Date() },
        code: { type: 'string', validate: () => 'never valid', parse: (v) => `${v}!` },
        inner: { a: 'string', validate: () => 'never', serialize: () => 'gone' },
        ratio: (value) => value.big,
        validate: () => 'schema never valid',
        parse: () => 'replaced',
        byName: { unique: ['name'] },
      },
    ],
  ]);
  const snapshot = json(original);
  const restored = fromJSON(snapshot);
  assert.deepStrictEqual(json(restored), snapshot);
  const doc = restored.entities.get('Doc');
  assert.strictEqual(doc.kind, 'entity');
  assert.strictEqual(doc.unknown, 'ignore');
  assert.deepStrictEqual(doc.custom, { table: 'docs' });
  assert.deepStrictEqual(
    doc.indexes,
    Object.assign(Object.create(null), { byName: { unique: ['name'] } }),
  );
  const { name, big, at, when, code, inner } = doc.fields;
  assert.strictEqual(name.pattern.source, '^[a-z]+$');
  assert.strictEqual(name.pattern.flags, 'iu');
  assert.deepStrictEqual(name.length, { min: 1, max: 8 });
  assert.strictEqual(big.min, 1n);
  assert.strictEqual(at.default.getTime(), new Date('2026-10-11T00:00:00.000Z').getTime());
  // A validate passes, a decoder and a serializer give the value back, a
  // default factory and a calculated field give nothing.
  assert.strictEqual(typeof when.default, 'function');
  assert.strictEqual(when.default(), undefined);
  assert.strictEqual(code.validate('x'), undefined);
  assert.strictEqual(code.parse('x'), 'x');
  assert.strictEqual(inner.validate({}), undefined);
  assert.strictEqual(inner.serialize('x'), 'x');
  assert.strictEqual(typeof doc.fields.ratio, 'function');
  assert.strictEqual(doc.options.validate({}), undefined);
  assert.strictEqual(doc.options.parse('x'), 'x');
  assert.deepStrictEqual(restored.placeholders, [
    'Doc.when.default',
    'Doc.code.parse',
    'Doc.code.validate',
    'Doc.inner.validate',
    'Doc.inner.serialize',
    'Doc.ratio',
    'Doc.validate',
    'Doc.parse',
  ]);
  const value = {
    name: 'abc',
    big: 2n,
    at: new Date(),
    when: new Date(),
    code: 'c',
    inner: { a: 'x' },
    ratio: 1,
  };
  assert.strictEqual(doc.check(value).valid, true);
  assert.strictEqual(doc.parse(value).value.code, 'c');
  assert.strictEqual(doc.check({ ...value, name: '123' }).valid, false);
});

test('Evolution: fromJSON restores collections, tuples, unions and nested schemas', () => {
  const id = Schema.from('string');
  const original = new Model({}, [
    ['Tag', { Struct: {}, label: 'string' }],
    [
      'Doc',
      {
        Struct: {},
        tags: { array: { schema: { id: 'string', 'n?': 'integer' } } },
        ids: { set: 'bigint', length: { min: 1 } },
        byId: { map: { number: { x: 'boolean' } } },
        point: [{ x: 'number' }, { 'label?': 'string' }, ['boolean']],
        shape: {
          union: [
            { Struct: {}, kind: { enum: ['circle'] }, r: 'number' },
            { Struct: {}, kind: { enum: ['square'] }, side: { type: 'integer', min: 0 } },
          ],
          discriminator: 'kind',
        },
        either: { union: ['string', { array: 'number' }] },
        name: id,
        'nick?': id,
        owner: 'Tag',
        all: { many: 'Tag' },
      },
    ],
  ]);
  const snapshot = json(original);
  const restored = fromJSON(snapshot);
  assert.deepStrictEqual(json(restored), snapshot);
  const doc = restored.entities.get('Doc');
  const value = {
    tags: [{ id: 'a' }, { id: 'b', n: 2 }],
    ids: new Set([1n]),
    byId: new Map([[1, { x: true }]]),
    point: [1, 'l', [true]],
    shape: { kind: 'square', side: 2 },
    either: [1, 2],
    name: 'n',
    owner: { label: 'x' },
    all: [{ label: 'y' }],
  };
  assert.deepStrictEqual(doc.check(value).errors, []);
  assert.deepStrictEqual(
    doc.check({ ...value, shape: { kind: 'square', side: -1 }, either: true, nick: 1 }).errors,
    [
      'Field "Doc.shape.side" is less than 0',
      'Field "Doc.either" does not match any of: string, array',
      'Field "Doc.nick" not of expected type: string',
    ],
  );
  assert.strictEqual(doc.fields.point.value[1].name, 'label');
  assert.strictEqual(doc.fields.name.type, 'schema');
});

test('Evolution: fromJSON takes the real custom types and a registry', () => {
  const types = {
    hex: {
      kind: 'scalar',
      rules: ['length'],
      construct() {},
      checkType: (value) => /^[0-9a-f]+$/.test(value) || 'not hex',
    },
    money: { js: 'number', metadata: { pg: 'money' } },
  };
  const original = new Model(types, [
    ['Wallet', { Struct: {}, color: { type: 'hex', length: 6 }, total: 'money' }],
  ]);
  const snapshot = json(original);
  assert.deepStrictEqual(snapshot.types, {
    hex: { kind: 'scalar', check: true, metadata: {} },
    money: { js: 'number', metadata: { pg: 'money' } },
  });
  // Without the type: a placeholder accepts everything (and every rule).
  const loose = fromJSON(snapshot);
  assert.strictEqual(loose.entities.get('Wallet').check({ color: 'zzzzzz', total: 1 }).valid, true);
  assert.strictEqual(loose.entities.get('Wallet').check({ color: 1, total: 'x' }).valid, false);
  // With it, the restored model validates as the original.
  const strict = fromJSON(snapshot, { types: { hex: types.hex } });
  assert.deepStrictEqual(
    strict.entities.get('Wallet').check({ color: 'zzzzzz', total: 1 }).errors,
    ['Field "Wallet.color" not hex'],
  );
  assert.strictEqual(strict.types.hex.metadata.pg, undefined);
  // Into the shared registry, where the types are registered already.
  const shared = fromJSON(snapshot, { types, registry: 'shared' });
  assert.strictEqual(shared.types, original.types);
  // An alias of an alias comes back whatever the order of the snapshot.
  const chained = fromJSON({
    format: 1,
    database: null,
    types: { a: { js: 'b', metadata: {} }, b: { js: 'string', metadata: { pg: 'text' } } },
    entities: { E: { kind: 'struct', fields: { x: { type: 'a', required: true } } } },
  });
  assert.strictEqual(chained.entities.get('E').check({ x: 'y' }).valid, true);
  assert.strictEqual(chained.types.b.metadata.pg, 'text');
});

// A snapshot of the entities given, and a field of a type with more keys.
const broken = (entities, types = {}) => ({ format: 1, database: null, types, entities });
const field = (type, extra = {}) => ({ type, required: true, ...extra });
const struct = (fields, extra = {}) => ({ kind: 'struct', fields, ...extra });

test('Evolution: fromJSON and diff refuse what is not a snapshot', () => {
  const code = 'ERR_INVALID_SNAPSHOT';
  const snapshots = [null, 1, 'x', {}, { format: 2, entities: {} }, { format: 1 }, []];
  for (const value of [...snapshots, broken({}, 'types')]) {
    assert.throws(() => fromJSON(value), { name: 'SchemaDefinitionError', code });
    assert.throws(() => diff(value, committed), { code });
    assert.throws(() => diff(committed, value), { code });
  }
  assert.throws(() => fromJSON(broken({ A: { fields: {} } })), {
    code,
    message: 'An entity of a snapshot needs a kind in "A"',
    schema: 'A',
    field: '',
  });
  assert.throws(() => fromJSON(broken({ A: struct({ x: { required: true } }) })), {
    code,
    message: 'A field of a snapshot needs a type in "A.x"',
    schema: 'A',
    field: 'x',
  });
  assert.throws(() => fromJSON(broken({ A: struct({ x: 'string' }) })), { code });
  assert.throws(() => fromJSON(broken({}, { t: 'string' })), {
    code,
    message: 'A type of a snapshot needs an object in "types.t"',
  });
  // The options, and a target that is not a list of changes.
  for (const options of [null, 'shared', 1]) {
    assert.throws(() => fromJSON(committed, options), {
      code: 'ERR_INVALID_OPTIONS',
      message: 'Restore options must be an object',
    });
  }
  assert.throws(() => compatibility({}), { name: 'TypeError', code: 'ERR_INVALID_TARGET' });
});

// S1, S5: a snapshot is input. What it cannot say is ERR_INVALID_SNAPSHOT
// located in the entity, never a bare SyntaxError or TypeError, and what it
// says does not loosen the model.
test('Evolution: fromJSON locates what a snapshot cannot say', () => {
  const code = 'ERR_INVALID_SNAPSHOT';
  const fails = (entities, expected, types) =>
    assert.throws(() => fromJSON(broken(entities, types)), {
      name: 'SchemaDefinitionError',
      code,
      ...expected,
    });
  // A bigint, a date, a pattern that does not read; the location is the
  // path of the value, and `schema`/`field` are set as the core sets them.
  fails(
    { A: struct({ n: field('bigint', { min: { $bigint: 'abc' } }) }) },
    { message: 'Cannot convert abc to a BigInt in "A.n.min"', schema: 'A', field: 'n.min' },
  );
  fails(
    { A: struct({ d: field('date', { default: { $date: 'junk' } }) }) },
    { message: '"junk" is not a date in "A.d.default"' },
  );
  // The engine's text: V8 names the flags of the pattern since Node 20
  // (`/(/u:`), Node 18 does not (`/(/:`).
  fails(
    { A: struct({ s: field('string', { pattern: { source: '(', flags: 'u' } }) }) },
    { message: /^Invalid regular expression: \/\(\/u?: Unterminated group in "A\.s"$/ },
  );
  fails(
    { A: struct({ s: field('string', { pattern: {} }) }) },
    { message: 'A pattern needs a string source in "A.s"' },
  );
  fails(
    { A: struct({ s: field('string', { pattern: { source: 'a', flags: 5 } }) }) },
    { message: /^Invalid flags supplied to RegExp constructor '5' in "A\.s"$/ },
  );
  // Nested: the struct keys on the way, as a definition error is located.
  const city = field('string', { length: { min: { $bigint: 'x' } } });
  fails(
    { A: struct({ address: field('schema', { schema: { city } }) }) },
    { message: 'Cannot convert x to a BigInt in "A.address.city.length.min"' },
  );
  fails(
    { A: struct({ tags: field('array', { value: field('string', { length: 'x' }) }) }) },
    { code: 'ERR_INVALID_LENGTH', message: /in "A\.tags"$/ },
  );
  // A schema of one type, and the sections of an entity.
  fails(
    { Id: { kind: 'scalar', type: field('bigint', { min: { $bigint: 'q' } }) } },
    { message: 'Cannot convert q to a BigInt in "Id.min"', schema: 'Id', field: 'min' },
  );
  fails({ A: null }, { message: 'An entity of a snapshot needs a kind in "A"' });
  fails({ A: struct(null) }, { message: 'The fields of an entity must be an object in "A"' });
  fails(
    { A: struct({}, { custom: 'x' }) },
    { message: 'The custom of an entity must be an object in "A"' },
  );
  fails(
    { A: struct({}, { indexes: [] }) },
    { message: 'The indexes of an entity must be an object in "A"' },
  );
  // An index named like a field would replace the field.
  fails(
    { A: struct({ email: field('string', { length: 3 }) }, { indexes: { email: {} } }) },
    { message: 'An index is named like a field in "A.email"', schema: 'A', field: 'email' },
  );
  // The kind metadata wins over `custom`: a snapshot does not loosen `unknown`.
  const loose = fromJSON(
    broken({
      A: struct({ a: field('string') }, { unknown: 'reject', custom: { unknown: 'ignore' } }),
    }),
  );
  assert.strictEqual(loose.entities.get('A').unknown, 'reject');
  assert.strictEqual(loose.entities.get('A').check({ a: 'x', b: 1 }).valid, false);
  assert.deepStrictEqual(loose.entities.get('A').custom, {});
});

// S2: the walks over a snapshot stop at 128 levels.
test('Evolution: a snapshot nested deeper than 128 levels is refused', () => {
  const code = 'ERR_INVALID_SNAPSHOT';
  const message = 'A snapshot nested deeper than 128 levels';
  const nested = (count) => {
    let def = field('string');
    for (let index = 0; index < count; index += 1) def = field('array', { value: def });
    return broken({ A: struct({ a: def }) });
  };
  assert.strictEqual(fromJSON(nested(128)).entities.get('A').fields.a.type, 'array');
  assert.throws(() => fromJSON(nested(129)), { code, message: `${message} in "A.a"` });
  const valued = (count) => {
    let value = 1;
    for (let index = 0; index < count; index += 1) value = { v: value };
    return broken({ A: struct({ a: field('any', { default: value }) }) });
  };
  assert.deepStrictEqual(
    json(fromJSON(valued(128)).entities.get('A').fields.a.default),
    valued(128).entities.A.fields.a.default,
  );
  assert.throws(() => fromJSON(valued(129)), { code, message: /^A snapshot nested deeper/ });
  // A chain of aliases.
  const chained = (count) => {
    const types = {};
    for (let index = 0; index < count; index += 1) {
      types[`t${index}`] = { js: index + 1 < count ? `t${index + 1}` : 'string', metadata: {} };
    }
    return broken({ A: struct({ a: field('t0') }) }, types);
  };
  assert.strictEqual(fromJSON(chained(100)).entities.get('A').check({ a: 'x' }).valid, true);
  assert.throws(() => fromJSON(chained(200)), { code, message: `${message} in "types"` });
  // `diff` compares values with the same limit.
  assert.throws(() => diff(valued(129), valued(130)), { code, message });
  assert.deepStrictEqual(diff(valued(128), valued(128)), []);
  // A list of changes nested deeper than the stack takes is an error of
  // the snapshot, located at the change.
  let from = field('string');
  let to = field('string', { x: 1 });
  for (let index = 0; index < 20000; index += 1) {
    from = field('array', { value: from, x: index });
    to = field('array', { value: to });
  }
  const entry = { kind: 'field', op: 'changed', entity: 'A', name: 'a', from, to };
  assert.throws(() => compatibility([{ ...entry, detail: { keys: ['value'] } }]), {
    code,
    message: /in "A\.a"$/,
  });
});

// S4: the keys of a snapshot are defined, not assigned, so `__proto__` is a
// field; diff reads own keys only, so `constructor` is one too.
test('Evolution: a field named __proto__ or constructor is a field', () => {
  const original = new Model({}, [
    ['A', JSON.parse('{"Struct":{},"a":"string","__proto__":"string"}')],
  ]);
  const snapshot = json(original);
  assert.deepStrictEqual(Object.keys(snapshot.entities.A.fields), ['a', '__proto__']);
  const restored = fromJSON(snapshot);
  assert.deepStrictEqual(json(restored), snapshot);
  const entity = restored.entities.get('A');
  assert.strictEqual(entity.check(JSON.parse('{"a":"x","__proto__":"y"}')).valid, true);
  assert.deepStrictEqual(entity.check(JSON.parse('{"a":"x","__proto__":1}')).errors, [
    'Field "A.__proto__" not of expected type: string',
  ]);
  assert.deepStrictEqual(
    diff(json(one({ a: 'string' })), snapshot).map((c) => [c.op, c.name]),
    [['added', '__proto__']],
  );
  // A definition key `__proto__` is no key of a definition (the core
  // reserves it), not the prototype of the field.
  const proto = '{"type":"string","required":true,"__proto__":{"required":false}}';
  assert.throws(() => fromJSON(broken({ A: struct({ a: JSON.parse(proto) }) })), {
    code: 'ERR_RESERVED_KEY',
    message: /in "A\.a"$/,
  });
  // A type or a nested field named `constructor` is added, not compared
  // with Object.prototype.constructor.
  const types = diff(
    broken({ A: struct({}) }),
    broken({ A: struct({}) }, { constructor: { js: 'string', metadata: {} } }),
  );
  assert.deepStrictEqual(
    types.map((c) => [c.kind, c.op, c.name, compatibilityOf(c)]),
    [['type', 'added', 'constructor', 'full']],
  );
  const nested = (fields) => broken({ A: struct({ a: field('schema', { schema: fields }) }) });
  const added = diff(nested({}), nested({ constructor: field('string', { required: false }) }));
  assert.deepStrictEqual(
    added.map((c) => [c.op, c.detail, compatibilityOf(c)]),
    [['changed', { keys: ['schema'] }, 'full']],
  );
});

// S6: a shared registry takes no placeholder type.
test('Evolution: a shared registry refuses a placeholder type', () => {
  const snapshot = broken(
    { Wallet: struct({ color: field('hexa') }) },
    { hexa: { kind: 'scalar', check: true, metadata: {} }, string: { metadata: { pg: 'text' } } },
  );
  assert.throws(() => fromJSON(snapshot, { registry: 'shared' }), {
    code: 'ERR_INVALID_SNAPSHOT',
    message:
      'Type "hexa" of the snapshot needs options.types or an isolated registry in "types.hexa"',
  });
  assert.strictEqual(Schema.from({ a: 'string' }).types.hexa, undefined);
  // With the real type, or isolated, it restores; a metadata-only entry for
  // a built-in is what the registry takes from any model.
  const hexa = { kind: 'scalar', construct() {}, checkType: (v) => /^[0-9a-f]+$/.test(v) || 'no' };
  assert.deepStrictEqual(
    fromJSON(snapshot, { registry: 'shared', types: { hexa } }).placeholders,
    [],
  );
  assert.deepStrictEqual(fromJSON(snapshot).placeholders, ['types.hexa.checkType']);
  assert.strictEqual(Schema.from({ a: 'string' }).types.string.metadata.pg, 'text');
});

// O3: a restored model lists where its placeholders stand.
test('Evolution: fromJSON lists its placeholders', () => {
  assert.deepStrictEqual(fromJSON(committed).placeholders, []);
  const rgb = { kind: 'scalar', construct() {}, checkType: () => true };
  const original = new Model({ rgb }, [
    [
      'Doc',
      {
        Entity: {},
        name: { type: 'string', validate: () => true, parse: (v) => v },
        when: { type: 'date', default: () => new Date() },
        inner: { a: 'string', validate: () => true },
        tags: { array: { type: 'string', serialize: (v) => v } },
        point: [{ type: 'number', validate: () => true }, 'number'],
        shape: { union: ['number', { type: 'string', validate: () => true }] },
        color: 'rgb',
        total: () => 1,
        validate: () => true,
        parse: (v) => v,
      },
    ],
  ]);
  const restored = fromJSON(json(original));
  assert.deepStrictEqual(restored.placeholders, [
    'types.rgb.checkType',
    'Doc.name.parse',
    'Doc.name.validate',
    'Doc.when.default',
    'Doc.inner.validate',
    'Doc.tags.serialize',
    'Doc.point.validate',
    'Doc.shape.validate',
    'Doc.total',
    'Doc.validate',
    'Doc.parse',
  ]);
  // Invisible to the snapshot, and not a key of the model.
  assert.strictEqual(JSON.stringify(restored).includes('placeholders'), false);
  assert.deepStrictEqual(json(restored), json(original));
  assert.strictEqual(Object.keys(restored).includes('placeholders'), false);
  assert.strictEqual(Object.getOwnPropertyDescriptor(restored, 'placeholders').enumerable, false);
});

// R4, S1: `compatibility` reads a list of changes as `diff` writes them.
test('Evolution: compatibility refuses what is not a change and locates a bad definition', () => {
  const target = {
    name: 'TypeError',
    code: 'ERR_INVALID_TARGET',
    message: 'A list of changes is expected',
  };
  for (const entry of [null, 1, 'x', [], {}, { kind: 'field' }, { kind: 1, op: 'added' }]) {
    assert.throws(() => compatibility([entry]), target);
    assert.throws(() => compatibilityOf(entry), target);
  }
  const changed = { kind: 'field', op: 'changed', entity: 'A', name: 'a', from: {}, to: {} };
  assert.throws(() => compatibility([changed]), target);
  assert.throws(() => compatibility([{ ...changed, detail: {} }]), target);
  assert.strictEqual(compatibility([{ ...changed, detail: { keys: [] } }]), 'full');
  // A bigint of a snapshot that does not read, met while a bound is compared.
  const bound = (text) => broken({ A: struct({ a: field('bigint', { min: { $bigint: text } }) }) });
  assert.throws(() => compatibility(diff(bound('x'), bound('1'))), {
    name: 'SchemaDefinitionError',
    code: 'ERR_INVALID_SNAPSHOT',
    message: 'Cannot convert x to a BigInt in "A.a"',
    schema: 'A',
    field: 'a',
  });
  assert.strictEqual(compatibility(diff(bound('0'), bound('1'))), 'forward');
  // What `diff` does not read of a change it does not check: a definition
  // that is not one is an error of the snapshot, located at the change.
  assert.throws(() => compatibilityOf({ kind: 'field', op: 'added', entity: 'A', name: 'a' }), {
    code: 'ERR_INVALID_SNAPSHOT',
    message: /in "A\.a"$/,
  });
});

// S1: `diff` checks an entity before it reads it.
test('Evolution: diff refuses an entity it cannot read', () => {
  const code = 'ERR_INVALID_SNAPSHOT';
  const A = struct({ a: field('string') });
  const fails = (entity, message) => {
    assert.throws(() => diff(broken({ A: entity }), broken({ A })), { code, message, schema: 'A' });
    assert.throws(() => diff(broken({ A }), broken({ A: entity })), { code, message });
  };
  fails(null, 'An entity of a snapshot must be an object in "A"');
  fails({ kind: 'struct' }, 'An entity needs fields or a type, and relations as a list in "A"');
  fails(struct(null), 'An entity needs fields or a type, and relations as a list in "A"');
  fails(
    struct({}, { relations: 'x' }),
    'An entity needs fields or a type, and relations as a list in "A"',
  );
  fails(
    struct({}, { relations: [null] }),
    'An entity needs fields or a type, and relations as a list in "A"',
  );
  fails(struct({ a: null }), 'A field must be an object in "A.a"');
  // A struct that became a schema of one type (or back) changed its type.
  const changes = diff(broken({ A }), broken({ A: { kind: 'scalar', type: field('string') } }));
  assert.deepStrictEqual(
    changes.map((c) => [c.kind, c.op, c.detail]),
    [['entity', 'changed', { keys: ['kind', 'type'] }]],
  );
  assert.strictEqual(compatibility(changes), 'none');
  assert.strictEqual(
    compatibility(diff(broken({ A: { kind: 'struct', type: field('string') } }), broken({ A }))),
    'none',
  );
});

test('Evolution: diff lists every change by kind, in the order of the new model', () => {
  const prev = new Model({}, [
    [
      'Account',
      {
        Entity: {},
        name: 'string',
        count: 'integer',
        old: { type: 'string', deprecated: true },
        gone: 'string',
        company: 'Company',
        byName: { index: ['name'] },
      },
    ],
    ['Company', { Entity: {}, title: 'string' }],
    ['Dropped', { Struct: {}, x: 'string' }],
    ['Id', 'string'],
  ]);
  const next = new Model({ money: { js: 'number', metadata: { pg: 'money' } } }, [
    [
      'Account',
      {
        Entity: { unknown: 'ignore' },
        title: { type: 'string', aliases: ['name'], length: 8 },
        count: 'number',
        'note?': 'string',
        company: 'Company',
        employer: 'Company',
        byTitle: { index: ['title'] },
      },
    ],
    ['Company', { Entity: {}, title: 'money' }],
    ['Added', { Struct: {}, y: 'string' }],
    ['Id', 'number'],
  ]);
  const changes = diff(prev, next);
  const summary = changes.map(({ kind, op, entity, name, detail }) => [
    kind,
    op,
    entity,
    name,
    detail,
  ]);
  // The entities of the new model in its order (Company before Account,
  // which references it), the entities that are gone, then the types.
  assert.deepStrictEqual(summary, [
    ['field', 'changed', 'Company', 'title', { keys: ['type'] }],
    ['entity', 'changed', 'Account', 'Account', { keys: ['unknown'] }],
    ['field', 'renamed', 'Account', 'title', { renamed: 'name', keys: ['length'] }],
    ['field', 'changed', 'Account', 'count', { keys: ['type'] }],
    ['field', 'added', 'Account', 'note', undefined],
    ['field', 'added', 'Account', 'employer', undefined],
    ['field', 'removed', 'Account', 'old', { deprecated: true }],
    ['field', 'removed', 'Account', 'gone', undefined],
    ['index', 'removed', 'Account', 'byName', undefined],
    ['index', 'added', 'Account', 'byTitle', undefined],
    ['relation', 'added', 'Account', 'Company', undefined],
    ['entity', 'added', 'Added', 'Added', undefined],
    ['entity', 'changed', 'Id', 'Id', { keys: ['type'] }],
    ['entity', 'removed', 'Dropped', 'Dropped', undefined],
    ['type', 'added', '', 'money', undefined],
  ]);
  const [, meta, renamed, , , , removed, , , , relation, added, id, dropped, type] = changes;
  assert.deepStrictEqual(meta.from, {
    kind: 'entity',
    scope: 'application',
    store: 'persistent',
    allow: 'write',
    parent: '',
    unknown: 'reject',
    custom: {},
  });
  assert.strictEqual(meta.to.unknown, 'ignore');
  assert.deepStrictEqual(renamed.from, { type: 'string', required: true });
  assert.deepStrictEqual(renamed.to, {
    type: 'string',
    required: true,
    aliases: ['name'],
    length: { max: 8 },
  });
  assert.deepStrictEqual(removed.from, { type: 'string', required: true, deprecated: true });
  assert.deepStrictEqual(relation.to, { to: 'Company', type: 'many-to-one' });
  assert.strictEqual(added.to.kind, 'struct');
  assert.deepStrictEqual(id.from.type, { type: 'string', required: true });
  assert.deepStrictEqual(id.to.type, { type: 'number', required: true });
  assert.strictEqual(dropped.from.kind, 'struct');
  assert.deepStrictEqual(type.to, { js: 'number', metadata: { pg: 'money' } });
  // A model and its snapshot compare the same, and a model with itself not at all.
  assert.deepStrictEqual(diff(json(prev), json(next)), changes);
  assert.deepStrictEqual(diff(prev, json(next)), changes);
  assert.deepStrictEqual(diff(next, next), []);
  assert.deepStrictEqual(diff(committed, fromJSON(committed)), []);
});

test('Evolution: diff tells a renamed field from a removed and an added one', () => {
  // An alias that names a key of the old struct is a rename; one that names
  // a key still there, or none, is not.
  const prev = one({ a: 'string', b: 'string', c: 'string' });
  const ops = (next) => diff(prev, next).map(({ op, name, detail }) => [op, name, detail]);
  assert.deepStrictEqual(
    ops(one({ x: { type: 'string', aliases: ['a'] }, b: 'string', c: 'string' })),
    [['renamed', 'x', { renamed: 'a' }]],
  );
  assert.deepStrictEqual(
    ops(one({ b: 'string', c: 'string', x: { type: 'string', aliases: ['z'] } })),
    [
      ['added', 'x', undefined],
      ['removed', 'a', undefined],
    ],
  );
  // The first alias that was a key is the old one; a definition that
  // changed as well lists its keys.
  assert.deepStrictEqual(
    ops(
      one({
        x: { type: 'string', aliases: ['z', 'a'] },
        y: { type: 'number', aliases: ['b'] },
        c: 'string',
      }),
    ),
    [
      ['renamed', 'x', { renamed: 'a' }],
      ['renamed', 'y', { renamed: 'b', keys: ['type'] }],
    ],
  );
});

// One row per rule of the compatibility table: what changed from the first
// definition to the second, and the class.
// The rows with a format need the formats registered.
require('../../src/formats/index.js').register();

const RULES = [
  ['nothing', { a: 'string' }, { a: 'string' }, 'full'],
  ['a field added, optional', { a: 'string' }, { a: 'string', 'b?': 'string' }, 'full'],
  [
    'a field added, with a default',
    { a: 'string' },
    { a: 'string', b: { type: 'string', default: '' } },
    'full',
  ],
  ['a field added, required', { a: 'string' }, { a: 'string', b: 'string' }, 'forward'],
  ['a field removed, optional', { a: 'string', 'b?': 'string' }, { a: 'string' }, 'full'],
  [
    'a field removed, with a default',
    { a: 'string', b: { type: 'string', default: '' } },
    { a: 'string' },
    'full',
  ],
  ['a field removed, required', { a: 'string', b: 'string' }, { a: 'string' }, 'backward'],
  [
    'a deprecated field removed',
    { a: 'string', b: { type: 'string', deprecated: true } },
    { a: 'string' },
    'backward',
  ],
  [
    'a field renamed, required',
    { a: 'string' },
    { b: { type: 'string', aliases: ['a'] } },
    'backward',
  ],
  [
    'a field renamed, optional',
    { 'a?': 'string' },
    { 'b?': { type: 'string', aliases: ['a'] } },
    'full',
  ],
  ['required to optional', { a: 'string' }, { a: '?string' }, 'backward'],
  ['optional to required', { a: '?string' }, { a: 'string' }, 'forward'],
  ['a default added', { a: 'string' }, { a: { type: 'string', default: '' } }, 'full'],
  [
    'a default removed, required',
    { a: { type: 'string', default: '' } },
    { a: 'string' },
    'forward',
  ],
  [
    'a default removed, optional',
    { 'a?': { type: 'string', default: '' } },
    { 'a?': 'string' },
    'full',
  ],
  [
    'a default changed',
    { a: { type: 'string', default: 'x' } },
    { a: { type: 'string', default: 'y' } },
    'full',
  ],
  ['nullable', { a: 'string' }, { a: { type: 'string', nullable: true } }, 'backward'],
  ['not nullable', { a: { type: 'string', nullable: true } }, { a: 'string' }, 'forward'],
  // Coercion converts the input of parse: neither what check accepts nor
  // what parse gives changes.
  ['coerced', { a: 'integer' }, { a: { type: 'integer', coerce: true } }, 'full'],
  ['not coerced', { a: { type: 'integer', coerce: true } }, { a: 'integer' }, 'full'],
  ['integer to number', { a: 'integer' }, { a: 'number' }, 'backward'],
  ['number to integer', { a: 'number' }, { a: 'integer' }, 'forward'],
  ['another type', { a: 'string' }, { a: 'number' }, 'none'],
  [
    'length.min raised',
    { a: { type: 'string', length: { min: 1 } } },
    { a: { type: 'string', length: { min: 2 } } },
    'forward',
  ],
  [
    'length.min lowered',
    { a: { type: 'string', length: { min: 2 } } },
    { a: { type: 'string', length: { min: 1 } } },
    'backward',
  ],
  ['length.min added', { a: 'string' }, { a: { type: 'string', length: { min: 1 } } }, 'forward'],
  [
    'length.max raised',
    { a: { type: 'string', length: 4 } },
    { a: { type: 'string', length: 8 } },
    'backward',
  ],
  [
    'length.max lowered',
    { a: { type: 'string', length: 8 } },
    { a: { type: 'string', length: 4 } },
    'forward',
  ],
  ['length.max removed', { a: { type: 'string', length: 8 } }, { a: 'string' }, 'backward'],
  [
    'length tightened on both ends',
    { a: { type: 'string', length: [1, 8] } },
    { a: { type: 'string', length: [2, 4] } },
    'forward',
  ],
  [
    'length moved',
    { a: { type: 'string', length: [1, 4] } },
    { a: { type: 'string', length: [2, 8] } },
    'none',
  ],
  ['min raised', { a: { type: 'number', min: 0 } }, { a: { type: 'number', min: 1 } }, 'forward'],
  ['min removed', { a: { type: 'number', min: 0 } }, { a: 'number' }, 'backward'],
  ['max lowered', { a: { type: 'number', max: 9 } }, { a: { type: 'number', max: 5 } }, 'forward'],
  ['max added', { a: 'number' }, { a: { type: 'number', max: 5 } }, 'forward'],
  [
    'decimals raised',
    { a: { type: 'number', decimals: 2 } },
    { a: { type: 'number', decimals: 3 } },
    'backward',
  ],
  [
    'decimals lowered',
    { a: { type: 'number', decimals: 2 } },
    { a: { type: 'number', decimals: 0 } },
    'forward',
  ],
  ['decimals added', { a: 'number' }, { a: { type: 'number', decimals: 2 } }, 'forward'],
  ['decimals removed', { a: { type: 'number', decimals: 2 } }, { a: 'number' }, 'backward'],
  [
    'a bigint bound raised',
    { a: { type: 'bigint', min: 0n } },
    { a: { type: 'bigint', min: 1n } },
    'forward',
  ],
  [
    'a pattern added',
    { a: 'string' },
    { a: { type: 'string', pattern: '^a', length: 8 } },
    'forward',
  ],
  [
    'a pattern removed',
    { a: { type: 'string', pattern: '^a', length: 8 } },
    { a: { type: 'string', length: 8 } },
    'backward',
  ],
  [
    'a pattern changed',
    { a: { type: 'string', pattern: '^a', length: 8 } },
    { a: { type: 'string', pattern: '^b', length: 8 } },
    'none',
  ],
  ['a format added', { a: 'string' }, { a: { type: 'string', format: 'email' } }, 'forward'],
  ['a format removed', { a: { type: 'string', format: 'email' } }, { a: 'string' }, 'backward'],
  [
    'a format changed',
    { a: { type: 'string', format: 'email' } },
    { a: { type: 'string', format: 'uri' } },
    'none',
  ],
  ['enum values added', { a: { enum: ['x'] } }, { a: { enum: ['x', 'y'] } }, 'backward'],
  ['enum values removed', { a: { enum: ['x', 'y'] } }, { a: { enum: ['x'] } }, 'forward'],
  ['enum values replaced', { a: { enum: ['x'] } }, { a: { enum: ['y'] } }, 'none'],
  ['a validate added', { a: 'string' }, { a: { type: 'string', validate: () => true } }, 'forward'],
  [
    'a validate removed',
    { a: { type: 'string', validate: () => true } },
    { a: 'string' },
    'backward',
  ],
  ['a decoder added', { a: 'string' }, { a: { type: 'string', parse: (v) => v } }, 'full'],
  ['an alias added', { a: 'string' }, { a: { type: 'string', aliases: ['b'] } }, 'full'],
  ['an alias removed', { a: { type: 'string', aliases: ['b'] } }, { a: 'string' }, 'forward'],
  [
    'an annotation changed',
    { a: { type: 'string', title: 'x', unique: true } },
    { a: { type: 'string', title: 'y', description: 'd' } },
    'full',
  ],
  [
    'unicode length',
    { a: { type: 'string', length: 8 } },
    { a: { type: 'string', length: 8, unicode: true } },
    'full',
  ],
  [
    'a nested field added, required',
    { a: { x: 'string' } },
    { a: { x: 'string', y: 'string' } },
    'forward',
  ],
  [
    'a nested field removed, optional',
    { a: { x: 'string', 'y?': 'string' } },
    { a: { x: 'string' } },
    'full',
  ],
  [
    'a nested field renamed',
    { a: { x: 'string' } },
    { a: { y: { type: 'string', aliases: ['x'] } } },
    'backward',
  ],
  [
    'a nested validate added',
    { a: { x: 'string' } },
    { a: { x: 'string', validate: () => true } },
    'forward',
  ],
  [
    'a nested validate removed',
    { a: { x: 'string', validate: () => true } },
    { a: { x: 'string' } },
    'backward',
  ],
  ['a nested struct in place of a type', { a: 'string' }, { a: { x: 'string' } }, 'none'],
  ['an element widened', { a: { array: 'integer' } }, { a: { array: 'number' } }, 'backward'],
  ['an element of another type', { a: { array: 'string' } }, { a: { array: 'number' } }, 'none'],
  [
    'a tuple element narrowed',
    { a: ['number', 'string'] },
    { a: ['integer', 'string'] },
    'forward',
  ],
  ['a tuple element added', { a: ['number'] }, { a: ['number', 'string'] }, 'none'],
  [
    'a union branch added',
    { a: { union: ['string'] } },
    { a: { union: ['string', 'number'] } },
    'backward',
  ],
  [
    'a union branch removed',
    { a: { union: ['string', 'number'] } },
    { a: { union: ['string'] } },
    'forward',
  ],
  [
    'a union branch widened',
    { a: { union: ['integer', 'string'] } },
    { a: { union: ['number', 'string'] } },
    'backward',
  ],
  [
    'a key type changed',
    { a: { object: { string: 'number' } } },
    { a: { map: { string: 'number' } } },
    'none',
  ],
  [
    'a map key changed',
    { a: { map: { string: 'number' } } },
    { a: { map: { number: 'number' } } },
    'none',
  ],
  ['a reference target changed', { a: 'Company' }, { a: 'Person' }, 'none'],
  ['a reference embedded', { a: 'Company' }, { a: { type: 'Company', embed: true } }, 'none'],
  [
    'a discriminator changed',
    { a: { union: [{ Struct: {}, k: { enum: ['x'] } }], discriminator: 'k' } },
    { a: { union: [{ Struct: {}, k: { enum: ['x'] } }] } },
    'none',
  ],
  ['an index added', { a: 'string' }, { a: 'string', byA: { index: ['a'] } }, 'full'],
  ['an index removed', { a: 'string', byA: { index: ['a'] } }, { a: 'string' }, 'full'],
  [
    'an index changed',
    { a: 'string', byA: { index: ['a'] } },
    { a: 'string', byA: { unique: ['a'] } },
    'full',
  ],
  ['a calculated field added', { a: 'string' }, { a: 'string', half: (v) => v.a }, 'full'],
  [
    'a schema-level validate added',
    { a: 'string' },
    { a: 'string', validate: () => true },
    'forward',
  ],
  ['a schema-level decoder removed', { a: 'string', parse: (v) => v }, { a: 'string' }, 'full'],
];

test('Evolution: the compatibility class of every rule', () => {
  const BITS = { none: 0, backward: 1, forward: 2, full: 3 };
  const NAMES = ['none', 'backward', 'forward', 'full'];
  for (const [label, from, to, expected] of RULES) {
    const changes = diff(one(from), one(to));
    assert.strictEqual(compatibility(changes), expected, label);
    // The class of the list is the class every change allows.
    let bits = 3;
    for (const change of changes) bits &= BITS[compatibilityOf(change)];
    assert.strictEqual(NAMES[bits], expected, label);
  }
  // A function that stays a function is the same function.
  const marker = { $function: true };
  const same = {
    kind: 'field',
    op: 'changed',
    entity: 'A',
    name: 'validate',
    detail: { keys: [] },
  };
  assert.strictEqual(compatibilityOf({ ...same, from: marker, to: marker }), 'full');
  assert.strictEqual(compatibilityOf({ ...same, name: 'half', from: marker, to: marker }), 'full');
});

test('Evolution: the compatibility class of entities, kinds, relations and types', () => {
  const both = (prev, next) => classOf(new Model({}, prev), new Model({}, next));
  const a = ['A', { Struct: {}, x: 'string' }];
  const b = ['B', { Struct: {}, y: 'string' }];
  assert.strictEqual(both([a], [a, b]), 'full', 'an entity added');
  assert.strictEqual(both([a, b], [a]), 'backward', 'an entity removed');
  const kinds = (prev, next) => classOf(one({ x: 'string' }, prev), one({ x: 'string' }, next));
  assert.strictEqual(kinds({ Struct: {} }, { Entity: {} }), 'none', 'the kind changed');
  assert.strictEqual(
    kinds({ Struct: {} }, { Struct: { store: 'persistent' } }),
    'none',
    'the store changed',
  );
  assert.strictEqual(
    kinds({ Struct: {} }, { Struct: { scope: 'global', allow: 'read' } }),
    'full',
    'scope, allow',
  );
  assert.strictEqual(
    kinds({ Struct: { table: 'a' } }, { Struct: { table: 'b' } }),
    'full',
    'custom metadata',
  );
  assert.strictEqual(
    kinds({ Struct: {} }, { Struct: { unknown: 'ignore' } }),
    'backward',
    'unknown ignored',
  );
  assert.strictEqual(
    kinds({ Struct: { unknown: 'ignore' } }, { Struct: {} }),
    'forward',
    'unknown rejected',
  );
  // A projection of another parent, a schema of one type.
  const account = ['Account', { Entity: {}, login: 'string', mail: 'string' }];
  const other = ['Other', { Entity: {}, login: 'string' }];
  assert.strictEqual(
    both(
      [account, other, ['P', { Projection: { schema: 'Account', fields: ['login'] } }]],
      [account, other, ['P', { Projection: { schema: 'Other', fields: ['login'] } }]],
    ),
    'none',
    'the parent changed',
  );
  assert.strictEqual(both([['Id', 'integer']], [['Id', 'number']]), 'none', 'a schema of one type');
  // A reference that comes and goes with its field; a type's metadata.
  const company = ['Company', { Entity: {}, name: 'string' }];
  assert.strictEqual(
    both(
      [company, ['P', { Entity: {}, c: 'Company' }]],
      [company, ['P', { Entity: {}, c: 'Company', d: '?Company' }]],
    ),
    'full',
    'a relation added with an optional field',
  );
  const typed = (types) =>
    new Model(types, [['A', { Struct: {}, x: 'money' }]], null, { registry: 'isolated' });
  assert.strictEqual(
    classOf(
      typed({ money: { js: 'number' } }),
      typed({ money: { js: 'number', metadata: { pg: 'money' } } }),
    ),
    'full',
    'type metadata',
  );
  assert.strictEqual(
    classOf(typed({ money: { js: 'number' } }), typed({ money: { js: 'string' } })),
    'none',
    'a type aliases another type',
  );
  assert.strictEqual(classOf(typed({ money: { js: 'number' } }), one({ x: 'number' })), 'none');
  // The classes combine: backward with forward is none, full changes nothing.
  assert.strictEqual(
    classOf(one({ a: 'string', b: 'string' }), one({ a: '?string', b: 'string', 'c?': 'string' })),
    'backward',
  );
  assert.strictEqual(
    classOf(one({ a: 'string', b: 'string' }), one({ a: '?string', b: 'string', c: 'string' })),
    'none',
  );
  assert.strictEqual(compatibility([]), 'full');
});

test('Evolution: register() installs the statics on Model, once', () => {
  assert.strictEqual(Model.fromJSON, undefined);
  assert.strictEqual(Model.diff, undefined);
  assert.strictEqual(Model.compatibilityOf, undefined);
  register();
  register();
  assert.strictEqual(Model.fromJSON, fromJSON);
  assert.strictEqual(Model.diff, diff);
  assert.strictEqual(Model.compatibility, compatibility);
  assert.strictEqual(Model.compatibilityOf, compatibilityOf);
  for (const name of ['fromJSON', 'diff', 'compatibility', 'compatibilityOf']) {
    assert.strictEqual(Object.getOwnPropertyDescriptor(Model, name).enumerable, false);
  }
  assert.deepStrictEqual(Object.keys(Model), []);
  const model = Model.fromJSON(committed);
  assert.deepStrictEqual(model.placeholders, []);
  assert.deepStrictEqual(Model.diff(model, committed), []);
  assert.strictEqual(Model.compatibility(Model.diff(committed, model)), 'full');
  const changes = Model.diff(committed, one({ a: 'string' }));
  assert.deepStrictEqual(
    changes.filter((change) => Model.compatibilityOf(change) !== 'full').map((c) => c.op),
    ['removed', 'removed', 'removed', 'removed', 'removed', 'removed'],
  );
});
