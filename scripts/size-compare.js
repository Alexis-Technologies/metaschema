/**
 * Cross-library bundle sizes for the docs and the README: what a program
 * pays to validate the comparison's object (the strict nested moltar schema
 * of bench/compare/scenarios.js) in each library. Each entry imports what it
 * uses, builds the schema the idiomatic way and exports a `check`; esbuild
 * bundles it for the browser (minified, tree-shaken, as scripts/size.js does
 * for metaschema's own entries), the bundle is loaded and must give the right
 * verdicts, and the report gives min and min+gzip.
 * Measuring the whole package instead would charge a tree-shakable library
 * for the functions a program never imports. Each import is the one the
 * library documents (`import * as z from 'zod'`: the named `z` export pulls
 * in every locale, 90 KB min+gzip instead of 26).
 *
 * Run: pnpm size:compare [--json]   (--json writes bench/results/size.json)
 */
const fs = require('node:fs');
const { gzipSync } = require('node:zlib');
const path = require('node:path');
const esbuild = require('esbuild');

const { getAdapter } = require('../bench/compare/adapters/index.js');
const { MOLTAR_NESTED_VALUE: NESTED_VALUE } = require('../bench/helpers.js');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'bench', 'results', 'size.json');

const FIELDS = `number: 'number', negNumber: 'number', maxNumber: 'number', string: 'string',
  longString: 'string', boolean: 'boolean'`;
const INNER = `foo: 'string', num: 'number', bool: 'boolean'`;

const METASCHEMA = `import { Schema } from './browser.js';
const schema = Schema.from({ Struct: {}, ${FIELDS}, deeplyNested: { ${INNER} } });`;

// The fields of a builder library: `number: x.number()` and so on.
const built = (x, inner) => `number: ${x}.number(), negNumber: ${x}.number(),
  maxNumber: ${x}.number(), string: ${x}.string(), longString: ${x}.string(),
  boolean: ${x}.boolean(), deeplyNested: ${inner}`;
const nested = (x, wrap) => wrap(`foo: ${x}.string(), num: ${x}.number(), bool: ${x}.boolean()`);

const ENTRIES = [
  {
    id: 'metaschema-jit',
    source: `${METASCHEMA}
import { compile } from './src/compile/index.js';
compile(schema, { jit: true });
export const check = (value) => schema.check(value).valid;`,
  },
  {
    id: 'metaschema',
    source: `${METASCHEMA}
export const check = (value) => schema.check(value).valid;`,
  },
  // Metarhia's checks compare `constructor.name` with 'Type', so a bundle
  // minified without keepNames accepts every value; this one keeps the names.
  {
    id: 'metarhia',
    keepNames: true,
    note: 'minified with keepNames: its checks compare constructor names',
    source: `import { Schema } from 'metaschema';
const schema = Schema.from({ Struct: {}, ${FIELDS}, deeplyNested: { ${INNER} } });
export const check = (value) => schema.check(value).valid;`,
  },
  {
    id: 'zod',
    source: `import * as z from 'zod';
const schema = z.strictObject({ ${built(
      'z',
      nested('z', (s) => `z.strictObject({ ${s} })`),
    )} });
export const check = (value) => schema.safeParse(value).success;`,
  },
  {
    id: 'valibot',
    source: `import * as v from 'valibot';
const schema = v.strictObject({ ${built(
      'v',
      nested('v', (s) => `v.strictObject({ ${s} })`),
    )} });
export const check = (value) => v.is(schema, value);`,
  },
  {
    id: 'arktype',
    source: `import { type } from 'arktype';
const schema = type({ '+': 'reject', ${FIELDS}, deeplyNested: { '+': 'reject', ${INNER} } });
export const check = (value) => schema.allows(value);`,
  },
  {
    id: 'effect',
    source: `import * as S from 'effect/Schema';
import * as Result from 'effect/Result';
const schema = S.Struct({ number: S.Number, negNumber: S.Number, maxNumber: S.Number,
  string: S.String, longString: S.String, boolean: S.Boolean,
  deeplyNested: S.Struct({ foo: S.String, num: S.Number, bool: S.Boolean }) });
const decode = S.decodeUnknownResult(schema);
export const check = (value) => Result.isSuccess(decode(value, { onExcessProperty: 'error' }));`,
  },
  {
    id: 'typebox',
    source: `import { Type } from 'typebox';
import { Compile } from 'typebox/compile';
const closed = { additionalProperties: false };
const schema = Type.Object({ ${built(
      'Type',
      nested('Type', (s) => `Type.Object({ ${s} }, closed)`),
    )
      .replaceAll('Type.number', 'Type.Number')
      .replaceAll('Type.string', 'Type.String')
      .replaceAll('Type.boolean', 'Type.Boolean')} }, closed);
const validator = Compile(schema);
export const check = (value) => validator.Check(value);`,
  },
  {
    id: 'typebox-value',
    source: `import { Type } from 'typebox';
import { Value } from 'typebox/value';
const closed = { additionalProperties: false };
const schema = Type.Object({ ${built(
      'Type',
      nested('Type', (s) => `Type.Object({ ${s} }, closed)`),
    )
      .replaceAll('Type.number', 'Type.Number')
      .replaceAll('Type.string', 'Type.String')
      .replaceAll('Type.boolean', 'Type.Boolean')} }, closed);
export const check = (value) => Value.Check(schema, value);`,
  },
  {
    id: 'ajv',
    source: `import Ajv from 'ajv/dist/2020';
const object = (properties) => ({ type: 'object', properties,
  required: Object.keys(properties), additionalProperties: false });
const n = { type: 'number' }, s = { type: 'string' }, b = { type: 'boolean' };
const validate = new Ajv().compile(object({ number: n, negNumber: n, maxNumber: n, string: s,
  longString: s, boolean: b, deeplyNested: object({ foo: s, num: n, bool: b }) }));
export const check = (value) => validate(value);`,
  },
  {
    id: 'yup',
    source: `import { object, number, string, boolean } from 'yup';
const yup = { number: () => number().required(), string: () => string().required(),
  boolean: () => boolean().required() };
const schema = object({ ${built(
      'yup',
      nested('yup', (s) => `object({ ${s} }).noUnknown().required()`),
    )} })
  .noUnknown().required();
export const check = (value) => schema.isValidSync(value, { strict: true });`,
  },
  {
    id: 'joi',
    source: `import Joi from 'joi';
const j = { number: () => Joi.number().unsafe().required(), string: () => Joi.string().required(),
  boolean: () => Joi.boolean().required() };
const schema = Joi.object({ ${built(
      'j',
      nested('j', (s) => `Joi.object({ ${s} }).required()`),
    )} });
export const check = (value) => !schema.validate(value, { convert: false }).error;`,
  },
  {
    id: 'superstruct',
    source: `import { object, number, string, boolean, is } from 'superstruct';
const s = { number, string, boolean };
const struct = object({ ${built(
      's',
      nested('s', (x) => `object({ ${x} })`),
    )} });
export const check = (value) => is(value, struct);`,
  },
];

const bundle = async (entry) => {
  const result = await esbuild.build({
    stdin: { contents: entry.source, resolveDir: ROOT, loader: 'js' },
    bundle: true,
    minify: true,
    keepNames: entry.keepNames === true,
    format: 'esm',
    platform: 'browser',
    write: false,
    logLevel: 'silent',
  });
  return Buffer.from(result.outputFiles[0].contents);
};

// A bundle that does not validate measures nothing, so each one is loaded
// and must accept the valid value and reject a wrong field and an unknown key.
// A browser bundle may reach for `self` (Joi's UMD build does).
globalThis.self ??= globalThis;

const verify = async (entry, buffer) => {
  const url = `data:text/javascript;base64,${buffer.toString('base64')}`;
  let check = null;
  try {
    check = (await import(url)).check;
  } catch (error) {
    throw new Error(`${entry.id}: the bundle does not load: ${error.message}`, { cause: error });
  }
  const verdicts = [
    check(NESTED_VALUE) === true,
    check({ ...NESTED_VALUE, number: '1' }) === false,
    check({ ...NESTED_VALUE, deeplyNested: { ...NESTED_VALUE.deeplyNested, bool: 'x' } }) === false,
    check({ ...NESTED_VALUE, extra: 1 }) === false,
  ];
  if (verdicts.includes(false)) throw new Error(`${entry.id}: the bundle gives wrong verdicts`);
};

const versionOf = (name) => {
  const file =
    name === '@alexify/metaschema' ? 'package.json' : `node_modules/${name}/package.json`;
  return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')).version;
};

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

const main = async () => {
  const rows = [];
  for (const entry of ENTRIES) {
    const buffer = await bundle(entry);
    await verify(entry, buffer);
    const adapter = getAdapter(entry.id);
    rows.push({
      id: entry.id,
      name: adapter.name,
      variant: adapter.variant,
      package: adapter.package,
      version: versionOf(adapter.package),
      min: buffer.length,
      gzip: gzipSync(buffer, { level: 9 }).length,
      ...(entry.note ? { note: entry.note } : {}),
    });
  }
  console.log('| Library | min | min+gzip |');
  console.log('| --- | ---: | ---: |');
  for (const row of rows) {
    console.log(`| ${row.name} · ${row.variant} | ${kb(row.min)} | ${kb(row.gzip)} |`);
  }
  if (process.argv.includes('--json')) {
    const report = { generatedAt: new Date().toISOString(), libraries: rows };
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\nWrote ${path.relative(ROOT, OUT)}`);
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

module.exports = { ENTRIES };
