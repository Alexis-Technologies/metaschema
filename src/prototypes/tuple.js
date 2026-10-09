const { SchemaDefinitionError } = require('../errors.js');
const { ValidationResult } = require('../metadata.js');
const { issue } = require('../util.js');

const notScalar = (element) => {
  const shown = typeof element === 'string' ? `"${element}"` : JSON.stringify(element);
  const reason = `Tuple element ${shown} is not a scalar type`;
  return new SchemaDefinitionError('ERR_INVALID_TUPLE', reason);
};

const tuple = {
  kind: 'struct',

  construct(def, prep) {
    const elements = def.value || def.tuple;
    this.value = elements.map((element) => {
      const named = typeof element !== 'string';
      const pair = named ? Object.entries(element)[0] : [null, element];
      const name = pair[0];
      const scalar = pair[1];
      const { Type, defs } = prep.parse(scalar);
      if (!Type || Type.kind !== 'scalar') throw notScalar(scalar);
      const type = new Type(defs, prep);
      if (name) type.name = name;
      return type;
    });
  },

  checkType(source, path) {
    if (!Array.isArray(source)) return issue('type', path, `not of expected type: ${this.type}`);
    if (source.length > this.value.length) {
      return issue('length', path, 'value length is more than expected in tuple');
    }
    const result = new ValidationResult(path);
    for (let index = 0; index < this.value.length; index += 1) {
      if (result.full) break;
      const scalar = this.value[index];
      const itemName = scalar.name || 'item';
      result.add(scalar.check(source[index], `${path}(${itemName}${index})`));
    }
    return result;
  },
};

module.exports = { tuple };
