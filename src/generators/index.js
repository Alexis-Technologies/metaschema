// The `./generators` subpath: what a schema or a model is rendered into
// (JSON Schema, TypeScript) and read from (a JSON Schema document), kept out
// of the core entry so that a program that only validates does not carry
// it. The functions take a Schema or a Model; `register()` installs them as
// methods, and the Standard JSON Schema converter on `~standard`, for the
// programs that want the methods.
const { hasBrand } = require('../util.js');
const { invalidTarget } = require('../errors.js');
const { Schema } = require('../validation.js');
const { Model } = require('../model.js');
const { writeFile } = require('../runtime/node.js');
const generators = require('./jsonschema.js');
const typescript = require('./typescript.js');
const { fromJSONSchema } = require('./fromjsonschema.js');

const isModel = (target) => {
  if (hasBrand(target, 'Schema')) return false;
  if (hasBrand(target, 'Model')) return true;
  throw invalidTarget('A Schema or a Model is expected');
};

// The JSON Schema document of a schema, or of a model (every entity as a
// definition, or the entity `options.root`).
const toJSONSchema = (target, options) =>
  isModel(target)
    ? generators.modelToJSONSchema(target, options)
    : generators.toJSONSchema(target, options);

// The TypeScript interface of a schema, or the interfaces of every entity
// of a model in dependency order.
const toTypeScript = (target, options) =>
  isModel(target)
    ? typescript.modelToTypeScript(target, options)
    : typescript.toInterface(target, options);

// Async, so that an error of the rendering (a target that is neither, a type
// with no form) is the rejection the typings promise, never a throw.
const saveTypes = async (outputFile, target, options) =>
  writeFile(outputFile, toTypeScript(target, options));

const schemaMethods = {
  toJSONSchema(options) {
    return generators.toJSONSchema(this, options);
  },
  toInterface(options) {
    return typescript.toInterface(this, options);
  },
};

const modelMethods = {
  toJSONSchema(options) {
    return generators.modelToJSONSchema(this, options);
  },
  toTypeScript(options) {
    return typescript.modelToTypeScript(this, options);
  },
  get dts() {
    return typescript.modelToTypeScript(this);
  },
};

// Installed like class members: not enumerable, so a loop over a schema
// never sees them. A copy per subpath rather than a helper of the core: the
// core is measured on its own, the subpaths on top of it.
const install = (prototype, members) => {
  const descriptors = Object.getOwnPropertyDescriptors(members);
  for (const name in descriptors) {
    descriptors[name].enumerable = false;
    Object.defineProperty(prototype, name, descriptors[name]);
  }
};

let registered = false;

// Adds `toJSONSchema` and `toInterface` to every schema, `toJSONSchema`,
// `toTypeScript` and `dts` to every model, `Schema.fromJSONSchema`, and the
// `jsonSchema` converter of Standard JSON Schema to `schema['~standard']`
// (built once per schema, on top of the props the core builds). Once per
// process.
const register = () => {
  if (registered) return;
  registered = true;
  install(Schema.prototype, schemaMethods);
  install(Model.prototype, modelMethods);
  install(Schema, { fromJSONSchema });
  const standard = Object.getOwnPropertyDescriptor(Schema.prototype, '~standard');
  const { get } = standard;
  standard.get = function withConverter() {
    const props = get.call(this);
    if (props.jsonSchema === undefined) props.jsonSchema = generators.standardConverter(this);
    return props;
  };
  Object.defineProperty(Schema.prototype, '~standard', standard);
};

module.exports = { toJSONSchema, toTypeScript, saveTypes, fromJSONSchema, register };
