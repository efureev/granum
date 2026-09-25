# Architecture

> 🇷🇺 Русская версия: [`../ru/architecture.md`](../ru/architecture.md).

Visual pipeline diagram: https://claude.ai/artifact/41CJUc18uAaaCdm23xWezq
(source — [`../architecture-pipeline.html`](../architecture-pipeline.html)).
Normative requirements are in the [specification](../spec.md), invariants in
the [registry](../invariants.md).

## Pipeline

```
PROVIDER BUILD (once, at publish time)
  sources ──► ./build ──► dist/components/<Name>/{index.js, chunks/, styles.css}
                          dist/theme/*.css
                          dist/granum.manifest.json          ← hand-over point

APPLICATION BUILD (vite build / dev)
  granum.config.ts ──► resolver ──► Resolution ──► ./vite ──┬─► JS:     virtual:granum/components, guard
        ▲                                                   ├─► CSS:    ./engine + @layer assembler → virtual:granum.css
  provider manifests (via package exports)                  └─► tokens: prune, theme manifest → virtual:granum/themes → ./runtime
```

Three principles from which everything else follows:

- **one source of truth per stage** — descriptors for the provider, the
  manifest for the package, the `Resolution` for the application;
- **compute once, where the data is born** — classes and token consumption
  at provider build, selection and token layers at application build;
- **no silent breakage** — a discrepancy is either a type error, a
  registration or build error, or a line in the report.

## Entry points

| Entry | Environment | Contents |
|---|---|---|
| `.` | browser + node | contract and resolver: `resolveGranum`, `GranumResolution` types, errors |
| `./contract` | browser + node | `defineGranumProvider`, `defineGranumComponent`, `GRANUM_CONTRACT_VERSION` |
| `./engine` | browser + node | `createEngine`, the `GranumEngine` interface, rule types |
| `./runtime` | browser | `createThemeController`, `resolveThemeActivation` |
| `./build` | node, peer `vite` | the `granumProvider()` plugin |
| `./vite` | node, peer `vite` | the `granum()` plugin, `defineGranumConfig` |
| `./node` | node | manifest reading, `prepareApp`, `emitCss`, `buildReport`, diagnostics as functions |
| `./codegen` | node | registry, barrel and `exports` generation |
| `bin/granum` | node | CLI |

Browser entries import no `node:*` and have no dependencies; `yarn
check:boundary` verifies that on `dist`. Node entries are unreachable from
provider browser code — the provider build catches a violation
(`BoundaryViolationError`).

## Resolution

`resolveGranum({ providers, components, themes })` is a pure function: no FS,
network or global state. The input is manifests (`{ manifest, baseUrl }`) or
contract objects; both forms are normalised into provider nodes. The result
is the ordered provider graph, the component registry, the selection after
transitive closure, active themes with their source, token layers with
effective values, classes and safelist of the selection, the CSS list in
emission order, warnings. Exactly one resolution exists per build: memoised
by config identity.

## Utility engine

A vendored UnoCSS 66.7.5 core (`@unocss/core`, `preset-mini`, `rule-utils`
without `magic-string`, `extractor-arbitrary-variants`) plus the ported rules
of `unocss-mini-extra-rules` — behind the structural `GranumEngine`
interface:

```ts
interface GranumEngine {
  name: string
  extract: (code: string, id: string) => ReadonlySet<string>
  generate: (input: EngineInput) => Promise<EngineOutput>   // { css, matched, unmatched }
}
```

The engine is pure and deterministic; every input class lands either in
`matched` (with its rule, source and layer) or in `unmatched` — nothing is
dropped silently. Engine code lives at build time and never reaches the
application's client bundle. A golden test compares the output with a live
`unocss@66.7.5`.

## CSS: cascade layers

```css
@layer granum.tokens, granum.base, granum.themes, granum.components, granum.utilities;
```

The order is explained by names, not numbers: `utilities` comes after
`components`, so a template utility wins over a component's base style;
unlayered application CSS wins over everything. Component CSS passes through
byte for byte (except `@apply` expansion done by the provider and token
pruning). Layers are also available one by one:
`virtual:granum/layers/<name>.css`.

## Diagnostics

The build report and the CLI are computed by the same functions as the
emission: the report cannot name a value that is not in the build. An
architectural test guards that the effective token value is computed in one
place.
