const fsp = require('node:fs').promises;

const saveTypes = (outputFile, model, options) =>
  fsp.writeFile(outputFile, model.toTypeScript(options));

module.exports = { saveTypes };
