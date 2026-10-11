/**
 * Superstruct: `object()` rejects unknown keys, `type()` allows them. A failed
 * `validate()` returns a `StructError` whose `failures()` lists every issue.
 */
const of = (s, shape, strict) => {
  const fields = {};
  for (const [key, type] of Object.entries(shape)) {
    fields[key] = typeof type === 'object' ? of(s, type, strict) : s[type]();
  }
  return strict ? s.object(fields) : s.type(fields);
};

module.exports = {
  id: 'superstruct',
  name: 'Superstruct',
  package: 'superstruct',
  variant: 'validate() · is()',
  load: () => require('superstruct'),
  setup: (s, shape) => {
    const loose = of(s, shape, false);
    const strict = of(s, shape, true);
    const parse = (value, struct) => {
      const [error, result] = s.validate(value, struct);
      return error ? null : result;
    };
    return {
      parseSafe: (value) => parse(value, loose),
      parseStrict: (value) => parse(value, strict),
      assertLoose: (value) => s.is(value, loose),
      assertStrict: (value) => s.is(value, strict),
      issues: (value) => s.validate(value, strict)[0].failures(),
      paths: (failures) => failures.map((failure) => failure.path.join('.')),
    };
  },
  builder: (s, shape) => () => {
    const struct = of(s, shape, true);
    return (value) => s.is(value, struct);
  },
};
