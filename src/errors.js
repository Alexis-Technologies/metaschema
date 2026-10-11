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

module.exports = { SchemaDefinitionError, asyncReturn };
