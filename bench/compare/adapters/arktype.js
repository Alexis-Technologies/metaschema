/**
 * ArkType: an object ignores unknown keys by default, `'+': 'reject'` rejects
 * them at that level (the nested object carries its own). A call returns the
 * value or an `ArkErrors` list; `allows()` gives the verdict alone.
 */
const of = (shape, strict) => {
  const definition = strict ? { '+': 'reject' } : {};
  for (const [key, type] of Object.entries(shape)) {
    definition[key] = typeof type === 'object' ? of(type, strict) : type;
  }
  return definition;
};

module.exports = {
  id: 'arktype',
  name: 'ArkType',
  package: 'arktype',
  variant: 'type(value) · allows()',
  load: () => require('arktype'),
  setup: ({ type, ArkErrors }, shape) => {
    const loose = type(of(shape, false));
    const strict = type(of(shape, true));
    return {
      parseSafe: (value) => {
        const result = loose(value);
        return result instanceof ArkErrors ? null : result;
      },
      parseStrict: (value) => {
        const result = strict(value);
        return result instanceof ArkErrors ? null : result;
      },
      assertLoose: (value) => loose.allows(value),
      assertStrict: (value) => strict.allows(value),
      issues: (value) => strict(value),
      paths: (errors) => errors.map((error) => error.path.join('.')),
    };
  },
  builder: ({ type }, shape) => {
    const definition = of(shape, true);
    return () => {
      const schema = type(definition);
      return (value) => schema.allows(value);
    };
  },
};
