const { test } = require('node:test');
const assert = require('node:assert');
const util = require('node:util');

const { Schema, Model } = require('../../index.js');
const derive = require('../../src/derive/index.js');
const { compile, canEval } = require('../../src/compile/index.js');

const { pick, omit, partial, required, extend, keyof, register } = derive;

// A derived schema checked on both backends: the result, and a compiled copy.
const both = (make) => {
  const derived = make();
  const copy = make();
  assert.strictEqual(compile(copy, { jit: canEval() ? true : 'auto' }).accelerated, canEval());
  return [derived, copy];
};

const unknownField = (fn, message) =>
  assert.throws(fn, { name: 'SchemaDefinitionError', code: 'ERR_UNKNOWN_FIELD', message });

const model = new Model({}, [
  ['Company', { Entity: {}, name: 'string' }],
  ['Tag', { Struct: {}, label: 'string' }],
  [
    'Account',
    {
      Registry: { table: 'accounts' },
      login: { type: 'string', unique: true, length: { min: 3, max: 20 } },
      password: { type: 'string', length: { min: 8 } },
      'nick?': { type: 'string', aliases: ['nickname'] },
      role: { enum: ['admin', 'user'], default: 'user' },
      company: 'Company',
      tags: { array: 'Tag' },
      address: {
        city: 'string',
        street: { type: 'string', default: 'Main' },
        geo: { lat: 'number', lng: 'number' },
        validate: (value) => (value.city === value.street ? 'city is the street' : null),
      },
      display: (account) => account.login,
      naturalKey: { unique: ['login', 'company'] },
      byRole: { index: ['role'] },
      validate: (value) => (value.login === value.password ? 'login is the password' : null),
    },
  ],
]);

const Account = model.entities.get('Account');
const Company = model.entities.get('Company');

const account = {
  login: 'marcus',
  password: 'secret-password',
  role: 'admin',
  company: 'c1',
  tags: [{ label: 'x' }],
  address: { city: 'Rome', street: 'Via', geo: { lat: 1, lng: 2 } },
};

test('Derive: pick keeps the fields named, in the order of the schema', () => {
  for (const view of both(() => pick(Account, ['company', 'login', 'nick']))) {
    assert.deepStrictEqual(Object.keys(view.fields), ['login', 'nick', 'company']);
    assert.strictEqual(view.name, 'Account');
    assert.strictEqual(view.kind, 'struct');
    const { login, nick } = view.fields;
    assert.deepStrictEqual(login.length, { min: 3, max: 20 });
    assert.strictEqual(login.unique, true);
    assert.strictEqual(nick.required, false);
    assert.deepStrictEqual(nick.aliases, ['nickname']);
    assert.strictEqual(view.check({ login: 'marcus', company: 'c1' }).valid, true);
    // The alias of a picked field is read as it was.
    assert.strictEqual(
      view.parse({ login: 'marcus', company: 'c1', nickname: 'm' }).value.nick,
      'm',
    );
    assert.deepStrictEqual(view.check({ login: 'ma', company: 'c1', password: 'x' }).errors, [
      'Field "Account.login" value is too short',
      'Field "Account" has unexpected keys: password',
    ]);
  }
  // A calculated field is a field to pick.
  const shown = pick(Account, ['login', 'display']);
  assert.strictEqual(typeof shown.fields.display, 'function');
  // No key at all is an empty struct; a key named twice is named once.
  assert.deepStrictEqual(Object.keys(pick(Account, []).fields), []);
  assert.deepStrictEqual(Object.keys(pick(Account, ['login', 'login']).fields), ['login']);
});

test('Derive: omit keeps every field but the ones named', () => {
  for (const create of both(() => omit(Account, ['password', 'tags']))) {
    assert.deepStrictEqual(Object.keys(create.fields), [
      'login',
      'nick',
      'role',
      'company',
      'address',
      'display',
    ]);
    const { password, tags, ...rest } = account;
    assert.strictEqual(create.check(rest).valid, true);
    assert.deepStrictEqual(create.check(account).errors, [
      'Field "Account" has unexpected keys: password, tags',
    ]);
  }
  // The alias of an omitted field is a key like any other.
  const bare = omit(Account, ['nick']);
  const { password, ...value } = account;
  assert.deepStrictEqual(bare.check({ ...value, password, nickname: 'm' }).errors, [
    'Field "Account" has unexpected keys: nickname',
  ]);
});

test('Derive: a stored kind becomes a struct without its id, unless the id is named', () => {
  assert.strictEqual(Account.kind, 'registry');
  assert.strictEqual(Object.hasOwn(Account.fields, 'accountId'), true);
  const create = omit(Account, ['password']);
  assert.strictEqual(create.kind, 'struct');
  assert.strictEqual(create.store, 'memory');
  assert.strictEqual(create.scope, 'local');
  assert.deepStrictEqual(create.custom, {});
  assert.strictEqual(Object.hasOwn(create.fields, 'accountId'), false);
  // Naming the id keeps it as the field it was; omitting it is accepted.
  const row = pick(Account, ['accountId', 'login']);
  assert.deepStrictEqual(Object.keys(row.fields), ['login', 'accountId']);
  assert.strictEqual(row.fields.accountId.required, false);
  assert.strictEqual(Object.hasOwn(omit(Account, ['accountId']).fields, 'accountId'), false);
  // The metadata given decides: a stored kind adds the id of the new name.
  const stored = omit(Account, ['password'], {
    name: 'Member',
    metadata: { kind: 'entity', table: 'members' },
  });
  assert.strictEqual(stored.kind, 'entity');
  assert.strictEqual(stored.store, 'persistent');
  assert.deepStrictEqual(stored.custom, { table: 'members' });
  assert.strictEqual(Object.hasOwn(stored.fields, 'memberId'), true);
  // An anonymous stored schema has an `id`, which goes the same way.
  const anonymous = Schema.from({ Entity: {}, title: 'string' });
  assert.deepStrictEqual(Object.keys(anonymous.fields), ['title', 'id']);
  assert.deepStrictEqual(Object.keys(partial(anonymous).fields), ['title']);
  // The unknown policy stays.
  const lenient = new Schema('Lenient', { Entity: { unknown: 'ignore' }, a: 'string' });
  assert.strictEqual(pick(lenient, ['a']).unknown, 'ignore');
});

test('Derive: a memory kind keeps its metadata, a projection becomes a struct', () => {
  const form = new Schema('Form', { Form: { unknown: 'ignore', layout: 'grid' }, a: 'string' });
  const derived = extend(form, { b: 'number' });
  assert.strictEqual(derived.kind, 'form');
  assert.strictEqual(derived.unknown, 'ignore');
  assert.deepStrictEqual(derived.custom, { layout: 'grid' });
  const projections = new Model({}, [
    ['User', { Entity: {}, login: 'string', password: 'string', email: 'string' }],
    ['Signin', { Projection: { schema: 'User', fields: ['login', 'password'] } }],
  ]);
  const signin = projections.entities.get('Signin');
  const login = pick(signin, ['login']);
  assert.strictEqual(login.kind, 'struct');
  assert.strictEqual(login.parent, '');
  assert.deepStrictEqual(Object.keys(login.fields), ['login']);
});

test('Derive: indexes stay while their columns do, relations are those of the fields', () => {
  assert.deepStrictEqual(Object.keys(Account.indexes), ['naturalKey', 'byRole']);
  const both2 = pick(Account, ['login', 'company', 'role']);
  assert.deepStrictEqual(Object.keys(both2.indexes), ['naturalKey', 'byRole']);
  assert.deepStrictEqual(both2.indexes.naturalKey, { unique: ['login', 'company'] });
  const one = omit(Account, ['company']);
  assert.deepStrictEqual(Object.keys(one.indexes), ['byRole']);
  assert.deepStrictEqual(one.warnings, []);
  // A many field is recorded again by the field itself.
  const many = new Model({}, [
    ['Address', { Entity: {}, city: 'string' }],
    ['Person', { Entity: {}, name: 'string', addresses: { many: 'Address' } }],
  ]).entities.get('Person');
  const derived = pick(many, ['addresses']);
  assert.deepStrictEqual(Object.keys(derived.indexes), ['addresses']);
  assert.deepStrictEqual([...derived.relations], [{ to: 'Address', type: 'one-to-many' }]);
  assert.deepStrictEqual([...omit(many, ['addresses']).relations], []);
  assert.deepStrictEqual([...pick(Account, ['company']).references], ['Company']);
});

test('Derive: the schema functions go with pick, omit and partial, and stay with required and extend', () => {
  const value = { ...account, login: 'same-text', password: 'same-text' };
  assert.deepStrictEqual(Account.check(value).errors, ['Field "Account" login is the password']);
  assert.strictEqual(
    pick(Account, ['login', 'password']).check({ login: 'same-text', password: 'same-text' }).valid,
    true,
  );
  assert.strictEqual(omit(Account, ['tags']).options.validate, null);
  assert.strictEqual(partial(Account).options.validate, null);
  assert.strictEqual(required(Account).options.validate, Account.options.validate);
  assert.strictEqual(
    extend(Account, { extra: '?string' }).options.validate,
    Account.options.validate,
  );
  // An extension puts one back.
  const checked = extend(pick(Account, ['login', 'password']), {
    validate: Account.options.validate,
  });
  assert.strictEqual(checked.check({ login: 'same-text', password: 'same-text' }).valid, false);
  // A field's codecs are its own and stay.
  const coded = new Schema('Coded', {
    at: { type: 'string', parse: (text) => text.toUpperCase() },
    other: 'number',
  });
  assert.strictEqual(pick(coded, ['at']).parse({ at: 'x' }).value.at, 'X');
  assert.strictEqual(partial(coded).parse({ at: 'x' }).value.at, 'X');
});

test('Derive: partial makes every field optional and leaves the defaults out', () => {
  for (const patch of both(() => partial(Account))) {
    for (const key of Object.keys(patch.fields)) {
      const field = patch.fields[key];
      if (typeof field !== 'function') assert.strictEqual(field.required, false, key);
    }
    assert.strictEqual(patch.check({}).valid, true);
    // A key left out stays out: no default fills it.
    assert.deepStrictEqual(patch.parse({}).value, {});
    assert.strictEqual(patch.check({ login: null }).valid, true);
    assert.deepStrictEqual(patch.check({ login: 'ab' }).errors, [
      'Field "Account.login" value is too short',
    ]);
    // Not deep: a nested struct given is checked whole.
    assert.deepStrictEqual(patch.check({ address: { city: 'Rome' } }).errors, [
      'Field "Account.address.street" is required',
      'Field "Account.address.geo" is required',
    ]);
  }
  // `defaults` keeps them; `keys` names the fields.
  assert.deepStrictEqual(partial(Account, { defaults: true }).parse({}).value, { role: 'user' });
  const some = partial(Account, { keys: ['password', 'role'] });
  assert.strictEqual(some.fields.login.required, true);
  assert.strictEqual(some.fields.password.required, false);
  assert.strictEqual(some.fields.role.default, undefined);
  assert.strictEqual(some.fields.company.required, true);
  unknownField(() => partial(Account, { keys: ['nmae'] }), 'No such field in "Account.nmae"');
});

test('Derive: a deep partial goes into nested structs only', () => {
  const nested = new Schema('Doc', {
    title: 'string',
    meta: {
      author: { name: 'string', email: 'string' },
      'note?': 'string',
      validate: () => 'never',
    },
    long: { schema: { a: 'string', b: 'string' } },
    items: { array: { schema: { x: 'number', y: 'number' } } },
    pair: [{ schema: { p: 'string' } }, 'number'],
    either: { union: ['string', { schema: { q: 'string' } }] },
    map: { object: { string: { schema: { m: 'string' } } } },
  });
  // `keys` with `deep`: the fields named, and what is nested in them.
  const some = partial(nested, { keys: ['meta'], deep: true });
  const rest = {
    title: 't',
    long: { a: 'a', b: 'b' },
    items: [],
    pair: [{ p: 'p' }, 1],
    either: 'e',
    map: { k: { m: 'm' } },
  };
  assert.strictEqual(some.check(rest).valid, true, JSON.stringify(some.check(rest).issues));
  assert.strictEqual(some.check({ ...rest, meta: { author: {} } }).valid, true);
  assert.strictEqual(some.check({ ...rest, title: undefined }).valid, false);
  assert.strictEqual(some.check({ ...rest, long: {} }).valid, false);
  // `deep` with `defaults`: a nested default stays.
  const defaulted = new Schema('D', {
    box: { size: { type: 'integer', default: 3 }, label: 'string' },
  });
  assert.deepStrictEqual(
    partial(defaulted, { deep: true, defaults: true }).parse({ box: {} }).value,
    {
      box: { size: 3 },
    },
  );
  assert.deepStrictEqual(partial(defaulted, { deep: true }).parse({ box: {} }).value, { box: {} });
  for (const patch of both(() => partial(nested, { deep: true }))) {
    assert.strictEqual(patch.check({ meta: { author: {} } }).valid, true);
    assert.strictEqual(patch.check({ long: {} }).valid, true);
    // The nested validate, written for the whole struct, is gone.
    assert.strictEqual(patch.fields.meta.validate, undefined);
    assert.strictEqual(patch.fields.meta.schema.validate, undefined);
    // Collections, tuples, unions and dictionaries are taken whole.
    assert.deepStrictEqual(patch.check({ items: [{ x: 1 }] }).errors, [
      'Field "Doc.items[0].y" is required',
    ]);
    assert.deepStrictEqual(patch.check({ pair: [{}, 1] }).errors, [
      'Field "Doc.pair[0].p" is required',
    ]);
    assert.strictEqual(patch.check({ either: {} }).valid, false);
    assert.deepStrictEqual(patch.check({ map: { k: {} } }).errors, [
      'Field "Doc.map.k.m" is required',
    ]);
  }
  // A reference is its own schema and stays as it is.
  const graph = partial(Account, { deep: true });
  assert.deepStrictEqual(graph.check({ tags: [{}] }, { references: 'embed' }).errors, [
    'Field "Account.tags[0].label" is required',
  ]);
});

test('Derive: required makes the fields required and keeps their defaults', () => {
  for (const full of both(() => required(Account))) {
    assert.strictEqual(full.fields.nick.required, true);
    assert.strictEqual(full.fields.role.default, 'user');
    const { role, ...value } = account;
    // check asks for the key, parse fills it.
    assert.deepStrictEqual(full.check({ ...value, nick: 'n' }).errors, [
      'Field "Account.role" is required',
    ]);
    assert.strictEqual(full.parse({ ...value, nick: 'n' }).value.role, 'user');
  }
  const forms = new Schema('Forms', {
    a: '?string',
    'b?': 'string',
    c: { type: 'string', required: false },
    d: { type: 'string', required: false, default: 'x' },
  });
  const all = required(forms);
  for (const key of ['a', 'b', 'c', 'd']) assert.strictEqual(all.fields[key].required, true);
  assert.strictEqual(required(forms, { keys: ['a'] }).fields.b.required, false);
  // There and back, without the defaults partial left out.
  assert.strictEqual(required(partial(forms)).fields.d.default, undefined);
  const deep = required(partial(Account, { deep: true }), { deep: true });
  assert.strictEqual(deep.fields.address.schema.geo.schema.lat.required, true);
});

test('Derive: extend replaces fields in place and adds the others after them', () => {
  for (const wider of both(() =>
    extend(Account, { 'login?': 'string', email: { type: 'string', length: { max: 50 } } }),
  )) {
    assert.deepStrictEqual(Object.keys(wider.fields), [
      'login',
      'password',
      'nick',
      'role',
      'company',
      'tags',
      'address',
      'display',
      'email',
    ]);
    // The whole definition is replaced: the old rules are gone.
    assert.strictEqual(wider.fields.login.required, false);
    assert.strictEqual(wider.fields.login.length, undefined);
    assert.strictEqual(wider.check({ ...account, email: 'm@x' }).valid, true);
    assert.deepStrictEqual(wider.check(account).errors, ['Field "Account.email" is required']);
  }
  // A Schema as the extension: its fields, indexes and functions, not its kind or id.
  const extra = new Schema('Extra', {
    Entity: {},
    phone: 'string',
    byPhone: { index: ['phone'] },
  });
  const joined = extend(omit(Account, ['tags']), extra);
  assert.strictEqual(joined.kind, 'struct');
  assert.strictEqual(Object.hasOwn(joined.fields, 'extraId'), false);
  assert.deepStrictEqual(Object.keys(joined.indexes), ['naturalKey', 'byRole', 'byPhone']);
  // A reference of the extension's model resolves.
  const other = new Model({}, [
    ['Country', { Entity: {}, code: 'string' }],
    ['Located', { Struct: {}, country: 'Country' }],
  ]);
  const located = extend(pick(Account, ['login']), other.entities.get('Located'));
  assert.strictEqual(located.check({ login: 'marcus', country: 'c1' }).valid, true);
  assert.deepStrictEqual(located.checkConsistency(), []);
  // A field named `type` first, and a field and its optional form at once.
  const typed = extend(Schema.from({ a: 'string' }), { type: 'string', b: 'number' });
  assert.deepStrictEqual(Object.keys(typed.fields), ['a', 'type', 'b']);
  assert.throws(() => extend(Account, { age: 'number', 'age?': 'number' }), {
    code: 'ERR_INVALID_DEFINITION',
    message: 'Key "age" is a field or an alias already in "Account.age"',
  });
  assert.throws(() => extend(Account, { nickname: 'string' }), {
    code: 'ERR_INVALID_DEFINITION',
    message: 'Key "nickname" is a field or an alias already in "Account.nickname"',
  });
});

test('Derive: keyof is an enum of the names of the fields', () => {
  for (const names of both(() => keyof(Account))) {
    assert.deepStrictEqual(names.fields.enum, [
      'login',
      'password',
      'nick',
      'role',
      'company',
      'tags',
      'address',
    ]);
    assert.strictEqual(names.check('login').valid, true);
    assert.strictEqual(names.check('display').valid, false);
    assert.strictEqual(names.check('accountId').valid, false);
  }
  assert.strictEqual(keyof(Account, { name: 'AccountKey' }).name, 'AccountKey');
  const query = new Schema('Query', {
    sort: keyof(pick(Account, ['login', 'role'])),
    fields: { array: keyof(Account) },
  });
  assert.strictEqual(query.check({ sort: 'role', fields: ['login', 'nick'] }).valid, true);
  assert.strictEqual(query.check({ sort: 'password', fields: [] }).valid, false);
  assert.throws(() => keyof(Schema.from({})), { code: 'ERR_INVALID_ENUM' });
  // A schema of an enum has no kind: the metadata option names nothing.
  assert.throws(() => keyof(Account, { metadata: { kind: 'struct' } }), {
    code: 'ERR_INVALID_OPTIONS',
    message: 'keyof takes a name only: a schema of an enum has no kind in "Account"',
  });
});

test('Derive: a derived schema has the name of its source, the namespaces too', () => {
  const create = omit(Account, ['password']);
  assert.strictEqual(create.name, 'Account');
  assert.deepStrictEqual([...create.namespaces], [model]);
  assert.strictEqual(create.findReference('Company'), Company);
  assert.deepStrictEqual(create.checkConsistency(), []);
  // A model takes it under its own name only.
  const named = omit(Account, ['password'], { name: 'CreateAccount' });
  const api = new Model({}, [['CreateAccount', named]]);
  assert.strictEqual(api.entities.get('CreateAccount'), named);
  assert.strictEqual(api.toJSON().entities.CreateAccount.kind, 'struct');
  assert.throws(() => new Model({}, [['CreateAccount', create]]), {
    code: 'ERR_INVALID_DEFINITION',
    message: 'Schema "Account" cannot be used as "CreateAccount"',
  });
  // An isolated registry of the source resolves the custom types.
  const isolated = new Model(
    { money: { js: 'number' } },
    [['Price', { Struct: {}, amount: 'money', note: '?string' }]],
    null,
    { registry: 'isolated' },
  );
  const price = partial(isolated.entities.get('Price'));
  assert.strictEqual(price.check({ amount: 5 }).valid, true);
  assert.strictEqual(price.check({ amount: 'x' }).valid, false);
});

test('Derive: a schema that names itself without a model is reached from what is derived', () => {
  const category = new Schema('Category', {
    name: 'string',
    'note?': 'string',
    'parent?': 'Category',
  });
  const embed = { references: 'embed' };
  // The parent is the source, under its name or another: a patch of a
  // category still names a whole category as its parent.
  for (const schema of both(() => partial(category))) {
    assert.deepStrictEqual(schema.check({ parent: {} }, embed).errors, [
      'Field "Category.parent.name" is required',
    ]);
  }
  for (const schema of both(() => omit(category, ['note']))) {
    assert.deepStrictEqual(schema.check({ name: 'a', parent: { note: 'x' } }).errors, [
      'Field "Category.parent.name" is required',
    ]);
  }
  for (const schema of both(() => pick(category, ['name', 'parent'], { name: 'CategoryRef' }))) {
    assert.deepStrictEqual(schema.check({ name: 'a', parent: { name: 1 } }).errors, [
      'Field "CategoryRef.parent.name" not of expected type: string',
    ]);
    assert.deepStrictEqual(schema.checkConsistency(), []);
  }
  const node = new Schema('Node', { 'next?': 'Node' });
  const base = new Schema('Base', { a: 'string' });
  for (const schema of both(() => extend(base, node))) {
    assert.deepStrictEqual(schema.check({ a: 'x', next: { next: { next: 1 } } }).errors, [
      'Field "Base.next.next.next" not of expected type: object',
    ]);
  }
  // A model that holds the source is its namespace already.
  const trees = new Model({}, [['Tree', { Struct: {}, 'up?': 'Tree' }]]);
  assert.deepStrictEqual([...partial(trees.entities.get('Tree')).namespaces], [trees]);
});

test('Derive: the source is never changed', () => {
  const before = JSON.stringify(model.toJSON());
  const enums = Account.fields.role.enum;
  const aliases = Account.fields.nick.aliases;
  pick(Account, ['login']);
  omit(Account, ['login']);
  partial(Account, { deep: true });
  required(Account, { deep: true });
  extend(Account, { role: { enum: ['x'] } });
  keyof(Account);
  assert.strictEqual(JSON.stringify(model.toJSON()), before);
  assert.strictEqual(Account.fields.role.enum, enums);
  assert.deepStrictEqual(enums, ['admin', 'user']);
  assert.deepStrictEqual(aliases, ['nickname']);
  assert.strictEqual(Account.fields.address.schema.street.default, 'Main');
});

test('Derive: fields named like members of Object.prototype', () => {
  const odd = new Schema(
    'Odd',
    JSON.parse('{"__proto__": "string", "constructor": "number", "x": "string"}'),
  );
  const picked = pick(odd, ['__proto__', 'constructor']);
  assert.deepStrictEqual(Object.keys(picked.fields), ['__proto__', 'constructor']);
  assert.strictEqual(picked.check(JSON.parse('{"__proto__": "a", "constructor": 1}')).valid, true);
  assert.deepStrictEqual(Object.keys(omit(odd, ['__proto__']).fields), ['constructor', 'x']);
  unknownField(
    () => pick(Schema.from({ a: 'string' }), ['toString']),
    'No such field in "toString"',
  );
});

test('Derive: what is not a struct schema, keys or options throws', () => {
  for (const target of [null, {}, Schema.from('string'), Schema.from({ array: 'string' })]) {
    for (const call of [
      () => pick(target, []),
      () => omit(target, []),
      () => partial(target),
      () => required(target),
      () => extend(target, {}),
      () => keyof(target),
    ]) {
      assert.throws(call, { name: 'TypeError', code: 'ERR_INVALID_TARGET' });
    }
  }
  // The options of a call are the call's; the metadata among them is a
  // definition.
  for (const keys of ['login', [1], undefined]) {
    assert.throws(() => pick(Account, keys), {
      name: 'TypeError',
      code: 'ERR_INVALID_OPTION',
      message: /^keys must be a list of field names, got /,
    });
  }
  assert.throws(() => partial(Account, 'deep'), {
    code: 'ERR_INVALID_OPTION',
    message: 'options must be an object, got "deep"',
  });
  assert.throws(() => partial(Account, { metadata: 'entity' }), {
    name: 'SchemaDefinitionError',
    code: 'ERR_INVALID_OPTIONS',
  });
  assert.throws(() => partial(Account, { keys: 'login' }), { code: 'ERR_INVALID_OPTION' });
  unknownField(() => omit(Account, ['nmae']), 'No such field in "Account.nmae"');
  for (const extension of [null, 'string', ['a']]) {
    assert.throws(() => extend(Account, extension), { code: 'ERR_INVALID_TARGET' });
  }
  assert.throws(() => extend(Account, Schema.from('string')), { code: 'ERR_INVALID_TARGET' });
  assert.throws(() => extend(Account, { Entity: {}, a: 'string' }), {
    name: 'SchemaDefinitionError',
    code: 'ERR_INVALID_DEFINITION',
    message: 'An extension has fields only; the kind is options.metadata in "Account"',
  });
});

test('Derive: register() installs the functions as methods of Schema', () => {
  assert.strictEqual(Account.pick, undefined);
  const printed = util.inspect(Account, { depth: 4 });
  register();
  register();
  for (const name of ['pick', 'omit', 'partial', 'required', 'extend', 'keyof']) {
    const descriptor = Object.getOwnPropertyDescriptor(Schema.prototype, name);
    assert.strictEqual(typeof descriptor.value, 'function', name);
    assert.strictEqual(descriptor.enumerable, false, name);
  }
  const patch = Account.omit(['password']).partial();
  assert.strictEqual(patch.check({}).valid, true);
  assert.deepStrictEqual(Object.keys(Account.pick(['login']).required().fields), ['login']);
  assert.deepStrictEqual(Account.keyof().fields.enum.length, 7);
  assert.strictEqual(Account.extend({ x: 'string' }).fields.x.required, true);
  // The methods are not keys of a schema, nor of what it prints.
  assert.strictEqual(Object.keys(Account).includes('pick'), false);
  assert.strictEqual(JSON.stringify(Account).includes('pick'), false);
  assert.strictEqual(util.inspect(Account, { depth: 4 }), printed);
  // A Schema as a field is read as a Schema whatever its prototype has.
  const embedded = new Schema('Outer', { inner: Account.pick(['login']) });
  assert.strictEqual(embedded.check({ inner: { login: 'marcus' } }).valid, true);
});
