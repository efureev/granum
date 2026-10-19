# Migration from `unocss-preset-granular`

> 🇷🇺 Русская версия: [`../ru/migration.md`](../ru/migration.md).

granum is the successor of the v1 preset with the same provider contract in
spirit but a different orchestrator: instead of `uno.config.ts` and a
glob over `node_modules` — a provider manifest and its own Vite plugin. The
v1 preset keeps working and is not changed; migrate one package at a time. Moving from
granum 2 to 3 is at the [end of the page](#moving-from-granum-2-to-3).

## What stays

- contract semantics: `id`, two dependency forms, `id:Name` selection keys,
  post-order DFS, token layer priority,
  `strictTokens`, `group`;
- the `components/<Name>/index.js` and `groups/<g>/shared/` layout;
- diagnostic commands and their meaning;
- the switching runtime (`createThemeController`; in granum 3 it switches modes).

## What changes in the contract

| v1 | granum | Why |
|---|---|---|
| `packageBaseUrl` is required | not needed: the base is the directory of the manifest found via `exports` | the `data:`-URL class of errors disappears |
| absolute `cssFiles` URLs + `cssFileAssetNames` | one relative path in the manifest | the fallback compensated for the missing manifest |
| `styleAssetFileName` | removed | was deprecated |
| `unocss: { rules, variants, preflights }` | `engine: { dialect, rules, variants, preflights }` | a rule is not portable: the vocabulary it is written against must be named |
| the engine is part of the preset, configured in `uno.config.ts` | an instance in the application config's `engine` | picking the implementation belongs to whoever owns the result |
| `tokenDefinitionsRef` read by the application | component tokens per theme in `themesDir` are materialised into the manifest at provider build | compute once, where the data is born |
| themes are CSS files under selectors | a theme is catalog data, modes are switched by a pair in an attribute | the application assigns selectors from the activation |
| safelist ∩ statics not checked | `safelist-redundant` warning | no silent breakage |
| `undeclared-dependency` by text, `warn` | by the bundler module graph, `error` | precision |
| `layer: 'granular'` with order −50 | `granum.*` cascade layers | the order is explained by names |
| a token key with `--` → `----x` | `InvalidTokenKeyError` | no silent breakage |
| `scan.*`, `content.filesystem` | none: no glob over `node_modules`; package files are read only when its vocabulary differs from the application engine, and only those the manifest names | the manifest |

## Provider

1. Imports: `@feugene/unocss-preset-granular/contract` →
   `@feugene/granum/contract`; `defineGranularComponent` →
   `defineGranumComponent`; `defineGranularProvider` → `defineGranumProvider`.
2. Remove `packageBaseUrl`, `cssFileAssetNames`, `styleAssetFileName`; rename
   `unocss` to `engine` and add a `dialect` to it — the name of the vocabulary
   the rules are written against; declare theme files as paths relative to
   `dist` (`theme/base.css`) and keep the sources in `src/theme/`.
3. In `vite.config.ts` replace `granularChunkFileNames`,
   `granularAssetFileNames`, `granularCssAssetsPlugin` and manual entries
   with a single `granumProvider({ provider, engine: windEngine() })`.
4. Add `codegenTargets.manifestExport()` to codegen so that
   `package.json#exports` lists `./granum.manifest.json`.
5. `vite build`, then `granum doctor --strict` in a consuming application.

The provider needs granum at build time, in `devDependencies`: the build embeds
the contract helpers in `dist`, so a descriptor may be re-exported from a component
entry without a runtime dependency on granum.

```diff
- import { defineGranularComponent } from '@feugene/unocss-preset-granular/contract'
+ import { defineGranumComponent } from '@feugene/granum/contract'

- export const xhCardConfig = defineGranularComponent(import.meta.url, {
+ export const xhCardConfig = defineGranumComponent(import.meta.url, {
    name: 'XhCard',
-   cssFiles: ['./styles.css'],
-   cssFileAssetNames: ['XhCard.css'],
+   cssFiles: ['./styles.css'],
  })
```

## Application

1. Delete `uno.config.ts`, the `unocss` and `@unocss/*` dependencies, the
   `virtual:uno.css` and `virtual:uno:granular.css` imports; install an engine:
   `yarn add -D @feugene/granum-engine-wind`.
2. Create `granum.config.ts` with the mandatory `engine: windEngine()`, plus
   `providers`, `components`, `theme`, `modes`, `appSources`; add `granum(config)` to
   `vite.config.ts`. Rules the application wrote for itself in `uno.config.ts`
   move into the engine factory: `windEngine({ rules: […] })`.
3. Replace the two CSS imports with one `import 'virtual:granum.css'`.
4. Build and check `dist/granum-report.json`: `classes.unmatched` must be
   empty or explained; `tokens.undefined` — empty.

```diff
- import UnoCSS from 'unocss/vite'
+ import { granum } from '@feugene/granum/vite'
+ import config from './granum.config.ts'

  export default defineConfig({
-   plugins: [vue(), UnoCSS()],
+   plugins: [vue(), granum(config)],
  })
```

The v1 preset options move like this: `providers`, `components`, `pruneTokens` keep their
names; `themes.names/define/tokenOverrides/strictTokens` become `modes.names/define/
tokenOverrides/strictTokens`, and `theme` picks the theme; `pruneTokens.appSources` became a
top-level `appSources` because it now also feeds the extraction of application
classes. There is no swap of provider files (`themes.themeFiles`, `baseFile`, `tokensFile`):
mode values are changed by `modes.tokenOverrides`, a whole theme by an application
theme object in `theme` ([Themes and tokens](./themes-and-tokens.md)).
A v1 key left in the config is a load error that says where it went, not a silently
ignored option.

One thing has no v1 counterpart at all: the engine. In the preset it was part
of the package and configured through `uno.config.ts`; in granum the application
picks it and passes an instance, while packages record in the manifest the
dialect and vocabulary fingerprint of the implementation that built them. What
that changes in practice — [engines and dialects](./engines-and-dialects.md).

## Move the reset into a layer

The quietest trap of the migration. With the v1 preset UnoCSS “layers” are
output order, and a conflict between the reset and a utility was settled by
specificity: `.text-[…]` beats `button`. granum uses real cascade layers, and
the rule flips: any unlayered CSS beats any `@layer`.

So an import like `import '@unocss/reset/tailwind-compat.css'` starts winning
over utilities and component CSS after the migration. Move it into a layer:

```css
/* src/styles/reset.css — imported BEFORE virtual:granum.css */
@import '@unocss/reset/tailwind-compat.css' layer(reset);
```

More on this in [“Using granum in an application”](./usage-in-apps.md).

## Checking equivalence

`yarn compare:css` in this repository compares the CSS of the `bench-one`
stand on granum with a snapshot of the same stand on the v1 preset: the rule
sets are equal up to the listed differences — mode pairs instead of `.dark` among them. The same approach works for your own application — capture
the CSS before migration, build after, and compare with
`scripts/compare-css.mjs`.

## Moving from granum 2 to 3

granum 3 changes the theme model: a theme is provider data, the application picks one
theme at build time, and its modes are switched by the pair `data-theme="<theme>-<mode>"`.
The provider contract is version 2, the manifest is format 3. The step-by-step list with
mapping tables is in the package's [`MIGRATION.md`](../../packages/granum/MIGRATION.md);
in short:

- provider: `theme.themes`, `defaultThemes`, `tokenDefinitions` →
  `theme.catalog` with theme data in JSON, `registry`, `defaultTheme`; component
  tokens — `themesDir` instead of `tokenDefinitions*`; `contractVersion: 2`;
- application: `themes` → `theme`, `previews`, `modes`; `themes.define` →
  `modes.define` with a mandatory `extends`; `label` → `title`;
- runtime: the controller's `set`/`get`/`list` → `setMode`/`mode`/`modes()`; the root carries
  a pair, there are no `.light`/`.dark` classes; before the first frame — `createThemeScript`;
- a format 2 manifest of a companion without themes is still read; with themes it is
  `UnsupportedManifestVersionError`, and the package is rebuilt with granum 3.
