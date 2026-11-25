const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const util = require('node:util');

const { Schema, Model } = require('../../index.js');
const derive = require('../../src/derive/index.js');
const { compile, canEval } = require('../../src/compile/index.js');

const { pick, omit, partial, required, extend, keyof, register } = derive;

// A derived schema checked on both backends: the result, and a compiled copy.
const both = (make) => {
  const derived = make();
  const copy = make();
  assert.equal(compile(copy, { jit: canEval() ? true : 'auto' }).accelerated, canEval());
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

describe('Derive', () => {
  it('should keep the fields named with pick, in the order of the schema', () => {
    for (const view of both(() => pick(Account, ['company', 'login', 'nick']))) {
      assert.deepEqual(Object.keys(view.fields), ['login', 'nick', 'company']);
      assert.equal(view.name, 'Account');
      assert.equal(view.kind, 'struct');
      const { login, nick } = view.fields;
      assert.deepEqual(login.length, { min: 3, max: 20 });
      assert.equal(login.unique, true);
      assert.equal(nick.required, false);
      assert.deepEqual(nick.aliases, ['nickname']);
      assert.equal(view.check({ login: 'marcus', company: 'c1' }).valid, true);
      // The alias of a picked field is read as it was.
      assert.equal(view.parse({ login: 'marcus', company: 'c1', nickname: 'm' }).value.nick, 'm');
      assert.deepEqual(view.check({ login: 'ma', company: 'c1', password: 'x' }).errors, [
        'Field "Account.login" value is too short',
        'Field "Account" has unexpected keys: password',
      ]);
    }
    // A calculated field is a field to pick.
    const shown = pick(Account, ['login', 'display']);
    assert.equal(typeof shown.fields.display, 'function');
    // No key at all is an empty struct; a key named twice is named once.
    assert.deepEqual(Object.keys(pick(Account, []).fields), []);
    assert.deepEqual(Object.keys(pick(Account, ['login', 'login']).fields), ['login']);
  });

  it('should keep every field but the ones named with omit', () => {
    for (const create of both(() => omit(Account, ['password', 'tags']))) {
      assert.deepEqual(Object.keys(create.fields), [
        'login',
        'nick',
        'role',
        'company',
        'address',
        'display',
      ]);
      const { password, tags, ...rest } = account;
      assert.equal(create.check(rest).valid, true);
      assert.deepEqual(create.check(account).errors, [
        'Field "Account" has unexpected keys: password, tags',
      ]);
    }
    // The alias of an omitted field is a key like any other.
    const bare = omit(Account, ['nick']);
    const { password, ...value } = account;
    assert.deepEqual(bare.check({ ...value, password, nickname: 'm' }).errors, [
      'Field "Account" has unexpected keys: nickname',
    ]);
  });

  it('should make a stored kind a struct without its id, unless the id is named', () => {
    assert.equal(Account.kind, 'registry');
    assert.equal(Object.hasOwn(Account.fields, 'accountId'), true);
    const create = omit(Account, ['password']);
    assert.equal(create.kind, 'struct');
    assert.equal(create.store, 'memory');
    assert.equal(create.scope, 'local');
    assert.deepEqual(create.custom, {});
    assert.equal(Object.hasOwn(create.fields, 'accountId'), false);
    // Naming the id keeps it as the field it was; omitting it is accepted.
    const row = pick(Account, ['accountId', 'login']);
    assert.deepEqual(Object.keys(row.fields), ['login', 'accountId']);
    assert.equal(row.fields.accountId.required, false);
    assert.equal(Object.hasOwn(omit(Account, ['accountId']).fields, 'accountId'), false);
    // The metadata given decides: a stored kind adds the id of the new name.
    const stored = omit(Account, ['password'], {
      name: 'Member',
      metadata: { kind: 'entity', table: 'members' },
    });
    assert.equal(stored.kind, 'entity');
    assert.equal(stored.store, 'persistent');
    assert.deepEqual(stored.custom, { table: 'members' });
    assert.equal(Object.hasOwn(stored.fields, 'memberId'), true);
    // An anonymous stored schema has an `id`, which goes the same way.
    const anonymous = Schema.from({ Entity: {}, title: 'string' });
    assert.deepEqual(Object.keys(anonymous.fields), ['title', 'id']);
    assert.deepEqual(Object.keys(partial(anonymous).fields), ['title']);
    // The unknown policy stays.
    const lenient = new Schema('Lenient', { Entity: { unknown: 'ignore' }, a: 'string' });
    assert.equal(pick(lenient, ['a']).unknown, 'ignore');
  });

  it('should keep the metadata of a memory kind and make a projection a struct', () => {
    const form = new Schema('Form', { Form: { unknown: 'ignore', layout: 'grid' }, a: 'string' });
    const derived = extend(form, { b: 'number' });
    assert.equal(derived.kind, 'form');
    assert.equal(derived.unknown, 'ignore');
    assert.deepEqual(derived.custom, { layout: 'grid' });
    const projections = new Model({}, [
      ['User', { Entity: {}, login: 'string', password: 'string', email: 'string' }],
      ['Signin', { Projection: { schema: 'User', fields: ['login', 'password'] } }],
    ]);
    const signin = projections.entities.get('Signin');
    const login = pick(signin, ['login']);
    assert.equal(login.kind, 'struct');
    assert.equal(login.parent, '');
    assert.deepEqual(Object.keys(login.fields), ['login']);
  });

  it('should keep the indexes while their columns stay, and the relations of the fields', () => {
    assert.deepEqual(Object.keys(Account.indexes), ['naturalKey', 'byRole']);
    const both2 = pick(Account, ['login', 'company', 'role']);
    assert.deepEqual(Object.keys(both2.indexes), ['naturalKey', 'byRole']);
    assert.deepEqual(both2.indexes.naturalKey, { unique: ['login', 'company'] });
    const one = omit(Account, ['company']);
    assert.deepEqual(Object.keys(one.indexes), ['byRole']);
    assert.deepEqual(one.warnings, []);
    // A many field is recorded again by the field itself.
    const many = new Model({}, [
      ['Address', { Entity: {}, city: 'string' }],
      ['Person', { Entity: {}, name: 'string', addresses: { many: 'Address' } }],
    ]).entities.get('Person');
    const derived = pick(many, ['addresses']);
    assert.deepEqual(Object.keys(derived.indexes), ['addresses']);
    assert.deepEqual([...derived.relations], [{ to: 'Address', type: 'one-to-many' }]);
    assert.deepEqual([...omit(many, ['addresses']).relations], []);
    assert.deepEqual([...pick(Account, ['company']).references], ['Company']);
  });

  it('should drop the schema functions with pick, omit and partial, and keep them with required and extend', () => {
    const value = { ...account, login: 'same-text', password: 'same-text' };
    assert.deepEqual(Account.check(value).errors, ['Field "Account" login is the password']);
    assert.equal(
      pick(Account, ['login', 'password']).check({ login: 'same-text', password: 'same-text' })
        .valid,
      true,
    );
    assert.equal(omit(Account, ['tags']).options.validate, null);
    assert.equal(partial(Account).options.validate, null);
    assert.equal(required(Account).options.validate, Account.options.validate);
    assert.equal(extend(Account, { extra: '?string' }).options.validate, Account.options.validate);
    // An extension puts one back.
    const checked = extend(pick(Account, ['login', 'password']), {
      validate: Account.options.validate,
    });
    assert.equal(checked.check({ login: 'same-text', password: 'same-text' }).valid, false);
    // A field's codecs are its own and stay.
    const coded = new Schema('Coded', {
      at: { type: 'string', parse: (text) => text.toUpperCase() },
      other: 'number',
    });
    assert.equal(pick(coded, ['at']).parse({ at: 'x' }).value.at, 'X');
    assert.equal(partial(coded).parse({ at: 'x' }).value.at, 'X');
  });

  it('should make every field optional with partial and leave the defaults out', () => {
    for (const patch of both(() => partial(Account))) {
      for (const key of Object.keys(patch.fields)) {
        const field = patch.fields[key];
        if (typeof field !== 'function') assert.equal(field.required, false, key);
      }
      assert.equal(patch.check({}).valid, true);
      // A key left out stays out: no default fills it.
      assert.deepEqual(patch.parse({}).value, {});
      assert.equal(patch.check({ login: null }).valid, true);
      assert.deepEqual(patch.check({ login: 'ab' }).errors, [
        'Field "Account.login" value is too short',
      ]);
      // Not deep: a nested struct given is checked whole.
      assert.deepEqual(patch.check({ address: { city: 'Rome' } }).errors, [
        'Field "Account.address.street" is required',
        'Field "Account.address.geo" is required',
      ]);
    }
    // `defaults` keeps them; `keys` names the fields.
    assert.deepEqual(partial(Account, { defaults: true }).parse({}).value, { role: 'user' });
    const some = partial(Account, { keys: ['password', 'role'] });
    assert.equal(some.fields.login.required, true);
    assert.equal(some.fields.password.required, false);
    assert.equal(some.fields.role.default, undefined);
    assert.equal(some.fields.company.required, true);
    unknownField(() => partial(Account, { keys: ['nmae'] }), 'No such field in "Account.nmae"');
  });

  it('should go into nested structs only with a deep partial', () => {
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
    assert.equal(some.check(rest).valid, true, JSON.stringify(some.check(rest).issues));
    assert.equal(some.check({ ...rest, meta: { author: {} } }).valid, true);
    assert.equal(some.check({ ...rest, title: undefined }).valid, false);
    assert.equal(some.check({ ...rest, long: {} }).valid, false);
    // `deep` with `defaults`: a nested default stays.
    const defaulted = new Schema('D', {
      box: { size: { type: 'integer', default: 3 }, label: 'string' },
    });
    assert.deepEqual(partial(defaulted, { deep: true, defaults: true }).parse({ box: {} }).value, {
      box: { size: 3 },
    });
    assert.deepEqual(partial(defaulted, { deep: true }).parse({ box: {} }).value, { box: {} });
    for (const patch of both(() => partial(nested, { deep: true }))) {
      assert.equal(patch.check({ meta: { author: {} } }).valid, true);
      assert.equal(patch.check({ long: {} }).valid, true);
      // The nested validate, written for the whole struct, is gone.
      assert.equal(patch.fields.meta.validate, undefined);
      assert.equal(patch.fields.meta.schema.validate, undefined);
      // Collections, tuples, unions and dictionaries are taken whole.
      assert.deepEqual(patch.check({ items: [{ x: 1 }] }).errors, [
        'Field "Doc.items[0].y" is required',
      ]);
      assert.deepEqual(patch.check({ pair: [{}, 1] }).errors, [
        'Field "Doc.pair[0].p" is required',
      ]);
      assert.equal(patch.check({ either: {} }).valid, false);
      assert.deepEqual(patch.check({ map: { k: {} } }).errors, ['Field "Doc.map.k.m" is required']);
    }
    // A reference is its own schema and stays as it is.
    const graph = partial(Account, { deep: true });
    assert.deepEqual(graph.check({ tags: [{}] }, { references: 'embed' }).errors, [
      'Field "Account.tags[0].label" is required',
    ]);
  });

  it('should make the fields required and keep their defaults with required', () => {
    for (const full of both(() => required(Account))) {
      assert.equal(full.fields.nick.required, true);
      assert.equal(full.fields.role.default, 'user');
      const { role, ...value } = account;
      // check asks for the key, parse fills it.
      assert.deepEqual(full.check({ ...value, nick: 'n' }).errors, [
        'Field "Account.role" is required',
      ]);
      assert.equal(full.parse({ ...value, nick: 'n' }).value.role, 'user');
    }
    const forms = new Schema('Forms', {
      a: '?string',
      'b?': 'string',
      c: { type: 'string', required: false },
      d: { type: 'string', required: false, default: 'x' },
    });
    const all = required(forms);
    for (const key of ['a', 'b', 'c', 'd']) assert.equal(all.fields[key].required, true);
    assert.equal(required(forms, { keys: ['a'] }).fields.b.required, false);
    // There and back, without the defaults partial left out.
    assert.equal(required(partial(forms)).fields.d.default, undefined);
    const deep = required(partial(Account, { deep: true }), { deep: true });
    assert.equal(deep.fields.address.schema.geo.schema.lat.required, true);
  });

  it('should replace fields in place with extend and add the others after them', () => {
    for (const wider of both(() =>
      extend(Account, { 'login?': 'string', email: { type: 'string', length: { max: 50 } } }),
    )) {
      assert.deepEqual(Object.keys(wider.fields), [
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
      assert.equal(wider.fields.login.required, false);
      assert.equal(wider.fields.login.length, undefined);
      assert.equal(wider.check({ ...account, email: 'm@x' }).valid, true);
      assert.deepEqual(wider.check(account).errors, ['Field "Account.email" is required']);
    }
    // A Schema as the extension: its fields, indexes and functions, not its kind or id.
    const extra = new Schema('Extra', {
      Entity: {},
      phone: 'string',
      byPhone: { index: ['phone'] },
    });
    const joined = extend(omit(Account, ['tags']), extra);
    assert.equal(joined.kind, 'struct');
    assert.equal(Object.hasOwn(joined.fields, 'extraId'), false);
    assert.deepEqual(Object.keys(joined.indexes), ['naturalKey', 'byRole', 'byPhone']);
    // A reference of the extension's model resolves.
    const other = new Model({}, [
      ['Country', { Entity: {}, code: 'string' }],
      ['Located', { Struct: {}, country: 'Country' }],
    ]);
    const located = extend(pick(Account, ['login']), other.entities.get('Located'));
    assert.equal(located.check({ login: 'marcus', country: 'c1' }).valid, true);
    assert.deepEqual(located.checkConsistency(), []);
    // A field named `type` first, and a field and its optional form at once.
    const typed = extend(Schema.from({ a: 'string' }), { type: 'string', b: 'number' });
    assert.deepEqual(Object.keys(typed.fields), ['a', 'type', 'b']);
    assert.throws(() => extend(Account, { age: 'number', 'age?': 'number' }), {
      code: 'ERR_INVALID_DEFINITION',
      message: 'Key "age" is a field or an alias already in "Account.age"',
    });
    assert.throws(() => extend(Account, { nickname: 'string' }), {
      code: 'ERR_INVALID_DEFINITION',
      message: 'Key "nickname" is a field or an alias already in "Account.nickname"',
    });
  });

  it('should build with keyof an enum of the names of the fields', () => {
    for (const names of both(() => keyof(Account))) {
      assert.deepEqual(names.fields.enum, [
        'login',
        'password',
        'nick',
        'role',
        'company',
        'tags',
        'address',
      ]);
      assert.equal(names.check('login').valid, true);
      assert.equal(names.check('display').valid, false);
      assert.equal(names.check('accountId').valid, false);
    }
    assert.equal(keyof(Account, { name: 'AccountKey' }).name, 'AccountKey');
    const query = new Schema('Query', {
      sort: keyof(pick(Account, ['login', 'role'])),
      fields: { array: keyof(Account) },
    });
    assert.equal(query.check({ sort: 'role', fields: ['login', 'nick'] }).valid, true);
    assert.equal(query.check({ sort: 'password', fields: [] }).valid, false);
    assert.throws(() => keyof(Schema.from({})), { code: 'ERR_INVALID_ENUM' });
    // A schema of an enum has no kind: the metadata option names nothing.
    assert.throws(() => keyof(Account, { metadata: { kind: 'struct' } }), {
      code: 'ERR_INVALID_OPTIONS',
      message: 'keyof takes a name only: a schema of an enum has no kind in "Account"',
    });
  });

  it('should give a derived schema the name of its source, the namespaces too', () => {
    const create = omit(Account, ['password']);
    assert.equal(create.name, 'Account');
    assert.deepEqual([...create.namespaces], [model]);
    assert.equal(create.findReference('Company'), Company);
    assert.deepEqual(create.checkConsistency(), []);
    // A model takes it under its own name only.
    const named = omit(Account, ['password'], { name: 'CreateAccount' });
    const api = new Model({}, [['CreateAccount', named]]);
    assert.equal(api.entities.get('CreateAccount'), named);
    assert.equal(api.toJSON().entities.CreateAccount.kind, 'struct');
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
    assert.equal(price.check({ amount: 5 }).valid, true);
    assert.equal(price.check({ amount: 'x' }).valid, false);
  });

  it('should reach a schema that names itself without a model from what is derived', () => {
    const category = new Schema('Category', {
      name: 'string',
      'note?': 'string',
      'parent?': 'Category',
    });
    const embed = { references: 'embed' };
    // The parent is the source, under its name or another: a patch of a
    // category still names a whole category as its parent.
    for (const schema of both(() => partial(category))) {
      assert.deepEqual(schema.check({ parent: {} }, embed).errors, [
        'Field "Category.parent.name" is required',
      ]);
    }
    for (const schema of both(() => omit(category, ['note']))) {
      assert.deepEqual(schema.check({ name: 'a', parent: { note: 'x' } }).errors, [
        'Field "Category.parent.name" is required',
      ]);
    }
    for (const schema of both(() => pick(category, ['name', 'parent'], { name: 'CategoryRef' }))) {
      assert.deepEqual(schema.check({ name: 'a', parent: { name: 1 } }).errors, [
        'Field "CategoryRef.parent.name" not of expected type: string',
      ]);
      assert.deepEqual(schema.checkConsistency(), []);
    }
    const node = new Schema('Node', { 'next?': 'Node' });
    const base = new Schema('Base', { a: 'string' });
    for (const schema of both(() => extend(base, node))) {
      assert.deepEqual(schema.check({ a: 'x', next: { next: { next: 1 } } }).errors, [
        'Field "Base.next.next.next" not of expected type: object',
      ]);
    }
    // A model that holds the source is its namespace already.
    const trees = new Model({}, [['Tree', { Struct: {}, 'up?': 'Tree' }]]);
    assert.deepEqual([...partial(trees.entities.get('Tree')).namespaces], [trees]);
  });

  it('should never change the source', () => {
    const before = JSON.stringify(model.toJSON());
    const enums = Account.fields.role.enum;
    const aliases = Account.fields.nick.aliases;
    pick(Account, ['login']);
    omit(Account, ['login']);
    partial(Account, { deep: true });
    required(Account, { deep: true });
    extend(Account, { role: { enum: ['x'] } });
    keyof(Account);
    assert.equal(JSON.stringify(model.toJSON()), before);
    assert.equal(Account.fields.role.enum, enums);
    assert.deepEqual(enums, ['admin', 'user']);
    assert.deepEqual(aliases, ['nickname']);
    assert.equal(Account.fields.address.schema.street.default, 'Main');
  });

  it('should pick and omit fields named like members of Object.prototype', () => {
    const odd = new Schema(
      'Odd',
      JSON.parse('{"__proto__": "string", "constructor": "number", "x": "string"}'),
    );
    const picked = pick(odd, ['__proto__', 'constructor']);
    assert.deepEqual(Object.keys(picked.fields), ['__proto__', 'constructor']);
    assert.equal(picked.check(JSON.parse('{"__proto__": "a", "constructor": 1}')).valid, true);
    assert.deepEqual(Object.keys(omit(odd, ['__proto__']).fields), ['constructor', 'x']);
    unknownField(
      () => pick(Schema.from({ a: 'string' }), ['toString']),
      'No such field in "toString"',
    );
  });

  it('should throw for what is not a struct schema, keys or options', () => {
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

  it('should install the functions as methods of Schema with register()', () => {
    assert.equal(Account.pick, undefined);
    const printed = util.inspect(Account, { depth: 4 });
    register();
    register();
    for (const name of ['pick', 'omit', 'partial', 'required', 'extend', 'keyof']) {
      const descriptor = Object.getOwnPropertyDescriptor(Schema.prototype, name);
      assert.equal(typeof descriptor.value, 'function', name);
      assert.equal(descriptor.enumerable, false, name);
    }
    const patch = Account.omit(['password']).partial();
    assert.equal(patch.check({}).valid, true);
    assert.deepEqual(Object.keys(Account.pick(['login']).required().fields), ['login']);
    assert.deepEqual(Account.keyof().fields.enum.length, 7);
    assert.equal(Account.extend({ x: 'string' }).fields.x.required, true);
    // The methods are not keys of a schema, nor of what it prints.
    assert.equal(Object.keys(Account).includes('pick'), false);
    assert.equal(JSON.stringify(Account).includes('pick'), false);
    assert.equal(util.inspect(Account, { depth: 4 }), printed);
    // A Schema as a field is read as a Schema whatever its prototype has.
    const embedded = new Schema('Outer', { inner: Account.pick(['login']) });
    assert.equal(embedded.check({ inner: { login: 'marcus' } }).valid, true);
  });

  it('should derive a struct of upper-case keys whole, and extend it with more', () => {
    const env = new Schema('Env', {
      DATABASE_URL: 'string',
      PORT: { type: 'number', default: 3000 },
      'DEBUG?': 'boolean',
    });
    for (const picked of both(() => pick(env, ['DATABASE_URL', 'PORT']))) {
      assert.equal(picked.kind, 'struct');
      assert.deepEqual(Object.keys(picked.fields), ['DATABASE_URL', 'PORT']);
      assert.equal(picked.check({ DATABASE_URL: 'x', PORT: 1 }).valid, true);
    }
    assert.deepEqual(Object.keys(omit(env, ['PORT']).fields), ['DATABASE_URL', 'DEBUG']);
    assert.equal(partial(env).check({}).valid, true);
    assert.deepEqual(required(env).check({ DATABASE_URL: 'x', PORT: 1 }).errors, [
      'Field "Env.DEBUG" is required',
    ]);
    assert.deepEqual(keyof(env).fields.enum, ['DATABASE_URL', 'PORT', 'DEBUG']);
    // An extension of capitalized fields is fields; until 3.4.1 it was taken
    // for a kind and refused.
    const extensions = [
      { REDIS_URL: 'string' },
      { PORT: 'integer', REDIS_URL: 'string' },
      { Name: 'string', REDIS_URL: 'string' },
    ];
    for (const extension of extensions) {
      for (const wider of both(() => extend(env, extension))) {
        const keys = Object.keys(wider.fields);
        assert.deepEqual(keys.slice(0, 3), ['DATABASE_URL', 'PORT', 'DEBUG']);
        assert.equal(keys.includes('REDIS_URL'), true);
        assert.deepEqual(wider.check({ DATABASE_URL: 'x', PORT: 1 }).errors.slice(-1), [
          'Field "Env.REDIS_URL" is required',
        ]);
      }
    }
    assert.equal(extend(env, { PORT: 'integer' }).fields.PORT.type, 'integer');
    // A kind is still no field of an extension, whichever kind.
    for (const extension of [{ Settings: { theme: 'dark' }, a: 'string' }, { Struct: {} }]) {
      assert.throws(() => extend(env, extension), {
        code: 'ERR_INVALID_DEFINITION',
        message: 'An extension has fields only; the kind is options.metadata in "Env"',
      });
    }
  });

  it('should accept as the kind of the metadata only a name a definition reads as a kind', () => {
    const env = new Schema('Env', { DATABASE_URL: 'string', PORT: 'number' });
    // The kind is written as the first key of the derived definition; a name
    // that key is not read back as a kind from would make it a field.
    for (const kind of ['dTO', 'DTO', 'api_config', 'x', '', 7, null]) {
      assert.throws(() => pick(env, ['PORT'], { metadata: { kind } }), {
        name: 'SchemaDefinitionError',
        code: 'ERR_INVALID_OPTIONS',
        message: `Metadata "kind" must be the name of a kind, got ${JSON.stringify(kind)}`,
      });
    }
    for (const kind of ['form', 'Form', 'settings', 'http2Server']) {
      const derived = pick(env, ['PORT'], { metadata: { kind } });
      assert.equal(derived.kind, kind.charAt(0).toLowerCase() + kind.slice(1));
      assert.deepEqual(Object.keys(derived.fields), ['PORT']);
    }
  });
});
