import { expectAssignable, expectError, expectType } from 'tsd';
import { Model, Schema } from '../../index.js';
import { canEval, compile, compiled, register } from '../../src/compile/index.js';
import type { CompileOptions, Compiled } from '../../src/compile/index.js';
import type { DefinitionErrorCode, SchemaDefinitionError } from '../../index.js';

const user = Schema.from({ name: 'string', age: '?number' });
const model = new Model({}, [['User', { name: 'string' }]]);

// compile takes a Schema or a Model and reports the mode.
expectType<Compiled>(compile(user));
expectType<Compiled>(compile(model));
expectType<boolean>(compile(user, { jit: 'auto' }).accelerated);
expectType<Compiled>(compile(user, { jit: true }));
expectType<Compiled>(compile(model, { jit: false }));
expectError(compile(user, { jit: 'always' }));
expectError(compile(user, { jit: 1 }));
expectError(compile({ name: 'string' }));
expectError(compile(user, { eval: true }));

// register takes the same options; canEval is a probe.
expectType<void>(register());
expectType<void>(register({ jit: 'auto' }));
expectType<void>(register({ jit: false }));
expectError(register({ jit: 'never' }));
expectType<boolean>(canEval());
expectType<boolean>(compiled(user));
expectType<boolean>(compiled(model));
expectError(compiled({ name: 'string' }));

const options: CompileOptions = { jit: true };
expectType<'auto' | boolean | undefined>(options.jit);

// The code of the error `jit: true` throws without eval, and the one of a
// check that could not be generated, reported in the default mode.
expectAssignable<DefinitionErrorCode>('ERR_NO_EVAL');
expectAssignable<DefinitionErrorCode>('ERR_JIT_BUILD');
expectType<SchemaDefinitionError | undefined>(compile(user).error);
expectType<void>(register({ onFallback: (schema, error) => void [schema, error.code] }));
expectError(register({ onFallback: 1 }));
