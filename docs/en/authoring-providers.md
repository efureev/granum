# Authoring providers

> 🇷🇺 Русская версия: [`../ru/authoring-providers.md`](../ru/authoring-providers.md).

A provider is an npm package of components that publishes a `dist` in the
granum layout plus `granum.manifest.json`. The application reads only the
manifest and the files it references; provider JS is never executed for
resolution.

## Package layout

```
src/
  components/<Name>/config.ts      descriptor (defineGranumComponent)
  components/<Name>/index.ts       component entry
  components/<Name>/<Name>.vue     code and <style>
  components/<Name>/styles.css     optional CSS (cssFiles)
  components/<Name>/themes/        component tokens per theme (themesDir)
  theme/{tokens,base}.css          theme-independent foundation
  themes/registry.json             token registry of the theme owner
  themes/<id>.json                 data of the catalog themes
  granum-provider/index.ts         defineGranumProvider
  index.ts                         barrel
dist/
  components/<Name>/index.js       entry in the layout
  components/<Name>/chunks/*.js    SFC chunks of the component
  components/<Name>/styles.css     component CSS
  groups/<g>/shared/*.js           shared chunks of a group
  chunks/*.js                      shared chunks outside groups
  granum/contract.js               embedded granum contract, if the code imports it
  theme/*.css                      foundation (copy of src/theme)
  themes/*.json                    registry and complete theme data
  granum.manifest.json
```

Theme files are declared as paths relative to `dist` (`theme/base.css`,
`themes/slate.json`) while the sources live mirrored in `src/`: the plugin copies them itself.

## Component descriptor

```ts
import { defineGranumComponent } from '@feugene/granum/contract'

export const xhButtonConfig = defineGranumComponent(import.meta.url, {
  name: 'XhButton',
  dependencies: ['XhIcon', '@acme/base:XBox'],
  safelist: ['p-2', 'p-3', 'bg-[var(--xh-btn-bg)]'],
  dynamicTokens: ['xh-z-*'],
  cssFiles: ['./styles.css'],
  themesDir: './themes',
  group: 'controls',
})
```

The provider build embeds the `@feugene/granum/contract` helpers in `dist` as a
separate `granum/contract.js`. So the descriptor may be re-exported from the
component entry: the package does not pull granum at runtime, and granum stays in
the provider's `devDependencies`. Other granum entry points imported at runtime
(for example, a re-export of `@feugene/granum/runtime`) are a dependency of the
package: list `@feugene/granum` in `peerDependencies`, otherwise the build writes
`peer-missing` to the manifest.

| Field | Purpose |
|---|---|
| `dependencies` | components whose code this component imports; the short form means the same provider, `id:Name` another one |
| `safelist` | only classes assembled in JS at runtime; template literals are not listed here — the build extracts them |
| `dynamicTokens` | tokens whose name is assembled at runtime; pruning keeps them while the component is in the build |
| `cssFiles` | CSS read as is; path relative to `config.ts`, inside the component directory. A `styles.css` next to an SFC `<style>` is merged with it into one file, the declared CSS first |
| `themesDir` | folder of the component's tokens per theme: `<theme>/root.{json,css}`, `<theme>/modes/<mode>.{json,css}`; keys without `--` |
| `group` | shared chunks of several components go to `groups/<g>/shared/` |

The first argument is the `import.meta.url` of the `config.ts` module: the
build uses it to find the component directory and the `cssFiles` sources.

## Provider

```ts
import { defineGranumProvider } from '@feugene/granum/contract'

export default defineGranumProvider({
  id: '@acme/ui',
  contractVersion: 2,
  components: [xhCardConfig, xhButtonConfig],
  theme: {
    tokensCss: 'theme/tokens.css',
    baseCss: 'theme/base.css',
    registry: 'themes/registry.json',
    defaultTheme: 'slate',
    catalog: {
      slate: { title: 'Slate', docs: 'https://example.com/themes/slate', data: 'themes/slate.json' },
      clay: { title: 'Clay', extends: 'slate', data: 'themes/clay.json' },
    },
  },
  engine: { dialect: 'unocss/preset-wind3+granum@66', rules: [['btn-reset', { appearance: 'none' }]] },
  dependencies: ['@acme/base'],
})
```

The provider's `dependencies` are ids of packages that must be in the
application graph. Their tokens, base, themes and engine rules come before
this provider however the application lists the packages in `providers`; a
cycle is a `CircularProviderDependencyError`. A string dependency missing from
`providers` is loaded by the application itself — the package is looked up from the
directory of the dependent provider, so listing it in the `dependencies` of your
`package.json` is enough. The `'all'` selection does not pick such a donor's components.

`defineGranumProvider` validates the shape when called: `contractVersion`,
the id, component names, `cssFiles` paths, catalog theme ids, their `extends` and
`defaultTheme`. Errors are typed classes with `providerId`,
`component` and `reason` fields. Contract 1 theme keys (`theme.themes`, `defaultThemes`,
`tokenDefinitions`, `tokenDefinitionsRef`) are `legacy-token-definitions` with a
hint; `contractVersion: 1` is only accepted for a package without themes.

## Themes: catalog, registry, data

A theme is data, not a CSS file: `GranumThemeData` JSON without selectors. The
application assigns selectors from the mode activation, so the cascade rules are the same
for a provider theme and an application theme.

```json
{
  "id": "slate",
  "title": "Slate",
  "root": { "xh-radius": "6px", "xh-ring": "0 0 0 2px var(--xh-accent)" },
  "defaultMode": "light",
  "modes": {
    "light": { "colorScheme": "light", "tokens": { "xh-bg": "#ffffff", "xh-accent": "#2563eb",
               "xh-soft": "color-mix(in oklab, var(--xh-accent) 15%, var(--xh-bg))" },
               "fallbacks": [{ "supports": "not (color: color-mix(in oklab, red, red))", "tokens": { "xh-soft": "#dbeafe" } }] },
    "dark": { "colorScheme": "dark", "tokens": { "xh-bg": "#0f172a", "xh-accent": "#60a5fa" } }
  },
  "extensions": { "acme": { "componentDefaults": { "XhButton": { "size": "m" } } } }
}
```

- A theme id is a slug `^[a-z][a-z0-9-]*$`, a mode name a slug without a hyphen, `root`
  is forbidden: otherwise a `<theme>-<mode>` pair could not be split at its last hyphen.
- `defaultMode` must be a key of `modes`; without it a `light` mode is required
  (`default-mode-missing`). A mode's `extends` names a mode of the same theme; a cycle is
  `mode-extends-cycle`.
- A theme with `extends` in the catalog keeps only its differences in the source. The build
  merges them with the parent: tokens key by key, a mode's `fallbacks` and `baseCss`
  are replaced whole, `extensions` merge at the top level; id, `title`,
  `docs` come from the catalog entry. Complete data goes to `dist`.
- The registry (`registry`) is `{ "<token>": "root" | "mode" }`. The build checks every
  theme against it: a `root` token is in `root`, a `mode` token is in the final tokens of
  every mode. A gap is `theme-incomplete` with a list like `dark:xh-bg`.
- The manifest gets the catalog index: `title`, `extends`, `docs`, the data path,
  the modes (default first) and `defaultMode` — the CLI lists themes without
  reading the data. `theme.declares` covers the registry and every catalog theme.

There is one catalog owner in an application graph, and it needs no components: the
design system's token package is a provider with `theme` only. Component packages depend on
it with a string in `dependencies` and put component tokens into `themesDir`:

```
components/XhButton/themes/
  slate/modes/light.json      { "xh-button-bg": "var(--xh-accent)" }
  slate/modes/dark.json       only the differences from light — the application takes the rest
  clay/modes/light.json       what is missing comes along the clay → slate chain
  slate/root.json             mode-independent component tokens
```

The folder name is a theme id, the file name a mode; a file is JSON or CSS with one flat block
(the selector does not matter). Anything else is `invalid-theme-dir`; `README.md` and hidden
files are skipped. Themes of a foreign catalog are legitimate: a companion ships tokens for the
design system's themes, and the application applies them when the theme is active. The object
form of a provider (tests, local development) does not merge data: its `data` must be
complete. Examples are the fixtures [`themes-package`](../../fixtures/themes-package/README.md),
[`themed-ds-package`](../../fixtures/themed-ds-package/README.md) and
[`themed-companion-package`](../../fixtures/themed-companion-package/README.md).

`engine` rules are written in granum types (`GranumRule`, `GranumVariant`,
`GranumPreflight`) — the same shape as UnoCSS rules, but without importing
third-party packages. They come with a mandatory `dialect`, the name of the
vocabulary they are written against (`<vendor>/<vocabulary>@<major>`): without
it registration fails with `rules-without-dialect`, because nothing could tell
an application whether the rule applies. Only an engine of that dialect runs it.

`dialect` may also be declared without rules — as a claim about the vocabulary
of the package classes: the build compares the claim with the dialect of its own
engine and refuses to write a foreign one into the manifest
(`EngineDialectMismatchError`). A package that uses no utilities at all declares
no `engine` block — its manifest carries `null` for both dialect and
fingerprint, and any engine reads it without re-extraction. What follows for the
application is in [engines and dialects](./engines-and-dialects.md).

## A theme without granum

An application without granum takes the theme as a ready stylesheet —
`@scope/ds/themes/<id>.css`. Build it with `emitThemeStylesheet` from
`@feugene/granum/node`: the `tokens`, `base` and `themes` layers by the same
rules as an application build, with the theme tokens of all your components.
Pass the provider object itself — its components are not scanned, the
`themesDir` folders are read next to `config.ts`:

```js
import { emitThemeStylesheet } from '@feugene/granum/node'
import { provider } from './src/granum-provider/index.ts'

const { css } = await emitThemeStylesheet({ providers: [provider], theme: 'slate', root: process.cwd() })
```

The same sheet comes in parts — `parts`: `root` (everything that does not depend
on the mode) and `modes.<mode>` (the mode's pair with its fallbacks). Lay them out
as files — `themes/<id>/root.css`, `themes/<id>/<mode>.css` — and an application
takes `root` and only its own modes; its bundler joins them into one file. `root`
goes first. Each mode is self-contained — inheritance by `extends` is already
resolved in it — and only the default mode carries `:root`: an application without
it gets the pair on `<html>` from the mode script or its markup.

Tokens of companion packages are not in such a file: only an application build
knows all the manifests. A `$`-prefixed key in a `themesDir` JSON file is a note
for the reader (`"$comment"`), not a token.

The mode controller of such an application needs a manifest, and there is no
`virtual:granum/themes`. `createThemeManifest` from `@feugene/granum/runtime` builds it
from a description of the theme — your package's catalog — by the same pair rule as
a build:

```js
import { createThemeManifest } from '@feugene/granum/runtime'

const manifest = createThemeManifest({
  theme: { id: 'slate', title: 'Slate' },
  modes: [{ name: 'light', colorScheme: 'light' }, { name: 'dark', colorScheme: 'dark' }],
  defaultMode: 'light',
})
```

## Build

```ts
import { granumProvider } from '@feugene/granum/build'
import { windEngine } from '@feugene/granum-engine-wind'

granumProvider({
  provider,
  engine: windEngine(),
  engineModule: 'granum-provider/engine.js',
  sourceDir: 'src',
  indexEntry: 'src/index.ts',
  dependencyCheck: 'error',
  boundaryCheck: 'error',
  exportsCheck: 'error',
})
```

`engine` is required: it is what filters the manifest classes, and its dialect
and vocabulary fingerprint go into the `engine` block — the class list is a fact
about one implementation. Rules are never embedded into JSON, so `engineModule`
points, relative to `dist`, at an ESM module with
`export default { rules, variants, preflights }`; declared rules without such a
path raise the `engine-module-missing` warning.

The plugin:

1. builds `build.lib.entry` from the component registry and names chunks by
   the layout;
2. extracts static classes from the chunks of every component with the engine
   extractor and keeps only those that have a rule;
3. collects consumed tokens: `var(--x)` in CSS, `var(--x)` and `'--x'`
   literals in JS, `dynamicTokens`; materialises every component's `themesDir`
   folder into the manifest;
4. reads the registry and the catalog theme data, completes a theme with `extends` from
   its parent, checks completeness against the registry and writes complete data to `dist`;
5. expands `@apply` in component CSS: a class is replaced by the
   declarations of its single flat rule. A variant (`hover:`, `md:`,
   `print:`), a class made of several rules (`container`) and a directive
   outside a flat rule are an `ApplyExpansionError`; no directives remain in
   `dist`;
6. computes the actual component → component graph from bundle imports and
   compares it with `dependencies`: an undeclared edge is an
   `UndeclaredDependencyError`;
7. checks that browser code imports neither `node:*` nor granum node entries
   (`BoundaryViolationError`) and that `package.json#exports` lists the
   manifest and the subpath of every component (`PackageExportsError`);
8. writes `dist/granum.manifest.json`.

Importing a constant or a type from another component's directory is not a
dependency and need not be declared: edges are computed from code that landed
in another component's chunks.

## Rules-only provider

An application may pass its own utility rules to the engine factory
(`windEngine({ rules })`), but then its engine's vocabulary fingerprint drifts
from the packages' fingerprints, and granum re-extracts their classes from files
on every build. If the price matters, the rules move into a provider package with
no components: the application's engine stays vanilla, and the build takes the
fast path.

```ts
// src/engine.ts — the rules module, shipped as dist/engine.js
import type { GranumRule } from '@feugene/granum/engine'

export const brandRules: readonly GranumRule[] = [
  ['brand-logo', { 'background-color': '#7c3aed' }],
  [/^brand-pad-(\d+)$/, ([, step]) => ({ padding: `${Number(step) * 4}px` })],
]

export default { rules: brandRules }
```

```ts
// vite.config.ts
granumProvider({
  provider: defineGranumProvider({
    id: '@acme/brand-rules',
    contractVersion: 2,
    components: [],
    engine: { dialect: WIND_DIALECT_EXTRA, rules: brandRules },
  }),
  engine: windEngine(),
  indexEntry: false,
  entries: { engine: 'src/engine.ts' },
  engineModule: 'engine.js',
})
```

- The package is built with the **vanilla** engine of its dialect, without the
  package rules: the fingerprint in the manifest then equals that of the
  application's vanilla engine, and the application takes the manifest as is.
- The package dialect must equal the dialect of the application's engine:
  otherwise the rules module is not loaded (`engine-rules-skipped` in `doctor`),
  and the rule classes are not generated.
- The module runs in Node during the application build and provides
  `export default { rules, variants, preflights }`. Embed the rule data at package
  build time: the bundler inlines JSON from inside the package by itself. A JSON
  import from another package left external comes out without the
  `with { type: 'json' }` attribute, and the application fails to load the module
  with `ERR_IMPORT_ATTRIBUTE_MISSING`.
- `exports` needs only `./granum.manifest.json`: the application finds the rules
  module by the path in the manifest.

A working example is the [`rules-only-package`](../../fixtures/rules-only-package)
fixture and the [`app-rules`](../../apps/app-rules) stand.

## Codegen

The provider registry, the barrel and `exports` are generated from the
component directories. The standard set of targets is available from the CLI —
`granum codegen` and `granum codegen --check` for CI (see [CLI](./cli.md));
custom targets programmatically:

```js
// scripts/generate-registry.mjs
import { fileURLToPath } from 'node:url'
import { codegenTargets, runRegistryCodegen } from '@feugene/granum/codegen'

await runRegistryCodegen({
  packageDir: fileURLToPath(new URL('..', import.meta.url)),
  check: process.argv.includes('--check'),
  targets: [
    codegenTargets.barrel(),
    codegenTargets.packageExports(),
    codegenTargets.manifestExport(),
    ...codegenTargets.providerRegistry(),
  ],
})
```

## Release checklist

- `vite build` passes without `safelist-redundant` and `css-double-delivery`
  warnings, or they are explained. The most common source of the second one is a
  plugin that injects a component's CSS into its JS chunk
  (`vite-plugin-lib-inject-css` and friends): before granum that was the only
  delivery channel, and with granum the same file arrives from the manifest, so
  the consumer gets two copies. The second one is **outside the `granum.*`
  layers** and therefore beats the whole library. Drop such a plugin from a
  provider's config;
- `granum.manifest.json` is in `exports`; `sideEffects: false`; the package `files`
  cover the whole `dist`, `granum/contract.js` included;
- a package with rules declares `engine.dialect`, is built by an engine of that
  dialect, and `engineModule` points at the built rule module;
- component `dependencies` cover the imports — otherwise the build fails;
- catalog themes are complete against the registry, and `themesDir` folders are named by
  theme and mode ids — otherwise the build fails;
- a cross-provider donor is listed in `peerDependencies`; so is granum if `dist`
  imports any of its entry points besides the embedded `./contract`;
- `doctor --strict` of a consuming application exits with `0`.
