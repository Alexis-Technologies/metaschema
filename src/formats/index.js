// The `./formats` subpath: the formats a string field may name
// (`{ type: 'string', format: 'email' }`). The core knows the rule and keeps
// an empty table (`FORMATS` in rules.js); `register()` fills it with the
// formats below and with the program's own, so that a program that
// validates no email carries no email expression. Each format is a `test`
// function over a string, a few `examples` for `sample`, whether `infer` may
// read it out of data (a format ordinary words pass, like a hostname or a
// slug, says not to), and for some a `pattern` the JSON Schema export
// writes beside the name, a shape that never rejects what the test accepts.
//
// The expressions are copied, with the attribution the project gives for a
// helper it carries instead of a dependency, from:
// - ajv-formats 3.0.1 (MIT, Copyright (c) 2020 Evgeny Poberezkin): email,
//   uuid, uri, hostname, ipv4 and ipv6 of its fast mode, duration,
//   uri-template, json-pointer and relative-json-pointer of its full mode,
//   uri-reference of its fast mode, the shape of base64 (`byte`);
// - zod 4.6 (MIT, Copyright (c) 2025 Colin McDonnell): ulid, nanoid, e164,
//   hex, emoji, the cidr prefixes, the shapes of a card number and an IBAN,
//   the reading of base64, base64url and a JWT (without `atob` on the
//   payload, and an `alg` that is a string);
// - valibot 1.5 (MIT, Copyright (c) Fabian Hiller): cuid2, slug, hex-color
//   and the MAC-48 forms;
// - semver.org (CC BY 3.0): the expression of a semantic version.
// They are anchored and linear, every repetition bounded or separated by a
// character its class excludes. A repeated group with an alternative in it
// (`(?:a|bc)*`) is linear in time but not in the stack of the engine, which
// overflows on a string of megabytes: the forms that had one (an email's
// domain, a JSON pointer, a URI template, a slug, a semantic version) are
// read by a scanner over the string instead, with the same verdicts, and
// the expression stays as the `pattern` of the export where there is one.
// The date and time forms are RFC 3339 with the ranges checked (a 31st of
// February is not a date), and `url` is an http or https address whose host
// is a hostname or an address.
const { FORMATS } = require('../rules.js');
const { SchemaDefinitionError } = require('../errors.js');

const invalidFormat = (name, reason) =>
  new SchemaDefinitionError('ERR_INVALID_FORMAT', `Format "${name}" ${reason}`);

// ajv-formats' fast email: a local part of its characters, an `@`, and
// labels of at most 63 characters joined by dots.
const LOCAL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i;

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

const isEmail = (text) => {
  const at = text.indexOf('@');
  if (at < 1 || !LOCAL.test(text.slice(0, at))) return false;
  const labels = text.slice(at + 1).split('.');
  for (let index = 0; index < labels.length; index += 1) {
    if (!LABEL.test(labels[index])) return false;
  }
  return true;
};

const UUID = /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

const URI = /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/)?[^\s]*$/i;

const HOSTNAME =
  /^(?=.{1,253}\.?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[-0-9a-z]{0,61}[0-9a-z])?)*\.?$/i;

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

const IPV6 =
  /^((([0-9a-f]{1,4}:){7}([0-9a-f]{1,4}|:))|(([0-9a-f]{1,4}:){6}(:[0-9a-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){5}(((:[0-9a-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){4}(((:[0-9a-f]{1,4}){1,3})|((:[0-9a-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){3}(((:[0-9a-f]{1,4}){1,4})|((:[0-9a-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){2}(((:[0-9a-f]{1,4}){1,5})|((:[0-9a-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){1}(((:[0-9a-f]{1,4}){1,6})|((:[0-9a-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9a-f]{1,4}){1,7})|((:[0-9a-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))$/i;

// A full-date of RFC 3339 with the day within its month, and a full-time
// (an offset is required, as the RFC says; a leap second is allowed).
const DATE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

const DAYS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const isDate = (text) => {
  const match = DATE.exec(text);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const leap = month === 2 && year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return Number(match[3]) <= DAYS[month] + (leap ? 1 : 0);
};

// A partial-time with or without its offset: `time` needs one, as the RFC
// says, `iso-time` does not (ajv-formats' names); a leap second is allowed.
const TIME =
  /^([01]\d|2[0-3]):([0-5]\d):([0-5]\d|60)(?:\.\d+)?(?:([zZ])|([+-])([01]\d|2[0-3])(?::?([0-5]\d))?)?$/;

// A leap second is the one of 23:59:60 UTC, whatever the offset says.
const timeOf = (zoned) => (text) => {
  const match = TIME.exec(text);
  if (match === null) return false;
  if (zoned && match[4] === undefined && match[5] === undefined) return false;
  if (match[3] !== '60') return true;
  const sign = match[5] === '-' ? -1 : 1;
  const offset =
    match[5] === undefined ? 0 : sign * (Number(match[6]) * 60 + Number(match[7] ?? 0));
  const minutes = (Number(match[1]) * 60 + Number(match[2]) - offset + 1440) % 1440;
  return minutes === 23 * 60 + 59;
};

const isTime = timeOf(true);

const isIsoTime = timeOf(false);

// A date-time is the two joined by `T` (or, as the RFC allows for
// readability, a space).
const dateTimeOf = (time) => (text) =>
  text.length > 11 &&
  (text[10] === 'T' || text[10] === 't' || text[10] === ' ') &&
  isDate(text.slice(0, 10)) &&
  time(text.slice(11));

const DURATION = /^P(?!$)((\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?|(\d+W)?)$/;

const URI_REFERENCE = /^(?:(?:[a-z][a-z0-9+\-.]*:)?\/?\/)?(?:[^\\\s#][^\s#]*)?(?:#[^\\\s]*)?$/i;

// Every character from `from` to `to` is one `allowed` accepts or a
// percent-encoded byte.
const HEX2 = /^[0-9a-f]{2}$/i;

const encoded = (text, from, to, allowed) => {
  let index = from;
  while (index < to) {
    if (text[index] === '%') {
      if (index + 3 > to || !HEX2.test(text.slice(index + 1, index + 3))) return false;
      index += 3;
    } else {
      if (!allowed.test(text[index])) return false;
      index += 1;
    }
  }
  return true;
};

// A URI template of RFC 6570 as ajv-formats reads it: literals outside the
// braces, and in each pair of braces an optional operator and a list of
// variable names, each with an optional prefix (`:1` to `:9999`) or `*`.
// oxlint-disable-next-line no-control-regex
const LITERAL = /[^\x00-\x20"'<>%\\^`{|}]/;

const VARCHAR = /[a-z0-9_]/i;

const OPERATOR = /[+#./;?&=,!@|]/;

const MODIFIER = /^:[1-9][0-9]{0,3}$/;

const isVariable = (spec) => {
  let name = spec;
  if (spec.endsWith('*')) name = spec.slice(0, -1);
  else {
    const colon = spec.indexOf(':');
    if (colon !== -1) {
      if (!MODIFIER.test(spec.slice(colon))) return false;
      name = spec.slice(0, colon);
    }
  }
  return name !== '' && encoded(name, 0, name.length, VARCHAR);
};

const isExpression = (expression) => {
  const body = OPERATOR.test(expression[0] ?? '') ? expression.slice(1) : expression;
  if (body === '') return false;
  const specs = body.split(',');
  for (let index = 0; index < specs.length; index += 1) {
    if (!isVariable(specs[index])) return false;
  }
  return true;
};

const isTemplate = (text) => {
  let index = 0;
  for (;;) {
    const open = text.indexOf('{', index);
    if (!encoded(text, index, open === -1 ? text.length : open, LITERAL)) return false;
    if (open === -1) return true;
    const close = text.indexOf('}', open + 1);
    if (close === -1 || !isExpression(text.slice(open + 1, close))) return false;
    index = close + 1;
  }
};

// A JSON pointer of RFC 6901: empty, or segments led by `/` in which a `~`
// escapes a `0` or a `1` and nothing else.
const isPointer = (text) => {
  if (text === '') return true;
  if (text[0] !== '/') return false;
  for (let at = text.indexOf('~'); at !== -1; at = text.indexOf('~', at + 2)) {
    const next = text[at + 1];
    if (next !== '0' && next !== '1') return false;
  }
  return true;
};

const RELATIVE = /^(?:0|[1-9][0-9]*)/;

const isRelativePointer = (text) => {
  const match = RELATIVE.exec(text);
  if (match === null) return false;
  const rest = text.slice(match[0].length);
  return rest === '#' || isPointer(rest);
};

// A pattern of JSON Schema 2020-12 is an ECMA-262 expression in unicode
// mode. Compiling one costs memory in proportion to its text (a property
// escape expands as it is parsed), so a text longer than any pattern a
// program writes is not one; `length.max` on the field bounds it further.
const REGEX_MAX = 4096;

const isRegex = (text) => {
  if (text.length > REGEX_MAX) return false;
  try {
    return RegExp(text, 'u') instanceof RegExp;
  } catch {
    return false;
  }
};

const ULID = /^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$/;

const NANOID = /^[\w-]{21}$/;

const CUID2 = /^[a-z][0-9a-z]{1,31}$/;

const E164 = /^\+[1-9]\d{6,14}$/;

const HEX = /^[0-9a-fA-F]*$/;

const HEX_COLOR = /^#(?:[\da-fA-F]{3,4}|[\da-fA-F]{6}|[\da-fA-F]{8})$/;

// Words of digits and lowercase letters joined by single dashes or
// underscores (valibot's slug); the expression is the pattern of the export.
const SLUG = /^[\da-z]+(?:[-_][\da-z]+)*$/;

const SLUG_CHARS = /^[\da-z](?:[\da-z_-]*[\da-z])?$/;

const SEPARATORS = /[-_]{2}/;

const isSlug = (text) => SLUG_CHARS.test(text) && !SEPARATORS.test(text);

const MAC =
  /^(?:[\da-fA-F]{2}:){5}[\da-fA-F]{2}$|^(?:[\da-fA-F]{2}-){5}[\da-fA-F]{2}$|^(?:[\da-fA-F]{4}\.){2}[\da-fA-F]{4}$/;

// semver.org's expression, the pattern of the export; the test reads the
// three parts (the core, the pre-release after the first `-`, the build
// after the `+`) and their dot-separated identifiers one by one.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][\dA-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][\dA-Za-z-]*))*))?(?:\+([\dA-Za-z-]+(?:\.[\dA-Za-z-]+)*))?$/;

const CORE = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

const PRERELEASE = /^(?:0|[1-9]\d*|\d*[A-Za-z-][\dA-Za-z-]*)$/;

const BUILD = /^[\dA-Za-z-]+$/;

const identifiers = (text, form) => {
  const parts = text.split('.');
  for (let index = 0; index < parts.length; index += 1) {
    if (!form.test(parts[index])) return false;
  }
  return true;
};

const isSemver = (text) => {
  const plus = text.indexOf('+');
  const version = plus === -1 ? text : text.slice(0, plus);
  if (plus !== -1 && !identifiers(text.slice(plus + 1), BUILD)) return false;
  const dash = version.indexOf('-');
  if (dash === -1) return CORE.test(version);
  return CORE.test(version.slice(0, dash)) && identifiers(version.slice(dash + 1), PRERELEASE);
};

const EMOJI =
  /^(?=[\s\S]*[\p{Extended_Pictographic}\p{Regional_Indicator}\u20E3])[\p{Extended_Pictographic}\p{Emoji_Component}]+$/u;

// A charset and a length instead of the quantified forms, which overflow the
// stack of the engine on a string of megabytes.
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

const BYTE = '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$';

const isBase64 = (text) => text.length % 4 === 0 && BASE64.test(text);

const BASE64URL = /^[\w-]*$/;

const isBase64url = (text) => text.length % 4 !== 1 && BASE64URL.test(text);

// A JWT is three parts of base64url, the first a JSON object that names its
// algorithm; the signature is not verified, and the payload not read.
const JWT = /^([\w-]+)\.[\w-]*\.[\w-]*$/;

const isJwt = (text) => {
  const match = JWT.exec(text);
  if (match === null || match[1].length % 4 === 1) return false;
  try {
    const header = JSON.parse(atob(match[1].replaceAll('-', '+').replaceAll('_', '/')));
    return header !== null && typeof header === 'object' && typeof header.alg === 'string';
  } catch {
    return false;
  }
};

const PREFIX4 = /^(?:3[0-2]|[12]?\d)$/;

const PREFIX6 = /^(?:12[0-8]|1[01]\d|[1-9]?\d)$/;

const cidrOf = (address, prefix) => (text) => {
  const at = text.indexOf('/');
  return at > 0 && prefix.test(text.slice(at + 1)) && address.test(text.slice(0, at));
};

// An http or https address, stricter than what a browser reads: the host is
// a hostname, an IPv4 address (a host that ends in a number is one) or an
// IPv6 address in brackets, and the port fits in 16 bits.
const URL_FORM =
  /^https?:\/\/(?:[^\s/?#@]*@)?(\[[^\s/?#\]]*\]|[^\s/?#:@[\]]+)(?::(\d{1,5}))?(?:[/?#][^\s\\]*)?$/i;

const NUMERIC = /(?:^|\.)\d+\.?$/;

const isUrl = (text) => {
  const match = URL_FORM.exec(text);
  if (match === null || Number(match[2] ?? 0) > 65535) return false;
  const host = match[1];
  if (host[0] === '[') return IPV6.test(host.slice(1, -1));
  return NUMERIC.test(host) ? IPV4.test(host) : HOSTNAME.test(host);
};

// A card number of 12 to 19 digits (spaces or dashes between them) whose
// Luhn sum holds; a valid sum is not a card that exists.
const CARD = /^\d(?:[ -]?\d){11,18}$/;

const isCard = (text) => {
  if (!CARD.test(text)) return false;
  let sum = 0;
  let double = false;
  for (let index = text.length - 1; index >= 0; index -= 1) {
    let digit = text.charCodeAt(index) - 48;
    if (digit < 0 || digit > 9) continue;
    if (double) digit = digit > 4 ? digit * 2 - 9 : digit * 2;
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
};

// An IBAN whose check digits hold (ISO 7064 mod 97-10, the letters read as
// 10 to 35, the remainder kept small instead of a bigint).
const IBAN = /^[A-Z]{2}(?!00|01|99)\d{2}[A-Z\d]{11,30}$/;

const isIban = (text) => {
  if (!IBAN.test(text)) return false;
  const moved = text.slice(4) + text.slice(0, 4);
  let rest = 0;
  for (let index = 0; index < moved.length; index += 1) {
    const code = moved.charCodeAt(index);
    rest = code >= 65 ? (rest * 100 + code - 55) % 97 : (rest * 10 + code - 48) % 97;
  }
  return rest === 1;
};

const tested = (expression) => (text) => expression.test(text);

// In the order `infer` tries them: the specific forms first (a uuid, a
// date, an address are also hostnames), a date-time with its zone before
// one without, an http address before any URI; the forms ordinary words or
// numbers pass (a hostname, a slug, a JSON pointer, `1.2.3` as a version, a
// Luhn sum one number in ten passes) are never inferred.
const BUILT_IN = {
  uuid: {
    test: tested(UUID),
    examples: ['550e8400-e29b-41d4-a716-446655440000', '123e4567-e89b-12d3-a456-426614174000'],
  },
  ulid: {
    test: tested(ULID),
    examples: ['01ARZ3NDEKTSV4RRFFQ69G5FAV', '01HZX8Q4N0J5W6Y2T9K3M7P1RB'],
    pattern: ULID.source,
  },
  jwt: {
    test: isJwt,
    examples: [
      'eyJhbGciOiJub25lIn0.e30.',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl',
    ],
    pattern: '^[\\w-]+\\.[\\w-]*\\.[\\w-]*$',
  },
  email: { test: isEmail, examples: ['ann@example.com', 'ann.lee@mail.example.org'] },
  'date-time': {
    test: dateTimeOf(isTime),
    examples: ['2026-10-11T12:00:00Z', '2026-10-11T12:00:00.000+02:00'],
  },
  'iso-date-time': {
    test: dateTimeOf(isIsoTime),
    examples: ['2026-10-11T12:00:00', '2026-10-11 12:00:00.5'],
  },
  date: { test: isDate, examples: ['2026-10-11', '2000-02-29'] },
  time: { test: isTime, examples: ['12:00:00Z', '23:59:59.999+02:00'] },
  'iso-time': { test: isIsoTime, examples: ['12:00:00', '23:59:59.999+02:00'] },
  duration: { test: tested(DURATION), examples: ['P1Y2M3DT4H5M6S', 'PT15M'] },
  ipv4: { test: tested(IPV4), examples: ['192.168.0.1', '10.0.0.255'] },
  cidrv4: { test: cidrOf(IPV4, PREFIX4), examples: ['192.168.0.0/24', '10.0.0.0/8'] },
  ipv6: { test: tested(IPV6), examples: ['::1', '2001:db8::ff00:42:8329'] },
  cidrv6: { test: cidrOf(IPV6, PREFIX6), examples: ['2001:db8::/32', 'fe80::/10'] },
  mac: {
    test: tested(MAC),
    examples: ['00:1a:2b:3c:4d:5e', '00-1A-2B-3C-4D-5E'],
    pattern: MAC.source,
  },
  e164: { test: tested(E164), examples: ['+380501234567', '+14155552671'], pattern: E164.source },
  iban: {
    test: isIban,
    examples: ['DE89370400440532013000', 'GB82WEST12345698765432'],
    pattern: IBAN.source,
  },
  'hex-color': {
    test: tested(HEX_COLOR),
    examples: ['#7c5cff', '#fff'],
    pattern: HEX_COLOR.source,
  },
  url: { test: isUrl, examples: ['https://example.com/path?q=1', 'http://localhost:3000/'] },
  uri: { test: tested(URI), examples: ['https://example.com/path?q=1', 'mailto:ann@example.com'] },
  hostname: { test: tested(HOSTNAME), examples: ['example.com', 'api.example.org'], infer: false },
  'uri-reference': {
    test: tested(URI_REFERENCE),
    examples: ['/users/42?tab=info', '../up#top'],
    infer: false,
  },
  'uri-template': {
    test: isTemplate,
    examples: ['https://example.com/users/{id}', '/search{?q,page}'],
    infer: false,
  },
  'json-pointer': {
    test: isPointer,
    examples: ['/users/0/name', '/a~1b'],
    infer: false,
  },
  'relative-json-pointer': {
    test: isRelativePointer,
    examples: ['1/name', '0#'],
    infer: false,
  },
  regex: { test: isRegex, examples: ['^[a-z]+$', '\\d{3}-\\d{4}'], infer: false },
  nanoid: {
    test: tested(NANOID),
    examples: ['V1StGXR8_Z5jdHi6B-myT', 'a3Fk9_LmQz-7xYpR2tWn0'],
    infer: false,
    pattern: NANOID.source,
  },
  cuid2: {
    test: tested(CUID2),
    examples: ['tz4a98xxat96iws9zmbrgj3a', 'pfh0haxfpzowht3oi213cqos'],
    infer: false,
    pattern: CUID2.source,
  },
  base64: { test: isBase64, examples: ['aGVsbG8=', 'TWFu'], infer: false, pattern: BYTE },
  base64url: {
    test: isBase64url,
    examples: ['aGVsbG8', 'PDw_Pz8-'],
    infer: false,
    pattern: '^(?:[\\w-]{4})*(?:[\\w-]{2,3})?$',
  },
  hex: { test: tested(HEX), examples: ['deadbeef', '0A1B2C'], infer: false, pattern: HEX.source },
  emoji: { test: tested(EMOJI), examples: ['👍', '🇺🇦'], infer: false },
  semver: {
    test: isSemver,
    examples: ['1.0.0', '2.1.3-beta.1+build.5'],
    infer: false,
    pattern: SEMVER.source,
  },
  slug: {
    test: isSlug,
    examples: ['hello-world', 'metaschema-3-3'],
    infer: false,
    pattern: SLUG.source,
  },
  'credit-card': {
    test: isCard,
    examples: ['4111111111111111', '5555 5555 5555 4444'],
    infer: false,
    pattern: CARD.source,
  },
};

// An entry as the table keeps it: the test, a copy of the examples, whether
// infer may read it and the pattern of the export, frozen.
const entryOf = (name, entry) => {
  if (entry === null || typeof entry !== 'object') {
    throw invalidFormat(name, 'needs { test, examples }');
  }
  const { test, examples, infer, pattern } = entry;
  if (typeof test !== 'function') throw invalidFormat(name, 'needs a test function');
  const listed = Array.isArray(examples) && examples.length > 0;
  if (!listed) throw invalidFormat(name, 'needs a list of example strings');
  for (let index = 0; index < examples.length; index += 1) {
    if (typeof examples[index] !== 'string') {
      throw invalidFormat(name, 'needs a list of example strings');
    }
  }
  if (infer !== undefined && typeof infer !== 'boolean') {
    throw invalidFormat(name, 'needs a boolean infer');
  }
  if (pattern !== undefined && (typeof pattern !== 'string' || !isRegex(pattern))) {
    throw invalidFormat(name, 'needs a pattern string that compiles under the u flag');
  }
  const copy = { test, examples: Object.freeze(examples.slice()), infer: infer !== false };
  if (pattern !== undefined) copy.pattern = pattern;
  return Object.freeze(copy);
};

const registered = (name) =>
  new SchemaDefinitionError(
    'ERR_FORMAT_REGISTERED',
    `Format "${name}" is already registered with another test`,
  );

// A name is registered once: the same test again is nothing, and another
// test under a registered name is an error, since the schemas built so far
// hold the first one. The one exception is the program's own format under
// the name of a built-in: it takes the built-in's place (and its position in
// the order infer reads them), so that a format a program registered before
// the name was built in keeps working; the schemas built before it keep the
// built-in test.
const add = (name, entry, own) => {
  if (name === '') throw invalidFormat(name, 'needs a name');
  const known = FORMATS[name];
  if (known !== undefined) {
    if (known.test === entry.test) return;
    if (!own) return;
    const builtIn = Object.hasOwn(BUILT_IN, name) && known.test === BUILT_IN[name].test;
    if (!builtIn) throw registered(name);
  }
  FORMATS[name] = entryOf(name, entry);
};

// Registers the built-in formats and the program's own
// (`{ phone: { test, examples } }`); once per name, process-wide, like the
// type registry. Importing the subpath registers nothing.
const register = (custom = {}) => {
  if (custom === null || typeof custom !== 'object') {
    throw new SchemaDefinitionError('ERR_INVALID_FORMAT', 'Formats must be an object of entries');
  }
  for (const name of Object.keys(BUILT_IN)) {
    const own = Object.hasOwn(custom, name);
    add(name, own ? custom[name] : BUILT_IN[name], own);
  }
  for (const name of Object.keys(custom)) {
    if (!Object.hasOwn(BUILT_IN, name)) add(name, custom[name], true);
  }
};

module.exports = { FORMATS, register };
