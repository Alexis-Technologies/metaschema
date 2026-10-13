// A broken definition is a programming error, so it throws instead of being
// collected like a validation error. The throw sites (type parsing, custom type
// registration, projections) rarely know which entity and field they are
// parsing; the struct that owns the field does, and calls `locate` on the way
// up, so the message ends with `in "Entity.field"`.
class SchemaDefinitionError extends TypeError {
  #reason;

  constructor(code, reason) {
    super(reason);
    this.code = code;
    this.schema = '';
    this.field = '';
    this.#reason = reason;
  }

  locate(schema, field) {
    this.schema = schema;
    this.field = this.field ? `${field}.${this.field}` : field;
    const location = schema ? `${schema}.${this.field}` : this.field;
    this.message = `${this.#reason} in "${location}"`;
    return this;
  }
}

SchemaDefinitionError.prototype.name = 'SchemaDefinitionError';

// A validator, a custom checkType or a decoder returned a promise to a
// synchronous check or parse: a programming error of the call, not of the
// value, so it throws with a code of its own and names the method to use.
const asyncReturn = (what, where, method) => {
  const error = new TypeError(`The ${what} of "${where}" returned a promise; use ${method}`);
  error.code = 'ERR_ASYNC_VALIDATOR';
  return error;
};

// A function of a subpath was given something other than what it takes (a
// Schema, a Model, a snapshot, a list of changes): the call is wrong, not a
// definition, so a plain TypeError with a code of its own, like asyncReturn.
const invalidTarget = (message) => {
  const error = new TypeError(message);
  error.code = 'ERR_INVALID_TARGET';
  return error;
};

// A call that needs what `register()` of a subpath installs (the converters
// of coercion, the module of the mongodb driver) before that ran: the
// program is wired wrong, not a value or a definition.
const notRegistered = (what, where) => {
  const error = new TypeError(`${what} needs register() of @alexify/metaschema/${where} first`);
  error.code = 'ERR_NOT_REGISTERED';
  return error;
};

const shown = (value) =>
  typeof value === 'bigint' ? `${value}n` : (JSON.stringify(value) ?? String(value));

// An option of a call that is not what it must be (`maxErrors`, the options
// of the stream subpath): a TypeError naming it, as invalidTarget is.
const invalidOption = (name, expected, value) =>
  new TypeError(`${name} must be ${expected}, got ${shown(value)}`);

module.exports = {
  SchemaDefinitionError,
  asyncReturn,
  invalidTarget,
  notRegistered,
  invalidOption,
};
