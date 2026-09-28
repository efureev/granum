# @feugene/granum

Build pipeline for granular UI packages: a provider manifest, one resolution per
application and three channels out of it — JS (a virtual entry driven by the selection),
CSS (five cascade layers) and themes with their tokens.

Since **1.0** the contract is frozen: the provider contract, the manifest format,
the entry points, the shape of `GranumConfig`, the layer names, the virtual
module ids, the CLI commands with their exit codes and the error classes change
only with a major release — see [§18 of the specification](./docs/SPEC.md#18-стабильность-контракта-с-10).
The engine's vocabulary fingerprint is deliberately not part of that promise: it
changes whenever the rule set does, and re-extracting a package's classes is a
normal path, not a breakage.

| Entry | Environment | Purpose |
|---|---|---|
| `@feugene/granum` | browser + node | resolver and contract re-exports |
| `@feugene/granum/contract` | browser + node | provider contract: types and `define*` helpers |
| `@feugene/granum/engine` | browser + node | the `GranumEngine` contract and helpers (`extractClasses`, `parseDialect`, `vocabularyFingerprint`); no engine implementation lives here — the application picks one, e.g. `@feugene/granum-engine-wind` |
| `@feugene/granum/build` | node | Vite plugin for a provider's build |
| `@feugene/granum/vite` | node | Vite plugin for an application |
| `@feugene/granum/node` | node | manifests, CSS emission, diagnostics as functions |
| `@feugene/granum/runtime` | browser | theme controller |
| `@feugene/granum/codegen` | node | provider registry generation |
| `@feugene/granum/client` | — (types only) | ambient declarations for the virtual modules; reference them with `/// <reference types="@feugene/granum/client" />` |

`vite` is an optional peer dependency: only `./build` and `./vite` need it.

Specification: [`docs/spec.md`](../../docs/spec.md).
