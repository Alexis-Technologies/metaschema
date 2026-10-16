import { expectType } from 'tsd';
import * as core from '../../index.js';
import { Model, Schema, SchemaDefinitionError, KIND } from '../../src/definition/index.js';
import type { SchemaSnapshot } from '../../index.js';

// The definition subpath re-exports the core's own classes.
expectType<typeof core.Schema>(Schema);
expectType<typeof core.Model>(Model);
expectType<typeof core.SchemaDefinitionError>(SchemaDefinitionError);
expectType<Array<string>>(KIND);

const tag = Schema.from({ label: 'string', 'parent?': 'Tag' });
expectType<core.Schema<{ readonly label: 'string'; readonly 'parent?': 'Tag' }>>(tag);
expectType<SchemaSnapshot>(tag.toSnapshot());
const model = new Model({}, [['Tag', { Struct: {}, label: 'string' }]]);
expectType<core.ModelSnapshot>(model.toJSON());
