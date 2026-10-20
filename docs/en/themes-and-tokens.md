# Themes and tokens

> 🇷🇺 Русская версия: [`../ru/themes-and-tokens.md`](../ru/themes-and-tokens.md).

A token is a CSS custom property (`--th-accent`). A **theme** is a design language:
a complete set of token values without selectors, mode-independent (`root`) and per
**mode** (`light`, `dark`, then anything). An application build has exactly one active
theme; all of its modes go into CSS at once and switch at runtime by an attribute on the root.
Every name in data, configs and token files is written **without** `--`: the
generator adds the prefix; a key with `--` is an error (`InvalidTokenKeyError` in a
provider, `InvalidConfigError` with the field path in an application).

## Theme, mode, pair

| Concept | What it is |
|---|---|
| theme | `GranumThemeData`: `id` (slug `^[a-z][a-z0-9-]*$`), `title`, `root`, `modes`, `defaultMode` (`light` by default), `baseCss`, `extensions` |
| mode | values of mode-dependent tokens: `{ colorScheme, tokens, extends?, title?, fallbacks? }`; the name is a slug without a hyphen, `root` is forbidden |
| pair | the value of the activation attribute: `<theme>-<mode>` (`slate-light`, `ink-dim`) |
| catalog | the themes a provider declares; there is one catalog owner in the graph |
| registry | the owner's dictionary: token → `root` or `mode`; the build checks a theme's completeness against it |

A mode's `extends` names a mode of the same theme: its final tokens are the
ancestors along the chain, then its own. granum does not interpret `extensions`: the
field goes to `virtual:granum/themes` as is — that is how a design system hands the
application, for example, the default props of its components.

## Catalog and choosing the theme

The catalog is declared by a provider — usually a separate token package without
components ([for provider authors](./authoring-providers.md#themes-catalog-registry-data)).
The application picks the theme in its config:

```ts
export default defineGranumConfig({
  engine: windEngine(),
  providers: ['@acme/ui'],
  theme: 'ink',          // catalog id; '@acme/tokens:ink' is the qualified id
  previews: ['paper'],   // themes shown next to the active one
  modes: { names: ['light', 'dark', 'dim'] },
})
```

Without `theme`, the catalog owner's `defaultTheme` is used (or the catalog's only
theme). The report and `doctor` show the source as `themeSource`: `provider` —
an id from the config, `default` — the owner's default theme, `app` — an
application theme object. The owner need not be listed in `providers`: a string
dependency of a manifest (`dependencies: ['@acme/tokens']`) loads the donor from
the directory of the dependent package, and the `'all'` selection does not pick its components.

Data is read only for the active theme and the previews; the other themes of the
catalog do not reach the build and are not opened. An unknown id is a `ThemeResolutionError`
(`unknown-theme`) with the list of available themes; two catalog owners in the graph are
`multiple-theme-owners`.

## Mode set and application modes

Without `modes.names` CSS gets the theme's default mode (`light`) and the keys of
`modes.define`: the theme is built for the application, and a second mode is the
application's decision, not a default. Need dark — name it: `modes: { names: ['light', 'dark'] }`.
The default mode always comes first; if `modes.names` does not name it, the first mode of the set
becomes the build's default mode. A mode that a mode of the set extends (`extends`) does not have
to be in the set itself: its values are taken along the chain, and it gets no block. A name outside
the theme and `define` is `unknown-mode`.

```ts
modes: {
  define: {
    ocean: { extends: 'dark', tokens: { 'th-accent': '#0ea5e9' }, title: 'Ocean', colorScheme: 'dark' },
    sepia: { extends: 'light', tokensRef: new URL('./src/sepia.css', import.meta.url).href },
  },
  tokenOverrides: { root: { 'th-radius': '4px' }, dark: { 'th-bg': '#050505' } },
  strictTokens: true,
  system: 'media',
}
```

`define` is an application mode on top of a theme mode or another `define`: it takes
the base's final values (component tokens included) and adds its own. The base hands
over its `@supports` fallbacks computed from its own values; a mode that changes roles
needs its own — `fallbacks: [{ supports, tokens }]`, which come after the inherited ones
and override them token by token. An unknown
base and a cycle are warnings `mode-extends-unresolved` and `mode-extends-cycle`;
such a mode inherits the default mode. A `define` named like a mode of the
theme is the same pair — error `activation-collision`. `tokensRef` is an
application CSS file with one flat block of tokens; literal `tokens` win.

`tokenOverrides.root` goes into the mode-independent values, `tokenOverrides.<mode>` —
into the mode; a mode outside the set is `unknown-mode`. With `strictTokens: true` an
override of a token present neither in the theme data nor in component tokens is dropped,
and the report gets `override-skipped`. `system: 'media'` adds the dark mode by
`prefers-color-scheme` for a page whose root has no attribute yet.

## Activation

A mode is switched on by an attribute on the root: `data-theme="<theme>-<mode>"` by default.
The attribute and the value template are changed in `modes.activation`:

```ts
modes: { activation: { attribute: 'data-theme', value: '{theme}-{mode}' } }
```

The template must contain `{mode}`, and the values of all pairs of the active theme,
`define` and the previews must differ; otherwise `activation-collision`. granum emits
no `.light`/`.dark` classes. The engine's `dark:` variant is built from the pairs of modes
with `colorScheme: 'dark'` (`[data-theme="ink-dark"] .dark\:…`): it is a descendant
selector, and a light island inside a dark page matches it too — islands are served
by mode tokens, not by the variant.

## Value layers

A token's value in a mode is assembled from layers, each overriding the previous:

1. theme data — `root`, then the mode chain;
2. component tokens for the active theme — in selection order;
3. the application theme object;
4. `modes.define`;
5. `modes.tokenOverrides`.

A token declared in at least one mode gets a value in every mode: along the mode's
`extends` chain, otherwise from the default mode. Such a value is a fallback: it does
not override what another layer already gave the mode. A value taken from the default
mode brings that mode's `@supports` fallbacks for the token along, ahead of the mode's
own. One function computes the value
for CSS, the report and the CLI: `granum tokens <id:Name> --deep` shows the layer chain for
each mode together with the theme and mode the value came from.

## Component tokens per theme

Component tokens live next to the component, in the `themesDir` folder: `<theme>/root.json`
and `<theme>/modes/<mode>.json` (or `.css` with one flat block). The provider build puts them
into the manifest. For the active theme a token's value is looked up as follows: the mode, its
ancestors by `extends`, the default mode — and in each of them the theme first, then its
ancestors in the catalog. So in theme `ink`, which extends `paper`, mode `dim`
(extends `dark`) takes the button token from `paper/modes/dark.json` when `ink` has none.

A component may ship tokens for themes of a foreign catalog — a companion for a theme
of the design system: they apply when that theme is active. A theme folder that no
catalog of the graph declares is a `component-theme-unknown` warning, not an error.

## CSS layout

```css
@layer granum.tokens {
  :root { --th-radius: 2px; }                        /* root literals */
}
@layer granum.themes {
  :root, [data-theme] { --th-ring: 0 0 0 2px var(--th-accent); }
  :root, [data-theme="ink-light"] { color-scheme: light; --th-bg: #ffffff; }
  [data-theme="ink-dark"] { color-scheme: dark; --th-bg: #0f172a; }
  [data-theme="ink-dim"] { color-scheme: dark; --th-bg: #1e293b; }
  @supports not (color: color-mix(in oklab, red, red)) {
    :root:not([data-theme]), [data-theme="ink-light"] { … }
  }
  [data-theme^="paper-"] { … }                       /* preview: formulas */
  [data-theme="paper-light"] { … }                   /* preview: full block */
}
```

A formula referencing `var(` — in `root` or identical in every mode — sits under the
shared boundary `:root, [data-theme]`: it is recomputed on every mode island
instead of being inherited ready-made from the root. The default mode comes first under
`:root` and its own pair, the others follow the set order; with equal specificity
position decides. Then come the `@supports` fallbacks in the same order: the default
mode's one goes under `:root:not([data-theme])` and its pair rather than under `:root`,
otherwise it would override another mode's pair on the root by position. With
`system: 'media'` the `prefers-color-scheme` block closes the list and carries the dark
mode's fallbacks inside the same media query. A mode's `colorScheme` is a
`color-scheme` declaration in its block. The theme data's `baseCss` goes to the `base` layer.

## Previews

`previews` show other catalog themes next to the active one — on a design
system page or a portal. Every preview pair gets a full block: its own
`root` literals, the mode, the component tokens of the selection and the fallbacks;
formulas go under the prefix of its pairs (`[data-theme^="paper-"]`). A preview never
goes under `:root`, and token pruning cuts it the same way as the active theme.

By default the preview blocks sit in the shared sheet, and every page pays for them.
`css: { previews: 'separate' }` moves them into the modules
`virtual:granum/previews.css` (all preview themes) and
`virtual:granum/previews/<id>.css` (one) — imported only by the page that shows the
preview:

```ts
// src/pages/themes/[slug].astro — and nowhere else
import 'virtual:granum/previews.css'
```

A preview module carries the layer order declaration and puts the blocks into the
`themes` layer, so the cascade is the same as with the shared sheet.

## An application's own theme

`theme` also accepts a `GranumThemeData` object — complete data. Inheriting from a
catalog theme is resolved by the application itself, before the config, and `extends`
tells granum whose component tokens to build on:

```ts
theme: {
  ...brandData,          // complete data: id, title, root, modes
  extends: 'paper',      // component tokens for modes where the theme sets none
  sources: ['src/theme'],
}
```

The theme object is a layer after component tokens: a button token's value in one of its
modes overrides the component token. `sources` are the files the theme is assembled from:
the config is read once per Vite process, so editing them in dev restarts the
server. The stand is `apps/app-theme-own`.

## Consumption and the report

The provider build records in the manifest which tokens a component
**consumes** (`var(--x)` in CSS and JS, `'--x'` literals in JS, `dynamicTokens`)
and which of them it **requires from outside**: consumption without a fallback
minus what the component assigns itself (`--x:` in its own CSS, `v-bind()`
variables from `<style>`). The application merges consumption with `appSources` — those
are the pruning roots. `token-undefined` in the report and in `doctor` is one set: a token
a selected component requires from outside (except `dynamicTokens`) that got no
value in any mode of the active theme and is not declared by inlined
files. Tokens of the application's own markup are not part of it.

## Token pruning

```ts
pruneTokens: { mode: 'on', keep: ['th-brand-*'] }
```

Pruning removes declarations unreachable from the roots from the `tokens` and
`themes` layers; `base` is untouched. Theme data and component tokens are the package layer and
are cut by reachability. Roots: consumption in the CSS of selected components and in the
engine output, `consumes` and `dynamic` from the manifests, `appSources`, the application's
values (`modes.define`, `modes.tokenOverrides`, the theme object), `keep`.
Reachability follows the "token → tokens in its value" graph, so
`--soft: color-mix(…, var(--danger))` keeps `--danger`. A token needed by one
mode is kept in all of them.

Rollout order: `mode: 'report'` → look at the plan in the report or
`granum prune` → `mode: 'on'`. Mode `off` changes the emission by not a single byte.
The [`bench-pruned`](./measuring-weight.md) stand shows the effect.

## Runtime

```ts
import { createThemeController } from '@feugene/granum/runtime'
import manifest from 'virtual:granum/themes'

const themes = createThemeController(manifest)
themes.theme              // { id: 'ink', title: 'Ink' } — read-only
themes.modes()            // [{ name: 'light', value: 'ink-light', colorScheme: 'light' }, …]
themes.setMode('dim')     // <html data-theme="ink-dim">
themes.mode               // 'dim'
```

The manifest is the active theme, its modes with their pairs in CSS order, the default mode,
the activation attribute and `extensions`; it does not depend on the component selection.
The controller stores the **mode** name, not the pair (key `granum-theme`): changing the theme
at build time does not reset the user's choice. On start, `initial: 'auto'` takes the pair
already set on the root — and leaves the root alone; otherwise the stored mode,
the system scheme (the first mode with a matching `colorScheme`) and the default mode.
The pair is set before the first frame by `createThemeScript` or the plugin option
`themeScript` ([server rendering](./ssr.md)).
