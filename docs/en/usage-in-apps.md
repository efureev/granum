# Usage in applications

> 🇷🇺 Русская версия: [`../ru/usage-in-apps.md`](../ru/usage-in-apps.md).

The application states **which** components and themes it needs in
`granum.config.ts`; the `granum()` plugin builds one resolution from the
provider manifests and feeds three channels with it: CSS, JS and themes.

## Config

```ts
import { defineGranumConfig } from '@feugene/granum/vite'

export default defineGranumConfig({
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
| `providers` | — | package names (the manifest is found via `exports["./granum.manifest.json"]`) or contract objects |
| `components` | `'all'` | a list of `id:Name` keys / `{ provider, names }` or `'imports'` — from imports in `appSources` |
| `themes.names` | by `define` → providers' `defaultThemes` → `['light']` | the active set of themes |
| `themes.define` | — | application themes: `{ extends, tokens, tokensRef, label, colorScheme }` |
| `themes.tokenOverrides` | — | values on top of every provider layer |
| `themes.strictTokens` | `false` | an override of a token no layer declares is dropped |
| `appSources` | — | directories to extract application classes and token consumption from |
| `css.layers` | `true` | `@layer` wrappers; `false` — flat concatenation in the same order |
| `js.guard` | `'error'` | importing a component outside the selection: error, warning or nothing |
| `pruneTokens.mode` | `'off'` | `'report'` — plan in the report, `'on'` — prune the `tokens` and `themes` layers |
| `report.file` | `'granum-report.json'` | build report in `outDir`; `false` — do not write |

The config shape is validated on load: `InvalidConfigError` names the path
to the field.

## Selection

The list of components is closed transitively over the `dependencies` of
the manifests: dependencies come before dependants (post-order DFS), and
that order is normative for CSS and tokens. `components: 'imports'` computes
the initial list from imports like `@acme/ui/components/XhPanel` in
`appSources`.

The guard in `resolveId` catches an import of a component outside the
selection:

```
[granum] ComponentOutsideSelectionError: '@acme/ui:XhTable' is imported by
src/App.vue but is not part of the selection [@acme/ui:XhPanel, …]
```

## CSS channel

```ts
import 'virtual:granum.css'
```

The module holds the order statement and five layers:

```css
@layer granum.tokens, granum.base, granum.themes, granum.components, granum.utilities;
@layer granum.tokens { … }      /* providers' theme.tokensCss, structural :root tokens */
@layer granum.base { … }        /* theme.baseCss */
@layer granum.themes { … }      /* token blocks of active themes, theme files */
@layer granum.components { … }  /* cssFiles and styles.css of selected components */
@layer granum.utilities { … }   /* engine output: preflight and utilities */
```

The engine input is the union of the static classes of selected components
(from the manifests), their safelist and the classes extracted from
`appSources`. One layer alone: `virtual:granum/layers/utilities.css`; the
concatenation of layers equals the whole. Unlayered application CSS beats
everything inside the layers — by design: a utility in an application
template wins over a component's base style.

## JS channel

```ts
import { XhPanel } from 'virtual:granum/components'
```

The virtual module re-exports the selected components from their subpaths and
has no side effects: tree-shaking removes what is unused. Plain imports of
`@acme/ui/components/XhPanel` work too; the plugin neither rewrites provider
code nor changes the chunk layout.

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
