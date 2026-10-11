/**
 * Metarhia's metaschema 2.2.2, the project @alexify/metaschema was forked
 * from. Its `check` rejects unknown keys and has no option to ignore them, so
 * it takes part in the strict modes only, and it reports issues as strings
 * (`Field "deeplyNested.num" not of expected type: number`).
 */
const definitionOf = (shape) => {
  const definition = { Struct: {} };
  for (const [key, type] of Object.entries(shape)) {
    definition[key] = typeof type === 'object' ? { ...type } : type;
  }
  return definition;
};

const FIELD = /^Field "([^"]*)"/;

module.exports = {
  id: 'metarhia',
  name: 'Metarhia metaschema',
  package: 'metaschema',
  variant: 'check() · strict only',
  load: () => require('metaschema'),
  setup: ({ Schema }, shape) => {
    const schema = Schema.from(definitionOf(shape));
    return {
      parseStrict: (value) => (schema.check(value).valid ? value : null),
      assertStrict: (value) => schema.check(value).valid,
      issues: (value) => schema.check(value).errors,
      paths: (errors) => errors.map((line) => FIELD.exec(line)?.[1] ?? line),
    };
  },
  builder: ({ Schema }, shape) => {
    const definition = definitionOf(shape);
    return () => {
      const schema = Schema.from(definition);
      return (value) => schema.check(value).valid;
    };
  },
};
