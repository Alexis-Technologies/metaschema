// The mark the validation half leaves on the process when it is installed
// (`validation.js`): a schema whose classes have no validation where the
// mark is there is one of another copy of the package.
const VALIDATION = Symbol.for('alexify.metaschema.validation');

// A validator, a custom checkType or a decoder returned a promise to a
// synchronous check or parse: a programming error of the call, not of the
// value, so it throws with a code of its own and names the method to use.
const asyncReturn = (what, where, method) =>
  new SchemaUsageError(`The ${what} of "${where}" returned a promise; use ${method}`, {
    code: 'ALX_ERR_ASYNC_VALIDATOR',
  });

// A function of a subpath was given something other than what it takes (a
// Schema, a Model, a snapshot, a list of changes): the call is wrong, not a
// definition.
const invalidTarget = (message) =>
  new SchemaUsageError(message, { code: 'ALX_ERR_INVALID_TARGET' });

// A call that needs what `register()` of a subpath installs (the converters
// of coercion, the module of the mongodb driver) before that ran: the
// program is wired wrong, not a value or a definition.
const notRegistered = (what, where) =>
  new SchemaUsageError(`${what} needs register() of @alexify/metaschema/${where} first`, {
    code: 'ALX_ERR_NOT_REGISTERED',
  });

// A schema of `./definition` asked to validate before the core entry was
// loaded: the half of the core that validates is not installed into its
// classes, because the core is not loaded, or is loaded from another copy
// of the package (two versions installed side by side, a bundle with two).
const noValidation = (what) => {
  const elsewhere = globalThis[VALIDATION] === true;
  const reason = elsewhere
    ? 'the core entry loaded is another copy of the package than the one that built the ' +
      'schema (deduplicate @alexify/metaschema)'
    : './definition alone does not validate';
  const message = `${what} needs the core entry @alexify/metaschema: ${reason}`;
  return new SchemaUsageError(message, { code: 'ALX_ERR_NOT_REGISTERED', method: what });
};

// A symbol has no JSON, and a template literal throws on it.
const shown = (value) =>
  typeof value === 'bigint' ? `${value}n` : (JSON.stringify(value) ?? String(value));

// An option of a call that is not what it must be (`maxErrors`, the options
// of the stream subpath): an error naming it, with a code of its own.
const invalidOption = (name, expected, value) =>
  new SchemaUsageError(`${name} must be ${expected}, got ${shown(value)}`, {
    code: 'ALX_ERR_INVALID_OPTION',
  });

// A broken definition is a programming error, so it throws instead of being
// collected like a validation error. The throw sites (type parsing, custom type
// registration, projections) rarely know which entity and field they are
// parsing; the struct that owns the field does, and calls `locate` on the way
// up, so the message ends with `in "Entity.field"`. Its constructor is
// Error's, `(message, options = {})`: `options` holds the code, the cause, the
// place it is at (`schema`, `field`, which `locate` writes into the message)
// and the fields some codes carry (`index`, the sample infer could not
// accept; `seed`, the draw nothing satisfies), and goes to `super` whole, so
// `cause` is set only when given. Every field is set here, none afterwards.
class SchemaDefinitionError extends TypeError {
  #reason;

  constructor(message, options = {}) {
    super(message, options);
    const { code = 'ALX_ERR_INVALID_DEFINITION', schema = '', field = '', index, seed } = options;
    this.code = code;
    this.schema = schema;
    this.field = field;
    this.#reason = message;
    if (index !== undefined) this.index = index;
    if (seed !== undefined) this.seed = seed;
  }

  // A `field` of '' locates an error of the schema as a whole at the schema.
  locate(schema, field) {
    this.schema = schema;
    if (field !== '') this.field = this.field ? `${field}.${this.field}` : field;
    let location = this.field;
    if (schema !== '') location = this.field === '' ? schema : `${schema}.${this.field}`;
    this.message = `${this.#reason} in "${location}"`;
    return this;
  }
}

SchemaDefinitionError.prototype.name = 'SchemaDefinitionError';

// A call that is wrong, where a definition is not: a target or an option
// it does not take, a method that needs what a `register()` installs, a
// promise where the call is synchronous, an invalid record a stream was
// not told to drop. A TypeError, as it was a plain one until 4.0, made as
// SchemaDefinitionError is: `(message, options = {})`, with the code, the
// cause and the fields some codes carry in `options` (the record of a stream,
// its position and its result; the method a schema of `./definition` was
// asked for).
class SchemaUsageError extends TypeError {
  constructor(message, options = {}) {
    super(message, options);
    const { code = 'ALX_ERR_INVALID_TARGET', index, record, result, method } = options;
    this.code = code;
    if (index !== undefined) this.index = index;
    if (record !== undefined) this.record = record;
    if (result !== undefined) this.result = result;
    if (method !== undefined) this.method = method;
  }
}

SchemaUsageError.prototype.name = 'SchemaUsageError';

module.exports = {
  SchemaDefinitionError,
  SchemaUsageError,
  VALIDATION,
  asyncReturn,
  invalidTarget,
  notRegistered,
  noValidation,
  invalidOption,
};
