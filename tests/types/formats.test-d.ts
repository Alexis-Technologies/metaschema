import { expectAssignable, expectError, expectType } from 'tsd';
import { Schema } from '../../index.js';
import { FORMATS, register } from '../../src/formats/index.js';
import type { FormatDefinition } from '../../src/formats/index.js';
import type { DefinitionErrorCode, InferSchema, IssueCode, IssueOf } from '../../index.js';

// register() takes the program's own formats beside the built-in ones.
expectType<void>(register());
expectType<void>(register({ phone: { test: (value) => value.length > 3, examples: ['+380'] } }));
expectType<void>(register({ word: { test: () => true, examples: ['a'], infer: false } }));
expectError(register({ phone: { test: 1, examples: [] } }));
expectError(register({ phone: { examples: ['+380'] } }));
expectError(register('phone'));

// The table is read, not written.
expectType<Readonly<FormatDefinition> | undefined>(FORMATS.email);
expectError((FORMATS.email = undefined));
expectAssignable<FormatDefinition>({ test: (value: string) => value !== '', examples: ['x'] });

// The issue and the error codes of the subpath.
expectAssignable<IssueCode>('format');
expectType<{ format: string }>({} as IssueOf<'format'>['params']);
expectAssignable<DefinitionErrorCode>('ERR_INVALID_FORMAT');
expectAssignable<DefinitionErrorCode>('ERR_FORMAT_REGISTERED');

// The rule changes nothing of the inferred type: a formatted field is a string.
const user = Schema.from({
  email: { type: 'string', format: 'email' },
  'site?': { type: 'string', format: 'uri' },
});
type User = InferSchema<typeof user>;
expectType<string>({} as User['email']);
expectType<string | null | undefined>({} as User['site']);
