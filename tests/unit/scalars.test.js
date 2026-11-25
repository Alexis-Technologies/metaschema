const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { Schema, Model } = require('../../index.js');

describe('Scalars', () => {
  it('should set the kind of a scalar schema to scalar', () => {
    const schema = Schema.from('string');
    assert.equal(schema.kind, 'scalar');
  });

  it('should check a nested struct of the schema shorthand', () => {
    const definition = {
      field1: {
        n: { type: 'number', default: 100 },
        c: { type: 'string', shorthand: true },
      },
    };
    const schema = Schema.from(definition);

    const obj1 = { field1: 'value' };
    assert.equal(schema.check(obj1).valid, false);

    const obj2 = { field1: 1 };
    assert.equal(schema.check(obj2).valid, false);

    const obj3 = { field1: { n: 1, c: 'value' } };
    assert.equal(schema.check(obj3).valid, true);
  });

  it('should check the required shorthand of a schema in both forms', () => {
    const definition1 = { name: '?string' };
    const schema1 = Schema.from(definition1);

    const definition2 = { name: { type: '?string' } };
    const schema2 = Schema.from(definition2);

    const obj1 = { name: 'value' };
    assert.equal(schema1.check(obj1).valid, true);
    assert.equal(schema2.check(obj1).valid, true);

    const obj2 = {};
    assert.equal(schema1.check(obj2).valid, true);
    assert.equal(schema2.check(obj2).valid, true);

    const obj3 = { name: 100 };
    assert.equal(schema1.check(obj3).valid, false);
    assert.equal(schema2.check(obj3).valid, false);
  });

  it('should check a scalar', () => {
    const def1 = { type: 'string' };
    const schema1 = Schema.from(def1);
    assert.equal(schema1.check('value').valid, true);
    assert.equal(schema1.check(1917).valid, false);
    assert.equal(schema1.check(true).valid, false);
    assert.equal(schema1.check({}).valid, false);

    const def2 = 'string';
    const schema2 = Schema.from(def2);
    assert.equal(schema2.check('value').valid, true);
    assert.equal(schema2.check(1917).valid, false);
    assert.equal(schema2.check(true).valid, false);
    assert.equal(schema2.check({}).valid, false);
  });

  it('should check an enum', () => {
    const definition = { field: { enum: ['uno', 'due', 'tre'] } };
    const schema = Schema.from(definition);
    assert.equal(schema.check({ field: 'uno' }).valid, true);
    assert.equal(schema.check({ field: 'due' }).valid, true);
    assert.equal(schema.check({ field: 'tre' }).valid, true);
    assert.equal(schema.check({ field: 'quatro' }).valid, false);
    assert.equal(schema.check({ field: 100 }).valid, false);
    assert.equal(schema.check({}).valid, false);

    const def1 = { field: { enum: ['uno', 'due', 'tre'], required: false } };
    const schema1 = Schema.from(def1);
    assert.equal(schema1.check({ field: 'uno' }).valid, true);

    const def2 = { field: { enum: ['uno', 'due', 'tre'], required: false } };
    const schema2 = Schema.from(def2);
    assert.equal(schema2.check({ field: 'quatro' }).valid, false);

    const def3 = { field: { enum: ['uno', 'due', 'tre'], required: false } };
    const schema3 = Schema.from(def3);
    assert.equal(schema3.check({}).valid, true);

    const def4 = { field: { array: 'number', required: false } };
    const schema4 = Schema.from(def4);
    assert.equal(schema4.check({ field: [1, 2, 3] }).valid, true);

    const def5 = { field: { array: 'number', required: false } };
    const schema5 = Schema.from(def5);
    assert.equal(schema5.check({ field: ['uno', 2, 3] }).valid, false);

    const def6 = { field: { array: 'number', required: false } };
    const schema6 = Schema.from(def6);
    assert.equal(schema6.check({}).valid, true);
  });

  it('should check an enum as the value of a schema', () => {
    const def1 = { enum: ['uno', 'due', 'tre'] };
    const schema1 = Schema.from(def1);
    assert.equal(schema1.check('uno').valid, true);
    assert.equal(schema1.check('due').valid, true);
    assert.equal(schema1.check('tre').valid, true);
    assert.equal(schema1.check('quatro').valid, false);
    assert.equal(schema1.check(100).valid, false);

    const def2 = { enum: ['uno', 'due', 'tre'], required: false };
    const schema2 = Schema.from(def2);
    assert.equal(schema2.check('uno').valid, true);
    assert.equal(schema2.check('due').valid, true);
    assert.equal(schema2.check('tre').valid, true);
    assert.equal(schema2.check('quatro').valid, false);
    assert.equal(schema2.check(100).valid, false);
  });

  it('should check a null value', () => {
    const def = {
      field1: { type: 'string', required: false },
      field2: 'string',
      field3: '?string',
    };
    const schema = Schema.from(def);
    const obj1 = { field1: null, field2: 'uno', field3: null };
    assert.equal(schema.check(obj1).valid, true);

    const obj2 = { field1: 'due', field2: null };
    assert.equal(schema.check(obj2).valid, false);
  });

  it('should require a non-empty list of values for the enum type', () => {
    const message = `Type "enum" needs a list of values: { type: 'enum', enum: [...] } in "e"`;
    for (const definition of [{ e: 'enum' }, { e: { type: 'enum' } }, { e: { enum: [] } }]) {
      assert.throws(() => Schema.from(definition), {
        name: 'SchemaDefinitionError',
        code: 'ERR_INVALID_ENUM',
        message,
      });
    }
    const status = { js: 'enum' };
    const task = { Struct: {}, state: { type: 'status', enum: ['open', 'done'] } };
    const model = new Model({ status }, [['Task', task]]);
    assert.equal(model.entities.get('Task').fields.state.type, 'status');
    assert.equal(model.entities.get('Task').check({ state: 'open' }).valid, true);
    assert.equal(model.entities.get('Task').check({ state: 'late' }).valid, false);
    assert.throws(
      () => new Model({ status }, [['Job', { Struct: {}, state: { type: 'status' } }]]),
      {
        code: 'ERR_INVALID_ENUM',
        message: `Type "status" needs a list of values: { type: 'status', enum: [...] } in "Job.state"`,
      },
    );
  });

  it('should check a large enum through a Set', () => {
    const values = Array.from({ length: 12 }, (_, index) => `v${index}`);
    const schema = Schema.from({ 'state?': { enum: values } });
    assert.equal(schema.check({ state: 'v11' }).valid, true);
    assert.equal(schema.check({ state: null }).valid, true);
    assert.equal(schema.check({}).valid, true);
    assert.deepEqual(schema.check({ state: 'v12' }).issues, [
      {
        code: 'enum',
        path: ['state'],
        message: `value is not of enum: ${values.join(', ')}`,
        params: { values },
      },
    ]);
    assert.equal(schema.fields.state.enum, values);
    const required = Schema.from({ state: { enum: values } });
    assert.deepEqual(required.check({ state: null }).errors, [
      `Field "state" value is not of enum: ${values.join(', ')}`,
    ]);
    const numbers = Schema.from({ n: { enum: [1, 2, 3, 4, 5, 6, 7, 8, 9, NaN] } });
    assert.equal(numbers.check({ n: NaN }).valid, true);
    assert.equal(numbers.check({ n: '1' }).valid, false);
  });
});
