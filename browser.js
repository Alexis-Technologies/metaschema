// Intentionally mirrors index.js: bundlers resolve this file through the
// package.json `browser` field and `exports` condition, and the same map swaps
// src/runtime/node.js for src/runtime/browser.js. Do not deduplicate.
module.exports = require('./src/index.js');
