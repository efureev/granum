# Themes and tokens

> 🇷🇺 Русская версия: [`../ru/themes-and-tokens.md`](../ru/themes-and-tokens.md).

A token is a CSS custom property (`--xh-accent`). A provider declares tokens
in files (`tokensCss`, theme files) and structurally (`tokenDefinitions`);
the application picks the active themes, adds its own and overrides values.
Every name in configs and descriptors is written **without** `--`: the
generator adds the prefix; a key with `--` is an `InvalidTokenKeyError` in a
descriptor and an `InvalidConfigError` with the field path in the config's `themes`.

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
is then not read. A theme a provider ships as a file is the same bottom layer:
blocks without their own selector (component, `define`, `tokenOverrides`) land under
the selector of the file's first block, and every block of the theme comes after its
file in the CSS, so they win. With `strictTokens: true`, an override of a token no
package layer declares — neither structurally nor in a theme file — is dropped, and
the report gets `override-skipped`. One function computes the value for CSS, the
report and the CLI: `granum tokens <id:Name> --deep` shows the whole chain of layers.

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

The selector of an application theme: an explicit `selector`; for a theme a
provider supplies structurally, that theme's selector (`dark: { tokens }`
lands under `.dark`); for a theme it ships as a file, the selector of the file's
first block; for a theme nobody supplies, `[data-theme="<name>"]`,
and the runtime switches it with that attribute.

### Recolouring a provider theme

Point by point — `tokenOverrides`; as a whole — `define` with `tokensRef` to your CSS:

```ts
themes: {
  names: ['light', 'dark'],
  tokenOverrides: { dark: { 'gr-primary': '#4fd1e0' } },
  define: { light: { tokensRef: new URL('./src/themes/light.css', import.meta.url).href } },
}
```

Both work for a theme the provider ships as a CSS file too: the file stays in the CSS,
and the application values override it for every token they set. There is no swap of
the file itself (`themes.themeFiles` of the v1 preset) — these two paths replace it.

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
no selector or nesting is a `TokenParseError`, not an empty theme. A token
value is taken whole, including `url(data:…)` and strings with `;`; several
blocks with the same selector are merged, the last declaration wins. An
application theme's `tokensRef` is read the same way.

## Consumption and the report

The provider build records in the manifest which tokens a component
**consumes** (`var(--x)` in CSS and JS, `'--x'` literals in JS,
`dynamicTokens`) and which of them it **requires from outside**: uses without
a fallback minus what the component assigns itself (`--x:` in its CSS,
`v-bind()` variables from `<style>`). The application merges consumption with
`appSources` — those are the pruning roots. `token-undefined` in the report and
in `doctor` is one set: a token a selected component requires from outside
(except `dynamicTokens`) that no layer declares for any active theme. Tokens of
the application's own markup are not part of it — the application's CSS
usually declares them.

## Token pruning

```ts
pruneTokens: { mode: 'on', keep: ['xh-brand-*'] }
```

Pruning removes from the `tokens` and `themes` layers the declarations that
are unreachable from the roots; `base` is untouched. Roots: consumption in the
CSS of selected components and in the utilities and preflight generated by the
engine, `consumes` and `dynamic` from the manifests, `appSources`,
`tokenOverrides`, structural layers, `keep`. Reachability follows the graph
"token → tokens in its value", so `--soft: color-mix(…, var(--danger))` keeps
`--danger`.

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
