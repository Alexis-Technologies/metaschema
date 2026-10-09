# Security Policy

## Supported versions

Only the latest published version receives fixes.

| Version | Supported |
|---|---|
| 1.x | ✅ |
| `metaschema` (metarhia) 2.x | ❌ (report upstream) |

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through
[GitHub's private vulnerability reporting](https://github.com/Alexis-Technologies/metaschema/security/advisories/new),
or by email to <dolid.sasha@gmail.com>.

Include, as far as you can:

- what an attacker can do, and what they need in order to do it;
- the affected version and Node.js version (or browser);
- a minimal reproduction.

You can expect an acknowledgement within a few days, and an assessment of severity and a fix
timeline once the report is confirmed.

## Threat model

Some things work as intended and are not vulnerabilities:

- **Schemas are code.** A schema is a JavaScript value supplied by the application. Field and
  schema `validate` functions, custom types' `construct` / `checkType`, and calculated fields are
  live functions that run with the privileges of your process. Build schemas only from definitions
  you trust, the same as any other module you `require`.
- **metaschema never loads or evaluates code.** Since 1.0 it has no loader: it does not read schema
  files, evaluate source strings or run a sandbox. Turning untrusted input into a schema definition
  is the application's decision and responsibility.
- **Validation errors are data.** `check` collects problems as strings instead of throwing on bad
  input. The messages contain field paths (which can include key names taken from the input) and,
  for `enum`, the allowed values; they never contain the rejected values themselves. A message
  from a custom `validate` function, or from an exception it throws, is passed through as written.
- **Type registration is process-wide.** Custom types registered by one `Model` are visible to
  every schema in the process. Register them once, from trusted code.
- **`saveTypes` writes where it is told.** The output path is the caller's argument; metaschema
  does not sanitize it.
- **Bundled and minified builds validate exactly like the source.** Internal identity checks use a
  global symbol brand, not class names, and `tests/unit/bundle.test.js` validates through esbuild
  bundles of both entry points, minified and not. A build in which `check` accepts invalid data is a
  bug; please report it.

Things that *are* in scope: input data that makes `check` throw, hang or consume unbounded
resources; input data that changes a schema or the type registry; and a message that leaks a value
it should not.
