// A definition of every form of the language, as a function so that every
// call builds fresh objects (the default factory, the validators): read by
// definition.test.js in its own process and in a child that has the
// definition entry alone.
module.exports = () => ({
  Entity: { unknown: 'ignore' },
  name: { type: 'string', length: { min: 1, max: 8 }, pattern: '^[a-z]+$' },
  price: { type: 'number', decimals: 2, min: 0 },
  count: { type: 'integer', max: 10 },
  big: { type: 'bigint', min: 1n },
  data: '?bytes',
  perms: { flags: ['read', 'write'] },
  role: { enum: ['a', 'b'] },
  ids: { set: 'string' },
  byId: { map: { number: 'boolean' } },
  scores: { object: { string: 'number' } },
  point: [{ x: 'number' }, { 'y?': 'string' }],
  shape: { union: [{ Struct: {}, kind: { enum: ['a'] } }], discriminator: 'kind' },
  either: { union: ['string', 'number'] },
  when: { type: 'date', default: () => new Date() },
  inner: { a: 'string', validate: () => true },
  'note?': { type: 'string', nullable: true, aliases: ['comment'] },
  parent: '?Doc',
  ratio: (value) => value.count / 2,
  byName: { index: ['name'] },
});
