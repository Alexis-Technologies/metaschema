/**
 * Valibot: `v.object` ignores unknown keys (and strips them), `v.strictObject`
 * rejects them, and `v.is` gives the verdict alone.
 */
const of = (v, shape, strict) => {
  const entries = {};
  for (const [key, type] of Object.entries(shape)) {
    entries[key] = typeof type === 'object' ? of(v, type, strict) : v[type]();
  }
  return strict ? v.strictObject(entries) : v.object(entries);
};

module.exports = {
  id: 'valibot',
  name: 'Valibot',
  package: 'valibot',
  variant: 'safeParse() · is()',
  load: () => require('valibot'),
  setup: (v, shape) => {
    const loose = of(v, shape, false);
    const strict = of(v, shape, true);
    return {
      parseSafe: (value) => {
        const result = v.safeParse(loose, value);
        return result.success ? result.output : null;
      },
      parseStrict: (value) => {
        const result = v.safeParse(strict, value);
        return result.success ? result.output : null;
      },
      assertLoose: (value) => v.is(loose, value),
      assertStrict: (value) => v.is(strict, value),
      issues: (value) => v.safeParse(strict, value).issues,
      paths: (issues) => issues.map((issue) => issue.path.map((item) => item.key).join('.')),
    };
  },
  builder: (v, shape) => () => {
    const schema = of(v, shape, true);
    return (value) => v.is(schema, value);
  },
};
