const { isFirstUpper } = require('../metautil.js');
const { formatters } = require('../util.js');
const { SchemaDefinitionError } = require('../errors.js');
const { issues } = require('../issues.js');

const invalidTuple = (reason) => new SchemaDefinitionError('ERR_INVALID_TUPLE', `Tuple ${reason}`);

// A named element is `{ name: 'type' }`: one key that is not `type`, a type
// name or a kind, holding a type name. Anything else is a definition of its
// own (a nested struct, a collection, a tuple).
const nameOf = (element, types) => {
  if (element === null || typeof element !== 'object' || Array.isArray(element)) return null;
  const keys = Object.keys(element);
  if (keys.length !== 1 || typeof element[keys[0]] !== 'string') return null;
  const { field } = formatters.key(keys[0]);
  if (field === 'type' || types[field] || isFirstUpper(field)) return null;
  return keys[0];
};

const tuple = {
  kind: 'struct',

  construct(def, prep) {
    const elements = def.value || def.tuple;
    if (!Array.isArray(elements)) throw invalidTuple('needs a list of element definitions');
    this.value = elements.map((element, index) => {
      const key = nameOf(element, prep.types);
      const source = key === null ? element : element[key];
      const { Type, defs } = prep.parse(source);
      if (!Type) throw invalidTuple(`element ${index} cannot be a function`);
      if (key !== null) {
        const { field, required } = formatters.key(key);
        defs.required = (defs.required ?? true) && required;
        const type = new Type(defs, prep);
        type.name = field;
        return type;
      }
      return new Type(defs, prep);
    });
  },

  compile() {
    const { required, type } = this;
    const checks = this.value.map((element) => element.check);
    const { length } = checks;
    return (value, context, key) => {
      if (!Array.isArray(value)) {
        if (!required && value == null) return;
        issues.type(context, type, value, key);
        return;
      }
      if (value.length > length) {
        issues.length(context, undefined, length, value.length, key);
        return;
      }
      const nested = key !== undefined;
      if (nested) context.path.push(key);
      for (let index = 0; index < length; index += 1) {
        if (context.count >= context.limit) break;
        checks[index](value[index], context, index);
      }
      if (nested) context.path.pop();
    };
  },
};

module.exports = { tuple };
