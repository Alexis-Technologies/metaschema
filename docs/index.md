---
layout: home

title: metaschema
titleTemplate: Schemas, validation and TypeScript types for JavaScript

hero:
  name: metaschema
  text: Schemas, validation and TypeScript types
  tagline: Declare data structures and domain models once as plain JavaScript objects. Validate data against them and generate TypeScript interfaces. Zero dependencies, Node.js and browsers.
  image:
    src: /logo-mark.svg
    alt: metaschema
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Why metaschema?
      link: /guide/why
    - theme: alt
      text: View on GitHub
      link: https://github.com/Alexis-Technologies/metaschema

features:
  - icon: ✍️
    title: Compact schema syntax
    details: "Shorthands like '?string', 'key?', { array: 'number' } and ['number', 'number'] sit next to a long form for when a field needs options."
    link: /guide/schema-syntax
    linkText: Schema syntax
  - icon: ✅
    title: Errors, not exceptions
    details: "check() walks the whole value and returns every problem as data: a code, the path as keys, params and a localized message. Data errors are collected; only a broken definition throws."
    link: /guide/validation
    linkText: Validation
  - icon: 🧩
    title: Domain models
    details: "Entities, registries, dictionaries and projections with references, relations and indexes, ordered by dependency and checked for missing references."
    link: /guide/model
    linkText: Domain models
  - icon: 🔷
    title: TypeScript out of the box
    details: "A model renders its entities as TypeScript interfaces, and the package ships hand-written typings for its own API."
    link: /guide/typescript
    linkText: TypeScript
  - icon: 📦
    title: Zero dependencies
    details: "No runtime dependencies at all, under 10 KB min+gzip. The whole package is CommonJS that ships as written, with no build step."
    link: /guide/why
    linkText: Why metaschema?
  - icon: 🌐
    title: Node.js and browsers
    details: "One package for both. Bundlers pick the browser entry automatically, and nothing under src/ touches a Node builtin except saveTypes."
    link: /guide/browser
    linkText: Browser usage
---
