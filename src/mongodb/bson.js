// The BSON side of the `./mongodb` subpath: the types a field holds a value
// of the driver in, and the module of the driver the program registers, the
// one that turns the ids a record carries as strings into ObjectIds. Nothing
// is imported from bson or mongodb: a value of the driver is recognized by
// its `_bsontype` and by a method that JSON cannot give a value (a body of a
// request claiming to be an ObjectId is data), never by `instanceof`, so a
// value of another realm or of another copy of bson is one too.
const { toLowerCamel } = require('../metautil.js');
const { constants } = require('../kinds.js');
const { invalidOption, notRegistered } = require('../errors.js');
const { register: coercion } = require('../coerce/index.js');

// The tag every value of bson carries, and the key of a document.
const TAG = '_bsontype';
const ID = '_id';

const tagOf = (value) => (value !== null && typeof value === 'object' ? value[TAG] : undefined);

const isObjectId = (value) => {
  const tag = tagOf(value);
  return (tag === 'ObjectId' || tag === 'ObjectID') && typeof value.toHexString === 'function';
};

const isDecimal128 = (value) => tagOf(value) === 'Decimal128' && typeof value.toJSON === 'function';

const isBinary = (value) =>
  (tagOf(value) === 'Binary' && typeof value.toJSON === 'function') ||
  Object.prototype.toString.call(value) === '[object Uint8Array]';

const construct = () => {};

// A custom type as a model takes it: the check, the BSON type of the
// mongodb target and the JSON Schema of the value on the wire.
const typeOf = (test, bson, jsonSchema) =>
  Object.freeze({
    construct,
    checkType: (value) => test(value),
    metadata: Object.freeze({ bson, jsonSchema }),
  });

const HEX = /^[0-9a-fA-F]{24}$/;

// The types to give a model: `new Model({ ...types, ...own }, entities)`.
// They are not registered by register(): a type name is a shorthand key of
// a definition, so a program says where it uses them.
const types = Object.freeze({
  objectId: typeOf(isObjectId, 'objectId', { type: 'string', pattern: HEX.source }),
  decimal128: typeOf(isDecimal128, 'decimal', { type: 'string' }),
  binary: typeOf(isBinary, 'binData', { type: 'string', contentEncoding: 'base64' }),
});

// The module of the driver (or of bson) the program registered.
let driver = null;

const driverOf = () => {
  if (driver === null) throw notRegistered('An ObjectId', 'mongodb');
  return driver;
};

// The converters of coercion for the BSON types, the ones parse runs on the
// input of a field of such a type: a 24-digit hex string is an ObjectId, a
// decimal string or a number a Decimal128, base64 text a Binary. What they
// cannot read comes back as it was, for the check to report.
const toObjectId = (value) =>
  typeof value === 'string' && HEX.test(value) ? new driver.ObjectId(value) : value;

const toDecimal128 = (value) => {
  const kind = typeof value;
  if (kind !== 'string' && kind !== 'number') return value;
  return driver.Decimal128.fromString(String(value));
};

// Text of the base64 shape only: the decoder of the driver reads anything,
// and the empty string is never converted.
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const toBinary = (value) =>
  typeof value === 'string' && value.length % 4 === 0 && BASE64.test(value)
    ? driver.Binary.createFromBase64(value)
    : value;

// Takes the module of the driver (`require('mongodb')`, which carries the
// bson it was built with) or of bson, and installs the converters of the
// BSON types into the coercion of `./coerce`. Once: another module after
// the first is an error, since values of the first are in the program.
const register = (options) => {
  const bson = options === null || typeof options !== 'object' ? undefined : options.bson;
  const valid = bson !== null && typeof bson === 'object' && typeof bson.ObjectId === 'function';
  if (!valid) {
    throw invalidOption('bson', 'the module of the mongodb driver or of bson', typeof bson);
  }
  if (driver !== null && driver !== bson) {
    throw invalidOption('bson', 'the module registered before', 'another one');
  }
  driver = bson;
  coercion({ objectId: toObjectId, decimal128: toDecimal128, binary: toBinary });
};

// The id field a stored kind adds (kinds.js names it the same way), which a
// document holds as `_id`, unless the schema has an `_id` of its own.
const idOf = (schema) => {
  const { fields, kind, name } = schema;
  if (!constants.KIND_STORED.includes(kind) || ID in fields) return null;
  return name ? `${toLowerCamel(name)}Id` : 'id';
};

module.exports = { ID, HEX, types, register, driverOf, idOf, isObjectId };
