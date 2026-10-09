const { SchemaDefinitionError } = require('../errors.js');
const { issues } = require('../issues.js');

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

  compile() {
    const { required, type } = this;
    const checks = this.value.map((element) => element.check);
    const { length } = checks;
    return (value, context, key) => {
      if (!Array.isArray(value)) {
        if (!required && (value === null || value === undefined)) return;
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
