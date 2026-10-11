import type { Model, Schema, SchemaDefinitionError } from '../../index.js';

export interface CompileOptions {
  // 'auto' (the default) generates the check where the environment allows
  // code generation from strings and keeps the closure backend silently where
  // it does not; true throws `SchemaDefinitionError` with the code
  // `ERR_NO_EVAL` instead of falling back; false never generates code.
  jit?: 'auto' | boolean;
  // Told of every schema the default mode could not compile, with the
  // `ERR_JIT_BUILD` error (the error of the generator as its `cause`); the
  // schema keeps its closures.
  onFallback?: (schema: Schema, error: SchemaDefinitionError) => void;
}

export interface Compiled {
  // Whether the check runs generated code now; false in the fallback, where
  // the closure backend is left as it is.
  accelerated: boolean;
  // What stopped the first check that could not be generated (`ERR_JIT_BUILD`,
  // the generator's error as its `cause`); absent where the environment allows
  // no code generation at all, and after `{ jit: false }`.
  error?: SchemaDefinitionError;
}

// Replaces the check of a schema, or of every entity of a model, with the
// generated one. The issues are the ones the closure backend records, in the
// same order. A target that is neither is a `TypeError`. With `jit: true` a
// check that cannot be generated throws `ERR_JIT_BUILD` and nothing is
// installed; `{ jit: false }` puts the closures back.
export function compile(target: Schema | Model, options?: CompileOptions): Compiled;

// Compiles every schema built from now on with these options; a later call
// replaces them, `{ jit: false }` stops it. A schema built before the call is
// not touched: pass it to `compile`.
export function register(options?: CompileOptions): void;

// Whether this environment allows code generation from strings; probed once.
export function canEval(): boolean;

// Whether the check of a schema (of every entity of a model) runs generated
// code now: what `compile` reported, asked later. False for a schema built
// before `register()` and after `{ jit: false }`; a target that is neither
// a Schema nor a Model is a `TypeError`.
export function compiled(target: Schema | Model): boolean;
