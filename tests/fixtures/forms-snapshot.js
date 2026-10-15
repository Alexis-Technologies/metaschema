// The schemas whose snapshots `schema-snapshot.json` holds, as text: every
// form 3.4 added to format 1 (bytes, flags, decimals, the tags of bytes, a
// Map and a Set, `root`), a schema that names itself without a model, and
// the entities one schema of a model reaches. snapshot.test.js compares the
// text of `toSnapshot()` with the file, key order included: it is the
// contract a program that reads one schema (protoarray) builds on.
const { Schema, Model } = require('../../index.js');

const listingModel = () =>
  new Model(
    { cents: { js: 'number', metadata: { pg: 'bigint' } } },
    [
      ['Owner', { Entity: {}, name: 'string', 'best?': 'Pet' }],
      [
        'Pet',
        { Struct: {}, name: 'string', 'owner?': { type: 'Owner', embed: true }, 'mate?': 'Pet' },
      ],
      [
        'Listing',
        {
          Entity: { audit: true },
          title: { type: 'string', length: { max: 40 }, pattern: /^\S/u },
          price: { type: 'number', decimals: 2, min: 0 },
          cents: '?cents',
          photo: { type: 'bytes', required: false, default: new Uint8Array([0, 255]) },
          flags: { flags: ['featured', 'sold'], default: { featured: false } },
          tags: { set: 'string', default: new Set(['new']) },
          prices: { map: { string: 'number' }, default: new Map([['eur', 1]]) },
          listed: { type: 'date', default: new Date(0) },
          point: ['number', 'number'],
          pet: 'Pet',
          seller: 'Owner',
          offer: {
            union: [
              { Struct: {}, kind: { enum: ['fixed'] }, amount: 'number' },
              { Struct: {}, kind: { enum: ['auction'] }, ends: 'date' },
            ],
            discriminator: 'kind',
          },
          'related?': { many: 'Listing' },
          byTitle: { index: ['title'] },
        },
      ],
    ],
    null,
    { registry: 'isolated' },
  );

const category = () => new Schema('Category', { name: 'string', 'parent?': 'Category' });

const snapshots = () => ({
  listing: listingModel().entities.get('Listing').toSnapshot(),
  category: category().toSnapshot(),
});

module.exports = { listingModel, category, snapshots };
