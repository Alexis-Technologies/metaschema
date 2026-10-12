/**
 * TypeBox 1.x (the unscoped `typebox` package, the successor of
 * `@sinclair/typebox` 0.34), twice: `Compile()` generates a validator with
 * `new Function`, `Value.Check` interprets the same schema.
 * `additionalProperties: false` rejects unknown keys.
 */
const of = (Type, shape, strict) => {
  const properties = {};
  const types = { number: Type.Number, string: Type.String, boolean: Type.Boolean };
  for (const [key, type] of Object.entries(shape)) {
    properties[key] = typeof type === 'object' ? of(Type, type, strict) : types[type]();
  }
  return Type.Object(properties, strict ? { additionalProperties: false } : {});
};

const load = () => ({
  Type: require('typebox').Type,
  Compile: require('typebox/compile').Compile,
  Value: require('typebox/value').Value,
});

const paths = (errors) => errors.map((error) => error.instancePath.slice(1).replaceAll('/', '.'));

const compiled = {
  id: 'typebox',
  name: 'TypeBox',
  package: 'typebox',
  variant: 'Compile(…).Check()',
  load,
  setup: ({ Type, Compile }, shape) => {
    const loose = Compile(of(Type, shape, false));
    const strict = Compile(of(Type, shape, true));
    return {
      parseSafe: (value) => (loose.Check(value) ? value : null),
      parseStrict: (value) => (strict.Check(value) ? value : null),
      assertLoose: (value) => loose.Check(value),
      assertStrict: (value) => strict.Check(value),
      issues: (value) => strict.Errors(value),
      paths,
    };
  },
  builder:
    ({ Type, Compile }, shape) =>
    () => {
      const validator = Compile(of(Type, shape, true));
      return (value) => validator.Check(value);
    },
};

const interpreted = {
  id: 'typebox-value',
  name: 'TypeBox',
  package: 'typebox',
  variant: 'Value.Check()',
  load,
  setup: ({ Type, Value }, shape) => {
    const loose = of(Type, shape, false);
    const strict = of(Type, shape, true);
    return {
      parseSafe: (value) => (Value.Check(loose, value) ? value : null),
      parseStrict: (value) => (Value.Check(strict, value) ? value : null),
      assertLoose: (value) => Value.Check(loose, value),
      assertStrict: (value) => Value.Check(strict, value),
      issues: (value) => Value.Errors(strict, value),
      paths,
    };
  },
  builder:
    ({ Type, Value }, shape) =>
    () => {
      const schema = of(Type, shape, true);
      return (value) => Value.Check(schema, value);
    },
};

module.exports = { compiled, interpreted };
