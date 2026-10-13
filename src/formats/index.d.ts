// A format a string field may name: a test over the string, the examples
// `sample` draws, whether `infer` may read the format out of data (true
// unless said otherwise; a format ordinary words pass says false), and the
// pattern the JSON Schema export writes beside the name (a string that
// compiles in unicode mode, a shape that never rejects what `test` accepts).
export interface FormatDefinition {
  test: (value: string) => boolean;
  examples: readonly string[];
  infer?: boolean;
  pattern?: string;
}

// The formats registered so far, by name: empty until `register()` ran. Read
// it; `register()` writes it.
export const FORMATS: { readonly [name: string]: Readonly<FormatDefinition> | undefined };

// Registers the 35 built-in formats (the identifiers `uuid`, `ulid`, `jwt`,
// `nanoid`, `cuid2`; the dates and times `date-time`, `iso-date-time`,
// `date`, `time`, `iso-time`, `duration`; the network forms `email`,
// `ipv4`, `cidrv4`, `ipv6`, `cidrv6`, `mac`, `url`, `uri`, `hostname`; the
// formats of JSON Schema `uri-reference`, `uri-template`, `json-pointer`,
// `relative-json-pointer`, `regex`; and `e164`, `iban`, `hex-color`,
// `base64`, `base64url`, `hex`, `emoji`, `semver`, `slug`, `credit-card`)
// and the program's own, once per name and process-wide, like the type
// registry: a name registered again with the same test is nothing, with
// another test `ERR_FORMAT_REGISTERED`, and an entry that is not a format
// `ERR_INVALID_FORMAT`. The program's own format under the name of a
// built-in one takes its place.
export function register(custom?: Record<string, FormatDefinition>): void;
