const fsp = require('node:fs').promises;

// The one file-system call of the package, behind `saveTypes` of the
// `./generators` subpath. The text goes to a file of its own beside the
// target, then takes the target's place by a rename, which is atomic within
// a directory: a reader (`tsc --watch`, an editor) never sees half a
// declaration file, and a write that fails leaves the old file as it was.
// `wx` refuses a temporary name that exists; the counter keeps the names of
// two writes of one process apart.
let written = 0;

const writeFile = async (outputFile, text) => {
  written += 1;
  const temporary = `${outputFile}.${process.pid}.${written}.tmp`;
  try {
    await fsp.writeFile(temporary, text, { flag: 'wx' });
    await fsp.rename(temporary, outputFile);
  } catch (error) {
    await fsp.rm(temporary, { force: true });
    throw error;
  }
};

module.exports = { writeFile };
