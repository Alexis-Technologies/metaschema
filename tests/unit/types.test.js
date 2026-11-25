const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { Model, Schema } = require('../../index.js');
const { TYPES, typeFactory } = require('../../src/types.js');

const types = {
  string: { metadata: { pg: 'varchar' } },
  number: { metadata: { pg: 'integer' } },
  datetime: { js: 'string', metadata: { pg: 'timestamp with time zone' } },
  text: { js: 'string', metadata: { pg: 'text' } },
  json: { metadata: { pg: 'jsonb' } },
  decimal: {
    metadata: { pg: 'decimal' },
    kind: 'scalar',
    rules: ['length'],
    symbols: '1234567890e.',
    checkType(src, path) {
      if (typeof src !== 'string') {
        return `Field "${path}" not a decimal 1`;
      }
      const arr = src.split('.');
      if (arr.length !== 2) return `Field "${path}" not a decimal 2`;
      const [a, b] = arr;
      const chars = new Set([...a, ...b]);
      for (const char of chars) {
        if (!this.symbols.includes(char)) {
          return `Field "${path}" not a decimal 3`;
        }
      }
      return null;
    },
    construct() {},
  },
};

describe('Types', () => {
  it('should register the metadata of the table with prepareTypes, built-ins included', () => {
    const customTypes = typeFactory(types);
    const { datetime, text, json, decimal } = customTypes;
    assert.equal(datetime.metadata.pg, types.datetime.metadata.pg);
    assert.equal(text.metadata.pg, types.text.metadata.pg);
    assert.equal(json.metadata.pg, types.json.metadata.pg);
    assert.equal(decimal.metadata.pg, types.decimal.metadata.pg);
    const { string, number } = customTypes;
    assert.equal(string.metadata.pg, types.string.metadata.pg);
    assert.equal(number.metadata.pg, types.number.metadata.pg);
    assert.equal(TYPES.string.metadata.pg, 'varchar');
  });

  it('should register the same table twice and refuse a different definition', () => {
    const table = {
      money: { js: 'string', metadata: { pg: 'money' } },
      hex: {
        kind: 'scalar',
        construct() {},
        checkType: (value) => (/^[0-9a-f]+$/.test(value) ? null : 'not hex'),
      },
    };
    const first = new Model(table, []);
    const again = new Model(table, []);
    assert.equal(first.types.money, again.types.money);
    assert.equal(again.types.money.metadata.pg, 'money');
    assert.equal(Schema.from({ h: 'hex' }).check({ h: 'zz' }).valid, false);
    assert.equal(Schema.from({ h: 'hex' }).check({ h: 'ff' }).valid, true);

    const message = 'Type "money" is already registered; only { metadata } may be added';
    assert.throws(() => new Model({ money: { js: 'number' } }, []), {
      name: 'SchemaDefinitionError',
      code: 'ALX_ERR_TYPE_REGISTERED',
      message,
    });
    const other = { kind: 'scalar', construct() {}, checkType: () => null };
    assert.throws(() => new Model({ hex: other }, []), { code: 'ALX_ERR_TYPE_REGISTERED' });
    assert.throws(() => new Model({ string: { js: 'number' } }, []), {
      code: 'ALX_ERR_TYPE_REGISTERED',
    });

    const updated = new Model({ money: { metadata: { pg: 'numeric' } } }, []);
    assert.equal(updated.types.money.metadata.pg, 'numeric');
  });

  it('should refuse a table of its own for bytes and flags, which are built in', () => {
    // What protoarray 1.2 gave a model for the two before they were built in.
    const table = {
      bytes: { kind: 'scalar', construct() {}, checkType: (value) => value instanceof Uint8Array },
      flags: { kind: 'scalar', construct() {}, checkType: () => null },
    };
    for (const name of ['bytes', 'flags']) {
      assert.throws(() => new Model({ [name]: table[name] }, []), {
        code: 'ALX_ERR_TYPE_REGISTERED',
        message: `Type "${name}" is already registered; only { metadata } may be added`,
      });
    }
    const model = new Model({ bytes: { metadata: { pg: 'bytea' } } }, [], null, {
      registry: 'isolated',
    });
    assert.equal(model.types.bytes.metadata.pg, 'bytea');
  });

  it('should require js to name a registered type, built-in or custom', () => {
    assert.throws(() => new Model({ bad: { js: 'strng' } }, []), {
      name: 'SchemaDefinitionError',
      code: 'ALX_ERR_UNKNOWN_JS_TYPE',
      message: 'Unknown js type "strng" for custom type "bad"',
    });
    const table = {
      stamp: { js: 'string', metadata: { pg: 'timestamp' } },
      created: { js: 'stamp', metadata: { pg: 'timestamptz' } },
    };
    const model = new Model(table, [['Event', { Entity: {}, at: 'created' }]]);
    const event = model.entities.get('Event');
    assert.equal(event.fields.at.type, 'created');
    assert.equal(event.check({ at: '2026-10-09' }).valid, true);
    assert.deepEqual(event.check({ at: 1 }).errors, [
      'Field "Event.at" not of expected type: string',
    ]);
    assert.equal(model.types.created.metadata.pg, 'timestamptz');
    assert.equal(model.types.stamp.metadata.pg, 'timestamp');
  });

  it('should follow the alias chain with baseTypeOf to the type a field validates as', () => {
    const { baseTypeOf } = require('../../src/types.js');
    const model = new Model(
      {
        money: { js: 'number' },
        cents: { js: 'money' },
        point: { construct() {}, checkType: () => true },
      },
      [['T', { Struct: {}, a: 'cents', b: 'money', c: 'number', d: 'point', e: 'T' }]],
      null,
      { registry: 'isolated' },
    );
    const { fields } = model.entities.get('T');
    assert.equal(baseTypeOf(fields.a).type, 'number');
    assert.equal(baseTypeOf(fields.b).type, 'number');
    assert.equal(baseTypeOf(fields.c).type, 'number');
    assert.equal(baseTypeOf(fields.c).source, undefined);
    // A custom type with a check of its own ends the chain.
    assert.equal(baseTypeOf(fields.d).type, 'point');
    assert.equal(baseTypeOf(fields.d).source.js, undefined);
    // The class of a reference field is the reference prototype's, whatever
    // entity it names (`field.type` has the name).
    assert.equal(baseTypeOf(fields.e).type, 'reference');
    assert.equal(fields.e.type, 'T');
    // A name the registry cannot resolve ends it where it stands.
    const orphan = Object.create(fields.a, { root: { value: { types: {} } } });
    assert.equal(baseTypeOf(orphan).type, 'cents');
  });

  it('should keep the types of an isolated model to itself', () => {
    const asString = { js: 'string', metadata: { pg: 'text' } };
    const asNumber = { js: 'number', metadata: { pg: 'integer' } };
    const entities = [['Item', { Entity: {}, amount: 'coin' }]];
    const strings = new Model({ coin: asString }, entities, null, { registry: 'isolated' });
    const numbers = new Model({ coin: asNumber }, entities, null, { registry: 'isolated' });
    assert.notEqual(strings.types, numbers.types);
    assert.notEqual(strings.types, TYPES);
    assert.equal(strings.entities.get('Item').check({ amount: '1' }).valid, true);
    assert.equal(strings.entities.get('Item').check({ amount: 1 }).valid, false);
    assert.equal(numbers.entities.get('Item').check({ amount: 1 }).valid, true);
    assert.equal(numbers.entities.get('Item').check({ amount: '1' }).valid, false);
    assert.equal(strings.types.coin.metadata.pg, 'text');
    assert.equal(numbers.types.coin.metadata.pg, 'integer');
    assert.equal(TYPES.coin, undefined);
    assert.throws(() => Schema.from({ amount: 'coin' }), { code: 'ALX_ERR_UNKNOWN_TYPE' });
    assert.equal(Schema.from({ amount: 'coin' }, [numbers]).check({ amount: 2 }).valid, true);
    assert.equal(strings.types.string.metadata.pg, undefined);
    assert.throws(() => new Model({}, [], null, { registry: 'private' }), {
      code: 'ALX_ERR_INVALID_OPTIONS',
      message: 'Model option "registry" must be "shared" or "isolated", got "private"',
    });
  });

  it('should report a custom compile that throws as the error of the type, with the cause', () => {
    // A compile of the type's own runs when the check is first compiled: on
    // the first check on the closures, when the schema is built under the JIT.
    const cause = new TypeError('boom');
    const table = {
      brokenType: {
        construct() {},
        compile: () => {
          throw cause;
        },
      },
    };
    const build = () => new Model(table, [['Broken', { Struct: {}, code: 'brokenType' }]]);
    if (process.env.METASCHEMA_BACKEND === 'jit') {
      assert.throws(build, (error) => {
        assert.equal(error.code, 'ALX_ERR_JIT_BUILD');
        assert.equal(error.cause.code, 'ALX_ERR_INVALID_CUSTOM_TYPE');
        assert.equal(error.cause.cause, cause);
        return true;
      });
      return;
    }
    const broken = build().entities.get('Broken');
    for (let attempt = 0; attempt < 2; attempt += 1) {
      assert.throws(() => broken.check({ code: 'x' }), {
        name: 'SchemaDefinitionError',
        code: 'ALX_ERR_INVALID_CUSTOM_TYPE',
        message: 'Custom type "brokenType" could not compile its check: boom in "Broken"',
        schema: 'Broken',
        cause,
      });
    }
  });

  it('should report a custom checkType that throws as an exception issue', () => {
    const boom = {
      kind: 'scalar',
      construct() {},
      checkType(value) {
        if (value === 'ok') return null;
        throw new Error(`bad ${value}`);
      },
    };
    const model = new Model({ boom }, [['Thing', { Struct: {}, a: 'boom', 'b?': 'boom' }]]);
    const thing = model.entities.get('Thing');
    assert.equal(thing.check({ a: 'ok' }).valid, true);
    assert.equal(thing.check({ a: 'ok', b: null }).valid, true);
    const result = thing.check({ a: 'no', b: 'nope' });
    assert.deepEqual(result.errors, [
      'Field "Thing.a" validation failed Error: bad no',
      'Field "Thing.b" validation failed Error: bad nope',
    ]);
    assert.equal(result.issues[0].code, 'exception');
    assert.ok(result.issues[0].params.error instanceof Error);
    assert.deepEqual(thing.check({ a: 'no', b: 'nope' }, { root: 'Thing', maxErrors: 1 }).errors, [
      'Field "Thing.a" validation failed Error: bad no',
    ]);
  });
});
