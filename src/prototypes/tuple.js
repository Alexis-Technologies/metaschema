const { formatters } = require('../util.js');
const { SchemaDefinitionError } = require('../errors.js');

const invalidTuple = (reason) =>
  new SchemaDefinitionError(`Tuple ${reason}`, { code: 'ALX_ERR_INVALID_TUPLE' });

// A named element is `{ name: 'type' }`: one key that is not `type` or a type
// name, holding a type name (a string is no metadata of a kind, so `{ X:
// 'number' }` is a name too). Anything else is a definition of its own (a
// nested struct, a collection, a tuple).
const nameOf = (element, types) => {
  if (element === null || typeof element !== 'object' || Array.isArray(element)) return null;
  const keys = Object.keys(element);
  if (keys.length !== 1 || typeof element[keys[0]] !== 'string') return null;
  const { field } = formatters.key(keys[0]);
  if (field === 'type' || types[field]) return null;
  return keys[0];
};

const tuple = {
  kind: 'struct',
  options: ['value', 'tuple'],

  construct(def, preprocessor) {
    const elements = def.value || def.tuple;
    if (!Array.isArray(elements)) throw invalidTuple('needs a list of element definitions');
    const built = [];
    for (let index = 0; index < elements.length; index += 1) {
      const element = elements[index];
      const key = nameOf(element, preprocessor.types);
      const source = key === null ? element : element[key];
      const { Type, defs } = preprocessor.parse(source);
      if (!Type) throw invalidTuple(`element ${index} cannot be a function`);
      let name = null;
      if (key !== null) {
        const parsed = formatters.key(key);
        defs.required = (defs.required ?? true) && parsed.required;
        name = parsed.field;
      }
      const type = new Type(defs, preprocessor);
      if (name !== null) type.name = name;
      built.push(type);
    }
    this.value = built;
  },
};

module.exports = { tuple };
