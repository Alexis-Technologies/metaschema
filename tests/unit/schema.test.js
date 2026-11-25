const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const util = require('node:util');

const { Schema, Model, ValidationResult } = require('../../index.js');
const { register } = require('../../src/generators/index.js');
const { idFieldOf } = require('../../src/kinds.js');

register();

describe('Schema', () => {
  it('should name the id field a stored kind adds with idFieldOf', () => {
    assert.equal(idFieldOf(new Schema('Order', { Entity: {}, a: 'string' })), 'orderId');
    assert.equal(idFieldOf(new Schema('Company', { Registry: {}, a: 'string' })), 'companyId');
    assert.equal(idFieldOf(Schema.from({ Entity: {}, a: 'string' })), 'id');
    assert.equal(idFieldOf(new Schema('Form', { Form: {}, a: 'string' })), null);
    assert.equal(idFieldOf(Schema.from({ a: 'string' })), null);
    assert.equal(idFieldOf(Schema.from('string')), null);
    // The field the rule names is the one the schema has.
    const order = new Schema('Order', { Entity: {}, a: 'string' });
    assert.equal(order.fields[idFieldOf(order)].type, 'string');
  });

  it('should build a schema with the constructor', () => {
    const definition = { field1: 'string' };
    const schema = new Schema('StructName', definition);
    assert.equal(schema.name, 'StructName');
    assert.equal(schema.kind, 'struct');
    assert.equal(schema.scope, 'local');
    assert.equal(schema.store, 'memory');
    assert.equal(schema.allow, 'write');
    assert.equal(typeof schema.fields, 'object');
    assert.equal(typeof schema.indexes, 'object');
    assert.equal(schema.options.validate, null);
    assert.equal(schema.options.format, null);
    assert.equal(schema.options.parse, null);
    assert.equal(schema.options.serialize, null);
    assert.equal(schema.fields.field1.type, 'string');
  });

  it('should build a schema with the factory', () => {
    const definition = { field1: 'string' };

    const entities = new Map();
    entities.set('Person', { name: 'string' });
    const model = new Model({}, entities);

    const schema = Schema.from(definition, [model]);
    assert.equal(schema.fields.field1.type, 'string');
  });

  it('should generate a ts interface', () => {
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
    assert.equal(iface, expected);
  });

  it('should attach and detach namespaces', () => {
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
    assert.deepEqual(schema.namespaces, new Set([model]));
    schema.detach(model);
    assert.deepEqual(schema.namespaces, new Set());
    schema.attach(model);
    assert.deepEqual(schema.namespaces, new Set([model]));
  });

  it('should check with namespaces', () => {
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
    assert.equal(schema.check(data1).valid, true);

    const data2 = {
      name: 'Besarabsky Market',
      address: {
        street: 'Besarabskaya Square',
        building: '2',
      },
    };
    assert.equal(schema.check(data2).valid, false);
  });

  it('should run the validation function', () => {
    const definition = {
      field: '?string',
      throw: '?string',
      validate: (value, path) => {
        if (value.field) return true;
        if (value.throw) throw new Error(value.throw);
        return `${path}.field is required`;
      },
    };
    const schema = Schema.from(definition);

    assert.equal(
      schema.check({
        field: 'abc',
      }).valid,
      true,
    );

    assert.deepEqual(schema.check({}).errors, ['Field "" .field is required']);

    assert.deepEqual(
      schema.check({
        throw: '42',
      }).errors,
      ['Field "" validation failed Error: 42'],
    );

    // The schema-level validate runs only on a value whose fields all passed.
    assert.deepEqual(
      schema.check({
        field2: 'abc',
      }).errors,
      ['Field "" has unexpected keys: field2'],
    );
    assert.deepEqual(schema.check({ field: 1 }).errors, [
      'Field "field" not of expected type: string',
    ]);
  });

  it('should read a simple return of the validation function', () => {
    const definition = {
      field: '?string',
      validate: (value) => value.field === '42',
    };
    const schema = Schema.from(definition);

    assert.equal(schema.check({ field: '42' }).valid, true);
    assert.deepEqual(schema.check({ field: '43' }).errors, ['Field "" validation error']);
  });

  it('should run a nested validation function', () => {
    const definition = {
      field: 'string',
      nested: {
        schema: {
          field: { type: 'string', required: false },
          throw: '?string',
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

    assert.equal(
      schema.check({
        field: 'abc',
      }).valid,
      true,
    );

    assert.deepEqual(
      schema.check({
        field2: 'abc',
      }).errors,
      ['Field "field" is required', 'Field "" has unexpected keys: field2'],
    );

    assert.equal(
      schema.check({
        field: 'abc',
        nested: {
          field: 'abc',
        },
      }).valid,
      true,
    );

    assert.deepEqual(
      schema.check({
        field: 'abc',
        nested: {},
      }).errors,
      ['Field "nested" nested.field is required'],
    );

    assert.deepEqual(
      schema.check({
        field: 'abc',
        nested: {
          throw: '42',
        },
      }).errors,
      ['Field "nested" validation failed Error: 42'],
    );

    // A nested validate runs only when the nested value's fields all passed.
    assert.deepEqual(
      schema.check({
        field: 'abc',
        nested: {
          field2: 'abc',
        },
      }).errors,
      ['Field "nested" has unexpected keys: field2'],
    );
  });

  it('should check a struct with a calculated field', () => {
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
    assert.equal(schema.check(obj).valid, true);
  });

  it('should keep a custom function definition as a field', () => {
    const defs = {
      custom: () => 10,
    };
    const schema = Schema.from(defs);
    assert.equal(schema.fields.custom(), 10);
    assert.equal(schema.check({}).valid, true);
  });

  it('should accept fields named like reserved keys under a kind, and require them', () => {
    const defs = {
      Struct: {},
      required: 'string',
      type: 'string',
      note: 'string',
    };
    const schema = Schema.from(defs);
    assert.equal(
      schema.check({
        required: 'yes',
        type: 'myType',
        note: 'this is not forbidden anymore',
      }).valid,
      true,
    );
    assert.equal(
      schema.check({
        note: 'this is not forbidden anymore',
      }).valid,
      false,
    );
  });

  it('should run a custom validate on a field', () => {
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
    // A type failure cancels the rules and the validate function of the field.
    assert.deepEqual(schema1.check({ email: 12345 }).errors, [
      'Field "email" not of expected type: string',
    ]);
    assert.deepEqual(schema1.check({ email: 'ab' }).errors, ['Field "email" Not an Email']);
    assert.equal(schema1.check({ email: 'asd@asd.com' }).valid, true);
    assert.deepEqual(schema1.check({ email: 'asdasdasdasdasdasd@asd.com' }).errors, [
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
    assert.deepEqual(schema2.check(12).errors, ['Field "" validation failed Error: Not a ten']);
    assert.deepEqual(schema3.check(12).errors, ['Field "" Not a ten']);
    assert.deepEqual(schema4.check(12).errors, ['Field "" Not', 'Field "" a', 'Field "" ten']);
    assert.equal(schema2.check(10).valid, true);
    assert.equal(schema3.check(10).valid, true);
    assert.equal(schema4.check(10).valid, true);
    const defs5 = { num: { type: 'number', validate: (num) => num === 10 } };
    const schema5 = Schema.from(defs5);
    assert.equal(schema5.check({ num: 12 }).valid, false);
    assert.equal(schema5.check({ num: 10 }).valid, true);
  });

  it('should build a schema with a custom kind', () => {
    const defs = { Custom: {}, type: 'string' };
    const schema = Schema.from(defs);
    assert.equal(schema.kind, 'custom');
    assert.equal(schema.check({ type: 'type' }).valid, true);
  });

  it('should keep the custom kind metadata', () => {
    const defs = { Custom: { myMetadata: 'data' }, type: 'string' };
    const schema = Schema.from(defs);
    assert.deepEqual(schema.custom, { myMetadata: 'data' });
  });

  it('should check a schema with a number field name', () => {
    const schema = Schema.from({
      Dynamic: {},
      field: 'string',
      1234: { type: 'number' },
    });
    assert.equal(schema.kind, 'dynamic');
    assert.equal(schema.check({ 1234: 42, field: 'type' }).valid, true);
  });

  it('should render the definition with toString and JSON.stringify', () => {
    const schema = Schema.from({ a: 'string' });
    assert.equal(schema.toString(), '{"a":{"required":true,"type":"string"}}');
    assert.equal(JSON.stringify(schema), '{"a":{"required":true,"type":"string"}}');
  });

  it('should accept a ValidationResult that a validate function builds and returns', () => {
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
    assert.equal(schema.check({ range: '1-2' }).valid, true);
    assert.deepEqual(schema.check({ range: '0123456789' }).errors, [
      'Field "range" needs a dash',
      'Field "range" is too long',
    ]);
    const result = new ValidationResult({ root: 'p' });
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
    result.add(false).add(['a', 'Field "q" b']).add(null).add(true);
    assert.deepEqual(result.errors, ['Field "p" validation error', 'Field "p" a', 'Field "q" b']);
    assert.equal(result.valid, false);
    assert.equal(ValidationResult.isInstance(result), true);
    assert.equal(ValidationResult.isInstance({ issues: [] }), false);
  });

  it('should report a value that refers back to itself, not recurse into it', () => {
    const model = new Model({}, [
      ['Category', { Struct: {}, name: 'string', parent: '?Category' }],
    ]);
    const category = model.entities.get('Category');
    const loop = { name: 'root' };
    loop.parent = loop;
    assert.deepEqual(category.check(loop).errors, [
      'Field "Category.parent" is a circular reference',
    ]);
    const chain = { name: 'a', parent: { name: 'b' } };
    chain.parent.parent = chain;
    assert.deepEqual(category.check(chain).errors, [
      'Field "Category.parent.parent" is a circular reference',
    ]);
    const shared = { name: 'leaf' };
    assert.equal(category.check({ name: 'x', parent: shared }).valid, true);

    // A schema without references cannot recurse: a cyclic value is walked as
    // far as the schema goes and reported for what it is.
    const nested = Schema.from({ inner: { x: 'string' } });
    const self = { x: 'ok' };
    self.inner = self;
    assert.deepEqual(nested.check(self).errors, [
      'Field "inner" has unexpected keys: inner',
      'Field "" has unexpected keys: x',
    ]);

    const list = Schema.from({ items: { array: { n: 'number' } } });
    const holder = { n: 1 };
    holder.items = [holder];
    assert.deepEqual(list.check(holder).errors, [
      'Field "items[0]" has unexpected keys: items',
      'Field "" has unexpected keys: n',
    ]);
    const deep = new Model({}, [
      ['Tree', { Struct: {}, items: { array: { node: '?Tree' } } }],
    ]).entities.get('Tree');
    const branch = { items: [] };
    branch.items.push({ node: branch });
    assert.deepEqual(deep.check(branch).errors, [
      'Field "Tree.items[0].node" is a circular reference',
    ]);
    const twice = { n: 2 };
    assert.equal(list.check({ items: [twice, twice] }).valid, true);
    assert.equal(Schema.from(['number', 'number']).check([1, 2]).valid, true);
    assert.equal(Schema.from({ array: 'number' }).check([1, 2]).valid, true);
  });

  it('should accept more messages from a validator than a spread call accepts', () => {
    const messages = Array.from({ length: 200000 }, (_, i) => `m${i}`);
    const schema = Schema.from({ a: { type: 'string', validate: () => messages } });
    const result = schema.check({ a: 'x' });
    assert.equal(result.errors.length, 200000);
    assert.equal(result.errors[0], 'Field "a" m0');
    assert.equal(result.errors[199999], 'Field "a" m199999');
  });

  it('should truncate input key names in messages', () => {
    const key = 'k'.repeat(1024 * 1024);
    const struct = Schema.from({ a: 'string' }).check({ a: 'x', [key]: 1 });
    assert.equal(struct.errors.length, 1);
    assert.equal(struct.errors[0], `Field "" has unexpected keys: ${'k'.repeat(100)}...`);
    assert.equal(struct.issues[0].params.keys[0], key);
    const byKey = Schema.from({ o: { object: { string: 'number' } } }).check({ o: { [key]: 'x' } });
    assert.equal(byKey.errors[0], `Field "o.${'k'.repeat(100)}..." not of expected type: number`);
    const short = Schema.from({ a: 'string' }).check({ a: 'x', [`${'k'.repeat(100)}`]: 1 });
    assert.equal(short.errors[0], `Field "" has unexpected keys: ${'k'.repeat(100)}`);
  });

  it('should serialize every schema, whatever its definition', () => {
    assert.equal(JSON.stringify(Schema.from('?string')), '{"required":false,"type":"string"}');
    const list = Schema.from({ array: 'number' });
    assert.deepEqual(JSON.parse(JSON.stringify(list)), {
      required: true,
      type: 'array',
      value: { required: true, type: 'number' },
    });
    const struct = Schema.from({ name: 'string', tags: { array: 'string' } });
    assert.equal(struct.toString(), JSON.stringify(struct));
    assert.deepEqual(JSON.parse(struct.toString()), {
      name: { required: true, type: 'string' },
      tags: { required: true, type: 'array', value: { required: true, type: 'string' } },
    });
  });

  it('should reuse a Schema instance and attach it to the namespaces it is given', () => {
    const company = new Schema('Company', { Entity: {}, name: 'string' });
    assert.equal(new Schema('Company', company), company);
    assert.equal(Schema.from(company), company);
    assert.throws(() => new Schema('Firm', company), {
      code: 'ERR_INVALID_DEFINITION',
      message: 'Schema "Company" cannot be used as "Firm"',
    });
    const model = new Model({}, [
      ['Company', company],
      ['Person', { Entity: {}, employer: 'Company' }],
    ]);
    assert.equal(model.entities.get('Company'), company);
    assert.ok(company.namespaces.has(model));
    assert.equal(company.findReference('Person'), model.entities.get('Person'));
    assert.deepEqual(model.warnings, []);
    assert.deepEqual([...model.order], ['Company', 'Person']);
  });

  it('should print the definition with util.inspect, not the graph', () => {
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
    assert.equal(util.inspect(user.fields.name), "{ required: true, type: 'string' }");
  });

  it('should run only the schema-level function in validate(value, path)', () => {
    const schema = Schema.from({
      field: '?string',
      validate: (value, path) => {
        if (value.throw) throw new Error(value.throw);
        return value.field ? null : `${path} needs a field`;
      },
    });
    assert.equal(schema.validate({ field: 'x' }).valid, true);
    assert.deepEqual(schema.validate({}, 'body').errors, ['Field "" body needs a field']);
    assert.deepEqual(schema.validate({ extra: 1 }).issues, [
      { code: 'custom', path: [], message: ' needs a field', params: {} },
    ]);
    const thrown = schema.validate({ throw: 'boom' });
    assert.deepEqual(thrown.errors, ['Field "" validation failed Error: boom']);
    assert.equal(thrown.issues[0].code, 'exception');
    assert.ok(thrown.issues[0].params.error instanceof Error);
    assert.equal(Schema.from({ field: 'string' }).validate({}), null);
  });

  it('should accept an index or an option called like a method, a metadata key called like anything', () => {
    // `indexes` and `options` are dictionaries, not instances with methods.
    const schema = new Schema('Table', {
      Entity: {},
      a: 'string',
      extract: { index: ['a'] },
      constructor: { unique: ['a'] },
    });
    assert.deepEqual(Object.keys(schema.indexes), ['extract', 'constructor']);
    assert.equal(schema.check({ a: 'x' }).valid, true);
    assert.equal(Object.getPrototypeOf(schema.indexes), null);
    assert.deepEqual(Object.keys(schema.options), ['validate', 'format', 'parse', 'serialize']);
    // The metadata of a type is a dictionary: `__proto__` is a key of it.
    const PROTO = '__proto__';
    const model = new Model({ string: { metadata: { [PROTO]: { polluted: true } } } }, []);
    assert.equal(Object.hasOwn(model.types.string.metadata, PROTO), true);
    assert.equal({}.polluted, undefined);
  });

  it('should run the schema-level validate on the schema, and never return a promise', () => {
    const schema = new Schema('Doc', {
      Struct: {},
      a: 'string',
      validate(value, path) {
        return this.name === 'Doc' && path === 'body' ? null : 'wrong this or path';
      },
    });
    assert.equal(schema.validate({ a: 'x' }, 'body').valid, true);
    assert.equal(schema.check({ a: 'x' }).valid, false);
    const async = Schema.from({ a: 'string', validate: async () => true });
    assert.throws(() => async.validate({ a: 'x' }), { code: 'ERR_ASYNC_VALIDATOR' });
  });

  it('should report a thrown null or symbol as an exception in the validate method', () => {
    const nullish = new Schema('S', {
      Struct: {},
      a: 'string',
      validate() {
        // oxlint-disable-next-line no-throw-literal
        throw null;
      },
    });
    assert.deepEqual(nullish.validate({ a: 'x' }).errors, ['Field "" validation failed null']);
    const symbolic = new Schema('S', {
      Struct: {},
      a: 'string',
      validate() {
        throw Symbol('s');
      },
    });
    assert.deepEqual(symbolic.validate({ a: 'x' }).errors, [
      'Field "" validation failed Symbol(s)',
    ]);
  });
});
