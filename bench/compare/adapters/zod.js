/**
 * Zod 4, its classic API: `z.object` ignores unknown keys (and strips them),
 * `z.strictObject` rejects them.
 */
const of = (z, shape, strict) => {
  const fields = {};
  for (const [key, type] of Object.entries(shape)) {
    fields[key] = typeof type === 'object' ? of(z, type, strict) : z[type]();
  }
  return strict ? z.strictObject(fields) : z.object(fields);
};

module.exports = {
  id: 'zod',
  name: 'Zod',
  package: 'zod',
  variant: 'safeParse()',
  load: () => require('zod').z,
  setup: (z, shape) => {
    const loose = of(z, shape, false);
    const strict = of(z, shape, true);
    return {
      parseSafe: (value) => {
        const result = loose.safeParse(value);
        return result.success ? result.data : null;
      },
      parseStrict: (value) => {
        const result = strict.safeParse(value);
        return result.success ? result.data : null;
      },
      assertLoose: (value) => loose.safeParse(value).success,
      assertStrict: (value) => strict.safeParse(value).success,
      issues: (value) => strict.safeParse(value).error.issues,
      paths: (issues) => issues.map((issue) => issue.path.join('.')),
    };
  },
  builder: (z, shape) => () => {
    const schema = of(z, shape, true);
    return (value) => schema.safeParse(value).success;
  },
};
