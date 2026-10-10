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

// Replaces the check of a schema with the generated one. A failure to build
// it is a fallback in the default mode, an error when the JIT was demanded.
const install = (target, mode) => {
  let run;
  try {
    run = build(target);
  } catch (error) {
    if (mode === true) throw error;
    return false;
  }
  target[RUN] = run;
  return true;
};

// `{ accelerated }`: whether the check of the schema (of every entity of the
// model) runs generated code now; false in the fallback, where the closure
// backend is left as it is.
const compile = (target, options = {}) => {
  const mode = modeOf(options);
  const schemas = hasBrand(target, 'Schema') ? [target] : null;
  if (schemas === null && !hasBrand(target, 'Model')) {
    throw new TypeError('A Schema or a Model is expected');
  }
  let accelerated = accelerates(mode);
  if (accelerated) {
    for (const schema of schemas || target.entities.values()) {
      if (!install(schema, mode)) accelerated = false;
    }
  }
  return { accelerated };
};

// Compiles every schema built from now on, with these options; a later call
// replaces them, and `{ jit: false }` stops it. A schema built before the
// call is not touched.
const register = (options = {}) => {
  const mode = modeOf(options);
  Schema[HOOK] = accelerates(mode)
    ? (schema) => {
        install(schema, mode);
      }
    : undefined;
};

module.exports = { compile, register, canEval };
