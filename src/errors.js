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

module.exports = { SchemaDefinitionError };
