const { test } = require('node:test');
const assert = require('node:assert');

const { Schema, Model } = require('../../index.js');

test('dts: the description of a field is its JSDoc, deprecated is a tag', () => {
  const schema = new Schema('User', {
    login: { type: 'string', description: 'The login name' },
    old: { type: 'string', deprecated: true, required: false },
    legacy: { type: 'number', description: 'Replaced by login', deprecated: true },
    'nick?': { type: 'string', deprecated: false, title: 'Nick' },
    plain: 'boolean',
  });
  assert.strictEqual(
    schema.toInterface(),
    `interface User {
  /** The login name */
  login: string;
  /** @deprecated */
  old?: string;
  /**
   * Replaced by login
   * @deprecated
   */
  legacy: number;
  nick?: string;
  plain: boolean;
}`,
  );
  // An inline struct has no room for JSDoc, and no calculated field.
  const nested = Schema.from({
    part: { a: { type: 'string', description: 'A' }, double: (value) => value.a + value.a },
  });
  assert.strictEqual(nested.toInterface(), 'interface  {\n  part: { a: string };\n}');
  assert.strictEqual(nested.toInterface({ named: true }).includes('/** A */'), true);
});

test('dts: named types for enums and nested structs', () => {
  const types = { datetime: { js: 'string' } };
  const entities = [
    ['Owner', { Entity: {}, name: 'string' }],
    [
      'Doc',
      {
        Entity: {},
        status: { enum: ['open', 'done'], description: 'The state' },
        levels: { array: { enum: [1, 2] } },
        byName: { object: { string: { enum: ['x'] } } },
        address: {
          city: 'string',
          'zip?': 'string',
          geo: { lat: 'number', lon: { type: 'number', deprecated: true } },
        },
        'extra?': { schema: { note: 'string' } },
        owner: 'Owner',
        pair: [{ enum: ['a'] }, 'number'],
        either: { union: [{ enum: ['x'] }, { n: 'number' }] },
        created: 'datetime',
      },
    ],
  ];
  const model = new Model(types, entities);
  const expected = `interface Owner {
  name: string;
  ownerId?: string;
}

type DocStatus = "open" | "done";

type DocLevels = 1 | 2;

type DocByName = "x";

interface DocAddressGeo {
  lat: number;
  /** @deprecated */
  lon: number;
}

interface DocAddress {
  city: string;
  zip?: string;
  geo: DocAddressGeo;
}

interface DocExtra {
  note: string;
}

type DocPair0 = "a";

type DocEither0 = "x";

interface DocEither1 {
  n: number;
}

interface Doc {
  /** The state */
  status: DocStatus;
  levels: DocLevels[];
  byName: Record<string, DocByName>;
  address: DocAddress;
  extra?: DocExtra;
  ownerId: string;
  pair: [DocPair0, number];
  either: DocEither0 | DocEither1;
  created: string;
  docId?: string;
}
`;
  assert.strictEqual(model.toTypeScript({ named: true }), expected);
  // Without the option nothing is named, and dts is the same rendering.
  assert.strictEqual(model.toTypeScript(), model.dts);
  assert.strictEqual(model.toTypeScript({}), model.dts);
  assert.strictEqual(model.toTypeScript({ named: false }), model.dts);
  assert.strictEqual(
    model.dts.includes(
      '  address: { city: string; zip?: string; geo: { lat: number; lon: number } };',
    ),
    true,
  );
  assert.strictEqual(model.dts.includes('DocStatus'), false);
  // The entities of a model render the same through toInterface.
  assert.strictEqual(
    model.entities.get('Doc').toInterface({ named: true }),
    expected.slice(expected.indexOf('type DocStatus'), -1),
  );
});

test('dts: named types outside a model, and a schema of one type', () => {
  assert.strictEqual(
    Schema.from({ status: { enum: ['a', 'b'] } }).toInterface({ named: true }),
    'type Status = "a" | "b";\n\ninterface  {\n  status: Status;\n}',
  );
  assert.strictEqual(
    new Schema('Pair', ['number', { enum: ['q'] }]).toInterface({ named: true }),
    'type Pair1 = "q";\n\ntype Pair = [number, Pair1];',
  );
  assert.strictEqual(
    new Schema('Status', { enum: ['a'] }).toInterface({ named: true }),
    'type Status = "a";\n\ntype Status = Status;',
  );
  assert.strictEqual(new Schema('Status', { enum: ['a'] }).toInterface(), 'type Status = "a";');
  // A Schema instance of one type as a field renders as that type.
  assert.strictEqual(
    Schema.from({ x: { schema: Schema.from('?number') } }).toInterface(),
    'interface  {\n  x: number;\n}',
  );
});
