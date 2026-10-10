# Performance

metaschema 2.0 validates about five times faster than 1.0 on the same machine, and the speed
comes from the shape of the core rather than from a trick in one place. This page explains that
core, gives the numbers of the repository's benchmark and how to reproduce them, and says what
2.1 adds.

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

## Numbers

`bench/baseline.json` in the repository is a snapshot of `pnpm bench` on the 2.0 branch (Node
24, Apple silicon, 2026-10-10). The 1.0 column is the same scenarios on the same machine the day
before.

| Scenario | 1.0 | 2.0 |
| --- | ---: | ---: |
| `Schema.from`, flat struct (4 fields) | 276 K ops/s | 280 K ops/s |
| `Schema.from`, nested struct, collections, tuple | 94 K | 93 K |
| `check`, flat struct, valid | 2.1 M | 10.7 M |
| `check`, flat struct, invalid (3 issues) | 0.87 M | 3.5 M |
| `check`, nested struct, valid | 0.33 M | 2.7 M |
| `check`, nested struct, invalid | 0.23 M | 1.5 M |
| moltar flat (6 fields), four modes | — | 14.2–14.7 M |
| moltar nested (6 + 3 fields), four modes | — | 14.1–14.7 M |
| `new Model`, fixture model (6 entities) | 18 K | 17 K |
| `model.dts`, fixture model | — | 102 K |

The moltar scenarios are the object of the
[typescript-runtime-type-benchmarks](https://github.com/moltar/typescript-runtime-type-benchmarks)
suite in its four modes (`parseSafe`, `parseStrict`, `assertLoose`, `assertStrict`): unknown keys
ignored or rejected, the value returned or the verdict only. The strict and loose modes are at
parity, because the unknown-keys scan runs only when the value has more keys than the plan.

Where the time goes: on a valid value, in the plan loop (a keyed load and a call per field, both
megamorphic in a closure backend, since every field's closure comes from the same source);
on an invalid one, in the issue objects (a params object, a path array and a rendered message
each). The second is what the JIT backend of 2.1 is for.

## Reproducing

```bash
pnpm bench                 # every scenario, ops/sec
pnpm bench check           # only the scenarios whose name contains "check"
pnpm bench --json          # the results as JSON
pnpm bench --save          # write them to bench/baseline.json
pnpm bench --compare       # the change against bench/baseline.json, scenario by scenario
```

The numbers are machine-specific, so compare before and after a change on one machine, and
compare two trees in separate processes rather than in one run. The harness reads the clock once
per hundred calls and calls `check` through a holder and a call site made megamorphic on purpose,
so `check` is measured as a callee, the way a program calls it, instead of being inlined into
the measuring loop together with its context and result; the comment at the top of
`bench/helpers.js` explains why. Run-to-run noise on a quiet machine is a few percent.

## 2.1: the JIT backend

The closure backend is the floor, not the ceiling. 2.1 adds `compile(schema, { jit })` from a
separate `@alexify/metaschema/compile` entry: the plan is rendered into straight-line JavaScript
(`typeof value.name === 'string'`, one statement per field, real values such as regular
expressions and nested schemas passed through a scope, never through the source text) and built
with `new Function`, with a silent fallback to the closures where code generation is not allowed
(a Content Security Policy, Cloudflare Workers,
`node --disallow-code-generation-from-strings`). Both backends pass one test suite and report the
same issues; the target is 25 M ops/s on the flat valid scenario. Until then, every `check` is
the closure backend described above.
