// The BSON side of the `./mongodb` subpath: the types a field holds a value
// of the driver in, and the module of the driver the program registers, the
// one that turns the ids a record carries as strings into ObjectIds. Nothing
// is imported from bson or mongodb: a value of the driver is recognized by
// its `_bsontype` and by a method that JSON cannot give a value (a body of a
// request claiming to be an ObjectId is data), never by `instanceof`, so a
// value of another realm or of another copy of bson is one too.
const { idFieldOf } = require('../kinds.js');
const { invalidOption, notRegistered } = require('../errors.js');
const { isBytes } = require('../util.js');
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

// The bytes of a Binary of the driver, the view `bytes` holds, or null.
const binaryBytes = (value) =>
  tagOf(value) === 'Binary' && typeof value.toJSON === 'function' && isBytes(value.buffer)
    ? value.buffer.subarray(0, value.position)
    : null;

const isBinary = (value) =>
  (tagOf(value) === 'Binary' && typeof value.toJSON === 'function') || isBytes(value);

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

// A decimal written as one (`fromString` of the driver reads `NaN`, `inf`
// and an exponent too), or a finite number.
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

const toDecimal128 = (value) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? driver.Decimal128.fromString(String(value)) : value;
  }
  return typeof value === 'string' && DECIMAL.test(value)
    ? driver.Decimal128.fromString(value)
    : value;
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
// BSON types into the coercion of `./coerce`: the one of a type the module
// cannot build (a slim build without `Decimal128` or `Binary`) is not
// installed, so that such a value is reported by the check rather than
// lost in a converter that throws. Once: another module after the first is
// an error, since values of the first are in the program.
const register = (options) => {
  const bson = options === null || typeof options !== 'object' ? undefined : options.bson;
  const valid = bson !== null && typeof bson === 'object' && typeof bson.ObjectId === 'function';
  if (!valid) {
    throw invalidOption('bson', 'the module of the mongodb driver or of bson', typeof bson);
  }
  if (driver !== null && driver !== bson) {
    throw invalidOption('bson', 'the module registered before', 'another one');
  }
  const converters = { objectId: toObjectId };
  if (typeof bson.Decimal128?.fromString === 'function') converters.decimal128 = toDecimal128;
  if (typeof bson.Binary?.createFromBase64 === 'function') converters.binary = toBinary;
  driver = bson;
  coercion(converters);
};

// The id field a stored kind adds, which a document holds as `_id`, unless
// the schema has an `_id` of its own.
const idOf = (schema) => {
  const id = idFieldOf(schema);
  return id === null || ID in schema.fields ? null : id;
};

module.exports = { ID, HEX, types, register, driverOf, idOf, isObjectId, binaryBytes };
