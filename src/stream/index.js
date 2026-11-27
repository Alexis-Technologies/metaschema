// The `./stream` subpath: a schema over a sequence of records. `checkEach`
// and `parseEach` run `check` or `parse` on every record of an iterable and
// yield `{ index, record, result }` in the order of the records; the async
// pair does the same over a sync or async iterable with `checkAsync` or
// `parseAsync`, keeping up to `concurrency` records in flight; `transform`
// is a TransformStream that lets the valid records (or their parsed values)
// through and reports the others. Kept out of the core entry so that a
// program that validates one value at a time does not carry it; `register()`
// installs the methods on Schema for the programs that want them.
const { hasBrand } = require('../util.js');
const { abandon } = require('../issues.js');
const { SchemaUsageError, invalidTarget, invalidOption: invalid } = require('../errors.js');
const { Schema } = require('../validation.js');

const optionsOf = (options) => {
  if (options === undefined || (options !== null && typeof options === 'object')) return options;
  throw invalid('options', 'an object', options);
};

// How many invalid records end the iteration: a whole number, or no limit.
const limitOf = (options) => {
  const limit = optionsOf(options)?.maxInvalid;
  if (limit === undefined) return Infinity;
  if ((Number.isInteger(limit) || limit === Infinity) && limit >= 1) return limit;
  throw invalid('maxInvalid', 'an integer of at least 1', limit);
};

// How many records an async iteration keeps in flight: one unless asked.
const widthOf = (options) => {
  const width = options?.concurrency;
  if (width === undefined) return 1;
  if (Number.isInteger(width) && width >= 1) return width;
  throw invalid('concurrency', 'an integer of at least 1', width);
};

const modeOf = (options) => {
  const mode = options?.mode;
  if (mode === undefined) return 'parse';
  if (mode === 'parse' || mode === 'check') return mode;
  throw invalid('mode', '"parse" or "check"', mode);
};

const asyncOf = (options) => {
  const async = options?.async;
  if (async === undefined || typeof async === 'boolean') return async === true;
  throw invalid('async', 'a boolean', async);
};

const callbackOf = (options) => {
  const onInvalid = options?.onInvalid;
  if (onInvalid === undefined || typeof onInvalid === 'function') return onInvalid;
  throw invalid('onInvalid', 'a function', onInvalid);
};

const schemaOf = (schema) => {
  if (!hasBrand(schema, 'Schema')) throw invalidTarget('A Schema is expected');
  return schema;
};

// A sequence of records: anything with an iterator, or an async one where
// the iteration is async. A string is iterable and surely a mistake.
const recordsOf = (records, async) => {
  const ruledOut = records === undefined || records === null || typeof records === 'string';
  const sync = !ruledOut && typeof records[Symbol.iterator] === 'function';
  const streamed = !ruledOut && async && typeof records[Symbol.asyncIterator] === 'function';
  if (!sync && !streamed) throw invalidTarget('An iterable of records is expected');
  return records;
};

// The method of the schema a function of the subpath runs on each record.
const CHECK = (schema, record, options) => schema.check(record, options);
const PARSE = (schema, record, options) => schema.parse(record, options);
const CHECK_ASYNC = (schema, record, options) => schema.checkAsync(record, options);
const PARSE_ASYNC = (schema, record, options) => schema.parseAsync(record, options);

const callOf = (async, parse) => {
  if (async) return parse ? PARSE_ASYNC : CHECK_ASYNC;
  return parse ? PARSE : CHECK;
};

// One record after the other. The entry of a record carries its position,
// since an iterator has none, and the record itself, since a stream cannot
// be read again. The options are handed to check or parse as given (they
// read the keys they know), so nothing is allocated per record beyond what
// the check itself allocates and the entry.
const each = function* (schema, records, options, limit, call) {
  let failed = 0;
  let index = 0;
  for (const record of records) {
    const result = call(schema, record, options);
    yield { index, record, result };
    index += 1;
    if (!result.valid && (failed += 1) >= limit) return;
  }
};

// A source the async pair reads with for await. An async iterable is read as
// it is; a sync one through an async iterator of its own steps, which awaits
// an element that is a Promise (the documented contract) and nothing else:
// for await over a sync iterable adopts every thenable, and a record with a
// `then` of its own would come out as what that `then` resolves to, where a
// value of the program is data (as for the passes of parse).
const stepsOf = (records) => {
  if (typeof records[Symbol.asyncIterator] === 'function') return records;
  const iterator = records[Symbol.iterator]();
  const next = () => {
    const step = iterator.next();
    if (step.done || !(step.value instanceof Promise)) return Promise.resolve(step);
    return step.value.then((value) => ({ value, done: false }));
  };
  const close = (value) => {
    const step = typeof iterator.return === 'function' ? iterator.return(value) : { done: true };
    return Promise.resolve(step);
  };
  const steps = { next, return: close };
  return { [Symbol.asyncIterator]: () => steps };
};

// The async pair over a sync or async iterable: up to `width` records are
// checked at once, the entries come out in the order of the records, and the
// promises still in flight when the iteration ends early (`maxInvalid`, a
// consumer that stops, a record whose parse throws) are observed, never
// awaited. The queue is as long as `width`, which is small by design.
const eachAsync = async function* (schema, records, options, limit, width, call) {
  const queue = [];
  let failed = 0;
  let index = 0;
  try {
    for await (const record of stepsOf(records)) {
      const result = call(schema, record, options);
      // Observed from the start: a record that rejects while an earlier one
      // is still awaited would reject unhandled before its turn (the await
      // of its entry still throws it).
      abandon(result);
      queue.push({ index, record, result });
      index += 1;
      if (queue.length < width) continue;
      const entry = queue.shift();
      entry.result = await entry.result;
      yield entry;
      if (!entry.result.valid && (failed += 1) >= limit) return;
    }
    while (queue.length > 0) {
      const entry = queue.shift();
      entry.result = await entry.result;
      yield entry;
      if (!entry.result.valid && (failed += 1) >= limit) return;
    }
  } finally {
    for (let at = 0; at < queue.length; at += 1) abandon(queue[at].result);
  }
};

const checkEach = (schema, records, options) =>
  each(schemaOf(schema), recordsOf(records, false), options, limitOf(options), CHECK);

const parseEach = (schema, records, options) =>
  each(schemaOf(schema), recordsOf(records, false), options, limitOf(options), PARSE);

const checkEachAsync = (schema, records, options) => {
  const limit = limitOf(options);
  return eachAsync(
    schemaOf(schema),
    recordsOf(records, true),
    options,
    limit,
    widthOf(options),
    CHECK_ASYNC,
  );
};

const parseEachAsync = (schema, records, options) => {
  const limit = limitOf(options);
  return eachAsync(
    schemaOf(schema),
    recordsOf(records, true),
    options,
    limit,
    widthOf(options),
    PARSE_ASYNC,
  );
};

// The error a stream ends with: the record, its position and its result
// travel on it, since the stream carries them no further.
const invalidRecord = (index, record, result) => {
  const message = `Record ${index} is invalid`;
  return new SchemaUsageError(message, { code: 'ALX_ERR_INVALID_RECORD', index, record, result });
};

// A TransformStream over the records of a stream: a valid record goes on as
// its parsed value (or as it is, in `check` mode); an invalid one is handed
// to `onInvalid` and dropped, or ends the stream with the error when there
// is no `onInvalid` or `maxInvalid` is reached. A stream that ends looks
// complete to what reads it, so it cannot stop quietly as a generator does.
// The stream handles one record at a time, so the async methods settle in
// order too.
const transform = (schema, options) => {
  schemaOf(schema);
  const limit = limitOf(options);
  const mode = modeOf(options);
  const async = asyncOf(options);
  const onInvalid = callbackOf(options);
  const parse = mode === 'parse';
  const call = callOf(async, parse);
  let failed = 0;
  let index = 0;
  const settle = (record, result, controller) => {
    const at = index;
    index += 1;
    if (result.valid) return void controller.enqueue(parse ? result.value : record);
    failed += 1;
    if (onInvalid !== undefined) onInvalid(record, result, at);
    if (onInvalid === undefined || failed >= limit) {
      controller.error(invalidRecord(at, record, result));
    }
  };
  return new TransformStream({
    transform(record, controller) {
      const result = call(schema, record, options);
      if (!async) return settle(record, result, controller);
      return result.then((settled) => settle(record, settled, controller));
    },
  });
};

// Installed like class members: not enumerable. A copy per subpath rather
// than a helper of the core: the core is measured on its own, the subpaths
// on top of it.
const install = (target, members) => {
  const descriptors = Object.getOwnPropertyDescriptors(members);
  for (const name in descriptors) {
    descriptors[name].enumerable = false;
    Object.defineProperty(target, name, descriptors[name]);
  }
};

let registered = false;

// Adds `schema.checkEach`, `schema.parseEach`, `schema.checkEachAsync`,
// `schema.parseEachAsync` and `schema.transform`. Once per process.
const register = () => {
  if (registered) return;
  registered = true;
  install(Schema.prototype, {
    checkEach(records, options) {
      return checkEach(this, records, options);
    },
    parseEach(records, options) {
      return parseEach(this, records, options);
    },
    checkEachAsync(records, options) {
      return checkEachAsync(this, records, options);
    },
    parseEachAsync(records, options) {
      return parseEachAsync(this, records, options);
    },
    transform(options) {
      return transform(this, options);
    },
  });
};

module.exports = { checkEach, parseEach, checkEachAsync, parseEachAsync, transform, register };
