// A format a string field may name: a test over the string, the examples
// `sample` draws, and whether `infer` may read the format out of data (true
// unless said otherwise; a format every word passes says false).
export interface FormatDefinition {
  test: (value: string) => boolean;
  examples: readonly string[];
  infer?: boolean;
}

// The formats registered so far, by name: empty until `register()` ran. Read
// it; `register()` writes it.
export const FORMATS: { readonly [name: string]: Readonly<FormatDefinition> | undefined };

// Registers the built-in formats (`email`, `uuid`, `uri`, `hostname`, `ipv4`,
// `ipv6`, `date`, `time`, `date-time`) and the program's own, once per name
// and process-wide, like the type registry: a name registered again with the
// same test is nothing, with another test `ERR_FORMAT_REGISTERED`, and an
// entry that is not a format `ERR_INVALID_FORMAT`.
export function register(custom?: Record<string, FormatDefinition>): void;
