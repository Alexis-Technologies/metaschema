import { expectError, expectType } from 'tsd';
import { Schema } from '../../index.js';
import type { Locale } from '../../index.js';
import en = require('../../src/locales/en.js');
import uk = require('../../src/locales/uk.js');

expectType<Required<Locale>>(en);
expectType<Required<Locale>>(uk);
expectType<string>(uk.required({}));
expectType<string>(uk.field('User.name'));
expectType<string>(en.type({ expected: 'string', received: 'number' }));
expectError(en.type({}));
expectType<Schema>(Schema.from({ a: 'string' }));
expectType<string[]>(Schema.from({ a: 'string' }).check({}, '', { messages: uk }).errors);
