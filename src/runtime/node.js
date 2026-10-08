'use strict';

const fsp = require('node:fs').promises;

const saveTypes = (outputFile, model) => fsp.writeFile(outputFile, model.dts);

module.exports = { saveTypes };
