/** Every library in the comparison, in the order the tables list them. */
const metaschema = require('./metaschema.js');
const typebox = require('./typebox.js');

const ADAPTERS = [
  metaschema.jit,
  metaschema.closures,
  require('./metarhia.js'),
  require('./zod.js'),
  require('./valibot.js'),
  require('./arktype.js'),
  require('./effect.js'),
  typebox.compiled,
  typebox.interpreted,
  require('./ajv.js'),
  require('./yup.js'),
  require('./joi.js'),
  require('./superstruct.js'),
];

const getAdapter = (id) => {
  const adapter = ADAPTERS.find((candidate) => candidate.id === id);
  if (adapter) return adapter;
  const known = ADAPTERS.map((candidate) => candidate.id).join(', ');
  throw new Error(`unknown adapter "${id}" (known: ${known})`);
};

module.exports = { ADAPTERS, getAdapter };
