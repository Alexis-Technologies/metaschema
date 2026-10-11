import { expectAssignable, expectError, expectNotAssignable, expectType } from 'tsd';
import { Schema, ValidationResult } from '../../index.js';
import type {
  Infer,
  InferOutput,
  InferEntity,
  ParseOptions,
  ParseResult,
  RuntimeErrorCode,
  SerializeChecked,
  SerializeOptions,
  Serialized,
  ValidationIssue,
} from '../../index.js';

declare const as: <T>() => T;

// `infer(definition)` reads the definition as `parse` accepts it, `output` as
// `parse` gives it.
declare const infer: <const D extends string | object>(definition: D) => Infer<D>;
declare const output: <const D extends string | object>(definition: D) => InferOutput<D>;

// A decoder replaces the value of its field on the output side only.
expectType<string>(infer({ type: 'string', parse: (text: string) => new Date(text) }));
expectType<Date>(output({ type: 'string', parse: (text: string) => new Date(text) }));
expectType<number>(output({ type: 'string', pattern: /^\d+$/, parse: Number }));
expectType<Date>(output({ type: 'string', parse: async (text: string) => new Date(text) }));
expectType<Date | null | undefined>(
  output({ type: '?string', parse: (text: string) => new Date(text) }),
);
expectType<Date | null>(
  output({ type: 'string', nullable: true, parse: (text: string) => new Date(text) }),
);
expectType<Date | null | undefined>(
  output({ type: 'string', required: false, parse: (text: string) => new Date(text) }),
);
expectType<string>(output({ array: 'string', parse: (list: string[]) => list.join(',') }));
expectType<string[]>(infer({ array: 'string', parse: (list: string[]) => list.join(',') }));
expectType<Date[]>(output({ array: { type: 'string', parse: (text: string) => new Date(text) } }));
expectType<Set<number>>(output({ set: { type: 'string', parse: Number } }));
expectType<Record<string, number>>(
  output({ object: { string: { type: 'string', parse: Number } } }),
);
expectType<Map<string, number>>(output({ map: { string: { type: 'string', parse: Number } } }));
expectType<[number, string]>(output([{ type: 'string', parse: Number }, 'string']));
expectType<number | boolean>(output({ union: [{ type: 'string', parse: Number }, 'boolean'] }));
expectType<'a' | 'b'>(output({ enum: ['a', 'b'] }));

// A nested struct's own parse, the schema's own parse, a Schema as a field.
expectType<{ city: string; zip: number }>(
  output({ city: 'string', zip: { type: 'string', parse: Number } }),
);
expectType<string>(output({ city: 'string', parse: (address: { city: string }) => address.city }));
expectType<{ city: string }>(
  infer({ city: 'string', parse: (address: { city: string }) => address.city }),
);
expectType<number>(output({ Struct: {}, type: 'string', parse: (): number => 1 }));
expectType<{ type: string }>(infer({ Struct: {}, type: 'string', parse: (): number => 1 }));
expectType<{ inner: string }>(
  output({ inner: { type: 'schema', schema: { a: 'string' }, parse: (v: { a: string }) => v.a } }),
);
const inner = Schema.from({ a: 'string', parse: (value: { a: string }) => value.a.length });
expectType<{ part: number }>(output({ part: inner }));
expectType<{ part: { a: string } }>(infer({ part: inner }));
expectType<number>(as<InferOutput<typeof inner>>());
expectType<{ a: string }>(as<Infer<typeof inner>>());

// A default makes the key optional on the input side and present on the
// output side; null stays where the key was optional.
type Defaulted = {
  name: 'string';
  status: { type: 'string'; default: 'draft' };
  'views?': { type: 'integer'; default: 0 };
  tags: { array: 'string'; default: () => string[] };
  'ratio?': { type: 'number'; nullable: true; default: null };
  nothing: { type: 'string'; default: undefined };
  'when?': { type: 'string'; default: 'now'; parse: (text: string) => Date };
};
expectType<{
  name: string;
  status?: string;
  views?: number | null | undefined;
  tags?: string[];
  ratio?: number | null | undefined;
  nothing: string;
  when?: string | null | undefined;
}>(as<Infer<Defaulted>>());
expectType<{
  name: string;
  status: string;
  views: number | null;
  tags: string[];
  ratio: number | null;
  nothing: string;
  when: Date | null;
}>(as<InferOutput<Defaulted>>());

// The entity map resolves references on the output side too.
const entities = {
  Tag: { Struct: {}, label: { type: 'string', parse: (text: string) => text.toUpperCase() } },
  Person: { Entity: {}, name: 'string', tags: { many: 'Tag' }, employer: 'Company' },
} as const;
expectType<{ label: string }>(as<Infer<'Tag', typeof entities>>());
expectType<{ label: string }>(as<InferOutput<'Tag', typeof entities>>());
expectType<{ name: string; tags: { label: string }[]; employer: string; personId?: string }>(
  as<InferEntity<typeof entities, 'Person'>>(),
);

// parse: the result narrows on `valid`.
const user = Schema.from({
  name: 'string',
  'age?': { type: 'integer', default: 18 },
  when: { type: 'string', parse: (text: string) => new Date(text) },
});
type UserOut = { name: string; age: number | null; when: Date };
const result = user.parse({});
expectType<ParseResult<UserOut>>(result);
expectType<boolean>(result.valid);
expectType<ValidationIssue[] | []>(result.issues);
if (result.valid) {
  expectType<UserOut>(result.value);
  expectType<[]>(result.issues);
} else {
  expectType<undefined>(result.value);
  expectType<ValidationIssue[]>(result.issues);
}
expectType<ParseResult<UserOut>>(user.parse({}, { unknown: 'strip', maxErrors: 1, root: 'body' }));
expectType<ParseResult<UserOut>>(user.parse({}, { unknown: 'ignore', references: 'embed' }));
expectError(user.parse({}, { unknown: 'drop' }));
expectError(user.parse({}, 'body'));
expectAssignable<ParseOptions>({ unknown: 'strip' });
expectNotAssignable<ParseOptions>({ unknown: 'drop' });
expectType<Promise<ParseResult<UserOut>>>(user.parseAsync({}));
expectType<Promise<ParseResult<UserOut>>>(user.parseAsync({}, { unknown: 'strip' }));
expectType<Promise<ValidationResult>>(user.checkAsync({}));
expectType<Promise<ValidationResult>>(user.checkAsync({}, { maxErrors: 1 }));
expectError(user.checkAsync({}, { unknown: 'strip' }));
expectType<ParseResult<string>>(Schema.from('string').parse('x'));
expectType<ParseResult<unknown>>(as<Schema>().parse({}));

// serialize: the value of the program in, the value check accepts out.
type UserIn = { name: string; age?: number | null | undefined; when: string };
expectType<Serialized<UserIn>>(user.serialize({ name: 'x', age: 1, when: new Date() }));
expectType<SerializeChecked<UserIn>>(
  user.serialize({ name: 'x', age: 1, when: new Date() }, { check: true }),
);
expectType<Serialized<UserIn>>(
  user.serialize({ name: 'x', age: null, when: new Date() }, { references: 'id' }),
);
expectError(user.serialize({ name: 'x', age: 1, when: 'text' }));
expectError(
  user.serialize({ name: 'x', age: 1, when: new Date() }, { check: true, unknown: 'strip' }),
);
expectAssignable<SerializeOptions>({ check: true, unknown: 'ignore', maxErrors: 2 });
const checked = user.serialize({ name: 'x', age: 1, when: new Date() }, { check: true });
expectType<boolean>(checked.valid);
expectType<ValidationIssue[]>(checked.issues);

// Validators and custom types may return promises; the error of a
// synchronous call has a code of its own.
expectAssignable<RuntimeErrorCode>('ERR_ASYNC_VALIDATOR');
expectNotAssignable<RuntimeErrorCode>('ERR_NO_EVAL');
Schema.from({
  name: { type: 'string', validate: async (value: string) => value !== '' || 'empty' },
});
Schema.from({ name: 'string', validate: async () => true });
