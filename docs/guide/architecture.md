# Architecture

metaschema is a library: a schema is an object in your process, built once from a definition,
and every check is a function call on it. This page follows a definition from the object you
write to the function that checks a value, then a call through `check`, `parse` and the async
methods, and maps each step to the module that does it. The topic pages go deeper; the links say
where.

## The big picture

```mermaid
flowchart TB
    DEF["Definition: plain objects"] -->|"new Schema · Schema.from"| PRE["Preprocessor<br/>the first key decides"]
    DEF -->|"new Model"| MODEL["Model<br/>entities by dependency"]
    MODEL --> PRE
    MODEL -.-> SNAP(["model.toJSON() · schema.toSnapshot()<br/>the snapshot"])
    PRE --> TYPES["Built types: one class per prototype<br/>struct plan, checks compiled on first use"]
    TYPES --> RUN{{"schema[RUN]"}}
    JIT["./compile: generated code"] -.->|"replaces"| RUN
    RUN --> CHECK(["check · checkAsync<br/>→ ValidationResult"])
    RUN --> PARSE(["parse · parseAsync<br/>→ { valid, value, issues }"])
    PARSE --> STD(["~standard.validate"])
```

A definition is parsed once, when the schema is built: every field becomes an instance of a
type and a struct becomes a frozen plan of its fields. The checks are compiled into closures on
their first use, so a schema that is only read (rendered, written as a snapshot) never compiles
one. `schema[RUN]` is the check of the whole schema. `check` and `parse` call it
with a context of their own and turn what it recorded into a result; the [JIT
backend](/guide/compile) replaces it with one generated function and changes nothing else.
Nothing is read from the definition after construction, and nothing global is touched by a
check.

## The packages

The core entry validates; everything that is rendered from a schema, or built on top of it, is
a subpath that imports the core and registers nothing until it is asked to. The core itself is
two halves over the same classes: the [definition half](/guide/definition), which builds a
schema and reads it, and the validation half, which installs `check`, `parse` and the rest into
it. `@alexify/metaschema/definition` is the first half alone.

```mermaid
flowchart LR
    GEN["./generators · 7.6 KB<br/>toJSONSchema · toTypeScript<br/>fromJSONSchema · saveTypes"] --> CORE
    COMP["./compile · 4.4 KB<br/>compile · register · canEval"] --> CORE
    MOD["./model · 12.4 KB<br/>fromJSON · diff · compatibility<br/>sample · merge · infer"] --> CORE
    STR["./stream · 0.9 KB<br/>checkEach · parseEach · transform"] --> CORE
    FMT["./formats · 3.9 KB<br/>35 formats · your own"] --> CORE
    DER["./derive · 2.0 KB<br/>pick · omit · partial<br/>required · extend · keyof"] --> CORE
    COE["./coerce · 1.8 KB<br/>converters · coerce()"] --> CORE
    MDB["./mongodb · 3.6 KB<br/>BSON types · documents<br/>indexes · updates"] --> COE
    LOC["./locales/uk"] -.-> CORE
    CORE["@alexify/metaschema · 20.3 KB<br/>check · parse · serialize · async<br/>~standard · warnings"] --> DEFN
    DEFN["./definition · 9.7 KB<br/>Schema · Model<br/>toJSON · toSnapshot"]
```

The sizes are min+gzip, a subpath measured as what it adds to the core (`./mongodb` to the core
and `./coerce`, which it requires), `./definition` on its own. Each subpath exports functions and an explicit `register()`
that installs them as methods or fills a table of the core; nothing in the core requires a
subpath, so a bundler drops the ones a program does not import.

| Layer | Modules (under `src/`) | Responsibility |
| --- | --- | --- |
| [Definitions](/guide/schema-syntax) | `schema.js`, `preprocessor.js`, `types.js`, `kinds.js`, `metadata.js` | read a definition (the first key decides), the type registry, kinds and their metadata |
| [Types](/guide/types) | `prototypes/*.js`, `rules.js` | one prototype per type: what it reads from a definition; the rules (`length`, `min`/`max`, `decimals`, `pattern`, `format`) |
| Structs | `struct.js` | the null-prototype field dictionary and its plan |
| [Models](/guide/model) | `model.js`, `snapshot.js` | entities ordered by dependency, the snapshot of a model and of a schema |
| [Checks](/guide/validation) | `validation.js`, `checks.js` | the validation half: the check of every type, field and struct, compiled on first use, and what `validation.js` installs into the classes above |
| [Validation](/guide/validation) | `context.js`, `issues.js`, `result.js`, `locales/`, `lint.js` | the context of one call, issues as data, the async drain, messages rendered once, the warnings |
| [Parse](/guide/parse) | `codec.js` | coercion, defaults, strip, decoders and serializers as passes over the built types |
| Subpaths | `definition/`, `generators/`, `compile/`, `model/`, `stream/`, `formats/`, `derive/`, `coerce/`, `mongodb/` | each bundled only where it is imported |
| [Platform](/guide/browser) | `runtime/node.js`, `runtime/browser.js` | `writeFile` behind `saveTypes`, the only file that touches a Node builtin |

## From a definition to a check

`new Schema(name, definition)` hands the definition to the `Preprocessor`, which picks a parser
by the type of the source and, for an object, by its **first key**: a capitalized key is a kind,
`type` first is the long form, a type name first is a shorthand, anything else is a nested
struct. A `Schema` or a field that is already built is taken as it is.

```mermaid
flowchart TB
    SRC["A definition"] --> T{"its type"}
    T -->|"string"| STR["'?string' or 'Company'<br/>shorthand or reference"]
    T -->|"array"| TUP["tuple"]
    T -->|"function"| FN["calculated field"]
    T -->|"object"| K{"its first key"}
    K -->|"Capitalized"| KIND["a kind<br/>Entity, Struct, …"]
    K -->|"type"| LONG["long form<br/>{ type: 'string' }"]
    K -->|"a type name"| SHORT["shorthand<br/>{ array: 'number' }"]
    K -->|"anything else"| NESTED["nested struct"]
```

A broken definition throws a `SchemaDefinitionError` with a code here, at construction, never
inside `check`. Every field is then built: the type's class copies the rules (a rule the type
does not accept throws `ERR_INVALID_RULE`, bounds that leave nothing between them
`ERR_INVALID_RULE` too), and a struct records a frozen **plan** entry per field (`{ key, type,
required, own, aliases }`). On the first use of a field's `check`, the `compile()` of its type
(`checks.js`, installed on the prototype by `validation.js`) returns the type check as a
closure, wrapped in the rules and the `validate` only when the field has them and in the
`nullable` test last; a struct compiles one loop over its plan the same way, and a schema its
own check through a stub of `schema[RUN]` that takes the closures' place. See
[Performance](/guide/performance#the-core) for what the loop does and does not do.

## The two halves of the core

The classes (`Schema`, `Model`, the class of every type) are built by the definition half and
validated by the other. `validation.js` installs, once, when the core entry loads it:
`check`, `checkAsync`, `parse`, `parseAsync`, `serialize`, `validate`, `~standard`, `warnings`
and `checkConsistency` on `Schema`, `warnings` on `Model`, the `compile` of every built-in type
on the prototype object the classes of that type inherit from (so a registry built before has
it too), and the builders the lazy checks call. Until then, a schema of
`@alexify/metaschema/definition` builds, renders and writes its snapshot, and a call that
validates is `ERR_NOT_REGISTERED`. The state the validation half keeps on a schema (whether its
root joins the cycle detection, its default coercion, the caches of parse and `~standard`) is
held under symbols the definition half sets; a test of the module graph pins that the
definition half reaches no module of the validation half.

```mermaid
flowchart LR
    APP["a program"] -->|"require('@alexify/metaschema')"| VAL["validation.js<br/>checks.js · codec.js · issues.js"]
    VAL -->|"installs into"| CLS["Schema · Model<br/>the prototypes of the types"]
    BROWSER["a client that reads schemas"] -->|"require('…/definition')"| CLS
```

## A check

```mermaid
sequenceDiagram
    autonumber
    participant App
    participant S as Schema
    participant R as schema[RUN]
    participant C as context
    App->>S: check(value, options)
    S->>C: createContext
    S->>R: run(value, context)
    loop each field of the plan
        Note over R: type → rules → validate
        R->>C: an issue, as data
    end
    Note over R: the schema's validate,<br/>if nothing failed
    S->>C: render the messages once
    S-->>App: ValidationResult
```

The context is one object per call (`{ issues, count, limit, path, seen, … }`, always one shape);
a container pushes its key on `path` before its children and pops it after them, and a leaf
never touches it. An issue is recorded as data with an empty message; messages are rendered
once, after the walk, through the locale of the call, and the lines with the location only
when `result.errors` is read. `count >= limit` stops every loop at `maxErrors`.

## Parse

`parse` is the same check between two passes of `codec.js` over the built types. A pass returns
after one bit test when the schema carries nothing for it, so a schema without defaults and
decoders parses at about the speed of its check. With [coercion](/guide/coercion) on, the pass
before the check enters every field and converts the input through the converters
`./coerce` registered.

```mermaid
flowchart TB
    IN["value"] --> P["prepare<br/>coercion (when asked) ·<br/>defaults of missing keys"]
    P --> RUN["schema[RUN]<br/>the check"]
    RUN -->|"valid"| F["finish<br/>strip · aliases renamed ·<br/>decoders, parts first"]
    RUN -->|"invalid"| BAD(["{ valid: false, issues }"])
    F --> OUT(["{ valid: true, value }"])
    SER["serialize(value)"] -->|"the schema's, then the fields', top down"| SOUT(["{ value }"])
```

Both passes copy a container at the first part that changes and never write to the value given,
so a plain schema returns the very object it was given. See [Parse and serialize](/guide/parse).

## Async

`checkAsync` and `parseAsync` walk the value once, the same way. A validator that returns a
promise is kept with the path it was met at, and a validator met later is deferred only when
it lies over a path that is still pending; everything else runs at once.

```mermaid
sequenceDiagram
    participant W as walk
    participant L as pending list
    participant St as settle
    W->>L: field a: a promise
    W->>L: field b: a promise
    Note over L: a and b in flight together
    W->>L: the struct's validate: deferred
    W->>St: the walk is over
    St->>L: await a, then b
    St->>L: the deferred validate,<br/>if nothing under it failed
```

The rule that a validator runs only when nothing under it failed holds across promises, and
`maxErrors` stops the settle. See [Async](/guide/parse#async).

## References

A field named with a capitalized name (`'Company'`) is resolved when it is checked, through the
model (`root.findReference`), and a name that no model resolves is the schema's own when it is
its name (`parent: '?Category'` needs no model). Whether the value is the target's id or the
target's record is decided per call:

```mermaid
flowchart TD
    REF["A reference field"] --> OPT{"options.references"}
    OPT -->|"'embed'"| EMB["the record,<br/>checked by the target schema"]
    OPT -->|"'id'"| ID["an id: a string"]
    OPT -->|"'kind' (default)"| F{"embed on the field?"}
    F -->|"true / false"| BY["as the field says"]
    F -->|"not set"| ST{"target stored?<br/>Entity, Registry, …"}
    ST -->|"yes"| ID
    ST -->|"no: Struct, Form, …"| EMB
```

Cycles are tracked only where a record is embedded, and `maxDepth` (128) bounds a deep graph.
See [References](/guide/references).

## The model

```mermaid
flowchart TB
    TY["custom types"] -->|"1 · register"| REG[("type registry")]
    ENT["[name, definition], …"] -->|"2 · build each as a Schema"| SCH["entities"]
    SCH -->|"3 · projections"| SCH
    SCH -->|"4 · order"| ORD["Identifier first,<br/>dependencies before dependents"]
    ORD --> W["model.warnings<br/>(on first read)"]
    ORD --> J(["toJSON(): the snapshot<br/>schema.toSnapshot(): one schema's"])
    J -->|"./model fromJSON"| BACK["a Model again"]
    J -->|"./model diff"| D["changes"] -->|"compatibility"| CL["backward · forward · full"]
```

The snapshot is the contract other programs read a model through (a schema writes the same
document for itself and the entities it reaches, with its name as `root`);
`@alexify/metaschema/model` restores it, compares two of them and classifies the change. See [Domain models](/guide/model)
and [Model evolution](/guide/evolution).

## The JIT backend

`compile(schema)` of `@alexify/metaschema/compile` renders the same plan into one function and
installs it as `schema[RUN]`; `register()` does it for every schema built afterwards, through a
slot the core reads once per construction.

```mermaid
flowchart TD
    A["compile(schema, { jit })"] --> E{"new Function allowed?"}
    E -->|"no, jit: 'auto'"| KEEP["keep the closures"]
    E -->|"no, jit: true"| ERR["throw ERR_NO_EVAL"]
    E -->|"yes"| G["emit.js<br/>an emitter per prototype"]
    G --> B{"generated?"}
    B -->|"yes"| R["schema[RUN] = jit"]
    B -->|"no"| FB["ERR_JIT_BUILD<br/>returned or thrown"]
```

Built-in types are inlined; a reference, a custom type and a `validate` function stay calls into
a scope. The generated code records issues through the same constructors as the closures, so the
result of a check is the same object either way. See [The JIT backend](/guide/compile).
