/**
 * Joi with `convert: false`, so a value is validated as it is rather than
 * converted first. An object rejects unknown keys by default and
 * `allowUnknown: true` allows them at every level; a number outside the safe
 * integer range fails unless the field is `unsafe()`, which the moltar value
 * (`Number.MAX_VALUE`) needs. Joi stops at the first error unless
 * `abortEarly: false`.
 */
const of = (Joi, shape) => {
  const keys = {};
  for (const [key, type] of Object.entries(shape)) {
    if (typeof type === 'object') keys[key] = of(Joi, type);
    else if (type === 'number') keys[key] = Joi.number().unsafe().required();
    else keys[key] = Joi[type]().required();
  }
  return Joi.object(keys).required();
};

const STRICT = { convert: false };
const LOOSE = { convert: false, allowUnknown: true };
const ALL = { convert: false, abortEarly: false };

module.exports = {
  id: 'joi',
  name: 'Joi',
  package: 'joi',
  variant: 'validate(), convert: false',
  load: () => require('joi'),
  setup: (Joi, shape) => {
    const schema = of(Joi, shape);
    const parse = (value, options) => {
      const result = schema.validate(value, options);
      return result.error ? null : result.value;
    };
    return {
      parseSafe: (value) => parse(value, LOOSE),
      parseStrict: (value) => parse(value, STRICT),
      assertLoose: (value) => !schema.validate(value, LOOSE).error,
      assertStrict: (value) => !schema.validate(value, STRICT).error,
      issues: (value) => schema.validate(value, ALL).error.details,
      paths: (details) => details.map((detail) => detail.path.join('.')),
    };
  },
  builder: (Joi, shape) => () => {
    const schema = of(Joi, shape);
    return (value) => !schema.validate(value, STRICT).error;
  },
};
