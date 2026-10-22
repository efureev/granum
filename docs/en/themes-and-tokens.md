# Themes and tokens

> 🇷🇺 Русская версия: [`../ru/themes-and-tokens.md`](../ru/themes-and-tokens.md).

A token is a CSS custom property (`--th-accent`). A **theme** is a design language:
a complete set of token values without selectors, mode-independent (`root`), per
**mode** (`light`, `dark`, then anything) and the values of components. The application lists the build themes:
one **default** theme — in the shared sheet and under `:root`, the other ones are
**additional** — each in a sheet of its own. A theme and a mode are switched on by a
pair in an attribute on the root and switch at runtime. Every name in data, configs
and token files is written **without** `--`: the generator adds the prefix; a key
with `--` is an error (`InvalidTokenKeyError` in a provider, `InvalidConfigError`
with the field path in an application).

## Theme, mode, pair

| Concept | What it is |
|---|---|
| theme | `GranumThemeData`: `id` (slug `^[a-z][a-z0-9-]*$`), `title`, `root`, `modes`, `defaultMode` (`light` by default), `baseCss`, `extensions`, `version`, `targets`, `components` |
| mode | values of mode-dependent tokens: `{ colorScheme, tokens, extends?, title?, fallbacks? }`; the name is a slug without a hyphen, `root` is forbidden |
| pair | the value of the activation attribute: `<theme>-<mode>` (`slate-light`, `ink-dim`) |
| catalog | the themes a provider declares; there is one catalog owner in the graph |
| registry | the owner's dictionary: token → `root` or `mode`; the build checks a theme's completeness against it |
| default theme | the build theme under `:root`: its blocks are in the shared sheet, its default mode applies without the attribute |
| additional theme | a build theme in a sheet of its own: full pair blocks, never under `:root` |

A mode's `extends` names a mode of the same theme: its final tokens are the
ancestors along the chain, then its own. granum does not interpret `extensions`: the
field goes to `virtual:granum/themes` as is — that is how a design system hands the
application, for example, the default props of its components.

## Build themes

The catalog is declared by a provider — usually a separate token package without
components ([for provider authors](./authoring-providers.md#themes-catalog-registry-data)).
The application lists the build themes in `themes`:

```ts
export default defineGranumConfig({
  engine: windEngine(),
  providers: ['@acme/ui'],
  themes: [
    { theme: 'ink', default: true, modes: ['light', 'dark', 'dim'] }, // default
    { theme: 'paper', modes: ['light', 'dark'] },                     // additional
    '@acme/tokens:clay',                                              // qualified id, its default mode only
  ],
})
```

An entry is a theme (a catalog id, `'@acme/tokens:ink'` or an application theme
object) or `{ theme, default?, modes? }`. There is exactly one default theme: in a
list of one entry it is that entry, in a longer list — the one marked
`default: true`; no mark or two marks are `InvalidConfigError('themes')`. An empty
list is an error too: a build without themes is a graph without a catalog owner.
Without `themes`, the catalog owner's `defaultTheme` is used (or the catalog's only
theme). The order of entries is the order of themes in the manifest.

The report and `doctor` show the default theme's source as `themeSource`: `provider` —
an id from the config, `default` — the owner's default theme, `app` — an
application theme object. The owner need not be listed in `providers`: a string
dependency of a manifest (`dependencies: ['@acme/tokens']`) loads the donor from
the directory of the dependent package, and the `'all'` selection does not pick its components.

Data is read only for the themes in `themes`; the other themes of the catalog do not
reach the build and are not opened. An unknown id is a `ThemeResolutionError`
(`unknown-theme`) with the list of available themes; one theme listed twice is
`duplicate-theme`; two catalog owners in the graph are `multiple-theme-owners`.

## Mode set and application modes

Every theme has modes of its own, in the `modes` of its entry: an array of names or
an object `{ names, define, tokenOverrides, strictTokens }`. Without `names` CSS gets
the theme's default mode (`light`) and the keys of its `define`: the theme is built
for the application, and a second mode is the application's decision, not a default.
The rule is the same for the default and the additional themes. The default mode
always comes first; if `names` does not name it, the first mode of the set becomes the
theme's default mode in the build. A mode that a mode of the set extends (`extends`)
does not have to be in the set itself: its values are taken along the chain, and it
gets no block. A name outside the theme and its `define` is `unknown-mode`.

```ts
themes: [{
  theme: 'ink',
  modes: {
    names: ['light', 'dark'],
    define: {
      ocean: { extends: 'dark', tokens: { 'th-accent': '#0ea5e9' }, title: 'Ocean', colorScheme: 'dark' },
      sepia: { extends: 'light', tokensRef: new URL('./src/sepia.css', import.meta.url).href },
    },
    tokenOverrides: { root: { 'th-radius': '4px' }, dark: { 'th-bg': '#050505' } },
    strictTokens: true,
  },
}]
```

`define` is an application mode on top of a mode of its theme or another of its
`define`: it takes the base's final values (component tokens included) and adds its
own. The base hands over its `@supports` fallbacks computed from its own values; a
mode that changes roles needs its own — `fallbacks: [{ supports, tokens }]`, which
come after the inherited ones and override them token by token. An unknown
base and a cycle are warnings `mode-extends-unresolved` and `mode-extends-cycle`;
such a mode inherits the default mode. A `define` named like a mode of its theme is
the same pair — error `activation-collision`. `tokensRef` is an
application CSS file with one flat block of tokens; literal `tokens` win. A file with
several blocks is the error `multiple-blocks` unless `selector` names the block
wanted.

`tokenOverrides.root` goes into the mode-independent values of its theme,
`tokenOverrides.<mode>` — into its mode; a mode outside the set is `unknown-mode`.
With `strictTokens: true` an override of a token present neither in the theme data
nor in component tokens is dropped, and the report gets `override-skipped`. The
values of one theme never touch another.

## Activation

A theme and a mode are switched on by an attribute on the root:
`data-theme="<theme>-<mode>"` by default. The attribute, the value template and the
system scheme are shared by all build themes, in `activation`: a document has one root.

```ts
activation: { attribute: 'data-theme', value: '{theme}-{mode}', system: 'media' }
```

The template must contain `{mode}`, and the values of all pairs of all build themes
and their `define` must differ; otherwise `activation-collision`. `system: 'media'`
adds the default theme's dark mode by `prefers-color-scheme` for a page whose root
has no attribute yet: a root without the attribute is always the default theme.
granum emits no `.light`/`.dark` classes. The engine's `dark:` variant is built from
the pairs with `colorScheme: 'dark'` of **all** build themes
(`[data-theme="ink-dark"] .dark\:…`): utilities live in the shared sheet, and a pair
of an additional theme can be dark too. It is a descendant selector, and a light
island inside a dark page matches it too — islands are served by mode tokens, not
by the variant.

## Value layers

A build theme token's value in a mode is assembled from layers, each overriding the
previous:

1. theme data — `root`, then the mode chain, together with the values of the `components` section;
   for a theme object with `extends`, the data of its parent;
2. component tokens for that theme — in selection order;
3. the application theme object — for an object with `extends`, only its own differences;
4. `modes.define` of the theme's entry;
5. `modes.tokenOverrides` of the theme's entry.

A token declared in at least one mode gets a value in every mode: along the mode's
`extends` chain, otherwise from the default mode. Such a value is a fallback: it does
not override what another layer already gave the mode. A value taken from the default
mode brings that mode's `@supports` fallbacks for the token along, ahead of the mode's
own. A theme fallback is written for the theme's value: a token whose value in the pair
comes from a component gets no theme fallbacks. One function computes the value
for CSS, the report and the CLI: `granum tokens <id:Name> --deep` shows the layer chain
for each mode of the default theme together with the theme and mode the value came from.

## Component values in the theme

Token names are the contract of the component package, values belong to the theme.
A theme carries the values of components in the `components` section of its data:
package → component → `root` and modes. So a new theme for a component package does
not edit the package, and a theme published apart or living in an application does
not set component values blindly — granum checks them against the manifests of the graph.

```ts
components: {
  '@acme/ui': {
    Button: { root: { 'btn-radius': '6px' }, modes: { light: { 'btn-bg': '#fff' }, dark: { 'btn-bg': '#111' } } },
  },
}
```

A value has one place: a token in two sections, in a section and in `root`/`modes` of
the theme, or in `root` and a mode of one section is the error `theme-token-collision`.
A section mode is a mode of the theme, a section package is in the theme's `targets`.
Section values are theme data: the same layer and the same mode chains as
`root`/`modes`.

Whose values they are is checked against the manifests of the graph, not against the
selection: a theme is written for the whole package. A package missing from the graph —
its section is skipped. A section may name a group (`group` of the descriptor) instead of
a component: the tokens of a shared SFC belong to no single component, and a group token
is one that some component of the group requires. A group value is one for the whole
group: a value that differs per component is that component's own token. A component
with the same name takes the section. Neither a component nor a group —
`theme-component-unknown`. A token the component does not require from outside —
`theme-token-foreign`: a hook, a token the
component assigns itself, a global registry token (its place is `root`/`modes`) or a
typo. A theme does not set hooks at all: a value the theme gives makes the token a theme
token, and a hook in `root`/`modes` of the theme is the same finding. The values apply
despite a finding: the theme author decides.

## Component tokens per theme

Values on the component side are for themes of a foreign catalog or for a package that
has not moved its values into themes yet. They live next to the component, in the
`themesDir` folder: `<theme>/root.json`
and `<theme>/modes/<mode>.json` (or `.css` with one flat block). The provider build puts them
into the manifest. For every build theme a token's value is looked up as follows: the mode,
its ancestors by `extends`, the default mode — and in each of them the theme first, then its
ancestors in the catalog. So in theme `ink`, which extends `paper`, mode `dim`
(extends `dark`) takes the button token from `paper/modes/dark.json` when `ink` has none.
Every theme has its own chain: an additional theme does not take tokens from the default
one unless that is its ancestor.

A component may ship tokens for themes of a foreign catalog — a companion for a theme
of the design system: they apply when that theme is in the build. A theme folder that no
catalog of the graph declares is a `component-theme-unknown` warning, not an error.

## Theme source

A theme is easiest to keep as a folder — a source: `theme.json` with the metadata and
the modes, the values in files where they belong. The layout is one for a catalog
theme, a theme package and an application theme.

```text
themes/stone/
  theme.json                         id, title, description, version, targets, extends, defaultMode, modes, extensions
  root.json                          mode-independent tokens
  modes/light.json                   mode tokens
  base.css                           baseCss: @font-face and the like
  components/@acme/ui/Button/root.json
  components/@acme/ui/Button/modes/dark.json
  README.md                          documentation — not read
```

The key order of `modes` in `theme.json` is the order of modes; every mode file is
declared there, and in a source with `extends` a mode without fields of its own is an
empty entry `"dark": {}`. A value file is JSON or CSS with one flat block. `*.md` and
hidden files are not read; anything else that is not theme data is named in `ignore`,
otherwise a stray file is a `ThemeSourceError`: a silently skipped file is lost values.

```ts
import { loadThemeSource } from '@feugene/granum/node'

const reef = loadThemeSource(new URL('./src/themes/reef/', import.meta.url), { ignore: ['notes.json'] })
```

A provider puts a source into its catalog as `{ source: 'themes/stone', ignore? }`: the
provider build reads it and writes the data into `dist` (section values are also merged
into `root`/`modes` there — granum before 3.10 applies them).

## Inheritance and copy

A theme starts in one of two ways, and the difference is not syntax but what happens to
the theme when its source changes.

| | `extends` — inheritance | `granum theme copy` — copy |
|---|---|---|
| Resolved | on every build of whoever builds the theme | once, by the command |
| A change of the source | reaches the theme | does not reach it |
| A new token of the source | the theme gets its value silently | `theme-incomplete` names it — the author decides |
| Take it when | the theme is a variation that must follow its source | the theme is a language of its own |

```bash
granum theme copy stone themes/moss --id moss --title "Moss" --config granum.config.ts
```

A copy resolves the inheritance of the theme and the component values of the source,
including those on the component side (`themesDir`), and keeps the inheritance of
modes: that is a link inside one theme. The values per pair of a copy equal those of
the source at the moment of copying.

## Version and target packages

`version` is the version of the theme, its own, not the version of its package.
`targets` are the packages whose versions the theme is written for:

```json
{ "version": "2.1.0", "targets": { "@acme/ui": "^1.2.0" } }
```

A package whose values the theme sets in `components` must be in `targets`. An heir
merges `targets` with the parent's per package: its own range overrides the parent's
only for its own package, so a section inherited from the parent keeps its target.
`version` is not inherited. The build
checks the ranges against the manifest versions of the graph: going out of range is a
warning in the build log and the `doctor` finding `theme-target-mismatch`; a package
missing from the graph is not checked. A version is a coarse signal, completeness is a
precise one: a theme for `^1` may be complete on `2.0`, and a theme in range may not —
then `theme-incomplete` says so.

## CSS layout

```css
/* shared sheet — the default theme ink */
@layer granum.tokens {
  :root:not([data-theme]), [data-theme="ink-light"], [data-theme="ink-dark"], [data-theme="ink-dim"] { --th-radius: 2px; }  /* root literals */
}
@layer granum.themes {
  :where(:root), [data-theme="ink-light"], [data-theme="ink-dark"], [data-theme="ink-dim"] { --th-ring: 0 0 0 2px var(--th-accent); }
  :where(:root), [data-theme="ink-light"] { color-scheme: light; --th-bg: #ffffff; }
  [data-theme="ink-dark"] { color-scheme: dark; --th-bg: #0f172a; }
  [data-theme="ink-dim"] { color-scheme: dark; --th-bg: #1e293b; }
  @supports not (color: color-mix(in oklab, red, red)) {
    :root:not([data-theme]), [data-theme="ink-light"] { … }
  }
}
/* sheet of the additional theme paper */
@layer granum.tokens, granum.base, granum.themes, granum.components, granum.utilities;
@layer granum.themes {
  [data-theme="paper-light"], [data-theme="paper-dark"] { … }  /* formulas */
  [data-theme="paper-light"] { … }                              /* full block */
}
```

A formula referencing `var(` — in `root` or identical in every mode — sits under the
default theme's shared boundary — `:where(:root)` and the list of its pairs: it is
recomputed on every mode island instead of being inherited ready-made from the root.
The boundary is exactly the list of pairs, not `[data-theme]`: it does not reach a
pair of another theme. The default mode comes first under `:where(:root)` and its own
pair, the others follow the set order. The default theme's `:root` sits under
`:where()` and weighs zero: a pair of any mode and any theme on the root overrides it
by specificity rather than by position — so the cascade does not depend on the order
of the sheets in the document. Then come the `@supports` fallbacks in the same order:
the default mode's one goes under `:root:not([data-theme])` and its pair, otherwise it
would reach a root with another pair. With `system: 'media'` the
`prefers-color-scheme` block closes the list and carries the dark mode's fallbacks
inside the same media query. A mode's `colorScheme` is a `color-scheme` declaration
in its block. The default theme's `baseCss` goes to the `base` layer of the shared sheet.

## Additional themes

Every build theme except the default one is additional. Every pair of it gets a full
block: its own `root` literals, the mode, the component tokens of the selection and
the fallbacks; formulas go once under the list of its pairs (`[data-theme="paper-light"],
[data-theme="paper-dark"]`). A value prefix would also match the pairs of another
theme (`slate-` matches `slate-hc-light`). An additional theme never goes under
`:root`, and token pruning cuts it the same way as the default one.

The shared sheet has no blocks of an additional theme — they live only in its sheet.
The sheet is self-sufficient: the shared sheet and it alone give the whole theme,
without the sheets of other themes. It starts with the layer order declaration and
puts the blocks into the `themes` layer and its own `baseCss` into the `base` layer
(except the entries the shared sheet already has), so linked before the shared sheet
it does not change the cascade. Once loaded, the sheet stays in the document, and its
`base` applies to the whole page — an additional theme's `baseCss` is the place only
for `@font-face`, `@property` and `@keyframes`; `doctor` reports a style rule there as
`theme-base-global`. The sheet comes two ways:

- as a module — a page that always shows the theme imports it statically:

```ts
// src/pages/themes/[slug].astro — and nowhere else
import 'virtual:granum/themes/paper.css' // one theme; 'virtual:granum/themes.css' — all additional ones
```

- by the address in the manifest — for switching at runtime: the manifest module
  imports the sheet `?url` as the file `/@granum-theme/granum-theme-<id>.css`. At
  build time Vite runs it through the same CSS pipeline as the shared sheet, emits it
  as an asset with a hash and puts the address, `base` included, into the theme entry's
  `href`; in dev the dev server serves that address. The plugin puts no `<link>` into
  HTML — the runtime loads the sheet.

The two ways combine: the sheet ends with a marker, `@property --granum-sheet-<id>`
outside the layers and without a selector, so the loader recognises a sheet already
imported statically and inserts no second `<link>` — the page downloads it once.

A module of the default theme is an error pointing out that its blocks are in
`virtual:granum.css`; a theme outside the build is an error listing the additional themes.

The stand is `apps/app-theme-sheets`: two pages, only one gets the additional theme's
sheet as a module, and the manifest carries the asset address.

## An application's own theme

A `themes` entry also accepts a `GranumThemeData` object — an application theme or a
theme from a package of its own. With `extends` the object carries only differences:
granum merges it with the parent — a catalog theme by id or another object — before
any check, and the catalog chain also gives component tokens. So a theme package
extends a catalog theme live: changes of the parent arrive on the next application build.

```ts
import tide from '@acme/theme-tide'          // the theme object of a theme package: extends: 'stone'

themes: [
  { theme: 'stone', default: true },
  tide,
  { theme: { ...loadThemeSource(new URL('./src/themes/reef/', import.meta.url)) } },
]
```

An `extends` absent from the catalog is the error `unknown-theme` listing the available
ones: otherwise the values of that chain would silently not apply. Objects that extend each
other in a cycle are `theme-extends-cycle`. Without `extends` the object data must be
complete; an object's `id` and `title` are always its own.

The theme object's own values are a layer after component tokens: a button token's value
in one of its modes overrides the component token. What it inherits from the parent comes
as the parent's theme data — before component tokens and under pruning, as for the parent
itself: an heir without differences of its own looks just like the parent. `sources` are the files the theme is assembled from
(`loadThemeSource` fills them): the config is read once per Vite process, so editing them
in dev restarts the server. The stands are `apps/app-theme-own` and
`apps/app-theme-values`.

## Consumption and the report

The provider build records in the manifest which tokens a component
**consumes** (`var(--x)` in CSS and JS, `'--x'` literals in JS, `dynamicTokens`)
and which of them it **requires from outside**: consumption without a fallback
minus what the component assigns itself (`--x:` in its own CSS, `v-bind()`
variables from `<style>`). The application merges consumption with `appSources` — those
are the pruning roots. `token-undefined` in the report and in `doctor` is one set: a token
a selected component requires from outside (except `dynamicTokens`) that got no
value in any mode of any build theme and is not declared by inlined
files. Tokens of the application's own markup are not part of it.

A token a component reads **only** through `var(--x, fallback)` is not required
from outside, yet staying silent about it is risky: if no layer sets it, the
component always renders the fallback, and a renamed token hides exactly this way.
The build records such tokens in the manifest separately, and `doctor` reports the
unset ones as `token-fallback-only`. An intentional hook — a default the application
may override — is declared by the component in `hookTokens`; a theme does not set hooks.

## Token pruning

```ts
pruneTokens: { mode: 'on', keep: ['th-brand-*'] }
```

Pruning removes declarations unreachable from the roots from the `tokens` and
`themes` layers; `base` is untouched. Theme data and component tokens are the package
layer and are cut by reachability for every build theme. Roots: consumption in the CSS
of selected components and in the engine output, `consumes` and `dynamic` from the
manifests, `appSources`, the application's values (`define` and `tokenOverrides` of
the theme entries, theme objects), `keep`.
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
themes.themes()            // [{ id: 'ink', modes, defaultMode }, { id: 'paper', …, href: '/assets/granum-theme-paper-….css' }]
themes.theme.id            // 'ink'
themes.modes()             // modes of the current theme: [{ name: 'light', value: 'ink-light', colorScheme: 'light' }, …]
themes.setMode('dim')      // <html data-theme="ink-dim">
await themes.setTheme('paper') // the paper sheet, then <html data-theme="paper-dark">
themes.subscribe(({ theme, mode }) => {})
```

The complete example is `apps/app-theme-switch`: two package themes and the
application's own theme, a theme and mode switcher, islands and the choice before the
first frame.

The manifest is the build themes in config order (each with its modes and their pairs
in CSS order, the default mode, the sheet's `href` for an additional theme and
`extensions`), `defaultTheme` and the activation attribute; apart from the sheet
addresses it does not depend on the component selection. `setTheme` loads the theme's
sheet first (`loadThemeSheet`) and only then sets the pair: the theme's values without
its sheet would be someone else's. While the sheet of an additional theme chosen at
start is loading, `setMode` does not set the pair either — it only remembers the mode;
if the sheet fails, the controller stays in the default theme. The outcome of a link
inserted by the early script is marked on it (`data-granum-state`), so a sheet that
failed before the controller is not awaited forever, and the next `setTheme` loads it
again. The mode on a theme change is the given `mode`,
otherwise the one named like the current one, otherwise the first of the same scheme,
otherwise the theme's default mode.

The controller stores not the pair but a selection key (key `granum-theme`): the mode
name for the default theme, `<theme>-<mode>` for an additional one
(`themeSelectionKey`). A default-theme mode stored without the theme name survives a
change of the default theme at build time; a key that names no mode of a selectable
build theme gives no choice. On start, `initial: 'auto'` takes the pair already set
on the root — and leaves the root alone, finding and awaiting the sheet of its theme;
otherwise the stored choice, the system scheme (the first mode of the default theme
with a matching `colorScheme`) and the default mode. A stored additional theme is set
once its sheet has loaded — `ready`; if the sheet fails, the controller stays on the
default theme. `initial` may also name the choice outright — a mode of the default
theme or `{ theme?, mode? }`, the shape `themeRootAttributes` takes: a server that read
the choice from a cookie hands the same selection to the app it renders.

The pair is set before the first frame by `createThemeScript` or the plugin option
`themeScript` ([server rendering](./ssr.md)): for an additional theme the script first
inserts its sheet's `<link rel="stylesheet" blocking="render">`, and it does not pick a
theme without a sheet address (a manifest built before the bundle).
