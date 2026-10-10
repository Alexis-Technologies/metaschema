import { expectAssignable, expectError, expectNotAssignable, expectType } from 'tsd';
import { Model, Schema } from '../../index.js';
import type { Infer, InferEntity, InferSchema } from '../../index.js';

// Custom types are known to `Infer` through module augmentation; a type name
// that is neither built in nor declared here infers as unknown.
declare module '../../index.js' {
  interface CustomTypes {
    datetime: string;
    decimal: string;
  }
}

// `infer(definition)` is `Infer<typeof definition>` with the literal types an
// inline definition keeps, the way `Schema.from(definition)` sees it.
declare const infer: <const D extends string | object>(definition: D) => Infer<D>;

declare const as: <T>() => T;

// Scalars
expectType<string>(infer('string'));
expectType<number>(infer('number'));
expectType<number>(infer('integer'));
expectType<bigint>(infer('bigint'));
expectType<boolean>(infer('boolean'));
expectType<Date>(infer('date'));
expectType<null>(infer('null'));
expectType<any>(infer('any'));
expectType<unknown>(infer('unknown'));
expectType<unknown>(infer('json'));
expectType<string>(infer('datetime'));
expectType<unknown>(infer('timestamp'));

// Optional and nullable
expectType<number | null | undefined>(infer('?number'));
expectType<string | null>(infer({ type: 'string', nullable: true }));
expectType<string | null | undefined>(infer({ type: 'string', required: false }));
expectType<string | null | undefined>(infer({ type: '?string' }));
expectType<string | null | undefined>(infer({ type: '?string', nullable: true }));
expectType<string>(infer({ type: 'string', length: { min: 3, max: 32 }, unique: true }));
expectType<number>(infer({ type: 'integer', min: 0, max: 10, default: 0 }));
expectType<string>(infer({ type: 'datetime', index: true }));
expectType<string | null>(infer({ type: 'decimal', nullable: true }));
expectType<unknown>(infer('ip'));

// Collections
expectType<number[]>(infer({ array: 'number' }));
expectType<number[][]>(infer({ array: { array: 'number' } }));
expectType<number[][][][]>(infer({ array: { array: { array: { array: 'number' } } } }));
expectType<(string | null | undefined)[]>(infer({ array: '?string' }));
expectType<string[]>(infer({ type: 'array', array: 'string', length: 3 }));
expectType<string[]>(infer({ type: 'array', value: 'string' }));
expectType<string[] | null | undefined>(infer({ array: 'string', required: false }));
expectType<string[] | null>(infer({ array: 'string', nullable: true }));
expectType<Set<number>>(infer({ set: 'number' }));
expectType<Set<{ x: number }>>(infer({ set: { x: 'number' } }));
expectType<Record<string, number>>(infer({ object: { string: 'number' } }));
expectType<Record<number, boolean>>(infer({ object: { number: 'boolean' } }));
expectType<Record<string, boolean>>(infer({ type: 'object', key: 'string', value: 'boolean' }));
expectType<Map<string, string>>(infer({ map: { string: 'string' } }));
expectType<Map<number, string[]>>(infer({ map: { number: { array: 'string' } } }));
expectType<Map<string, boolean>>(infer({ type: 'map', key: 'string', value: 'boolean' }));
expectType<({ city: string } | null | undefined)[]>(
  infer({ array: { type: 'schema', schema: { city: 'string' }, required: false } }),
);
expectType<({ city: string } | null)[]>(
  infer({ array: { schema: { city: 'string' }, nullable: true } }),
);

// Enum: the values are literal types when the definition keeps them
expectType<'admin' | 'user'>(infer({ enum: ['admin', 'user'] }));
expectType<1 | 2 | 3>(infer({ type: 'enum', enum: [1, 2, 3] }));
expectType<'a' | null | undefined>(infer({ enum: ['a'], required: false }));
const widened = { enum: ['admin', 'user'] };
expectType<string>(as<Infer<typeof widened>>());
const kept = { enum: ['admin', 'user'] } as const;
expectType<'admin' | 'user'>(as<Infer<typeof kept>>());

// Tuples: any element, named scalar elements, optional elements
expectType<[string, number]>(infer(['string', 'number']));
expectType<[string, number | null | undefined]>(infer(['string', '?number']));
expectType<[number, number | null | undefined]>(infer([{ x: 'number' }, { 'y?': 'number' }]));
expectType<[string | null | undefined]>(infer([{ at: '?datetime' }]));
expectType<[{ x: number; y: number }]>(infer([{ x: 'number', y: 'number' }]));
expectType<[{ x: number }]>(infer([{ schema: { x: 'number' } }]));
expectType<[string, number[], 'a' | 'b']>(
  infer(['string', { array: 'number' }, { enum: ['a', 'b'] }]),
);
expectType<[string, [number, number]]>(infer(['string', ['number', 'number']]));
expectType<[string, string[]]>(infer([{ one: 'Company' }, { many: 'Address' }]));
expectType<[string, number]>(infer({ tuple: ['string', 'number'] }));
expectType<[string, number]>(infer({ type: 'tuple', tuple: ['string', 'number'] }));
expectType<[string, number]>(infer({ type: 'tuple', value: ['string', 'number'] }));
expectType<[string, number] | null | undefined>(
  infer({ tuple: ['string', 'number'], required: false }),
);

// Structs
expectType<{ name: string; age?: number | null | undefined }>(
  infer({ name: 'string', age: '?number' }),
);
expectType<{ name: string; tags?: string[] | null | undefined }>(
  infer({ name: 'string', 'tags?': { array: 'string' } }),
);
expectType<{ parent: string | null; nick?: string | null | undefined }>(
  infer({ parent: { type: 'string', nullable: true }, 'nick?': 'string' }),
);
expectType<{ size?: number | null | undefined; bio?: string | null | undefined }>(
  infer({ size: { type: 'number', required: false }, bio: { type: '?string' } }),
);
expectType<{
  name: { first: string; last: string; third?: string | null | undefined };
  address: { city: string; street: string };
}>(
  infer({
    name: { first: 'string', last: 'string', third: '?string' },
    address: { city: 'string', street: 'string' },
  }),
);
expectType<{ a: { b: { c: { d: { e: { f: string; g: number[][] } } } } } }>(
  infer({ a: { b: { c: { d: { e: { f: 'string', g: { array: { array: 'number' } } } } } } } }),
);
expectType<{}>(infer({}));
expectType<{ x: number } | null | undefined>(infer({ schema: { x: 'number' }, required: false }));
expectType<{ x: number } | null>(
  infer({ type: 'schema', schema: { x: 'number' }, nullable: true }),
);
expectType<{ part: { type: 'cpu' | 'ram'; name: string } }>(
  infer({ part: { schema: { type: { enum: ['cpu', 'ram'] }, name: 'string' } } }),
);
expectType<{ type: 'cpu' | 'ram'; name: string }>(
  infer({ Struct: {}, type: { enum: ['cpu', 'ram'] }, name: 'string' }),
);
expectType<{ map: Map<string, string>; name: string }>(
  infer({ Struct: {}, map: { map: { string: 'string' } }, name: 'string' }),
);
expectType<{ date: Date; place: string }>(
  infer({ Struct: { unknown: 'ignore' }, date: 'date', place: 'string' }),
);
// Without a kind the keys say what the object is: `type` is the long form,
// a collection key its shorthand, so these need the kind above.
expectType<string>(infer({ name: 'string', type: 'string' }));
expectType<Map<string, string>>(infer({ map: { string: 'string' }, name: 'string' }));
// A custom alias of `schema` in the long form
expectType<{ city: string }>(infer({ type: 'address', schema: { city: 'string' } }));

// A Schema instance as a field, or as the definition
const fullName = Schema.from({ first: 'string', last: 'string' });
expectType<{
  name: { first: string; last: string };
  nickname?: { first: string; last: string } | null | undefined;
  alias?: { first: string; last: string } | null | undefined;
}>(infer({ name: fullName, 'nickname?': fullName, alias: { schema: fullName, required: false } }));
expectType<{ first: string; last: string }>(as<Infer<typeof fullName>>());

// Unions
expectType<string | number>(infer({ union: ['string', 'number'] }));
expectType<string | number | null | undefined>(
  infer({ union: ['string', 'number'], required: false }),
);
expectType<string | number>(infer({ type: 'union', union: ['string', 'number'] }));
expectType<string[] | number[]>(infer({ union: [{ array: 'string' }, { array: 'number' }] }));
expectType<{ kind: 'circle'; r: number } | { kind: 'square' | 'rect'; side: number }>(
  infer({
    union: [
      { kind: { enum: ['circle'] }, r: 'number' },
      { kind: { enum: ['square', 'rect'] }, side: 'number' },
    ],
    discriminator: 'kind',
  }),
);
expectType<string | { first: string; last: string }>(infer({ union: ['Company', fullName] }));

// References without a model: the storage view, an id as `check` accepts
expectType<string>(infer('Company'));
expectType<string | null | undefined>(infer('?Company'));
expectType<string>(infer({ one: 'Company' }));
expectType<string[]>(infer({ many: 'Address' }));
expectType<string>(infer({ type: 'Company' }));
expectType<string | null | undefined>(infer({ type: 'Company', required: false }));
expectType<string | null>(infer({ type: 'Company', nullable: true }));
expectType<string[]>(infer({ type: 'many', many: 'Address' }));
expectType<string>(infer({ type: 'one', one: 'Address' }));
expectType<string[] | null | undefined>(infer({ many: 'Address', required: false }));
// An embedded record is unknown until the entity map says what it is
expectType<unknown>(infer({ type: 'Company', embed: true }));
expectType<unknown[]>(infer({ many: 'Address', embed: true }));
expectType<string>(infer({ one: 'Company', embed: false }));
expectType<{ company: string; addresses: string[] }>(
  infer({ company: 'Company', addresses: { many: 'Address' } }),
);

// Kinds, indexes, calculated fields and schema options are not fields
expectType<{ name: string }>(
  infer({
    Entity: {},
    name: 'string',
    naturalKey: { unique: ['name'] },
    validate: (value: unknown) => typeof value === 'object',
  }),
);
expectType<{ city: string; street?: string | null | undefined }>(
  infer({
    Entity: {},
    city: 'string',
    street: '?string',
    byStreet: { index: ['street'] },
    key: { primary: ['city'] },
  }),
);
expectType<{ size: number; compressed: number }>(
  infer({
    size: 'number',
    compressed: 'number',
    ratio: (file: { size: number; compressed: number }) => file.compressed / file.size,
  }),
);
expectType<{ name: string }>(
  infer({
    Registry: { scope: 'global' },
    name: 'string',
    parse: (value: string) => value,
    serialize: (value: unknown) => String(value),
    format: (value: unknown) => value,
  }),
);
expectType<{ name: string }>(infer({ Audit: {}, name: 'string' }));
expectType<{ name: string; size?: number | null | undefined }>(
  infer({ Form: { unknown: 'ignore' }, name: { type: 'string', unique: true }, 'size?': 'number' }),
);

// Values: what is and is not assignable
expectAssignable<Infer<{ name: 'string'; age: '?number' }>>({ name: 'Marcus' });
expectAssignable<Infer<{ name: 'string'; age: '?number' }>>({ name: 'Marcus', age: null });
expectAssignable<Infer<{ name: 'string'; age: '?number' }>>({ name: 'Marcus', age: undefined });
expectAssignable<Infer<{ parent: { type: 'string'; nullable: true } }>>({ parent: null });
expectNotAssignable<Infer<{ parent: { type: 'string'; nullable: true } }>>({});
expectNotAssignable<Infer<{ name: 'string' }>>({ name: 1 });
expectNotAssignable<Infer<{ name: 'string' }>>({});
expectNotAssignable<Infer<{ name: 'string'; 'age?': 'number' }>>({ name: 'x', age: 'y' });
expectNotAssignable<Infer<{ role: { enum: readonly ['admin'] } }>>({ role: 'root' });
expectNotAssignable<Infer<readonly ['string', 'number']>>(['a', 'b']);
expectNotAssignable<Infer<readonly ['string', 'number']>>(['a', 1, 2]);
expectNotAssignable<Infer<{ ids: { set: 'number' } }>>({ ids: [1, 2] });
expectNotAssignable<Infer<{ company: 'Company' }>>({ company: { name: 'Acme' } });
type Shape = Infer<{
  union: readonly [
    { kind: { enum: readonly ['circle'] }; r: 'number' },
    { kind: { enum: readonly ['square'] }; side: 'number' },
  ];
  discriminator: 'kind';
}>;
expectAssignable<Shape>({ kind: 'circle', r: 1 });
expectNotAssignable<Shape>({ kind: 'circle', side: 1 });
expectNotAssignable<Shape>({ kind: 'line' });

// Schema<D>: the definition is kept as a type, with its literal types
const user = Schema.from({ name: 'string', age: '?number', role: { enum: ['admin', 'user'] } });
expectType<
  Schema<{
    readonly name: 'string';
    readonly age: '?number';
    readonly role: { readonly enum: readonly ['admin', 'user'] };
  }>
>(user);
type User = InferSchema<typeof user>;
expectType<{ name: string; age?: number | null | undefined; role: 'admin' | 'user' }>(as<User>());
expectAssignable<User>({ name: 'Marcus', role: 'admin' });
expectNotAssignable<User>({ name: 'Marcus', role: 'root' });
const named = new Schema('User', { name: 'string', point: ['number', 'number'] });
expectType<Schema<{ readonly name: 'string'; readonly point: readonly ['number', 'number'] }>>(
  named,
);
expectType<{ name: string; point: [number, number] }>(as<InferSchema<typeof named>>());
const scalar = Schema.from('?string');
expectType<Schema<'?string'>>(scalar);
expectType<string | null | undefined>(as<InferSchema<typeof scalar>>());
const pair = Schema.from(['string', 'number']);
expectType<Schema<readonly ['string', 'number']>>(pair);
expectType<[string, number]>(as<InferSchema<typeof pair>>());
const reused = Schema.from(user);
expectType<User>(as<InferSchema<typeof reused>>());
expectType<User>(as<Infer<typeof user>>());
// A Schema<D> is a Schema; a bare Schema infers nothing
expectAssignable<Schema>(user);
expectType<Schema | null>(user.findReference('Company'));
expectType<unknown>(as<InferSchema<Schema>>());
expectType<never>(as<InferSchema<string>>());
expectError(Schema.from(42));
expectError(new Schema('Answer', 42));
// A definition declared on its own widens its literals unless it is `as const`
const apart = { name: 'string', tags: { array: 'string' } };
expectType<{ name: unknown; tags: unknown[] }>(as<Infer<typeof apart>>());
expectType<{ name: unknown; tags: unknown[] }>(as<InferSchema<Schema<typeof apart>>>());
const constant = { name: 'string', tags: { array: 'string' } } as const;
expectType<{ name: string; tags: string[] }>(as<Infer<typeof constant>>());

// An entity map: tests/fixtures/schemas, as the const object the JS modules
// would be in TypeScript (a JS module widens its literals).
const entities = {
  Aaa: { Projection: { schema: 'Account', fields: ['login', 'password'] } },
  Account: {
    Registry: {},
    login: { type: 'string', unique: true },
    password: 'string',
    blocked: { type: 'boolean', default: false },
    company: 'Company',
    fullName: {
      given: { type: 'string', required: false },
      middle: { type: 'string', required: false },
      surname: { type: 'string', required: false },
    },
    birth: {
      Struct: {},
      date: { type: 'string', required: false },
      place: { type: 'string', required: false },
    },
    addresses: { many: 'Address' },
  },
  Address: {
    Entity: {},
    city: 'string',
    street: '?string',
    building: '?string',
    naturalKey: { unique: ['city', 'street', 'building'] },
  },
  Company: {
    Registry: {},
    name: { type: 'string', unique: true },
    parent: { type: 'Company', required: false },
  },
  Identifier: {
    Registry: { scope: 'global' },
    storage: { enum: ['master', 'cache', 'backup', 'replica'], index: true },
    status: { enum: ['prealloc', 'init', 'actual', 'historical'], index: true },
    creation: 'datetime',
    change: 'datetime',
    lock: { type: 'boolean', default: false },
    version: { type: 'number', default: 0 },
    hashsum: 'string',
  },
  Signin: { Projection: { schema: 'Account', fields: ['login', 'password'] } },
} as const;
type Entities = typeof entities;

type Account = InferEntity<Entities, 'Account'>;
expectType<{
  login: string;
  password: string;
  blocked: boolean;
  company: string;
  fullName: {
    given?: string | null | undefined;
    middle?: string | null | undefined;
    surname?: string | null | undefined;
  };
  birth: { date?: string | null | undefined; place?: string | null | undefined };
  addresses: string[];
  accountId?: string | undefined;
}>(as<Account>());
expectType<{ login: string; password: string }>(as<InferEntity<Entities, 'Signin'>>());
expectType<{ login: string; password: string }>(as<Infer<Entities['Aaa'], Entities>>());
expectType<{ name: string; parent?: string | null | undefined; companyId?: string | undefined }>(
  as<InferEntity<Entities, 'Company'>>(),
);
// The stored kinds of the map are ids; an entity the map does not have too
expectType<string>(as<Infer<'Company', Entities>>());
expectType<string[]>(as<Infer<{ many: 'Address' }, Entities>>());
expectType<string>(as<Infer<'Nope', Entities>>());
expectType<unknown>(as<Infer<{ type: 'Nope'; embed: true }, Entities>>());
expectType<unknown>(as<Infer<Entities['Aaa']>>());

// The interfaces model.dts renders for the same entities: the dts names a
// stored reference after its column (`companyId`) where `check` and `Infer`
// keep the field (`company`), and leaves `null` out of an optional field,
// so an entity without references is interchangeable and one with optional
// fields is assignable from its dts interface.
interface IdentifierDts {
  storage: 'master' | 'cache' | 'backup' | 'replica';
  status: 'prealloc' | 'init' | 'actual' | 'historical';
  creation: string;
  change: string;
  lock: boolean;
  version: number;
  hashsum: string;
  identifierId?: string;
}
interface AddressDts {
  city: string;
  street?: string;
  building?: string;
  addressId?: string;
}
expectAssignable<IdentifierDts>(as<InferEntity<Entities, 'Identifier'>>());
expectAssignable<InferEntity<Entities, 'Identifier'>>(as<IdentifierDts>());
expectAssignable<InferEntity<Entities, 'Address'>>(as<AddressDts>());
expectNotAssignable<AddressDts>(as<InferEntity<Entities, 'Address'>>());

// Memory kinds are embedded, by their kind or by `embed`, recursively
const graph = {
  Tag: { Struct: {}, label: 'string', parent: '?Tag' },
  Point: { x: 'number', y: 'number' },
  Pinned: { Struct: { store: 'persistent' }, v: 'number' },
  Shape: {
    Form: {},
    kind: { enum: ['dot'] },
    at: 'Point',
    tags: { many: 'Tag' },
    pinned: 'Pinned',
    former: { many: 'Pinned', embed: true },
  },
  Audit: { Entity: { store: 'memory' }, who: 'string' },
  Log: {
    Entity: {},
    audit: 'Audit',
    shape: { type: 'Shape', embed: false },
    tags: { many: 'Tag' },
  },
  Company: new Schema('Company', { Registry: {}, name: 'string' }),
  Person: { employer: 'Company', home: fullName },
} as const;
type Graph = typeof graph;
type Tag = Infer<'Tag', Graph>;
const tag: Tag = { label: 'a', parent: { label: 'b', parent: null } };
expectType<{ label: string; parent?: Tag | null | undefined }>(tag);
expectType<{
  kind: 'dot';
  at: { x: number; y: number };
  tags: Tag[];
  pinned: string;
  former: { v: number }[];
}>(as<Infer<Graph['Shape'], Graph>>());
expectType<{ who: string }>(as<Infer<'Audit', Graph>>());
expectType<{ audit: { who: string }; shape: string; tags: Tag[]; logId?: string | undefined }>(
  as<InferEntity<Graph, 'Log'>>(),
);
expectType<{ v: number; pinnedId?: string | undefined }>(as<InferEntity<Graph, 'Pinned'>>());
expectType<{ x: number; y: number }>(as<InferEntity<Graph, 'Point'>>());
expectType<{ name: string; companyId?: string | undefined }>(as<InferEntity<Graph, 'Company'>>());
expectType<{ employer: string; home: { first: string; last: string } }>(
  as<Infer<Graph['Person'], Graph>>(),
);

// A model's entities are bare schemas: the entity map is the typed source
const model = new Model({}, new Map(Object.entries(entities)));
expectType<Schema | undefined>(model.entities.get('Account'));
expectType<unknown>(as<InferSchema<NonNullable<ReturnType<typeof model.entities.get>>>>());

// The examples of docs/guide/typescript.md (and README), as written there
const docUser = Schema.from({
  name: 'string',
  age: '?number',
  role: { enum: ['admin', 'user'] },
  tags: { array: 'string' },
  address: { city: 'string', 'street?': 'string' },
  point: ['number', 'number'],
});
type DocUser = InferSchema<typeof docUser>;
expectType<{
  name: string;
  age?: number | null | undefined;
  role: 'admin' | 'user';
  tags: string[];
  address: { city: string; street?: string | null | undefined };
  point: [number, number];
}>(as<DocUser>());
const definition = { name: 'string', role: { enum: ['admin', 'user'] } } as const;
expectType<{ name: string; role: 'admin' | 'user' }>(as<Infer<typeof definition>>());
const part = Schema.from({ Struct: {}, type: { enum: ['cpu', 'ram'] }, name: 'string' });
expectType<{ type: 'cpu' | 'ram'; name: string }>(as<InferSchema<typeof part>>());
const payment = Schema.from({ amount: 'decimal', createdAt: 'datetime', clientIp: '?ip' });
expectType<{ amount: string; createdAt: string; clientIp?: unknown }>(
  as<InferSchema<typeof payment>>(),
);
const docEntities = {
  Company: { Registry: {}, name: 'string' },
  Tag: { Struct: {}, label: 'string', parent: '?Tag' },
  Person: { Entity: {}, name: 'string', employer: 'Company', tags: { many: 'Tag' } },
} as const;
type DocTag = Infer<'Tag', typeof docEntities>;
expectType<{ label: string; parent?: DocTag | null | undefined }>(as<DocTag>());
type DocPerson = InferEntity<typeof docEntities, 'Person'>;
expectType<{ name: string; employer: string; tags: DocTag[]; personId?: string }>(as<DocPerson>());
expectType<Model>(new Model({}, new Map(Object.entries(docEntities))));
