import { expectAssignable, expectError, expectType } from 'tsd';
import { Schema } from '../../index.js';
import type {
  CoerceOptions,
  DefinitionErrorCode,
  FieldType,
  InferSchema,
  KindMetadata,
  ParseOptions,
  RuntimeErrorCode,
} from '../../index.js';
import { COERCIONS, coerce, register } from '../../src/coerce/index.js';
import type { Coercion } from '../../src/coerce/index.js';

const form = new Schema('Form', { Form: { coerce: true }, age: 'integer', on: 'boolean' });

// The policy of a parse, of the schema, of a field.
expectAssignable<ParseOptions>({ coerce: true, unknown: 'strip' });
form.parse({ age: '42' }, { coerce: false });
expectError(form.check({ age: '42' }, { coerce: true }));
expectAssignable<Partial<KindMetadata>>({ coerce: true });
const field = Schema.from({ age: { type: 'integer', coerce: true } });
expectType<boolean | undefined>((field.fields as Record<string, FieldType>).age.coerce);

// Coercion does not change the value a schema accepts.
expectType<{ age: number; on: boolean }>({} as InferSchema<typeof form>);
expectType<{ age: number }>({} as InferSchema<typeof field>);

// The subpath.
expectType<void>(register());
const own: Coercion = (value, target) => (target.type === 'money' ? Number(value) : value);
register({ money: own });
expectError(register({ money: 'number' }));
expectType<Coercion | undefined>(COERCIONS.number);
expectError((COERCIONS.number = own));
expectType<unknown>(coerce(form, { age: '1' }));
expectType<unknown>(coerce(form, { age: '1' }, { references: 'embed', maxDepth: 4 }));
expectType<unknown>(form.coerce({ age: '1' }));
expectError(coerce({ age: 'integer' }, {}));
expectAssignable<CoerceOptions>({ maxDepth: 1 });

expectAssignable<DefinitionErrorCode>('ERR_INVALID_COERCION');
expectAssignable<DefinitionErrorCode>('ERR_COERCION_REGISTERED');
expectAssignable<RuntimeErrorCode>('ERR_NOT_REGISTERED');
