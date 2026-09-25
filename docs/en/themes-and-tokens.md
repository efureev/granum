# Themes and tokens

> 🇷🇺 Русская версия: [`../ru/themes-and-tokens.md`](../ru/themes-and-tokens.md).

A token is a CSS custom property (`--xh-accent`). A provider declares tokens
in files (`tokensCss`, theme files) and structurally (`tokenDefinitions`);
the application picks the active themes, adds its own and overrides values.
Every name in configs and descriptors is written **without** `--`: the
generator adds the prefix, and a key with `--` is an `InvalidTokenKeyError`
at registration.

## Active set of themes

Determined in a fixed order; the source is visible in the report as
`namesSource`:

1. the application's `themes.names` (including an empty list — no themes);
2. the keys of the application's `themes.define`;
3. the union of `defaultThemes` of all providers in the graph;
4. `['light']`.

Provider theme files (`theme.themes[name]`) are included only for active
names; a broken reference of an inactive theme does not fail the build.

## Value layers

The value of a token under a theme selector is assembled from layers, each
next one overriding the previous:

1. the provider's `theme.tokenDefinitions`;
2. component `tokenDefinitions` — in selection order;
3. the application's `themes.define[name].tokens`;
4. `themes.tokenOverrides[name]`.

A structural theme definition beats the CSS file of the same theme: the file
is then not read. With `strictTokens: true`, an override of a token that no
package layer declares is dropped — the report gets `override-skipped`. One
function computes the value for CSS, the report and the CLI:
`granum tokens <id:Name> --deep` shows the whole chain of layers.

## Application themes

```ts
themes: {
  define: {
    emerald: { extends: 'light', tokens: { 'app-bg': '#052e1f' }, label: 'Emerald', colorScheme: 'dark' },
    crimson: { extends: 'light', tokensRef: new URL('./src/themes/crimson.css', import.meta.url).href },
  },
}
```

`extends` inherits the values of a provider theme (structural ones only: a
file theme is opaque, and the report says `theme-extends-unresolved`).
`tokensRef` is an application CSS file whose tokens are materialised at build
time. `label` and `colorScheme` go to the theme manifest for the runtime.

## Component tokens

```ts
defineGranumComponent(import.meta.url, {
  name: 'XhCard',
  tokenDefinitions: { light: { selector: ':root', tokens: { 'xh-card-bg': 'var(--xh-surface)' } } },
  tokenDefinitionsRef: { dark: { url: './tokens.dark.css', selector: '.dark' } },
  dynamicTokens: ['xh-z-*'],
})
```

`tokenDefinitionsRef` is read at provider build time and materialised into
the manifest: the application does not need the file. `strict` by default:
no selector or nesting is a `TokenParseError`, not an empty theme.

## Consumption and the report

The provider build records in the manifest which tokens a component
**consumes**: `var(--x)` in CSS and JS, `'--x'` literals in JS,
`dynamicTokens`. The application merges that with consumption in
`appSources`. A token that is consumed and declared by no layer for any
active theme is `token-undefined` in the report and in `doctor`.

## Token pruning

```ts
pruneTokens: { mode: 'on', keep: ['xh-brand-*'] }
```

Pruning removes from the `tokens` and `themes` layers the declarations that
are unreachable from the roots; `base` is untouched. Roots: consumption in the
CSS of selected components, `consumes` and `dynamic` from the manifests,
`appSources`, `tokenOverrides`, structural layers, `keep`. Reachability
follows the graph "token → tokens in its value", so
`--soft: color-mix(…, var(--danger))` keeps `--danger`.

Rollout order: `mode: 'report'` → look at the plan in the report or in
`granum prune` → `mode: 'on'`. Mode `off` does not change the emission by a
byte. The [`bench-pruned`](./measuring-weight.md) stand shows the effect:
117 → 49 declared tokens.

## Runtime

```ts
import { createThemeController } from '@feugene/granum/runtime'
import manifest from 'virtual:granum/themes'

const themes = createThemeController(manifest, { initial: 'auto', storageKey: 'theme' })
themes.list()      // ['light', 'dark', 'emerald']
themes.set('dark') // data-theme / class / nothing — per the manifest
```

The theme manifest is derived from block selectors: `[data-theme=dark]` →
attribute, `.dark` → class, `:root` → nothing. For a theme file with an
unusual selector the activation can be set explicitly via
`granum(config, { themeManifest: { activations } })`.
