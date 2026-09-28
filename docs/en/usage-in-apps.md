# Usage in applications

> 🇷🇺 Русская версия: [`../ru/usage-in-apps.md`](../ru/usage-in-apps.md).

The application states **which** components and themes it needs in
`granum.config.ts`; the `granum()` plugin builds one resolution from the
provider manifests and feeds three channels with it: CSS, JS and themes.

## Config

```ts
import { defineGranumConfig } from '@feugene/granum/vite'
import { windEngine } from '@feugene/granum-engine-wind'

export default defineGranumConfig({
  engine: windEngine(),
  providers: ['@acme/ui', '@acme/base'],
  components: [{ provider: '@acme/ui', names: ['XhPanel'] }, '@acme/base:XBox'],
  themes: { names: ['light', 'dark'], tokenOverrides: { light: { 'xh-accent': '#0a7' } }, strictTokens: true },
  appSources: { dirs: ['src'] },
  css: { layers: true, layerPrefix: 'granum' },
  js: { virtualComponents: true, guard: 'error' },
  pruneTokens: { mode: 'off' },
  report: { file: 'granum-report.json' },
})
```

| Field | Default | Meaning |
|---|---|---|
| `engine` | — (required) | a utility engine instance: `windEngine()` from `@feugene/granum-engine-wind` or your own; the `'builtin'` string and an options object are not accepted |
| `providers` | — | package names (the manifest is found via `exports["./granum.manifest.json"]`) or contract objects; an object whose `baseUrl` points at an existing `dist` is scanned by the application itself (slow path, `provider-scanned`) |
| `components` | `'all'` | a list of `id:Name` keys / `{ provider, names }` or `'imports'` — from imports in `appSources` |
| `themes.names` | by `define` → providers' `defaultThemes` → `['light']` | the active set of themes |
| `themes.define` | — | application themes: `{ extends, tokens, tokensRef, label, colorScheme }` |
| `themes.tokenOverrides` | — | values on top of every provider layer |
| `themes.strictTokens` | `false` | an override of a token no layer declares is dropped |
| `appSources` | — | directories to extract application classes and token consumption from |
| `css.layers` | `true` | `@layer` wrappers; `false` — flat concatenation in the same order |
| `js.guard` | `'error'` | importing a component outside the selection: error, warning or nothing |
| `js.dts` | — | where to write the declarations for `virtual:granum/components`, e.g. `src/granum.d.ts` |
| `pruneTokens.mode` | `'off'` | `'report'` — plan in the report, `'on'` — prune the `tokens` and `themes` layers |
| `report.file` | `'granum-report.json'` | build report in `outDir`; `false` — do not write |
| `report.brotli` | `false` | whether to measure layer sizes in brotli: quality 11 is 151 ms on 222 kB against 2 ms for gzip |

The config shape is validated on load: `InvalidConfigError` names the path
to the field.

## Selection

The list of components is closed transitively over the `dependencies` of
the manifests: dependencies come before dependants (post-order DFS), and
that order is normative for CSS and tokens. `components: 'imports'` computes
the initial list from imports like `@acme/ui/components/XhPanel` and from
PascalCase tags in `appSources`.

The recommended mode is the explicit list: it keeps the selection in one place
where a reviewer can see it. `'imports'` fits applications whose component set
changes often, but mind its boundary: a component rendered through a computed
name (`<component :is="name">`) is not found by the scan, and its CSS will not
reach the build.

The guard in `resolveId` catches an import of a component outside the
selection:

```
[granum] ComponentOutsideSelectionError: '@acme/ui:XhTable' is imported by
src/App.vue but is not part of the selection [@acme/ui:XhPanel, …]
```

## The engine and package classes

`engine` in the config is a utility engine instance: granum has none of its
own, the application chooses. Application rules go to the engine factory
(`windEngine({ rules: […] })`); the config has no field for rules.

granum trusts the class list in a manifest only when the vocabulary
fingerprints match: the manifest's `engine` block records the fingerprint of
the implementation that filtered that list. On any difference the package
classes are re-extracted by the application engine from the manifest files, and
the difference is named — `gained` (the package build lost them, the application
got them back) and `lost` (the application has no rule; the class stays in the
engine input and shows up in `unmatched`). A package rule module is loaded on
equal dialects, not equal fingerprints; the full decision table lives in
[engines and dialects](./engines-and-dialects.md).

## CSS channel

```ts
import 'virtual:granum.css'
```

The module holds the order statement and five layers:

```css
@layer granum.tokens, granum.base, granum.themes, granum.components, granum.utilities;
@layer granum.tokens { … }      /* providers' theme.tokensCss, structural :root tokens */
@layer granum.base { … }        /* the engine preflight, then theme.baseCss */
@layer granum.themes { … }      /* token blocks of active themes, theme files */
@layer granum.components { … }  /* cssFiles and styles.css of selected components */
@layer granum.utilities { … }   /* the engine's utilities */
```

The engine input is the union of the static classes of selected components
(from the manifests), their safelist and the classes extracted from
`appSources`. One layer alone: `virtual:granum/layers/utilities.css` — with its
own `@layer` wrapper; the concatenation of layers equals the whole. Unlayered
application CSS beats everything inside the layers — by design: a utility in an
application template wins over a component's base style.

That rule has a flip side that is easy to walk into: **a browser reset is
unlayered CSS too**. Imported as is, it wins over utilities and component CSS
regardless of specificity: `button { color: inherit }` from a typical reset is
stronger than the class `.text-[var(--…)]` in `@layer granum.utilities`. On the
design system's showcase that produced a red button with dark text and a
contrast of 2.89:1 instead of 4.5:1.

One line fixes it — import the reset into a layer of its own:

```css
/* src/styles/reset.css — imported BEFORE virtual:granum.css */
@import '@unocss/reset/tailwind-compat.css' layer(reset);
```

A layer's place in the cascade is set by its first appearance, so a reset
imported earlier loses to every granum layer — which is exactly what a reset
should do.

With the v1 preset the question did not arise: there UnoCSS “layers” are output
order rather than cascade layers, and the conflict was settled by specificity,
where a class beats a tag.

### One asset per layer: `css.split`

A single file compresses better but is invalidated as a whole: a change in the
markup drops the cache of tokens and themes that did not change.

```ts
export default defineGranumConfig({
  engine: windEngine(),
  providers: ['@acme/ui'],
  appSources: { dirs: ['src'] },
  css: { split: true },
})
```

Every non-empty layer goes out as its own asset with its own hash, and the
`<link>` tags are injected into the HTML in layer order — the order of the links
is the order of the cascade. After that, a change in the markup changes one asset
out of five; the browser takes the other four from cache. The `apps/bench-split`
stand checks exactly this: two builds and a comparison of names.

The limits of the option: it applies to an application build only, and only where
there is an HTML entry — that is where the links go, and without HTML the plugin
says so with a warning. A server build produces no HTML, and in dev there are no
hashed assets at all, so CSS still arrives as a single module. The price is the
total weight, and it is not symbolic: every file is compressed with its own
dictionary. On a design system with 222 kB of CSS that is 41.6 kB gzip in five
layers against 32.9 kB in one file — **+27% on the first visit**. In exchange a
markup change re-fetches 20.8 kB instead of 32.9, a theme change 5.9 kB. So the
option pays off where repeat visits are many and the foundation changes rarely;
if the page is read once, the price is paid for nothing.

### A host with several Vite environments

A host may build several Vite environments in one build: Astro builds
`prerender`, `ssr` and `client`, resolving the config of each one before the
first build and calling the final hooks for every one of them. Resolution and
emission do not suffer from that — they are memoized and happen once — and the
report is written once, into the output directory of the resolved config. Of the
config, not of the environment: an environment directory may be temporary (in
Astro `prerender` is `dist/.prerender/`, which the host removes after the build),
and the report would be deleted along with it.

`css.split` is not applicable on such a host: the `<link>` tags are injected
through `transformIndexHtml`, and such a host builds HTML itself, bypassing that
hook. Leave the option at its default `false` — CSS then arrives as a single
`virtual:granum.css` module, which the host picks up as an ordinary CSS import.

## JS channel

```ts
import { XhPanel } from 'virtual:granum/components'
```

The virtual module re-exports the selected components from their subpaths and
has no side effects: tree-shaking removes what is unused. Plain imports of
`@acme/ui/components/XhPanel` work too; the plugin neither rewrites provider
code nor changes the chunk layout.

The channels differ, and that matters: JS follows the imports, CSS follows the
selection. A component that is in the selection but not imported does not make
it into the bundle, while its CSS does. To drop both, narrow the selection
rather than the imports.

Types. The package ships ambient declarations for the virtual modules —
reference them once in any `.d.ts` of the project:

```ts
/// <reference types="@feugene/granum/client" />
```

Component names are not there and cannot be: they depend on the application's
selection rather than on the package, so an import from that module is typed as
`any`. Precise declarations are generated by the plugin — like `components.d.ts`
for auto-import:

```ts
// granum.config.ts
js: { dts: 'src/granum.d.ts' }
```

The file is rewritten only when the selection changes, and its place is in git:

```ts
declare module 'virtual:granum/components' {
  export { XhPanel } from '@acme/ui/components/XhPanel'
}
```

## Auto-import

For `unplugin-vue-components` and compatible tools there is a resolver: given
a component name it returns the provider subpath; an unknown or ambiguous
name (two providers with the same `Name`) is not resolved.

```ts
import { granum, granumResolver } from '@feugene/granum/vite'
import Components from 'unplugin-vue-components/vite'

export default defineConfig({
  plugins: [vue(), granum(config), Components({ resolvers: [granumResolver(config, { prefix: 'Xh' })] })],
})
```

In `components: 'imports'` mode the selection is extended not by the
resolver but by a scan of PascalCase tags in `appSources`: `<XhPanel>`
without an import joins the selection when exactly one provider of the graph
declares the name. That keeps the selection independent of the bundler's
transform order.

## Themes at runtime

```ts
import { createThemeController } from '@feugene/granum/runtime'
import manifest from 'virtual:granum/themes'

export const themes = createThemeController(manifest)
themes.set('dark')
```

The theme manifest — names, selectors and activation mode (`data-theme`, a
class, `:root`) — is derived from the same resolution. Details in
[Themes and tokens](./themes-and-tokens.md).

## Dev mode

Editing an application source regenerates the `utilities` layer; a change of
a provider manifest (monorepo, `vite build --watch` in the provider)
invalidates the whole resolution. Resolution errors show up in the Vite
overlay.

## Build report

`dist/granum-report.json` — the selection, themes and their source, classes
without a rule with their sources, safelist entries covered by static
classes, the prune plan, undefined tokens, layer sizes raw/gzip/brotli from
the built asset after minification (`sizesSource: 'bundle'`) and from the
emission (`emissionSizes`). Read it with `granum report`.

Build time is not in the report and never will be: the report must stay
byte-identical between builds, and time never is. It is printed as a line in
the build log instead:

```
[granum] time 997 ms (prepare 646 [manifests 547, scan 92, resolve 7], emit 335, report 16)
```

`prepare` is the preparation split into three parts: `manifests` — reading the
manifests and re-extracting classes, `scan` — extracting classes from the
application's sources, `resolve` — the resolution itself. Then `emit` — the
utility generator and layer assembly, `report` — layer sizes and writing the
file. Everything else in the build — vue, the bundler, minification — is not
granum.

A large `manifests` almost always means re-extraction: the package's vocabulary
fingerprint drifted from the application's engine — for instance because the
application passed its own rules to the engine — and classes are read from the
package's files (`granum doctor` names the reason). On a design system with
eight providers that is half a second per build; if the price matters, move the
application's rules into a provider package of their own.
