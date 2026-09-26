# Guides

> 🇷🇺 Русская версия: [`../ru/README.md`](../ru/README.md).

User guides for `@feugene/granum`. The normative sources are the
[specification](../spec.md) and the [invariants registry](../invariants.md).

## Contents

| Guide | About |
|---|---|
| [Getting started](./getting-started.md) | a provider in three steps, an application in two, the first check |
| [Authoring providers](./authoring-providers.md) | layout, descriptors, `granumProvider()`, codegen, release checklist |
| [Usage in apps](./usage-in-apps.md) | `granum.config.ts`, selection, three channels, dev mode, report |
| [Engines and dialects](./engines-and-dialects.md) | picking an engine, `miniEngine`, dialect and vocabulary fingerprint, decision table |
| [Themes and tokens](./themes-and-tokens.md) | active set, value layers, application themes, pruning, runtime |
| [Architecture](./architecture.md) | pipeline, entry points, resolution, engine, cascade layers |
| [CLI](./cli.md) | `doctor`, `explain`, `why-css`, `tokens`, `prune`, `report`, exit codes |
| [Troubleshooting](./troubleshooting.md) | symptom → cause → action |
| [Measuring weight](./measuring-weight.md) | `bench-*` stands, budget, comparison with the v1 preset |
| [Migration from `unocss-preset-granular`](./migration.md) | what stays, what changes, step-by-step plan |

## Mirror rule

`docs/en/*.md` and `docs/ru/*.md` are pairs: same files, same heading
structure, same code fences, same links. `yarn check:docs` enforces it.
