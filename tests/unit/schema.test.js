const { test } = require('node:test');
const assert = require('node:assert');
const util = require('node:util');

const { Schema, Model, ValidationResult } = require('../../index.js');

test('Schema: constructor', () => {
  const definition = { field1: 'string' };
  const schema = new Schema('StructName', definition);
  assert.strictEqual(schema.name, 'StructName');
  assert.strictEqual(schema.kind, 'struct');
  assert.strictEqual(schema.scope, 'local');
  assert.strictEqual(schema.store, 'memory');
  assert.strictEqual(schema.allow, 'write');
  assert.strictEqual(typeof schema.fields, 'object');
  assert.strictEqual(typeof schema.indexes, 'object');
  assert.strictEqual(schema.options.validate, null);
  assert.strictEqual(schema.options.format, null);
  assert.strictEqual(schema.options.parse, null);
  assert.strictEqual(schema.options.serialize, null);
  assert.strictEqual(schema.fields.field1.type, 'string');
});

test('Schema: factory', () => {
  const definition = { field1: 'string' };

  const entities = new Map();
  entities.set('Person', { name: 'string' });
  const model = new Model({}, entities);

  const schema = Schema.from(definition, [model]);
  assert.strictEqual(schema.fields.field1.type, 'string');
});

test('Schema: generate ts interface', () => {
  const raw = {
    Dictionary: { scope: 'global' },
    name: { type: 'string', unique: true },
    addresses: { many: 'Address' },
  };

  const expected = `interface Company {
  name: string;
  addressesId: string[];
  companyId?: string;\n}`;

  const schema = new Schema('Company', raw);
  const iface = schema.toInterface();
  assert.strictEqual(iface, expected);
});

test('Schema: namespaces', () => {
  const raw = {
    name: { type: 'string', unique: true },
    addresses: { many: 'Address' },
  };

  const types = {};
  const entities = new Map();
  entities.set('Address', {
    city: 'string',
    street: 'string',
    building: 'string',
  });
  const model = new Model(types, entities);

  const schema = new Schema('Company', raw, [model]);
  assert.deepStrictEqual(schema.namespaces, new Set([model]));
  schema.detach(model);
  assert.deepStrictEqual(schema.namespaces, new Set());
  schema.attach(model);
  assert.deepStrictEqual(schema.namespaces, new Set([model]));
});

test('Schema: check with namespaces', () => {
  const raw = {
    name: { type: 'string', unique: true },
    address: 'Address',
  };

  const entities = new Map();
  entities.set('Address', {
    city: 'string',
    street: 'string',
    building: 'number',
  });
  const model = new Model({}, entities);
  const schema = new Schema('Company', raw, [model]);

  const data1 = {
    name: 'Besarabsky Market',
    address: {
      city: 'Kiev',
      street: 'Besarabskaya Square',
      building: 2,
    },
  };
  assert.strictEqual(schema.check(data1).valid, true);

  const data2 = {
    name: 'Besarabsky Market',
    address: {
      street: 'Besarabskaya Square',
      building: '2',
    },
  };
  assert.strictEqual(schema.check(data2).valid, false);
});

test('Schema: validation function', () => {
  const definition = {
    field: '?string',
    validate: (value, path) => {
      if (value.field) return true;
      if (value.throw) throw new Error(value.throw);
      return `${path}.field is required`;
    },
  };
  const schema = Schema.from(definition);

  assert.strictEqual(
    schema.check({
      field: 'abc',
    }).valid,
    true,
  );

  assert.deepStrictEqual(
    schema.check({
      field2: 'abc',
    }).errors,
    ['Field "" .field is required', 'Field "" has unexpected keys: field2'],
  );

  assert.deepStrictEqual(
    schema.check({
      throw: '42',
    }).errors,
    ['Field "" validation failed Error: 42', 'Field "" has unexpected keys: throw'],
  );
});

test('Schema: validation function simple return', () => {
  const definition = {
    field: '?string',
    validate: (value) => value.field === '42',
  };
  const schema = Schema.from(definition);

  assert.strictEqual(schema.check({ field: '42' }).valid, true);
  assert.deepStrictEqual(schema.check({ field: '43' }).errors, ['Field "" validation error']);
});

test('Schema: nested validation function', () => {
  const definition = {
    field: 'string',
    nested: {
      schema: {
        field: { type: 'string', required: false },
        validate: (value, path) => {
          if (value.field) return true;
          if (value.throw) throw new Error(value.throw);
          return `${path}.field is required`;
        },
      },
      required: false,
    },
  };
  const schema = Schema.from(definition);

  assert.strictEqual(
    schema.check({
      field: 'abc',
    }).valid,
    true,
  );

  assert.deepStrictEqual(
    schema.check({
      field2: 'abc',
    }).errors,
    ['Field "field" is required', 'Field "" has unexpected keys: field2'],
  );

  assert.strictEqual(
    schema.check({
      field: 'abc',
      nested: {
        field: 'abc',
      },
    }).valid,
    true,
  );

  assert.deepStrictEqual(
    schema.check({
      field: 'abc',
      nested: {
        field2: 'abc',
      },
    }).errors,
    ['Field "nested" has unexpected keys: field2', 'Field "nested" nested.field is required'],
  );

  assert.deepStrictEqual(
    schema.check({
      field: 'abc',
      nested: {
        throw: '42',
      },
    }).errors,
    ['Field "nested" has unexpected keys: throw', 'Field "nested" validation failed Error: 42'],
  );
});

test('Schema: calculated', () => {
  const definition = {
    filename: 'string',
    size: 'number',
    compression: {
      size: 'number',
      ratio: (file) => file.compression.size / file.size,
    },
  };
  const obj = {
    filename: 'file.ext',
    size: 54321,
    compression: {
      size: 12345,
    },
  };
  const schema = Schema.from(definition);
  assert.strictEqual(schema.check(obj).valid, true);
});

test('Schema: custom function definition', () => {
  const defs = {
    custom: () => 10,
  };
  const schema = Schema.from(defs);
  assert.strictEqual(schema.fields.custom(), 10);
  assert.strictEqual(schema.check({}).valid, true);
});

test('Schema: reserved fields permitted with Kind except "required"', () => {
  const defs = {
    Struct: {},
    required: 'string',
    type: 'string',
    note: 'string',
  };
  const schema = Schema.from(defs);
  assert.strictEqual(
    schema.check({
      required: 'yes',
      type: 'myType',
      note: 'this is not forbidden anymore',
    }).valid,
    true,
  );
  assert.strictEqual(
    schema.check({
      note: 'this is not forbidden anymore',
    }).valid,
    false,
  );
});

test('Schema: custom validate on field', () => {
  const defs1 = {
    email: {
      type: 'string',
      required: true,
      length: { min: 2, max: 15 },
      validate(src) {
        if (src.indexOf('@') === -1) {
          return 'Not an Email';
        }
        const [, domain] = src.split('@');
        if (domain.length <= 2) return 'Not an Email';
        return null;
      },
    },
  };

  const schema1 = Schema.from(defs1);
  assert.deepStrictEqual(schema1.check({ email: 12345 }).errors, [
    'Field "email" not of expected type: string',
    'Field "email" validation failed TypeError: src.indexOf is not a function',
    'Field "email" exceeds the maximum length',
  ]);
  assert.deepStrictEqual(schema1.check({ email: 'ab' }).errors, ['Field "email" Not an Email']);
  assert.strictEqual(schema1.check({ email: 'asd@asd.com' }).valid, true);
  assert.deepStrictEqual(schema1.check({ email: 'asdasdasdasdasdasd@asd.com' }).errors, [
    'Field "email" exceeds the maximum length',
  ]);
  const defs2 = {
    type: 'number',
    validate(num) {
      if (num !== 10) throw new Error('Not a ten');
    },
  };
  const defs3 = {
    type: 'number',
    validate(num) {
      if (num !== 10) return 'Not a ten';
      return null;
    },
  };
  const defs4 = {
    type: 'number',
    validate(num) {
      if (num !== 10) return ['Not', 'a', 'ten'];
      return null;
    },
  };
  const schema2 = Schema.from(defs2);
  const schema3 = Schema.from(defs3);
  const schema4 = Schema.from(defs4);
  assert.deepStrictEqual(schema2.check(12).errors, ['Field "" validation failed Error: Not a ten']);
  assert.deepStrictEqual(schema3.check(12).errors, ['Field "" Not a ten']);
  assert.deepStrictEqual(schema4.check(12).errors, ['Field "" Not', 'Field "" a', 'Field "" ten']);
  assert.strictEqual(schema2.check(10).valid, true);
  assert.strictEqual(schema3.check(10).valid, true);
  assert.strictEqual(schema4.check(10).valid, true);
  const defs5 = { num: { type: 'number', validate: (num) => num === 10 } };
  const schema5 = Schema.from(defs5);
  assert.strictEqual(schema5.check({ num: 12 }).valid, false);
  assert.strictEqual(schema5.check({ num: 10 }).valid, true);
});

test('Schema: with custom kind', () => {
  const defs = { Custom: {}, type: 'string' };
  const schema = Schema.from(defs);
  assert.strictEqual(schema.kind, 'custom');
  assert.strictEqual(schema.check({ type: 'type' }).valid, true);
});

test('Schema: custom kind metadata', () => {
  const defs = { Custom: { myMetadata: 'data' }, type: 'string' };
  const schema = Schema.from(defs);
  assert.deepStrictEqual(schema.custom, { myMetadata: 'data' });
});

test('Schema: with number field name', () => {
  const schema = Schema.from({
    Dynamic: {},
    field: 'string',
    1234: { type: 'number' },
  });
  assert.strictEqual(schema.kind, 'dynamic');
  assert.strictEqual(schema.check({ 1234: 42, field: 'type' }).valid, true);
});

test('Schema: toString, JSON.stringify', () => {
  const schema = Schema.from({ a: 'string' });
  assert.strictEqual(schema.toString(), '{"a":{"required":true,"type":"string"}}');
  assert.strictEqual(JSON.stringify(schema), '{"a":{"required":true,"type":"string"}}');
});

test('Schema: a validate function may build and return a ValidationResult', () => {
  const schema = Schema.from({
    range: {
      type: 'string',
      validate: (value) => {
        const result = new ValidationResult();
        if (!value.includes('-')) result.add('needs a dash');
        if (value.length > 9) result.add('is too long');
        return result;
      },
    },
  });
  assert.strictEqual(schema.check({ range: '1-2' }).valid, true);
  assert.deepStrictEqual(schema.check({ range: '0123456789' }).errors, [
    'Field "range" needs a dash',
    'Field "range" is too long',
  ]);
  const result = new ValidationResult({ root: 'p' });
  assert.strictEqual(result.valid, true);
  assert.deepStrictEqual(result.errors, []);
  result.add(false).add(['a', 'Field "q" b']).add(null).add(true);
  assert.deepStrictEqual(result.errors, [
    'Field "p" validation error',
    'Field "p" a',
    'Field "q" b',
  ]);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(ValidationResult.isInstance(result), true);
  assert.strictEqual(ValidationResult.isInstance({ issues: [] }), false);
});

test('Schema: a value that refers back to itself is reported, not recursed into', () => {
  const model = new Model({}, [['Category', { Entity: {}, name: 'string', parent: '?Category' }]]);
  const category = model.entities.get('Category');
  const loop = { name: 'root' };
  loop.parent = loop;
  assert.deepStrictEqual(category.check(loop).errors, [
    'Field "Category.parent" is a circular reference',
  ]);
  const chain = { name: 'a', parent: { name: 'b' } };
  chain.parent.parent = chain;
  assert.deepStrictEqual(category.check(chain).errors, [
    'Field "Category.parent.parent" is a circular reference',
  ]);
  const shared = { name: 'leaf' };
  assert.strictEqual(category.check({ name: 'x', parent: shared }).valid, true);

  // A schema without references cannot recurse: a cyclic value is walked as
  // far as the schema goes and reported for what it is.
  const nested = Schema.from({ inner: { x: 'string' } });
  const self = { x: 'ok' };
  self.inner = self;
  assert.deepStrictEqual(nested.check(self).errors, [
    'Field "inner" has unexpected keys: inner',
    'Field "" has unexpected keys: x',
  ]);

  const list = Schema.from({ items: { array: { n: 'number' } } });
  const holder = { n: 1 };
  holder.items = [holder];
  assert.deepStrictEqual(list.check(holder).errors, [
    'Field "items[0]" has unexpected keys: items',
    'Field "" has unexpected keys: n',
  ]);
  const deep = new Model({}, [
    ['Tree', { Entity: {}, items: { array: { node: '?Tree' } } }],
  ]).entities.get('Tree');
  const branch = { items: [] };
  branch.items.push({ node: branch });
  assert.deepStrictEqual(deep.check(branch).errors, [
    'Field "Tree.items[0].node" is a circular reference',
  ]);
  const twice = { n: 2 };
  assert.strictEqual(list.check({ items: [twice, twice] }).valid, true);
  assert.strictEqual(Schema.from(['number', 'number']).check([1, 2]).valid, true);
  assert.strictEqual(Schema.from({ array: 'number' }).check([1, 2]).valid, true);
});

test('Schema: a validator may return more messages than a spread call accepts', () => {
  const messages = Array.from({ length: 200000 }, (_, i) => `m${i}`);
  const schema = Schema.from({ a: { type: 'string', validate: () => messages } });
  const result = schema.check({ a: 'x' });
  assert.strictEqual(result.errors.length, 200000);
  assert.strictEqual(result.errors[0], 'Field "a" m0');
  assert.strictEqual(result.errors[199999], 'Field "a" m199999');
});

test('Schema: input key names are truncated in messages', () => {
  const key = 'k'.repeat(1024 * 1024);
  const struct = Schema.from({ a: 'string' }).check({ a: 'x', [key]: 1 });
  assert.strictEqual(struct.errors.length, 1);
  assert.strictEqual(struct.errors[0], `Field "" has unexpected keys: ${'k'.repeat(100)}...`);
  assert.strictEqual(struct.issues[0].params.keys[0], key);
  const byKey = Schema.from({ o: { object: { string: 'number' } } }).check({ o: { [key]: 'x' } });
  assert.strictEqual(
    byKey.errors[0],
    `Field "o.${'k'.repeat(100)}..." not of expected type: number`,
  );
  const short = Schema.from({ a: 'string' }).check({ a: 'x', [`${'k'.repeat(100)}`]: 1 });
  assert.strictEqual(short.errors[0], `Field "" has unexpected keys: ${'k'.repeat(100)}`);
});

test('Schema: every schema serializes, whatever its definition', () => {
  assert.strictEqual(JSON.stringify(Schema.from('?string')), '{"required":false,"type":"string"}');
  const list = Schema.from({ array: 'number' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(list)), {
    required: true,
    type: 'array',
    value: { required: true, type: 'number' },
  });
  const struct = Schema.from({ name: 'string', tags: { array: 'string' } });
  assert.strictEqual(struct.toString(), JSON.stringify(struct));
  assert.deepStrictEqual(JSON.parse(struct.toString()), {
    name: { required: true, type: 'string' },
    tags: { required: true, type: 'array', value: { required: true, type: 'string' } },
  });
});

test('Schema: a Schema instance is reused and attached to the namespaces it is given', () => {
  const company = new Schema('Company', { Entity: {}, name: 'string' });
  assert.strictEqual(new Schema('Company', company), company);
  assert.strictEqual(Schema.from(company), company);
  assert.throws(() => new Schema('Firm', company), {
    code: 'ERR_INVALID_DEFINITION',
    message: 'Schema "Company" cannot be used as "Firm"',
  });
  const model = new Model({}, [
    ['Company', company],
    ['Person', { Entity: {}, employer: 'Company' }],
  ]);
  assert.strictEqual(model.entities.get('Company'), company);
  assert.ok(company.namespaces.has(model));
  assert.strictEqual(company.findReference('Person'), model.entities.get('Person'));
  assert.deepStrictEqual(model.warnings, []);
  assert.deepStrictEqual([...model.order], ['Company', 'Person']);
});

test('Schema: util.inspect prints the definition, not the graph', () => {
  const user = new Schema('User', {
    name: 'string',
    tags: { array: 'string' },
    address: { city: 'string' },
  });
  const text = util.inspect(user, { depth: 6 });
  assert.ok(text.startsWith('Schema(User) {'), text);
  assert.ok(!text.includes('[Circular'), text);
  assert.ok(!text.includes('root'), text);
  assert.ok(text.includes("type: 'string'"), text);
  assert.ok(util.inspect(Schema.from({ a: 'string' })).startsWith('Schema {'));
  assert.strictEqual(util.inspect(user.fields.name), "{ required: true, type: 'string' }");
});

test('Schema: validate(value, path) runs only the schema-level function', () => {
  const schema = Schema.from({
    field: '?string',
    validate: (value, path) => {
      if (value.throw) throw new Error(value.throw);
      return value.field ? null : `${path} needs a field`;
    },
  });
  assert.strictEqual(schema.validate({ field: 'x' }).valid, true);
  assert.deepStrictEqual(schema.validate({}, 'body').errors, ['Field "" body needs a field']);
  assert.deepStrictEqual(schema.validate({ extra: 1 }).issues, [
    { code: 'custom', path: [], message: ' needs a field', params: {} },
  ]);
  const thrown = schema.validate({ throw: 'boom' });
  assert.deepStrictEqual(thrown.errors, ['Field "" validation failed Error: boom']);
  assert.strictEqual(thrown.issues[0].code, 'exception');
  assert.ok(thrown.issues[0].params.error instanceof Error);
  assert.strictEqual(Schema.from({ field: 'string' }).validate({}), null);
});
