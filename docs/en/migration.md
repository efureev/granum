# Migration from `unocss-preset-granular`

> 🇷🇺 Русская версия: [`../ru/migration.md`](../ru/migration.md).

granum is the successor of the v1 preset with the same provider contract in
spirit but a different orchestrator: instead of `uno.config.ts` and
`node_modules` scanning — a provider manifest and its own Vite plugin. The
v1 preset keeps working and is not changed; migrate one package at a time.

## What stays

- contract semantics: `id`, two dependency forms, `id:Name` selection keys,
  post-order DFS, the active set of themes, token layer priority,
  `strictTokens`, `group`;
- the `components/<Name>/index.js` and `groups/<g>/shared/` layout;
- diagnostic commands and their meaning;
- the theme runtime (`createThemeController`).

## What changes in the contract

| v1 | granum | Why |
|---|---|---|
| `packageBaseUrl` is required | not needed: the base is the directory of the manifest found via `exports` | the `data:`-URL class of errors disappears |
| absolute `cssFiles` URLs + `cssFileAssetNames` | one relative path in the manifest | the fallback compensated for the missing manifest |
| `styleAssetFileName` | removed | was deprecated |
| `unocss: { rules, variants, preflights }` | `engine: { rules, variants, preflights }` | independence from UnoCSS |
| `tokenDefinitionsRef` read by the application | materialised into the manifest at provider build | compute once, where the data is born |
| safelist ∩ statics not checked | `safelist-redundant` warning | no silent breakage |
| `undeclared-dependency` by text, `warn` | by the bundler module graph, `error` | precision |
| `layer: 'granular'` with order −50 | `granum.*` cascade layers | the order is explained by names |
| a token key with `--` → `----x` | `InvalidTokenKeyError` | no silent breakage |
| `scan.*`, `content.filesystem` | none: `node_modules` is not scanned | the manifest |

## Provider

1. Imports: `@feugene/unocss-preset-granular/contract` →
   `@feugene/granum/contract`; `defineGranularComponent` →
   `defineGranumComponent`; `defineGranularProvider` → `defineGranumProvider`.
2. Remove `packageBaseUrl`, `cssFileAssetNames`, `styleAssetFileName`;
   rename `unocss` to `engine`; declare theme files as paths relative to
   `dist` (`theme/base.css`) and keep the sources in `src/theme/`.
3. In `vite.config.ts` replace `granularChunkFileNames`,
   `granularAssetFileNames`, `granularCssAssetsPlugin` and manual entries
   with a single `granumProvider({ provider })`.
4. Add `codegenTargets.manifestExport()` to codegen so that
   `package.json#exports` lists `./granum.manifest.json`.
5. `vite build`, then `granum doctor --strict` in a consuming application.

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
   `virtual:uno.css` and `virtual:uno:granular.css` imports.
2. Create `granum.config.ts` with `providers`, `components`, `themes`,
   `appSources`; add `granum(config)` to `vite.config.ts`.
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

The v1 preset options move almost one to one: `providers`, `components`,
`themes.names/define/tokenOverrides/strictTokens`, `pruneTokens` keep their
names; `pruneTokens.appSources` became a top-level `appSources` because it
now also feeds the extraction of application classes.

## Checking equivalence

`yarn compare:css` in this repository compares the CSS of the `bench-one`
stand on granum with a snapshot of the same stand on the v1 preset: the rule
sets are equal. The same approach works for your own application — capture
the CSS before migration, build after, and compare with
`scripts/compare-css.mjs`.
