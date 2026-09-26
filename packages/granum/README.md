# @feugene/granum

Build pipeline for granular UI packages. Status: **stage 0 — skeleton**. Entry
points exist and are typed; behaviour arrives stage by stage according to the
[implementation plan](../../docs/plan.md).

| Entry | Environment | Purpose |
|---|---|---|
| `@feugene/granum` | browser + node | resolver and contract re-exports |
| `@feugene/granum/contract` | browser + node | provider contract: types and `define*` helpers |
| `@feugene/granum/engine` | browser + node | the `GranumEngine` contract and helpers (`extractClasses`, `parseDialect`, `vocabularyFingerprint`); no engine implementation lives here — the application picks one, e.g. `@feugene/granum-engine-mini` |
| `@feugene/granum/build` | node | Vite plugin for a provider's build |
| `@feugene/granum/vite` | node | Vite plugin for an application |
| `@feugene/granum/node` | node | manifests, CSS emission, diagnostics as functions |
| `@feugene/granum/runtime` | browser | theme controller |
| `@feugene/granum/codegen` | node | provider registry generation |

`vite` is an optional peer dependency: only `./build` and `./vite` need it.

Specification: [`docs/spec.md`](../../docs/spec.md).
