// The indexes of a schema as MongoDB's `createIndexes` takes them: the
// index definitions of the schema (`{ naturalKey: { unique: [...] } }`, named
// after their key) and the fields marked `unique`, `index` or `primary`,
// nested structs and the structs of lists included, by their dotted paths.
// `_id` is MongoDB's primary key, so `primary` is a unique index; a unique
// field that may be missing is a sparse index. Data only: the program calls
// the driver.
const { hasBrand, define } = require('../util.js');
const { isStruct } = require('../struct.js');
const { infoOf } = require('../codec.js');
const { idFieldOf } = require('../kinds.js');
const { invalidTarget } = require('../errors.js');
const { idOf } = require('./bson.js');
const { SHAPES } = require('./document.js');

const { NESTED, LIST } = SHAPES;

const keyOf = (columns) => {
  const key = {};
  for (const column of columns) define(key, column, 1);
  return key;
};

// The struct a field holds, itself or as the element of a list, or null.
const structOf = (field) => {
  let node = field;
  if (infoOf(node).shape === LIST) node = node.value;
  return infoOf(node).shape === NESTED && isStruct(node.schema) ? node.schema : null;
};

const marked = (fields, prefix, skip, list) => {
  for (const name in fields) {
    const field = fields[name];
    if (name === skip || !hasBrand(field, 'Type')) continue;
    const path = prefix + name;
    if (field.unique === true || field.primary === true || field.index === true) {
      const index = { key: keyOf([path]) };
      if (field.unique === true || field.primary === true) {
        index.unique = true;
        if (!field.required) index.sparse = true;
      }
      list.push(index);
    }
    const struct = structOf(field);
    if (struct !== null) marked(struct, `${path}.`, null, list);
  }
};

const indexesOfSchema = (schema) => {
  const list = [];
  for (const name in schema.indexes) {
    const index = schema.indexes[name];
    if (index.many !== undefined) continue;
    const entry = { key: keyOf(index.index || index.primary || index.unique), name };
    if (index.unique !== undefined || index.primary !== undefined) entry.unique = true;
    list.push(entry);
  }
  marked(schema.fields, '', idOf(schema), list);
  return list;
};

// The indexes of a schema, or of every stored entity of a model by name: a
// collection is what a stored kind (one with an id field) is kept in.
const indexesOf = (target) => {
  if (hasBrand(target, 'Schema') && isStruct(target.fields)) return indexesOfSchema(target);
  if (!hasBrand(target, 'Model')) {
    throw invalidTarget('A Schema of a struct or a Model is expected');
  }
  const out = {};
  for (const name of target.order) {
    const schema = target.entities.get(name);
    if (idFieldOf(schema) !== null && isStruct(schema.fields)) {
      define(out, name, indexesOfSchema(schema));
    }
  }
  return out;
};

module.exports = { indexesOf };
