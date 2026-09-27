# CLI `granum`

> 🇷🇺 Русская версия: [`../ru/cli.md`](../ru/cli.md).

Every command works **without building the application** — from provider
manifests and `granum.config.*`; the exception is `report`, which reads the
`granum-report.json` of a built application. The first argument is the path
to the config; the application root is its directory.

```bash
granum doctor  granum.config.ts [--json] [--strict] [--allow=code,code]
               [--code=<code>] [--component=<providerId:Name>] [--components]
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
| `token-undefined` | warn | a component needs a token from outside and no layer declares it. A use with a fallback, a token the component assigns itself and `dynamicTokens` are not findings |
| `token-conflict` | warn | several layers write the token; the chain and the outcome are shown |
| `theme-warning` | warn | theme resolution warnings (`extends`, partial themes) |
| `override-skipped` | warn | `strictTokens` dropped an override |
| `provider-without-manifest` | warn | the provider is passed as an object and its `baseUrl` is not a directory on disk: classes and consumption are unknown |
| `provider-scanned` | warn | the provider is passed as an object: classes and tokens were scanned from its `dist` by the application (slow path, no bundle graph) |
| `provider-dialect-mismatch` | warn | the package was built by an engine of another vocabulary: its classes were re-extracted instead of trusted |
| `engine-rules-skipped` | warn | the package ships rules of a foreign vocabulary — they are not loaded, classes relying on them end up `unmatched` |
| `provider-classes-recovered` | warn | the application engine knows classes missing from the manifest: the package build lost them |
| `provider-classes-dropped` | warn | classes from the manifest have no rule in the application engine; they stay in the engine input and in `unmatched` |
| `unused-provider` | warn | the provider contributes nothing to the build |

```
granum doctor
=============

Providers (1):
  • @granum-fixtures/heavy [manifest 0.1.0] — components: 7, theme: yes

Selected components (5, order = deps → dependents) — classes 41, safelist 14, css 3:
  • @granum-fixtures/heavy:XhAlert — classes: 9, css: 1
  …

Diagnostics (errors: 0, warnings: 1):
  ⚠ [safelist-dead] @granum-fixtures/heavy:XhButton — safelist entry 'shadow-legacy' has no rule in the engine

✓ OK — no errors; warnings: 1 (they only fail with --strict).
```

### Output that does not grow with the findings

On a design system of eight packages there are dozens of findings and more than a
hundred components. Expanding everything is pointless: what matters drowns. So by
default:

- **errors print in full and first** — they break the build, and no amount of
  noise justifies hiding them behind a flag;
- warnings, once there are more than a dozen, collapse into a table by code with
  counts, ordered by severity, each row naming its own flag;
- an enumeration inside a finding (safelist classes, lost names) collapses to
  three items and a counter;
- the component list collapses to one line with totals.

```
Diagnostics (errors: 0, warnings: 74):
  ⚠ token-undefined               1   --code=token-undefined
  ⚠ important-in-provider-css     1   --code=important-in-provider-css
  ⚠ safelist-dead                 2   --code=safelist-dead
  ⚠ safelist-redundant           70   --code=safelist-redundant
```

Details on demand: `--code=<code>` prints every finding of one code with its
lists in full, `--component=<providerId:Name>` narrows down to one component and
its findings, `--components` expands the list. `--json` collapses nothing and is
meant for scripts.

### Recorded debt: `--allow`

`--strict` fails the gate on any warning. Some of them are deliberate debt — say
`safelist-redundant`, whose cleanup is separate work. List those codes in
`--allow` and the gate tolerates them while still printing and counting them:

```bash
granum doctor granum.config.ts --strict --allow=safelist-redundant,safelist-dead
```

The flag exists so that nobody wraps the doctor in a script of their own: such a
wrapper inevitably drifts from the doctor itself. Warnings that are not allowed
are printed to stderr with per-code counts, so the CI log shows the reason rather
than just an exit code.

`--json` adds, next to every provider, its dialect, vocabulary fingerprint,
class source (`manifest` or `re-extracted`) and whether its rules were loaded,
and at the root the application engine with its dialect and fingerprint. Why
there are two decisions — [engines and dialects](./engines-and-dialects.md).

## `explain`

Why a component is in the build (`selected`, `dependency`, `not-selected`,
`unknown`), the shortest chain from the selection root, who requires it, and
what it contributes: classes, safelist, CSS, files, consumed and declared
tokens.

## `why-css`

Through which channel a class reached the CSS — manifest statics, safelist, a
selector in component CSS, application sources, plus `manifest-lost` (a class
from the manifest the application engine could not re-extract) — and which
engine rule generated it (source, layer, selector). `Rule: none` means a hook
class, a typo or a foreign vocabulary.

For an uncovered class coming from a package the `Vocabularies` section is
printed: which engine built the package and for which vocabulary, which engine
and dialect the application runs, whether the package rules were loaded — and
the two ways out: an engine of the same dialect, or your own factory rule.

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
