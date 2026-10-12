/**
 * Ajv 8 for JSON Schema draft 2020-12. A validator is generated with
 * `new Function` by `compile()`; `additionalProperties: false` rejects
 * unknown keys. Ajv stops at the first error unless the instance is created
 * with `allErrors: true`, which the issues scenario uses.
 */
const of = (shape, strict) => {
  const properties = {};
  for (const [key, type] of Object.entries(shape)) {
    properties[key] = typeof type === 'object' ? of(type, strict) : { type };
  }
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: !strict,
  };
};

module.exports = {
  id: 'ajv',
  name: 'Ajv',
  package: 'ajv',
  variant: 'compile(…)(value), draft 2020-12',
  load: () => require('ajv/dist/2020').default,
  setup: (Ajv, shape) => {
    const ajv = new Ajv();
    const loose = ajv.compile(of(shape, false));
    const strict = ajv.compile(of(shape, true));
    const every = new Ajv({ allErrors: true }).compile(of(shape, true));
    return {
      parseSafe: (value) => (loose(value) ? value : null),
      parseStrict: (value) => (strict(value) ? value : null),
      assertLoose: (value) => loose(value),
      assertStrict: (value) => strict(value),
      issues: (value) => (every(value) ? [] : every.errors),
      paths: (errors) => errors.map((error) => error.instancePath.slice(1).replaceAll('/', '.')),
    };
  },
  // One instance, as a program has; the compiled schema is removed again so
  // the instance's cache does not grow with every build.
  builder: (Ajv, shape) => {
    const ajv = new Ajv();
    return () => {
      const schema = of(shape, true);
      const validate = ajv.compile(schema);
      ajv.removeSchema(schema);
      return (value) => validate(value);
    };
  },
};
