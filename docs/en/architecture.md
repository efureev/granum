# Architecture

> 🇷🇺 Русская версия: [`../ru/architecture.md`](../ru/architecture.md).

Visual pipeline diagram — [`../architecture-pipeline.html`](../architecture-pipeline.html)
(open the file in a browser).
Normative requirements are in the [specification](../spec.md), invariants in
the [registry](../invariants.md).

## Pipeline

```
PROVIDER BUILD (once, at publish time)
  sources ──► ./build + engine ──► dist/components/<Name>/{index.js, chunks/, styles.css}
                                   dist/theme/*.css
                                   dist/granum.manifest.json          ← hand-over point
                                   (in the manifest — dialect and fingerprint of the build engine)

APPLICATION BUILD (vite build / dev)
  granum.config.ts + engine instance ──► resolver ──► Resolution ──► ./vite ──┬─► JS:  virtual:granum/components, guard
        ▲                                                                     ├─► CSS: engine + @layer assembler → virtual:granum.css
  provider manifests (via package exports)                                    └─► tokens: prune, theme manifest → virtual:granum/themes → ./runtime
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
| `./engine` | browser + node | the `GranumEngine` interface, rule types, `extractClasses`, `parseDialect`, `vocabularyFingerprint` |
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

The core carries no engine implementation at all: `./engine` ships the contract
and the helpers for engine authors, while the instance arrives from
`granum.config.*`. The stock implementation is `@feugene/granum-engine-mini`: a
vendored UnoCSS 66.7.5 core (`@unocss/core`, `preset-mini`, `rule-utils`
without `magic-string`, `extractor-arbitrary-variants`) plus the ported rules of
`unocss-mini-extra-rules`; the golden test against a live `unocss@66.7.5` lives
there too, next to the vendored code.

```ts
interface GranumEngine {
  name: string
  version?: string
  dialect: string      // vocabulary name: provider rules are loaded by it
  vocabulary: string   // fingerprint of the name set: manifest trust is decided by it
  extract: (code: string, id: string) => ReadonlySet<string>
  generate: (input: EngineInput) => Promise<EngineOutput>   // { css, matched, unmatched }
}
```

The engine is pure and deterministic; every input class lands either in
`matched` (with its rule, source and layer) or in `unmatched` — nothing is
dropped silently. Engine code lives at build time and never reaches the client.

The engine's place in the data flow changed: it is no longer part of a package.
A provider build runs the engine it was started with and writes its dialect and
vocabulary fingerprint into the manifest — as a fact about where the class list
came from. Before generating CSS the application compares its own engine with
those and decides: trust the list, or re-extract the classes from the manifest
files. The whole model is in [engines and dialects](./engines-and-dialects.md).

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
