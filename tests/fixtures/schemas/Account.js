module.exports = {
  Registry: {},

  login: { type: 'string', unique: true },
  password: 'string',
  blocked: { type: 'boolean', default: false },
  company: 'Company',

  fullName: {
    given: { type: 'string', required: false },
    middle: { type: 'string', required: false },
    surname: { type: 'string', required: false },
  },

  // `date` is a type name, so a struct whose first field is called that
  // says it is a struct.
  birth: {
    Struct: {},
    date: { type: 'string', required: false },
    place: { type: 'string', required: false },
  },

  addresses: { many: 'Address' },
};
