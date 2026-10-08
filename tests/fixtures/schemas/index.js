'use strict';

// The model fixture as one object: `database` and `types` hold the database
// metadata and the custom types, every other key is an entity schema. Keys
// are in file-name order, the order Model received them from the old loader.
module.exports = {
  database: require('./database.js'),
  types: require('./types.js'),
  Aaa: require('./Aaa.js'),
  Account: require('./Account.js'),
  Address: require('./Address.js'),
  Company: require('./Company.js'),
  Identifier: require('./Identifier.js'),
  Signin: require('./Signin.js'),
};
