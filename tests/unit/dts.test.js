const { test } = require('node:test');
const assert = require('node:assert');

const { Schema, Model } = require('../../index.js');
const { register } = require('../../src/generators/index.js');

register();

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
  // The alias of a schema of one type is the name of its type already.
  assert.strictEqual(
    new Schema('Status', { enum: ['a'] }).toInterface({ named: true }),
    'type Status = "a";',
  );
  assert.strictEqual(
    new Schema('Point', { x: 'number', 'tag?': { enum: ['t'] } }).toInterface({ named: true }),
    'type PointTag = "t";\n\ninterface Point {\n  x: number;\n  tag?: PointTag;\n}',
  );
  assert.strictEqual(new Schema('Status', { enum: ['a'] }).toInterface(), 'type Status = "a";');
  // A Schema instance of one type as a field renders as that type.
  assert.strictEqual(
    Schema.from({ x: { schema: Schema.from('?number') } }).toInterface(),
    'interface  {\n  x: number;\n}',
  );
});

test('dts: keys, comments and names are escaped or refused', () => {
  const schema = new Schema('Odd', {
    'a-b': 'string',
    '1x?': 'number',
    'q"': { type: 'string', description: 'Ends a comment */ export const pwn = 1; /*' },
    multi: { type: 'string', description: 'First line\nSecond line' },
    old: { type: 'string', deprecated: 'use multi' },
    'owner-ref': 'Owner',
    weird: { enum: [NaN, 10n, 'a', null, true] },
  });
  assert.strictEqual(
    schema.toInterface(),
    `interface Odd {
  "a-b": string;
  "1x"?: number;
  /** Ends a comment *\\/ export const pwn = 1; /* */
  "q\\"": string;
  /**
   * First line
   * Second line
   */
  multi: string;
  /** @deprecated use multi */
  old: string;
  "owner-refId": string;
  weird: number | 10n | "a" | null | true;
}`,
  );
  // A nested type takes a clean name; two that would share one are told apart.
  const named = new Schema('User', {
    'a-b': { Struct: {}, x: 'string' },
    aB: { enum: ['x'] },
    AB: { enum: ['y'] },
    e1: { enum: ['p'] },
    E1: { enum: ['q'] },
  });
  assert.strictEqual(
    named.toInterface({ named: true }),
    `interface UserA_b {
  x: string;
}

type UserAB = "x";

type UserAB2 = "y";

type UserE1 = "p";

type UserE12 = "q";

interface User {
  "a-b": UserA_b;
  aB: UserAB;
  AB: UserAB2;
  e1: UserE1;
  E1: UserE12;
}`,
  );
  // Through a model a nested type never takes the name of an entity.
  const model = new Model({}, [
    ['UserRole', { Struct: {}, level: 'number' }],
    ['User', { Struct: {}, role: { enum: ['admin'] }, kind: 'UserRole' }],
  ]);
  assert.strictEqual(
    model.toTypeScript({ named: true }),
    `interface UserRole {
  level: number;
}

type UserRole2 = "admin";

interface User {
  role: UserRole2;
  kind: UserRole;
}
`,
  );
  // An entity whose name is no identifier has no interface.
  const broken = new Model({}, [['A/b', { Struct: {}, x: 'string' }]]);
  assert.throws(() => broken.toTypeScript(), {
    name: 'SchemaDefinitionError',
    code: 'ERR_UNREPRESENTABLE',
    message: 'Entity name "A/b" (not an identifier) cannot be represented in TypeScript',
  });
  // An unresolved reference is an id unless it embeds, where it is the name.
  assert.strictEqual(Schema.from({ r: 'A/b' }).toInterface(), 'interface  {\n  rId: string;\n}');
  assert.throws(() => Schema.from({ r: { type: 'A/b', embed: true } }).toInterface(), {
    code: 'ERR_UNREPRESENTABLE',
  });
});
