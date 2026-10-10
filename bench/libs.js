/**
 * `pnpm bench --compare-libs`: the moltar scenarios through other validators
 * (zod 4, valibot, ajv for draft 2020-12, @sinclair/typebox's TypeCompiler
 * and Value.Check) beside metaschema's two backends, on the same schemas and
 * values (bench/helpers.js). Every library is reached through the same
 * adapter object and the same megamorphic call site, so no library's check is
 * inlined into the measuring loop. The libraries are devDependencies; the
 * table in docs/guide/performance.md is the output of this file on one
 * machine, and the numbers mean nothing across machines.
 *
 * The modes are the suite's: parseSafe (unknown keys allowed, the value
 * returned), parseStrict (unknown keys rejected, the value returned),
 * assertLoose (a value with unknown keys, the verdict only) and assertStrict
 * (the verdict only). A library that strips unknown keys when it parses (zod,
 * valibot) returns its own copy of the value in parseSafe, as it does in the
 * suite; the others return the value they were given.
 */

const fs = require('node:fs');
const path = require('node:path');

const { z } = require('zod');
const v = require('valibot');
const Ajv = require('ajv/dist/2020');
const { Type } = require('@sinclair/typebox');
const { TypeCompiler } = require('@sinclair/typebox/compiler');
const { Value } = require('@sinclair/typebox/value');

const { Schema } = require('../index.js');
const { compile } = require('../src/compile/index.js');
const {
  bench,
  callCheck,
  MOLTAR_FLAT_SCHEMA,
  MOLTAR_NESTED_SCHEMA,
  MOLTAR_FLAT_VALUE,
  MOLTAR_NESTED_VALUE,
  MOLTAR_FLAT_LOOSE,
  MOLTAR_NESTED_LOOSE,
} = require('./helpers.js');

const MODES = ['parseSafe', 'parseStrict', 'assertLoose', 'assertStrict'];

const LOOSE = { unknown: 'ignore' };

// The version of an installed package, from the package.json above its
// entry (valibot's exports map hides it from `require('valibot/package.json')`).
const versionOf = (name) => {
  let dir = path.dirname(require.resolve(name));
  for (;;) {
    const file = path.join(dir, 'package.json');
    if (fs.existsSync(file)) {
      const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (pkg.name === name) return pkg.version;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return 'unknown';
    dir = parent;
  }
};

const metaschema = (label, jit) => (definition) => {
  const schema = Schema.from(definition);
  if (jit) compile(schema, { jit: true });
  return {
    label,
    parseSafe: (value) => (schema.check(value, LOOSE).valid ? value : null),
    parseStrict: (value) => (schema.check(value).valid ? value : null),
    assertLoose: (value) => schema.check(value, LOOSE).valid,
    assertStrict: (value) => schema.check(value).valid,
  };
};

// The same shape in every library: a field per key of the moltar object, a
// nested struct where the definition has one.
const zodOf = (definition, strict) => {
  const shape = {};
  for (const [key, def] of Object.entries(definition)) {
    if (typeof def === 'object') shape[key] = zodOf(def, strict);
    else shape[key] = z[def]();
  }
  return strict ? z.strictObject(shape) : z.object(shape);
};

const zod = (definition) => {
  const loose = zodOf(definition, false);
  const strict = zodOf(definition, true);
  return {
    label: `zod ${versionOf('zod')}`,
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
  };
};

const valibotOf = (definition, strict) => {
  const entries = {};
  for (const [key, def] of Object.entries(definition)) {
    if (typeof def === 'object') entries[key] = valibotOf(def, strict);
    else entries[key] = v[def]();
  }
  return strict ? v.strictObject(entries) : v.object(entries);
};

const valibot = (definition) => {
  const loose = valibotOf(definition, false);
  const strict = valibotOf(definition, true);
  return {
    label: `valibot ${versionOf('valibot')}`,
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
  };
};

const jsonSchemaOf = (definition, strict) => {
  const properties = {};
  for (const [key, def] of Object.entries(definition)) {
    properties[key] = typeof def === 'object' ? jsonSchemaOf(def, strict) : { type: def };
  }
  const required = Object.keys(definition);
  return { type: 'object', properties, required, additionalProperties: !strict };
};

const ajv = (definition) => {
  const instance = new Ajv();
  const loose = instance.compile(jsonSchemaOf(definition, false));
  const strict = instance.compile(jsonSchemaOf(definition, true));
  return {
    label: `ajv ${versionOf('ajv')} (2020-12)`,
    parseSafe: (value) => (loose(value) ? value : null),
    parseStrict: (value) => (strict(value) ? value : null),
    assertLoose: (value) => loose(value),
    assertStrict: (value) => strict(value),
  };
};

const typeboxOf = (definition, strict) => {
  const properties = {};
  const types = { number: Type.Number, string: Type.String, boolean: Type.Boolean };
  for (const [key, def] of Object.entries(definition)) {
    properties[key] = typeof def === 'object' ? typeboxOf(def, strict) : types[def]();
  }
  return Type.Object(properties, strict ? { additionalProperties: false } : {});
};

const typeboxCompiled = (definition) => {
  const loose = TypeCompiler.Compile(typeboxOf(definition, false));
  const strict = TypeCompiler.Compile(typeboxOf(definition, true));
  return {
    label: `@sinclair/typebox ${versionOf('@sinclair/typebox')} (TypeCompiler)`,
    parseSafe: (value) => (loose.Check(value) ? value : null),
    parseStrict: (value) => (strict.Check(value) ? value : null),
    assertLoose: (value) => loose.Check(value),
    assertStrict: (value) => strict.Check(value),
  };
};

const typeboxValue = (definition) => {
  const loose = typeboxOf(definition, false);
  const strict = typeboxOf(definition, true);
  return {
    label: `@sinclair/typebox ${versionOf('@sinclair/typebox')} (Value.Check)`,
    parseSafe: (value) => (Value.Check(loose, value) ? value : null),
    parseStrict: (value) => (Value.Check(strict, value) ? value : null),
    assertLoose: (value) => Value.Check(loose, value),
    assertStrict: (value) => Value.Check(strict, value),
  };
};

const LIBRARIES = [
  metaschema('metaschema (closures)', false),
  metaschema('metaschema (jit)', true),
  zod,
  valibot,
  ajv,
  typeboxCompiled,
  typeboxValue,
];

const SUBJECTS = [
  ['moltar flat (6 fields)', MOLTAR_FLAT_SCHEMA, MOLTAR_FLAT_VALUE, MOLTAR_FLAT_LOOSE],
  ['moltar nested (6 + 3 fields)', MOLTAR_NESTED_SCHEMA, MOLTAR_NESTED_VALUE, MOLTAR_NESTED_LOOSE],
];

const millions = (ops) => `${(ops / 1e6).toFixed(1)} M`;

// Every library's four modes over every subject, through an adapter whose
// `check` is the mode under measurement, in the holder of bench/helpers.js.
const compareLibraries = ({ json = false } = {}) => {
  const results = [];
  for (const [subject, definition, value, loose] of SUBJECTS) {
    const rows = [];
    for (const library of LIBRARIES) {
      const built = library(definition);
      const row = { library: built.label };
      for (const mode of MODES) {
        const input = mode === 'assertLoose' ? loose : value;
        const adapter = { check: built[mode] };
        const name = `${mode} — ${subject} — ${built.label}`;
        const { opsPerSec } = bench(name, () => callCheck(input), { quiet: true, schema: adapter });
        row[mode] = opsPerSec;
      }
      rows.push(row);
      if (!json) console.error(`measured ${built.label} on ${subject}`);
    }
    results.push({ subject, rows });
  }
  if (json) {
    console.log(JSON.stringify({ node: process.version, date: new Date().toISOString(), results }));
    return;
  }
  console.log(`\nNode ${process.version} | ${new Date().toISOString().slice(0, 10)}`);
  for (const { subject, rows } of results) {
    console.log(`\n### ${subject}\n`);
    console.log(`| Library | ${MODES.join(' | ')} |`);
    console.log(`| --- | ${MODES.map(() => '---:').join(' | ')} |`);
    for (const row of rows) {
      console.log(`| ${row.library} | ${MODES.map((mode) => millions(row[mode])).join(' | ')} |`);
    }
  }
};

module.exports = { compareLibraries };
