# Performance

metaschema 2.0 validates about five times faster than 1.0 on the same machine, and 3.0 adds a JIT
backend that is three to six times faster again. The speed comes from the shape of the core rather
than from a trick in one place. This page explains that core, gives the numbers of the
repository's benchmark and how to reproduce them, and puts them beside other validators.

## The core

Everything a `check` needs is computed once, when the schema is built, and nothing of the kind
per call.

**The plan.** A struct definition becomes a frozen list of entries, one per validated field
(`{ key, type, required, own, check }`), plus a null-prototype dictionary of the known keys. The
struct check is an index loop over that list: one keyed load per field, the field's compiled
check called with its key, and `Object.hasOwn` consulted only when the value is `undefined` and
the field is required (or the field is named after a member of `Object.prototype`). Unknown keys
are looked for only when `for...in` counts more keys than the plan found, so a value with exactly
the expected keys is never scanned twice.

**The closures.** Every field compiles its check when it is built, as a closure over the field: a
scalar without rules is one `typeof`, an `enum` with more than eight values a `Set` lookup, a
`Map` or `Set` is iterated directly, an `object` through `for...in`, a tuple by index, a nested
struct through its own compiled check, a reference through a lookup plus cycle tracking. Rules
(`length`, `pattern`, `min`/`max`) are compiled into one closure over the field's bounds and wrap
the type check only when the field has rules or a `validate`; `nullable: true` wraps the result
once more. Nothing in the hot path reads the definition, creates a closure or a `RegExp`, or
looks a function up by name.

**The context.** Each call to `check` creates one object that every closure records into:
`{ issues, count, limit, path, seen, unknown, references, root, messages }`, always in that
order, so the hot path sees a single shape. The path is a stack of keys a container pushes
before its children and pops after them; a leaf never touches it. `issues` is a shared frozen
empty list until the first problem, and `seen` (cycle tracking) is created at the first
reference met. Two checks never share state, so a `validate` function may run another check,
even of the same value.

**Issues without text.** A problem is recorded as `{ code, path, params }` with an empty message.
Messages are rendered once, after the walk, through the locale of the call, and the lines with
the location (`result.errors`) only on first use. A valid value allocates the context, the
result and nothing else.

**Early exits.** The order inside a field is type, then rules, then `validate`, each step only
when the one before it passed; the schema-level `validate` runs only when every field passed;
and `maxErrors` stops every loop over fields, elements and records at the limit. Invalid data
does less work, not more.

Construction is deliberately not optimised at the cost of `check`: a field settles its rules and
its `required` flag before its closure is built, a projection re-parses its parent's fields, and
the lint runs only on the first read of `schema.warnings`, so a schema built in a request handler
(`Schema.from` per request) never pays for it.

## The JIT backend

[`@alexify/metaschema/compile`](/guide/compile) renders the same plan into one straight-line
function per schema and builds it with `new Function`: `typeof x2 !== "string"` for a field,
the elements of a collection in a loop of their own, a nested struct's fields in place, the
branches of a union as a `switch` on the discriminator. The two things the closure backend
cannot avoid go away: the call per field through the plan (megamorphic, since every field's
closure comes from the same source) and the push and pop of a container's key on the path, which
the generated code does only around a statement that records an issue or calls out. What the
closures record, the generated code records too, through the same issue constructors, so the
result of a check is the same object either way; a reference, a custom type and a `validate`
function are calls on both backends. Where code generation from strings is not allowed, the
closures stay.

## Numbers

`bench/baseline.json` in the repository is a snapshot of `pnpm bench` on the 3.0 branch (Node
24, Apple silicon, 2026-10-10). The 1.0 column is the same scenarios on the same machine the day
before 2.0; the closure column is what every `check` does, the JIT column the same schemas after
`compile`.

| Scenario | 1.0 | closures | JIT |
| --- | ---: | ---: | ---: |
| `Schema.from`, flat struct (4 fields) | 276 K ops/s | 263 K ops/s | — |
| `Schema.from`, nested struct, collections, tuple | 94 K | 88 K | — |
| `check`, flat struct, valid | 2.1 M | 10.4 M | 30.0 M |
| `check`, flat struct, invalid (4 issues) | 0.87 M | 3.4 M | 5.6 M |
| `check`, nested struct, valid | 0.33 M | 2.5 M | 17.4 M |
| `check`, nested struct, invalid | 0.23 M | 1.4 M | 2.0 M |
| `parse`, flat struct, valid | — | 9.6 M | 26.8 M |
| `parse`, nested struct, valid | — | 2.5 M | 14.7 M |
| `parse`, flat struct, a default and a `Date` decoder | — | 2.1 M | 2.9 M |
| moltar flat (6 fields), four modes | — | 7.1–7.4 M | 30.2–33.0 M |
| moltar nested (6 + 3 fields), four modes | — | 4.2–4.4 M | 24.1–30.2 M |
| `new Model`, fixture model (6 entities) | 18 K | 16 K | — |
| `toTypeScript(model)`, fixture model | — | 83 K | — |

The moltar scenarios are the object of the
[typescript-runtime-type-benchmarks](https://github.com/moltar/typescript-runtime-type-benchmarks)
suite in its four modes (`parseSafe`, `parseStrict`, `assertLoose`, `assertStrict`): unknown keys
ignored or rejected, the value returned or the verdict only. The 2.0 notes quoted 14 M for these
rows; that measured a schema whose first key, `number`, made it a `number` field under the
first-key rule, so every check failed on the root at once. The bench marks the schema as a struct
since 3.0, and the closure numbers above are what 2.0 and 3.0 do on it. The strict modes count
the keys of the value (`for...in`) to know whether to look for unknown ones; the loose modes skip
it, which is the gap between the two on the JIT.

Where the time goes: on a valid value, in the plan loop of the closures (a keyed load and a call
per field) and, on the JIT, in the context and the result a check allocates (about a third of
its 32 ns); on an invalid one, in the issue objects (a params object, a path array and a
rendered message each, about 40 ns an issue on both backends), which is why the invalid path
gains 1.6 times where the valid one gains 3. The `check` of 1.0 was slower than
`JSON.stringify` of the same value; the JIT is about seven times faster than it.

[`parse`](/guide/parse) is the same check between two passes over the built types, each of
which returns after one bit test when the schema has nothing for it, so a schema without
defaults and decoders parses at 90% of its check on the closures and 90% on the JIT (the
difference is the result object and the strip test). With a default to fill and a `Date` to
decode the flat struct parses at 2.1 M and 2.9 M: a copy of the object for the default, another
for the decoded field, and `new Date(text)` itself, which is a third of the time.

## Other libraries

`pnpm bench --compare-libs` runs the moltar scenarios through zod, valibot, ajv and
@sinclair/typebox beside metaschema's two backends (`bench/libs.js`), on one machine, in one
process, every library reached through the same adapter object and the same megamorphic call
site, so no library's check is inlined into the measuring loop, and every adapter's verdicts
are checked before anything is timed (a failing check is fast, and a mistranslated schema would
measure that). Node 24, Apple silicon, 2026-10-10, in millions of operations a second:

**moltar flat (6 fields)**

| Library | parseSafe | parseStrict | assertLoose | assertStrict |
| --- | ---: | ---: | ---: | ---: |
| metaschema 3.0 (closures) | 9.7 | 9.7 | 10.4 | 9.6 |
| metaschema 3.0 (JIT) | 35.9 | 33.7 | 36.5 | 31.2 |
| zod 4.6.5 | 23.7 | 11.6 | 23.9 | 11.6 |
| valibot 1.5.0 | 3.6 | 3.0 | 3.6 | 3.0 |
| ajv 8.20.0 (draft 2020-12) | 63.0 | 33.6 | 64.1 | 34.1 |
| @sinclair/typebox 0.34.52 (TypeCompiler) | 98.5 | 59.0 | 98.0 | 59.4 |
| @sinclair/typebox 0.34.52 (Value.Check) | 4.6 | 4.5 | 4.6 | 4.5 |

**moltar nested (6 + 3 fields)**

| Library | parseSafe | parseStrict | assertLoose | assertStrict |
| --- | ---: | ---: | ---: | ---: |
| metaschema 3.0 (closures) | 4.8 | 4.6 | 4.8 | 4.6 |
| metaschema 3.0 (JIT) | 33.6 | 27.3 | 32.3 | 27.0 |
| zod 4.6.5 | 12.1 | 6.4 | 12.4 | 6.5 |
| valibot 1.5.0 | 2.1 | 1.7 | 2.0 | 1.7 |
| ajv 8.20.0 (draft 2020-12) | 37.1 | 18.0 | 35.7 | 18.8 |
| @sinclair/typebox 0.34.52 (TypeCompiler) | 48.4 | 27.6 | 49.9 | 26.7 |
| @sinclair/typebox 0.34.52 (Value.Check) | 2.6 | 2.5 | 2.6 | 2.5 |

Read the table with its method in mind. The libraries do different work for one call: ajv and
typebox's TypeCompiler return a boolean from generated code and allocate nothing on a valid
value (ajv sets `validate.errors`, typebox keeps nothing), which is the floor of 10 to 17 ns a
call on a flat value; metaschema returns a `ValidationResult` with a context behind it, two
allocations per check, and zod and valibot build a result object and, in the parse modes, a
copy of the value without its unknown keys. The strict modes cost every code generator about
the same: the scan of the value's keys. The harness itself takes a share from all of them
alike: called directly inside the measuring closure, zod's `safeParse` does 29 M on the flat
value and metaschema's compiled `check` 44 M, against 24 M and 36 M through the adapter and
the megamorphic site. The suite's published numbers come from a different harness
(benchmark.js, direct calls), so they are not comparable with these one to one, only the order
is. What the table says is where metaschema stands with its own API: the closures are in the
range of the interpreters, the JIT in the range of the code generators (level with typebox's
compiler on the nested strict modes, ahead of ajv there, behind both on a flat loose value), and
both return every problem with its path.

## Reproducing

```bash
pnpm bench                 # every scenario, ops/sec, closures and JIT
pnpm bench check           # only the scenarios whose name contains "check"
pnpm bench --json          # the results as JSON
pnpm bench --save          # write them to bench/baseline.json
pnpm bench --compare       # the change against bench/baseline.json, scenario by scenario
pnpm bench --compare-libs  # the moltar scenarios through zod, valibot, ajv and typebox
```

The numbers are machine-specific, so compare before and after a change on one machine, and
compare two trees in separate processes rather than in one run. The harness reads the clock once
per hundred calls and calls `check` through a holder and a call site made megamorphic on purpose,
so `check` is measured as a callee, the way a program calls it, instead of being inlined into
the measuring loop together with its context and result; the comment at the top of
`bench/helpers.js` explains why. Run-to-run noise on a quiet machine is a few percent, more for
the allocation-heavy scenarios (`toTypeScript(model)` moved by a fifth between two runs of the
same code on one day).
