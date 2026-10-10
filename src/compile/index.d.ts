import type { Model, Schema } from '../../index.js';

export interface CompileOptions {
  // 'auto' (the default) generates the check where the environment allows
  // code generation from strings and keeps the closure backend silently where
  // it does not; true throws `SchemaDefinitionError` with the code
  // `ERR_NO_EVAL` instead of falling back; false never generates code.
  jit?: 'auto' | boolean;
}

export interface Compiled {
  // Whether the check runs generated code now; false in the fallback, where
  // the closure backend is left as it is.
  accelerated: boolean;
}

// Replaces the check of a schema, or of every entity of a model, with the
// generated one. The issues are the ones the closure backend records, in the
// same order. A target that is neither is a `TypeError`.
export function compile(target: Schema | Model, options?: CompileOptions): Compiled;

// Compiles every schema built from now on with these options; a later call
// replaces them, `{ jit: false }` stops it. A schema built before the call is
// not touched: pass it to `compile`.
export function register(options?: CompileOptions): void;

// Whether this environment allows code generation from strings; probed once.
export function canEval(): boolean;
