const fsp = require('node:fs').promises;

// The one file-system call of the package, behind `saveTypes` of the
// `./generators` subpath.
const writeFile = (outputFile, text) => fsp.writeFile(outputFile, text);

module.exports = { writeFile };
