<script setup>
import BenchFigure from '../.vitepress/theme/components/BenchFigure.vue';
</script>

# Performance

metaschema 2.0 validates about five times faster than 1.0 on the same machine, and 3.0 adds a JIT
backend that is three to six times faster again. The speed comes from the shape of the core rather
than from a trick in one place. This page explains that core and gives the numbers of the
repository's own benchmark; [Benchmarks](/guide/benchmarks) puts metaschema beside ten other
validators and beside every earlier release.

## The core

Everything a `check` needs is computed once, when the schema is built, and nothing of the kind
per call.

**The plan.** A struct definition becomes a frozen list of entries, one per validated field
(`{ key, type, required, own, aliases, check }`), plus a null-prototype dictionary of the known keys. The
struct check is an index loop over that list: one keyed load per field, the field's compiled
check called with its key, and `Object.hasOwn` consulted only when the value is `undefined` and
the field is required (or the field is named after a member of `Object.prototype`). Unknown keys
are looked for only when `for...in` counts more keys than the plan found, so a value with exactly
the expected keys is never scanned twice.

**The closures.** Every field compiles its check when it is built, as a closure over the field: a
scalar without rules is one `typeof`, an `enum` with more than eight values a `Set` lookup, a
`Map` or `Set` is iterated directly, an `object` through `for...in`, a tuple by index, a nested
struct through its own compiled check, a reference through a lookup plus cycle tracking. Rules
(`length`, `pattern`, `format`, `min`/`max`) are compiled into one closure over the field's
bounds and wrap the type check only when the field has rules or a `validate`; `nullable: true`
wraps the result once more. A `pattern` or a `format` is never run over a string longer than
`length.max`, so a field with a bound costs at most one comparison for an oversized string. Nothing in the hot path reads the definition, creates a closure or a `RegExp`, or
looks a function up by name.

**The context.** Each call to `check` creates one object that every closure records into:
`{ issues, count, limit, depth, maxDepth, path, seen, source, unknown, references, root,
messages, async, scratch, renamed }`, always in that order, so the hot path sees a single shape.
The path is a stack of keys a container pushes before its children and pops after them; a leaf
never touches it. `issues` is a shared frozen empty list until the first problem, `seen` (cycle
tracking) is created at the first embedded record, and `async` and `scratch` stay `null` outside
the async methods and `parse`. Two checks never share state, so a `validate` function may run another check,
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

<BenchFigure chart="engine" />

`bench/baseline.json` in the repository is a snapshot of `pnpm bench` on the 3.3 branch (Node
24, Apple silicon, 2026-10-13). The 1.0 column is the same scenarios on the same machine the day
before 2.0; the closure column is what every `check` does, the JIT column the same schemas after
`compile`. A run of one scenario on its own comes out higher than the same scenario in the whole
run (the call sites are warmer); the figures are from the whole run.

| Scenario | 1.0 | closures | JIT |
| --- | ---: | ---: | ---: |
| `Schema.from`, flat struct (4 fields) | 276 K ops/s | 255 K ops/s | — |
| `Schema.from`, nested struct, collections, tuple | 94 K | 84 K | — |
| `check`, flat struct, valid | 2.1 M | 10.3 M | 29.0 M |
| `check`, flat struct, invalid (4 issues) | 0.87 M | 3.2 M | 5.5 M |
| `check`, nested struct, valid | 0.33 M | 2.7 M | 16.9 M |
| `check`, nested struct, invalid | 0.23 M | 1.5 M | 2.0 M |
| `check`, sparse struct, two optional fields absent | — | 7.4 M | 31.0 M |
| `parse`, flat struct, valid | — | 9.2 M | 26.0 M |
| `parse`, nested struct, valid | — | 2.5 M | 14.1 M |
| `parse`, flat struct, a default and a `Date` decoder | — | 2.1 M | 2.9 M |
| `parse`, flat struct with an alias, no alias in the input | — | 8.2 M | 27.0 M |
| `parse`, flat struct with an alias, the alias in the input | — | 3.2 M | 4.5 M |
| `parse`, nested struct under `strip`, an extra key at every level | — | 1.2 M | 2.0 M |
| `parse`, 100 records under `strip` | — | 64 K | 95 K |
| `parse` with `coerce: true`, flat struct, two strings converted | — | 3.1 M | 4.0 M |
| `parse` with `coerce: true`, flat struct, nothing to convert | — | 3.5 M | 4.7 M |
| `coerce()`, flat struct, two strings converted | — | 4.1 M | — |
| `parse` with `coerce: true`, nested struct, the numbers as text | — | 404 K | 462 K |
| `parse` with `coerce: true`, plain unions, a number and a boolean as text | — | 1.2 M | — |
| `parse` with `coerce: true`, enums of 32 members, a member as text | — | 3.2 M | — |
| `parse`, flat struct, a plain and a coercing parse in turn | — | 4.0 M | — |
| `toDocument` of `./mongodb`, an entity with a reference, a struct and a list | — | 740 K | — |
| `fromDocument` of `./mongodb`, the same document (`parse` with `coerce`) | — | 467 K | — |
| `check`, flat struct, four sync validators | — | 3.7 M | 5.7 M |
| `checkAsync`, the same four sync validators | — | 2.8 M | 3.7 M |
| `checkAsync`, four async validators, resolved promises | — | 1.5 M | 1.7 M |
| `checkAsync`, four independent validators awaiting `setImmediate` | — | 66 K | 69 K |
| `checkAsync`, four independent validators awaiting `setTimeout(1)` | — | 850 | 848 |
| `checkAsync`, 32 records with a validator awaiting `setImmediate` each | — | 44 K | 45 K |
| `parseAsync`, flat struct, an async decoder | — | 1.1 M | 1.3 M |
| `check`, 1 000 flat records in a loop | — | 9.0 K | 31 K |
| `checkEach`, the same 1 000 records | — | 7.6 K | 19 K |
| moltar flat (6 fields), four modes | — | 7.0–7.1 M | 26.5–29.6 M |
| moltar nested (6 + 3 fields), four modes | — | 4.4–4.5 M | 23.6–24.7 M |
| `new Model`, fixture model (6 entities) | 18 K | 16 K | — |
| `toTypeScript(model)`, fixture model | — | 88 K | — |

The moltar scenarios are the object of the
[typescript-runtime-type-benchmarks](https://github.com/moltar/typescript-runtime-type-benchmarks)
suite in its four modes (`parseSafe`, `parseStrict`, `assertLoose`, `assertStrict`): unknown keys
ignored or rejected, the value returned or the verdict only. The 2.0 notes quoted 14 M for these
rows; that measured a schema whose first key, `number`, made it a `number` field under the
first-key rule, so every check failed on the root at once. The bench marks the schema as a struct
since 3.0, and the closure numbers above are what 2.0 and 3.0 do on it. The strict modes count
the keys of the value (`for...in`) to know whether to look for unknown ones; the loose modes skip
it, which is the gap between the two on the JIT.

A parse with coercion visits every field of the value and looks up the converter of each,
which is why it runs at about a third of a plain parse whether anything converts or not; the
JIT does not generate the passes of parse, so its gain there is small. A parse without
coercion costs what it did in 3.2: an A/B of the parse and check rows against the commit
before coercion is at parity on both backends.

Where the time goes: on a valid value, in the plan loop of the closures (a keyed load and a call
per field) and, on the JIT, in the context and the result a check allocates (about a third of
its 32 ns); on an invalid one, in the issue objects (a params object, a path array and a
rendered message each, about 40 ns an issue on both backends), which is why the invalid path
gains 1.6 times where the valid one gains 3. The `check` of 1.0 was slower than
`JSON.stringify` of the same value; the JIT is about seven times faster than it.

[`parse`](/guide/parse) is the same check between two passes over the built types, each of
which returns after one bit test when the schema has nothing for it, so a schema without
defaults and decoders parses at about 90% of its check on either backend (the difference is
the result object). With a default to fill and a `Date` to decode the flat struct parses at
2.0 M and 2.8 M: a copy of the object for the default, another for the decoded field, and
`new Date(text)` itself, which is a third of the time. A schema with an
[alias](/guide/evolution#aliases-and-deprecated) parses a value that carries none at the
speed of a schema without (the pass that renames runs only after a check that read an alias),
and a value under the alias at the speed of a decoded field: the copy that renames, and a
second one that puts the field where the alias was. Under `unknown: 'strip'` every struct of
the output is rebuilt from its known keys, so the pass visits every container; since 3.2 it
allocates nothing per container it visits (the output under construction is a local of the
walker), which is what took 100 records from 61 K to 66 K on the closures and from 81 K to
95 K on the JIT in this run.

The async rows measure the path of [`checkAsync`](/guide/parse#async). With sync validators
only, the async method is the sync one plus the promise it returns and the `await` of the
caller: 2.9 M against 3.8 M. With validators that resolve at once the time is the microtasks:
one per validator. With validators that wait for the event loop the time is the waits, and
since 3.2 independent validators wait together: four of them awaiting `setImmediate` cost one
turn of the loop per check (65 K checks a second, 18 K in 3.1, when they waited one after the
other), 32 records with a validator each cost one turn too (43 K, 2.2 K in 3.1), and four
awaiting `setTimeout(1)` cost one millisecond rather than four (812 a second, 190 in 3.1). A
validator over a promise, a struct's own `validate` or the schema's, still waits for it.

[`checkEach`](/guide/streaming) of the stream subpath costs what a loop of `check` costs plus
about 20 ns a record on this machine: the entry `{ index, record, result }` and the result
object of the iterator itself. On the closures that is 7.6 K against 9.2 K batches of a
thousand records a second; on the JIT, where a check is 33 ns, 19 K against 31 K, so a program
that validates millions of records at the speed of the JIT and needs no entries per record
loops over `check` itself.

## Other libraries

The comparison with zod, valibot, ArkType, Effect Schema, TypeBox, Ajv, Yup, Joi, Superstruct and
Metarhia's metaschema has a page of its own, [Benchmarks](/guide/benchmarks): the moltar object
in the suite's four modes, every issue of an invalid value, building a schema, cold start and
bundle size, each library in a fresh process and checked for its verdicts before it is timed.

## Reproducing

```bash
pnpm bench                 # every scenario, ops/sec, closures and JIT
pnpm bench check           # only the scenarios whose name contains "check"
pnpm bench --json          # the results as JSON
pnpm bench --save          # write them to bench/baseline.json
pnpm bench --compare       # the change against bench/baseline.json, scenario by scenario
pnpm bench:report          # the chart above, from bench/baseline.json
```

The numbers are machine-specific, so compare before and after a change on one machine, and
compare two trees in separate processes rather than in one run. The harness reads the clock once
per hundred calls and calls `check` through a holder and a call site made megamorphic on purpose,
so `check` is measured as a callee, the way a program calls it, instead of being inlined into
the measuring loop together with its context and result; the comment at the top of
`bench/helpers.js` explains why. Run-to-run noise on a quiet machine is a few percent, more for
the allocation-heavy scenarios (`toTypeScript(model)` moved by a fifth between two runs of the
same code on one day).
