# Engines and dialects

> 🇷🇺 Русская версия: [`../ru/engines-and-dialects.md`](../ru/engines-and-dialects.md).

The utility engine is not built into granum: the core ships the `GranumEngine`
contract and a few helpers, while the application picks an implementation and
passes it as an instance. This page covers why, how to install an engine, how a
dialect differs from a vocabulary fingerprint and what to do when they diverge.

## Why the application picks the engine

A utility rule is a function written against one generator's contract: its own
variant semantics, its own theme reading, its own arbitrary-value parsing. The
rules of two generators cannot share the `utilities` layer: a class would get
two verdicts and "the last match wins" would lose its meaning. So a build has
exactly one generator — and the one who owns the result picks it, which is the
application.

Everything else follows: `engine` in `granum.config.*` is required and takes an
instance, while the `'builtin'` string and an options object are not accepted
(`InvalidConfigError` naming the field path). A provider build demands an
explicit instance too: the class list in the manifest is a fact about one
implementation, not about the package.

## Install and configure

The default implementation is `@feugene/granum-engine-wind`: a vendored fork of
the UnoCSS 66.7.5 core with `preset-wind3`, zero dependencies.

```bash
yarn add -D @feugene/granum @feugene/granum-engine-wind
```

```ts
// granum.config.ts
import { defineGranumConfig } from '@feugene/granum/vite'
import { windEngine } from '@feugene/granum-engine-wind'

export default defineGranumConfig({
  engine: windEngine(),
  providers: ['@acme/ui'],
  appSources: { dirs: ['src'] },
})
```

| `windEngine` option | Default | Changes the dialect | Changes the fingerprint |
|---|---|---|---|
| `extraRules` | `true` | yes | yes |
| `rules`, `variants` | — | no | yes |
| `preflights` | — | no | no |
| `preflight` | `true` | no | no |
| `variablePrefix` | `--un-` | no | no |

An option that changes the set of generated names **or what they mean** must
change the dialect: `extraRules: false` turns off the one extra rule — alpha on
an arbitrary colour. The set of names does not change (`bg-[var(--x)]/55` matches
either way), but the meaning does: without the rule wind3 emits
`background-color: var(--x)` and silently drops the `/55`; with it, a
`color-mix`. So that is another vocabulary, `unocss/preset-wind3@66` instead of
`unocss/preset-wind3+granum@66`. An option that only changes the output leaves
the dialect alone.

## A rule of your own

Application rules go to the engine factory, not to the granum config: the
config has no field for rules and will not grow one.

```ts
engine: windEngine({ rules: [['x-app-only', { 'outline-style': 'dotted' }]] }),
```

The dialect stays the same — the wind3 vocabulary did not go anywhere —
but the fingerprint differs: the engine knows a name the package builds did
not. What follows from that is right below.

## Dialect and fingerprint

Two entities rather than one, because their consumers and decisions differ.

### The dialect is the name of a vocabulary

`<vendor>/<vocabulary>@<major>`: `unocss/preset-wind3+granum@66`,
`granum-fixtures/atoms@1`. Compared by strict string equality; the trailing
major is part of the name, not a range, because `@66` and `@67` are different
vocabularies rather than versions of one.

The dialect drives exactly one decision: **whether to load a provider's rule
module.** A rule written against a vocabulary survives a change of
implementation inside the major: `atom-stack` knows nothing about a `divide-y`
that appeared in a new upstream minor, and does not break because of it.

### The fingerprint is a key of the actual name set

`vocabulary` is an opaque string that changes exactly when the set of names the
engine can generate changes. The core computes it with the
`vocabularyFingerprint({ rules, variants })` helper from
`@feugene/granum/engine`: from rule identifiers and variant names, order-free.

The fingerprint drives the other decision: **whether to trust the class list in
a package manifest.** That list was filtered by the engine of the package build
— a class without a rule never reaches the manifest — so an implementation that
knows more names would have found more classes in the same files. The dialect
cannot see that by definition: inside one major the name set is not constant,
upstream adds rules in minors and the application adds its own to the factory.

## The decision table

| Manifest dialect | Fingerprint | What granum does | What the developer sees |
|---|---|---|---|
| `null` | `null` | fast path, no re-extraction | nothing: the package depends on no vocabulary |
| equal | equal | classes from the manifest, package rules loaded | nothing, this is the norm |
| equal | different | re-extraction with the package rules | `reason: 'vocabulary'` for the provider in the report; on a set difference — `provider-classes-recovered` / `provider-classes-dropped` |
| different | — | re-extraction without the package rules | `provider-dialect-mismatch`; plus `engine-rules-skipped` if the package ships a rule module; on a set difference — the same codes |

Re-extraction is not a guess: every component's classes are extracted anew from
its `files` listed in the manifest, by the application engine, and the result is
compared with the manifest list. The difference is named:

- **`gained`** — classes the package build dropped because its engine did not
  know those names while the application engine does: they come back into the
  build;
- **`lost`** — classes from the manifest the application engine has no rule
  for: they stay in the engine input and show up in the report's `unmatched`.
  Re-extraction may not make a loss quieter than it already was.

The `safelist` is never re-extracted: it is an authored declaration, not a
derivative; an entry without a rule lands in `safelist-dead` as before. The
re-extraction result is cached in process memory and never written to disk.

A fingerprint difference on its own is not a warning: that is how every
application with its own factory rule looks. The set difference warns.

## `provider-dialect-mismatch`

The package was built by an engine of another vocabulary. The consequences:

1. the package rule module is not loaded (`engine-rules-skipped`): a rule of a
   foreign vocabulary may not be executed;
2. the package classes are re-extracted — without its rules;
3. names the application vocabulary does not know are listed in `lost` and show
   up in `unmatched`.

What to do: either run an engine of the package dialect, or add the rules you
need to your own factory (`windEngine({ rules: […] })`). Two vocabularies
cannot be mixed in one build, and that is not an implementation limit: their
names overlap while their meanings differ, and `.p-4` would get two verdicts in
one layer.

## `provider-classes-dropped`

A class from the package manifest produced no CSS: the application engine has
no rule for it. One command finds the cause (see [CLI](./cli.md)):

```bash
granum why-css granum.config.ts divide-y
```

It names which package the class comes from, which engine built it and for which
vocabulary, whether its rules were loaded, and offers the two ways out — an
engine of the same dialect or your own rule in the factory. The opposite code,
`provider-classes-recovered`, means the package build lost classes and the
application got them back: a defect on the package side, fixed there.

## Writing your own engine

The interface from `@feugene/granum/engine` is small:

```ts
interface GranumEngine {
  readonly name: string
  readonly version?: string
  readonly dialect: string
  readonly vocabulary: string
  extract: (code: string, id: string) => ReadonlySet<string>
  generate: (input: EngineInput) => Promise<EngineOutput>
}
```

What an implementation owes:

- **purity and determinism**: no FS, no network, no global state between calls,
  and output independent of the input class order;
- **no silent class**: every input name lands either in `matched` (with its
  rule, source and layer) or in `unmatched`;
- **rule order**: builtins < provider rules in graph order < application rules,
  and on matcher collision the last match wins;
- **an honest fingerprint**: `vocabulary` changes whenever the set of names
  changes — compute it with `vocabularyFingerprint` or guarantee that rule
  yourself.

The core helpers `extractClasses`, `parseDialect` and `vocabularyFingerprint`
exist precisely for engine authors; the core carries no implementation at all. A
working example built from scratch, without a line of UnoCSS, is
`fixtures/atoms-engine` in this repository: a six-rule vocabulary, its own
`granum-fixtures/atoms@1` dialect, on which the `atoms-package` fixture and the
`apps/app-atoms` application are built.

## The implementation version decides nothing

`version` reaches the manifest and is printed by diagnostics, but takes no part
in decisions: neither by comparison nor by range. A patch that added no rules
must not cost the application a re-extraction of every package, while a minor
that added them must; the fingerprint tells those two cases apart, the number
does not. Two instances with different versions and one fingerprint take the
fast path.
