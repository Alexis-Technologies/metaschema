// Browser twin of ./node.js: the same interface, mapped in by the package.json
// `browser` field. There is no file system to write to, so it rejects.

const { SchemaUsageError } = require('../errors.js');

const writeFile = () => {
  const message = 'saveTypes is not available in the browser';
  return Promise.reject(new SchemaUsageError('ALX_ERR_UNSUPPORTED_RUNTIME', message));
};

module.exports = { writeFile };
