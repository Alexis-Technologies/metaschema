// The `./compile` subpath: the JIT backend of validation. `compile(target)`
// renders the check of a schema (or of every entity of a model) into
// straight-line JavaScript over the plan the closure backend walks, builds it
// with `new Function` and installs it as the schema's check; the issues are
// the ones the closures record, in the same order. Where code generation
// from strings is not allowed (a Content Security Policy, Cloudflare Workers,
// `node --disallow-code-generation-from-strings`) the closures stay, silently
// in the default mode. Nothing happens on import.
const { hasBrand, RUN, HOOK } = require('../util.js');
const { Schema } = require('../schema.js');
const { SchemaDefinitionError } = require('../errors.js');
const { Code } = require('./code.js');
const { emitRoot } = require('./emit.js');

const MODES = ['auto', true, false];

const modeOf = (options) => {
  if (options === null || typeof options !== 'object') {
    const reason = `Compile options must be an object, got ${JSON.stringify(options)}`;
    throw new SchemaDefinitionError('ERR_INVALID_OPTIONS', reason);
  }
  const { jit = 'auto' } = options;
  if (!MODES.includes(jit)) {
    const reason = `Compile option "jit" must be "auto", true or false, got ${JSON.stringify(jit)}`;
    throw new SchemaDefinitionError('ERR_INVALID_OPTIONS', reason);
  }
  return jit;
};

let evaluates = null;

// Whether this environment builds a function from source, probed once.
const canEval = () => {
  if (evaluates === null) {
    try {
      // oxlint-disable-next-line no-new-func
      evaluates = typeof new Function('') === 'function';
    } catch {
      evaluates = false;
    }
  }
  return evaluates;
};

const noEval = () => {
  const reason =
    'Code generation from strings is not allowed in this environment; ' +
    'jit: "auto" keeps the closure backend instead';
  return new SchemaDefinitionError('ERR_NO_EVAL', reason);
};

// Whether a mode generates code here: never for false, where it can for
// 'auto', and for true only where it can, otherwise an error.
const accelerates = (mode) => {
  if (mode === false) return false;
  if (canEval()) return true;
  if (mode === true) throw noEval();
  return false;
};

const build = (target) => {
  const code = new Code();
  emitRoot(target, code);
  // oxlint-disable-next-line no-new-func
  const factory = new Function('scope', code.source());
  return factory(code.values);
};

// The check a schema was built with, kept when the generated one replaces it
// so that `{ jit: false }` can put it back.
const ORIGINAL = new WeakMap();

const replace = (target, run) => {
  if (!ORIGINAL.has(target)) ORIGINAL.set(target, target[RUN]);
  target[RUN] = run;
};

const restore = (target) => {
  const run = ORIGINAL.get(target);
  if (run !== undefined) target[RUN] = run;
};

// Replaces the check of a schema with the generated one; a failure to build
// it is a fallback.
const install = (target) => {
  let run;
  try {
    run = build(target);
  } catch {
    return false;
  }
  replace(target, run);
  return true;
};

const schemasOf = (target) => {
  if (hasBrand(target, 'Schema')) return [target];
  if (!hasBrand(target, 'Model')) throw new TypeError('A Schema or a Model is expected');
  const schemas = [];
  for (const schema of target.entities.values()) schemas.push(schema);
  return schemas;
};

// `{ accelerated }`: whether the check of the schema (of every entity of the
// model) runs generated code now; false in the fallback, where the closure
// backend is left as it is, and after `{ jit: false }`, which puts the
// closures back. When the JIT is demanded every check is built before any is
// installed, so an error leaves the model as it was.
const compile = (target, options = {}) => {
  const mode = modeOf(options);
  const schemas = schemasOf(target);
  const { length } = schemas;
  if (!accelerates(mode)) {
    for (let index = 0; index < length; index += 1) restore(schemas[index]);
    return { accelerated: false };
  }
  let accelerated = true;
  if (mode === true) {
    const runs = [];
    for (let index = 0; index < length; index += 1) runs.push(build(schemas[index]));
    for (let index = 0; index < length; index += 1) replace(schemas[index], runs[index]);
  } else {
    for (let index = 0; index < length; index += 1) {
      if (!install(schemas[index])) accelerated = false;
    }
  }
  return { accelerated };
};

// Compiles every schema built from now on, with these options; a later call
// replaces them, and `{ jit: false }` stops it. A schema built before the
// call is not touched.
const register = (options = {}) => {
  const mode = modeOf(options);
  if (!accelerates(mode)) {
    Schema[HOOK] = undefined;
    return;
  }
  Schema[HOOK] =
    mode === true
      ? (schema) => {
          replace(schema, build(schema));
        }
      : (schema) => {
          install(schema);
        };
};

module.exports = { compile, register, canEval };
