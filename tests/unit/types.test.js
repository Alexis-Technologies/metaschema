const { test } = require('node:test');
const assert = require('node:assert');

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

test('Types: prepareTypes', () => {
  const customTypes = typeFactory(types);
  const { datetime, text, json, decimal } = customTypes;
  assert.strictEqual(datetime.metadata.pg, types.datetime.metadata.pg);
  assert.strictEqual(text.metadata.pg, types.text.metadata.pg);
  assert.strictEqual(json.metadata.pg, types.json.metadata.pg);
  assert.strictEqual(decimal.metadata.pg, types.decimal.metadata.pg);
  const { string, number } = customTypes;
  assert.strictEqual(string.metadata.pg, types.string.metadata.pg);
  assert.strictEqual(number.metadata.pg, types.number.metadata.pg);
  assert.strictEqual(TYPES.string.metadata.pg, 'varchar');
});

test('Types: the same table registers twice, a different definition does not', () => {
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
  assert.strictEqual(first.types.money, again.types.money);
  assert.strictEqual(again.types.money.metadata.pg, 'money');
  assert.strictEqual(Schema.from({ h: 'hex' }).check({ h: 'zz' }).valid, false);
  assert.strictEqual(Schema.from({ h: 'hex' }).check({ h: 'ff' }).valid, true);

  const message = 'Type "money" is already registered; only { metadata } may be added';
  assert.throws(() => new Model({ money: { js: 'number' } }, []), {
    name: 'SchemaDefinitionError',
    code: 'ERR_TYPE_REGISTERED',
    message,
  });
  const other = { kind: 'scalar', construct() {}, checkType: () => null };
  assert.throws(() => new Model({ hex: other }, []), { code: 'ERR_TYPE_REGISTERED' });
  assert.throws(() => new Model({ string: { js: 'number' } }, []), { code: 'ERR_TYPE_REGISTERED' });

  const updated = new Model({ money: { metadata: { pg: 'numeric' } } }, []);
  assert.strictEqual(updated.types.money.metadata.pg, 'numeric');
});

test('Types: js must name a registered type, built-in or custom', () => {
  assert.throws(() => new Model({ bad: { js: 'strng' } }, []), {
    name: 'SchemaDefinitionError',
    code: 'ERR_UNKNOWN_JS_TYPE',
    message: 'Unknown js type "strng" for custom type "bad"',
  });
  const table = {
    stamp: { js: 'string', metadata: { pg: 'timestamp' } },
    created: { js: 'stamp', metadata: { pg: 'timestamptz' } },
  };
  const model = new Model(table, [['Event', { Entity: {}, at: 'created' }]]);
  const event = model.entities.get('Event');
  assert.strictEqual(event.fields.at.type, 'created');
  assert.strictEqual(event.check({ at: '2026-10-09' }).valid, true);
  assert.deepStrictEqual(event.check({ at: 1 }).errors, [
    'Field "Event.at" not of expected type: string',
  ]);
  assert.strictEqual(model.types.created.metadata.pg, 'timestamptz');
  assert.strictEqual(model.types.stamp.metadata.pg, 'timestamp');
});
