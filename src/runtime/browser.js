// Browser twin of ./node.js: the same interface, mapped in by the package.json
// `browser` field. There is no file system to write to, so it rejects.

const saveTypes = () => Promise.reject(new Error('saveTypes is not available in the browser'));

module.exports = { saveTypes };
