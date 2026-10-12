/**
 * Effect 4's `effect/Schema`. A struct drops unknown keys when it decodes and
 * rejects them with `onExcessProperty: 'error'`; `is()` checks the type side
 * and ignores them. Every issue is collected with `errors: 'all'` and turned
 * into a list with paths by the Standard Schema formatter of `SchemaIssue`.
 */
const of = (S, shape) => {
  const fields = {};
  for (const [key, type] of Object.entries(shape)) {
    if (typeof type === 'object') fields[key] = of(S, type);
    else fields[key] = { number: S.Number, string: S.String, boolean: S.Boolean }[type];
  }
  return S.Struct(fields);
};

const STRICT = { onExcessProperty: 'error' };
const ALL = { errors: 'all', onExcessProperty: 'error' };

module.exports = {
  id: 'effect',
  name: 'Effect Schema',
  package: 'effect',
  variant: 'decodeUnknownResult() · is()',
  load: () => ({
    S: require('effect/Schema'),
    Result: require('effect/Result'),
    Issue: require('effect/SchemaIssue'),
  }),
  setup: ({ S, Result, Issue }, shape) => {
    const schema = of(S, shape);
    const decode = S.decodeUnknownResult(schema);
    const is = S.is(schema);
    const format = Issue.makeFormatterStandardSchemaV1();
    return {
      parseSafe: (value) => {
        const result = decode(value);
        return Result.isSuccess(result) ? result.success : null;
      },
      parseStrict: (value) => {
        const result = decode(value, STRICT);
        return Result.isSuccess(result) ? result.success : null;
      },
      assertLoose: (value) => is(value),
      assertStrict: (value) => Result.isSuccess(decode(value, STRICT)),
      issues: (value) => format(decode(value, ALL).failure.issue).issues,
      paths: (issues) => issues.map((issue) => issue.path.join('.')),
    };
  },
  builder:
    ({ S, Result }, shape) =>
    () => {
      const decode = S.decodeUnknownResult(of(S, shape));
      return (value) => Result.isSuccess(decode(value, STRICT));
    },
};
