/**
 * Yup with `strict: true`, so a value is validated as it is rather than cast
 * first (`'1'` would otherwise become a number). An object allows unknown
 * keys, `noUnknown()` rejects them at its level; the issues scenario passes
 * `abortEarly: false` (Yup stops at the first error by default), and the
 * synchronous validation reports a failure by throwing a `ValidationError`.
 */
const of = (yup, shape, strict) => {
  const fields = {};
  for (const [key, type] of Object.entries(shape)) {
    fields[key] = typeof type === 'object' ? of(yup, type, strict) : yup[type]().required();
  }
  const schema = yup.object(fields).required();
  return strict ? schema.noUnknown() : schema;
};

const OPTIONS = { strict: true };
const ALL = { strict: true, abortEarly: false };

module.exports = {
  id: 'yup',
  name: 'Yup',
  package: 'yup',
  variant: 'validateSync() · isValidSync(), strict',
  load: () => require('yup'),
  setup: (yup, shape) => {
    const loose = of(yup, shape, false);
    const strict = of(yup, shape, true);
    const parse = (schema, value) => {
      try {
        return schema.validateSync(value, OPTIONS);
      } catch {
        return null;
      }
    };
    return {
      parseSafe: (value) => parse(loose, value),
      parseStrict: (value) => parse(strict, value),
      assertLoose: (value) => loose.isValidSync(value, OPTIONS),
      assertStrict: (value) => strict.isValidSync(value, OPTIONS),
      issues: (value) => {
        try {
          strict.validateSync(value, ALL);
          return [];
        } catch (error) {
          return error.inner;
        }
      },
      paths: (errors) => errors.map((error) => error.path),
    };
  },
  builder: (yup, shape) => () => {
    const schema = of(yup, shape, true);
    return (value) => schema.isValidSync(value, OPTIONS);
  },
};
