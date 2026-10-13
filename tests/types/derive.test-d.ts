import { expectAssignable, expectError, expectType } from 'tsd';
import { Schema } from '../../index.js';
import type { DefinitionErrorCode, InferOutput, InferSchema, Model } from '../../index.js';
import { extend, keyof, omit, partial, pick, register, required } from '../../src/derive/index.js';

const account = new Schema('Account', {
  Registry: { table: 'accounts' },
  login: { type: 'string', unique: true },
  password: 'string',
  'nick?': 'string',
  role: { enum: ['admin', 'user'], default: 'user' },
  address: { city: 'string', street: { type: 'string', default: 'Main' } },
  display: (value: { login: string }) => value.login,
  byRole: { index: ['role'] },
  validate: () => null,
});

// pick and omit keep the fields named, by their names (no `?`).
const view = pick(account, ['login', 'nick']);
expectType<{ login: string; nick?: string | null | undefined }>({} as InferSchema<typeof view>);
const create = omit(account, ['password', 'address']);
expectType<{
  login: string;
  role?: 'admin' | 'user' | undefined;
  nick?: string | null | undefined;
}>({} as InferSchema<typeof create>);
expectType<'admin' | 'user'>(
  {} as InferOutput<typeof create extends Schema<infer D> ? D : never>['role'],
);
// A calculated field and the id of a stored kind are names too.
pick(account, ['display']);
pick(account, ['accountId']);
expectError(pick(account, ['nmae']));
expectError(omit(account, ['login?']));
expectError(pick(account, ['byRole']));
expectError(pick(account, ['validate']));

// partial: every field optional, the defaults gone; `keys` names some.
const patch = partial(account);
expectType<{
  login?: string | null | undefined;
  password?: string | null | undefined;
  nick?: string | null | undefined;
  role?: 'admin' | 'user' | null | undefined;
  address?: { city: string; street?: string | undefined } | null | undefined;
}>({} as InferSchema<typeof patch>);
const some = partial(account, { keys: ['password'] });
expectType<string>({} as InferSchema<typeof some>['login']);
expectType<string | null | undefined>({} as InferSchema<typeof some>['password']);
expectError(partial(account, { keys: ['nmae'] }));
// `deep` goes into the nested struct.
const deep = partial(account, { deep: true });
expectType<
  { city?: string | null | undefined; street?: string | null | undefined } | null | undefined
>({} as InferSchema<typeof deep>['address']);
// `defaults: true` keeps them: parse fills the key.
const filled = partial(account, { defaults: true });
expectType<'admin' | 'user' | null>(
  {} as InferOutput<typeof filled extends Schema<infer D> ? D : never>['role'],
);

// required: the optional forms are required.
const forms = Schema.from({ a: '?string', 'b?': 'number', c: { type: 'string', required: false } });
const all = required(forms);
expectType<{ a: string; b: number; c: string }>({} as InferSchema<typeof all>);
const some2 = required(forms, { keys: ['a'] });
expectType<string>({} as InferSchema<typeof some2>['a']);
expectType<number | null | undefined>({} as InferSchema<typeof some2>['b']);

// extend: fields of the same name replaced, the others added.
const wider = extend(create, { 'login?': 'string', email: 'string' });
expectType<{
  role?: 'admin' | 'user' | undefined;
  nick?: string | null | undefined;
  login?: string | null | undefined;
  email: string;
}>({} as InferSchema<typeof wider>);
const joined = extend(view, Schema.from({ Entity: {}, phone: 'string' }));
expectType<{ login: string; nick?: string | null | undefined; phone: string }>(
  {} as InferSchema<typeof joined>,
);

// keyof: the names of the fields.
const names = keyof(account);
expectType<'login' | 'password' | 'nick' | 'role' | 'address'>({} as InferSchema<typeof names>);

// The kind given in the options.
const stored = omit(account, ['password'], { name: 'Member', metadata: { kind: 'entity' } });
expectAssignable<Schema>(stored);

// Only a struct is derived from.
expectError(pick(Schema.from('string'), []));
expectError(partial(Schema.from({ array: 'string' })));
// A schema of an unknown definition gives one.
declare const model: Model;
const entity = model.entities.get('Account')!;
expectType<Schema>(pick(entity, ['anything']));
expectType<Schema>(entity.partial({ keys: ['x'] }));

// The methods, once register() ran, chain with the same types.
register();
expectType<void>(register());
const chained = account.omit(['password', 'address']).partial();
expectType<{
  login?: string | null | undefined;
  nick?: string | null | undefined;
  role?: 'admin' | 'user' | null | undefined;
}>({} as InferSchema<typeof chained>);
expectType<string>(
  {} as InferSchema<ReturnType<typeof account.pick<typeof account, ['login'], {}>>>['login'],
);
expectError(account.pick(['nmae']));
expectError(Schema.from('string').partial());
const assigned: Schema = account.pick(['login']).required();
expectAssignable<Schema>(assigned);

expectAssignable<DefinitionErrorCode>('ERR_UNKNOWN_FIELD');
