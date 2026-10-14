// The `./mongodb` subpath: the schema side of a MongoDB program, without a
// dependency on the driver and without I/O. The BSON types a field may hold
// (`types`, recognized without importing bson), the module of the driver the
// program registers (`register({ bson })`, which also teaches `./coerce` to
// read the BSON types), a record as the database holds it and back
// (`toDocument`, `fromDocument`), the indexes for `createIndexes`
// (`indexesOf`) and the updates of the driver checked and converted
// (`checkUpdate`, `toUpdate`). The collection validator is the mongodb
// target of `toJSONSchema` (`./generators`) with `ids: 'objectId'`.
const { types, register } = require('./bson.js');
const { toDocument, fromDocument, fromDocumentAsync } = require('./document.js');
const { indexesOf } = require('./indexes.js');
const { checkUpdate, toUpdate } = require('./update.js');

module.exports = {
  types,
  register,
  toDocument,
  fromDocument,
  fromDocumentAsync,
  indexesOf,
  checkUpdate,
  toUpdate,
};
