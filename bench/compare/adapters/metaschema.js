/**
 * metaschema itself, twice: `check` on the closures every schema is built
 * with, and the same schema after `compile()` of the `./compile` subpath (the
 * JIT backend). The definition is the shape with the kind marker: the first
 * key of the moltar object is `number`, a type name, so without `Struct: {}`
 * the definition would read as a number field.
 */
const LOOSE = { unknown: 'ignore' };

const definitionOf = (shape) => {
  const definition = { Struct: {} };
  for (const [key, type] of Object.entries(shape)) {
    definition[key] = typeof type === 'object' ? { ...type } : type;
  }
  return definition;
};

const createAdapter = ({ id, variant, jit }) => ({
  id,
  name: 'metaschema',
  package: '@alexify/metaschema',
  variant,
  load: () => {
    const { Schema } = require('../../../index.js');
    const compile = jit ? require('../../../src/compile/index.js').compile : null;
    return { Schema, compile };
  },
  setup: ({ Schema, compile }, shape) => {
    const schema = Schema.from(definitionOf(shape));
    if (compile) compile(schema, { jit: true });
    return {
      parseSafe: (value) => (schema.check(value, LOOSE).valid ? value : null),
      parseStrict: (value) => (schema.check(value).valid ? value : null),
      assertLoose: (value) => schema.check(value, LOOSE).valid,
      assertStrict: (value) => schema.check(value).valid,
      issues: (value) => schema.check(value).issues,
      paths: (issues) => issues.map((issue) => issue.path.join('.')),
    };
  },
  builder: ({ Schema, compile }, shape) => {
    const definition = definitionOf(shape);
    return () => {
      const schema = Schema.from(definition);
      if (compile) compile(schema, { jit: true });
      return (value) => schema.check(value).valid;
    };
  },
});

module.exports = {
  closures: createAdapter({ id: 'metaschema', variant: 'check() · closures', jit: false }),
  jit: createAdapter({ id: 'metaschema-jit', variant: 'check() · compile(), JIT', jit: true }),
};
