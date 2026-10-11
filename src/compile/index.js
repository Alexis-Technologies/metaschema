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
const { SchemaDefinitionError, invalidTarget } = require('../errors.js');
const { Code } = require('./code.js');
const { emitRoot } = require('./emit.js');

const invalidOptions = (reason) => new SchemaDefinitionError('ERR_INVALID_OPTIONS', reason);

// The options of compile and register: the mode, and the function told of
// every schema the default mode could not compile.
const optionsOf = (options) => {
  if (options === null || typeof options !== 'object') {
    throw invalidOptions(`Compile options must be an object, got ${JSON.stringify(options)}`);
  }
  const { jit = 'auto', onFallback } = options;
  if (jit !== 'auto' && jit !== true && jit !== false) {
    const got = JSON.stringify(jit);
    throw invalidOptions(`Compile option "jit" must be "auto", true or false, got ${got}`);
  }
  if (onFallback !== undefined && typeof onFallback !== 'function') {
    throw invalidOptions('Compile option "onFallback" must be a function');
  }
  return { mode: jit, onFallback };
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

// What went wrong when the check of a schema could not be generated: the
// error of the emitter or of `new Function` as the cause, under one code.
const failure = (target, error) => {
  const reason = `The check of "${target.name}" could not be generated: ${error.message}`;
  const wrapped = new SchemaDefinitionError('ERR_JIT_BUILD', reason);
  wrapped.cause = error;
  return wrapped;
};

const build = (target) => {
  const code = new Code();
  emitRoot(target, code);
  // oxlint-disable-next-line no-new-func
  const factory = new Function('scope', code.source(target.name));
  return factory(code.values);
};

// The generated check, or ERR_JIT_BUILD: the JIT was demanded.
const generate = (target) => {
  try {
    return build(target);
  } catch (error) {
    throw failure(target, error);
  }
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
// it is a fallback, reported to `onFallback` and returned.
const install = (target, onFallback) => {
  let run;
  try {
    run = build(target);
  } catch (error) {
    const wrapped = failure(target, error);
    if (onFallback !== undefined) onFallback(target, wrapped);
    return wrapped;
  }
  replace(target, run);
  return undefined;
};

const schemasOf = (target) => {
  if (hasBrand(target, 'Schema')) return [target];
  if (!hasBrand(target, 'Model')) throw invalidTarget('A Schema or a Model is expected');
  const schemas = [];
  for (const schema of target.entities.values()) schemas.push(schema);
  return schemas;
};

// `{ accelerated, error }`: whether the check of the schema (of every entity
// of the model) runs generated code now, and what stopped the first one that
// does not; false without an error where the environment allows no code
// generation and after `{ jit: false }`, which puts the closures back. When
// the JIT is demanded every check is built before any is installed, so an
// error leaves the model as it was.
const compile = (target, options = {}) => {
  const { mode, onFallback } = optionsOf(options);
  const schemas = schemasOf(target);
  const { length } = schemas;
  if (!accelerates(mode)) {
    for (let index = 0; index < length; index += 1) restore(schemas[index]);
    return { accelerated: false };
  }
  if (mode === true) {
    const runs = [];
    for (let index = 0; index < length; index += 1) runs.push(generate(schemas[index]));
    for (let index = 0; index < length; index += 1) replace(schemas[index], runs[index]);
    return { accelerated: true };
  }
  let error;
  for (let index = 0; index < length; index += 1) {
    const failed = install(schemas[index], onFallback);
    if (failed !== undefined && error === undefined) error = failed;
  }
  return error === undefined ? { accelerated: true } : { accelerated: false, error };
};

// Whether the check of a schema (of every entity of a model) runs the
// generated code now: what `compile` reported, asked later.
const compiled = (target) => {
  const schemas = schemasOf(target);
  for (let index = 0; index < schemas.length; index += 1) {
    const schema = schemas[index];
    if (!ORIGINAL.has(schema) || schema[RUN] === ORIGINAL.get(schema)) return false;
  }
  return true;
};

// Compiles every schema built from now on, with these options; a later call
// replaces them, and `{ jit: false }` stops it. A schema built before the
// call is not touched. In the default mode `onFallback` is told of every
// schema that keeps its closures because its check could not be generated.
const register = (options = {}) => {
  const { mode, onFallback } = optionsOf(options);
  if (!accelerates(mode)) {
    Schema[HOOK] = undefined;
    return;
  }
  Schema[HOOK] =
    mode === true
      ? (schema) => {
          replace(schema, generate(schema));
        }
      : (schema) => {
          install(schema, onFallback);
        };
};

module.exports = { compile, compiled, register, canEval };
