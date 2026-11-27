const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { Schema } = require('../../index.js');

describe('Database', () => {
  it('should build the schema of a Registry with its indexes and relations', () => {
    const raw = {
      Registry: {},

      name: { type: 'string', unique: true },
      street: 'string',
      building: 'string',
      apartment: 'string',
      location: {
        country: 'Country',
      },
      persons: { many: 'Person' },

      naturalKey: { primary: ['street', 'building', 'apartment'] },
      altKey: { unique: ['name', 'street'] },
    };

    const expected = {
      kind: 'registry',
      scope: 'application',
      store: 'persistent',
      allow: 'write',
      parent: '',
      indexes: {
        persons: { many: 'Person' },
        naturalKey: { primary: ['street', 'building', 'apartment'] },
        altKey: { unique: ['name', 'street'] },
      },
      options: { validate: null, format: null, parse: null, serialize: null },
      references: new Set(['string', 'Country', 'schema', 'Person']),
      relations: new Set([
        { to: 'Country', type: 'many-to-one' },
        { to: 'Person', type: 'one-to-many' },
      ]),
      fields: {
        name: { unique: true, required: true, type: 'string' },
        street: { required: true, type: 'string' },
        building: { required: true, type: 'string' },
        apartment: { required: true, type: 'string' },
        location: {
          country: { one: 'Country', required: true, type: 'Country' },
        },
        persons: { many: 'Person', required: true, type: 'Person' },
        addressId: { required: true, type: 'string' },
      },
      name: 'Address',
      namespaces: new Set(),
    };

    const entity = new Schema('Address', raw);
    assert.equal(entity.name, expected.name);
    assert.equal(entity.kind, expected.kind);
    assert.equal(entity.store, expected.store);
    assert.deepEqual(Object.keys(entity.fields), Object.keys(expected.fields));
    assert.deepEqual(Object.keys(entity.indexes), Object.keys(expected.indexes));
    assert.deepEqual(entity.references, expected.references);
    assert.deepEqual(entity.relations, expected.relations);

    const warn = entity.checkConsistency();
    const countryWarning =
      'Warning [missing-reference]: "Country" referenced by "Address" is not found';
    const personWarning =
      'Warning [missing-reference]: "Person" referenced by "Address" is not found';
    const expectedWarnings = [countryWarning, personWarning];
    assert.deepEqual(warn, expectedWarnings);
  });
});
