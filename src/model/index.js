// The `./model` subpath: the model as the source of truth. A model restored
// from its snapshot (`fromJSON`), the changes between two versions and their
// compatibility class (`diff`, `compatibility`, `compatibilityOf`), a value
// a schema accepts (`sample`), two schemas as one (`merge`), a definition
// from the values that exist (`infer`), kept out of the core entry so that a
// program that only validates does not carry them. The functions take
// Models, Schemas, snapshots or samples; `register()` installs them as
// members of the classes for the programs that want the methods.
const { Schema } = require('../schema.js');
const { Model } = require('../model.js');
const { fromJSON } = require('./restore.js');
const { diff, compatibility, compatibilityOf } = require('./diff.js');
const { sample } = require('./sample.js');
const { merge } = require('./merge.js');
const { infer } = require('./infer.js');

// Installed like class members: not enumerable.
const install = (target, members) => {
  const descriptors = Object.getOwnPropertyDescriptors(members);
  for (const name in descriptors) {
    descriptors[name].enumerable = false;
    Object.defineProperty(target, name, descriptors[name]);
  }
};

let registered = false;

// Adds `Model.fromJSON`, `Model.diff`, `Model.compatibility` and
// `Model.compatibilityOf`, `Schema.merge`, `Schema.infer` and
// `schema.sample(options)`. Once per process.
const register = () => {
  if (registered) return;
  registered = true;
  install(Model, { fromJSON, diff, compatibility, compatibilityOf });
  install(Schema, { merge, infer });
  install(Schema.prototype, {
    sample(options) {
      return sample(this, options);
    },
  });
};

module.exports = { fromJSON, diff, compatibility, compatibilityOf, sample, merge, infer, register };
