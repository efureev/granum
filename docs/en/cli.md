# CLI `granum`

> 🇷🇺 Русская версия: [`../ru/cli.md`](../ru/cli.md).

Every command works **without building the application** — from provider
manifests and `granum.config.*`; the exception is `report`, which reads the
`granum-report.json` of a built application. The first argument is the path
to the config; the application root is its directory.

```bash
granum doctor  granum.config.ts [--json] [--strict]
granum explain granum.config.ts <providerId:Component> [--json]
granum why-css granum.config.ts <class> [--json]
granum tokens  granum.config.ts <providerId:Component> [--deep] [--json]
granum prune   granum.config.ts [--json] [--strict]
granum report  [dist/granum-report.json] [--json] [--strict]
granum codegen [<package-dir>] [--check] [--json] [--targets=barrel,exports,manifest,registry]
```

A `.ts` config is loaded through the application's `vite`
(`loadConfigFromFile`); if `vite` does not resolve from the root, through a
native `import()`. The `default`, `granum` and `config` exports are accepted.

## Exit codes

| Code | When |
|---|---|
| `0` | clean |
| `1` | errors found; with `--strict` also warnings; a runtime failure |
| `2` | invalid invocation: missing command, config or subject |

`doctor` returns `1` on any `error` regardless of `--strict`; `explain`,
`tokens` and `why-css` return `1` when the subject is not found; `prune`
returns `1` only with `--strict` and removable tokens; `report` returns `1`
with `--strict` when there are classes without a rule or undefined tokens;
`codegen` returns `1` with `--check` when registries are stale, and on a
generation error.

## `doctor`

A full report on the configuration: providers and their form, the selection
in dependency order, themes and the source of the set, token blocks, checked
files and diagnostics. Levels: `error` — the build must break, `warn` —
legal but suspicious.

| Code | Level | Meaning |
|---|---|---|
| `missing-file` | error | a manifest file is missing on disk |
| `apply-not-expanded` | error | `@apply` is left in provider CSS — rebuild the provider with the plugin |
| `boundary` | error | a provider chunk imports `node:*` or a granum node entry |
| `important-in-provider-css` | warn | `!important` inside a layer inverts the cascade order |
| `safelist-redundant` | warn | the safelist duplicates statically extracted classes |
| `css-double-delivery` | warn | component CSS is both inlined and imported by its chunk |
| `safelist-dead` | warn | a safelist entry without a rule in the engine |
| `token-undefined` | warn | a token is consumed but declared by no layer |
| `token-conflict` | warn | several layers write the token; the chain and the outcome are shown |
| `theme-warning` | warn | theme resolution warnings (`extends`, partial themes) |
| `override-skipped` | warn | `strictTokens` dropped an override |
| `provider-without-manifest` | warn | the provider is passed as an object: classes and consumption are unknown |
| `unused-provider` | warn | the provider contributes nothing to the build |

```
granum doctor
=============

Providers (1):
  • @granum-fixtures/heavy [manifest 0.1.0] — components: 7, theme: yes

Selected components (5, order = deps → dependents):
  • @granum-fixtures/heavy:XhAlert — classes: 9, css: 1
  …

Diagnostics (errors: 0, warnings: 1):
  ⚠ [safelist-dead] @granum-fixtures/heavy:XhButton — safelist entry 'shadow-legacy' has no rule in the engine

✓ OK — no errors; warnings: 1 (they only fail with --strict).
```

## `explain`

Why a component is in the build (`selected`, `dependency`, `not-selected`,
`unknown`), the shortest chain from the selection root, who requires it, and
what it contributes: classes, safelist, CSS, files, consumed and declared
tokens.

## `why-css`

Through which channel a class reached the CSS — manifest statics, safelist, a
selector in component CSS, application sources — and which engine rule
generated it (source, layer, selector). `Rule: none` means a hook class or a
typo.

## `tokens`

What a component declares and consumes; for every token — where the value
comes from (`own`, `component`, `provider`, `app`, `none`) and the chain of
layers per theme. `--deep` includes the component's dependencies.

## `prune`

What pruning would remove and what it keeps, with a reason — from the same
plan the build uses; the command never changes the emission. Bytes "before →
after" per file.

## `report`

Reads `granum-report.json`: selection, themes, classes without a rule with
sources, safelist covered by statics, the prune plan, layer sizes
raw/gzip/brotli, warnings.

## `codegen`

Runs in a provider package (the argument is its root, the current directory
by default) and brings the registries in line with `src/components`: the
`src/index.ts` barrel, component subpath exports and `./granum.manifest.json`
in `package.json`, config imports and entries in
`src/granum-provider/index.ts`. The generator writes only inside the marked
blocks `<granum:components>`, `<granum:components:imports>`,
`<granum:components:registry>`; everything around them belongs to the package.

```bash
granum codegen                       # all four targets
granum codegen --check               # in CI: exit 1 when registries are stale
granum codegen --targets=barrel,exports --prefix=Xh
```

`--prefix` is the component name prefix (`Gr` by default), from which the
config export name is derived (`grAlertConfig`). `--components-dir`,
`--barrel`, `--registry` override the paths; `--subcomponents` adds `exports`
aliases for parts of compound components; `--exports=import` writes string
subpaths without `types` (a package without declarations). Custom targets (`markedBlock`) go
through the programmatic API of `@feugene/granum/codegen`.

## Programmatic access

All functions and formatters are exported from `@feugene/granum/node`:

```ts
import { formatDoctorReport, granumDoctor, loadGranumConfigFile, prepareApp } from '@feugene/granum/node'

const { config, root } = await loadGranumConfigFile('granum.config.ts', process.cwd())
const app = await prepareApp(config, root)
const report = await granumDoctor(app)
console.log(formatDoctorReport(report))
```

In CI: `granum doctor granum.config.ts --strict` before the build and
`granum report --strict` after it.
