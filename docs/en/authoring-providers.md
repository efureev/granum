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
  theme/{tokens,base,light,dark}.css
  granum-provider/index.ts         defineGranumProvider
  index.ts                         barrel
dist/
  components/<Name>/index.js       entry in the layout
  components/<Name>/chunks/*.js    SFC chunks of the component
  components/<Name>/styles.css     component CSS
  groups/<g>/shared/*.js           shared chunks of a group
  chunks/*.js                      shared chunks outside groups
  theme/*.css                      foundation (copy of src/theme)
  granum.manifest.json
```

Theme files are declared as paths relative to `dist` (`theme/base.css`) while
the sources live mirrored in `src/theme/`: the plugin copies them itself.

## Component descriptor

```ts
import { defineGranumComponent } from '@feugene/granum/contract'

export const xhButtonConfig = defineGranumComponent(import.meta.url, {
  name: 'XhButton',
  dependencies: ['XhIcon', '@acme/base:XBox'],
  safelist: ['p-2', 'p-3', 'bg-[var(--xh-btn-bg)]'],
  dynamicTokens: ['xh-z-*'],
  cssFiles: ['./styles.css'],
  tokenDefinitions: { light: { tokens: { 'xh-btn-bg': '#fff' } } },
  group: 'controls',
})
```

| Field | Purpose |
|---|---|
| `dependencies` | components whose code this component imports; the short form means the same provider, `id:Name` another one |
| `safelist` | only classes assembled in JS at runtime; template literals are not listed here — the build extracts them |
| `dynamicTokens` | tokens whose name is assembled at runtime; pruning keeps them while the component is in the build |
| `cssFiles` | CSS read as is; path relative to `config.ts`, inside the component directory |
| `tokenDefinitions` | structural tokens of the component per theme; keys without `--` |
| `group` | shared chunks of several components go to `groups/<g>/shared/` |

The first argument is the `import.meta.url` of the `config.ts` module: the
build uses it to find the component directory and the `cssFiles` sources.

## Provider

```ts
import { defineGranumProvider } from '@feugene/granum/contract'

export default defineGranumProvider({
  id: '@acme/ui',
  contractVersion: 1,
  components: [xhCardConfig, xhButtonConfig],
  theme: {
    tokensCss: 'theme/tokens.css',
    baseCss: 'theme/base.css',
    themes: { light: 'theme/light.css', dark: 'theme/dark.css' },
    defaultThemes: ['light'],
    tokenDefinitions: { light: { tokens: { 'xh-accent': '#0a7' } } },
  },
  engine: { dialect: 'unocss/preset-mini+granum@66', rules: [['btn-reset', { appearance: 'none' }]] },
  dependencies: ['@acme/base'],
})
```

`defineGranumProvider` validates the shape when called: `contractVersion`,
the id, component names, token keys, `cssFiles` paths. Errors are typed
classes with `providerId`, `component` and `reason` fields.

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

## Build

```ts
import { granumProvider } from '@feugene/granum/build'
import { miniEngine } from '@feugene/granum-engine-mini'

granumProvider({
  provider,
  engine: miniEngine(),
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
   literals in JS, `dynamicTokens`;
4. expands `@apply` in component CSS; no directives remain in `dist`;
5. computes the actual component → component graph from bundle imports and
   compares it with `dependencies`: an undeclared edge is an
   `UndeclaredDependencyError`;
6. checks that browser code imports neither `node:*` nor granum node entries
   (`BoundaryViolationError`) and that `package.json#exports` lists the
   manifest and the subpath of every component (`PackageExportsError`);
7. writes `dist/granum.manifest.json`.

Importing a constant or a type from another component's directory is not a
dependency and need not be declared: edges are computed from code that landed
in another component's chunks.

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
  warnings, or they are explained;
- `granum.manifest.json` is in `exports`; `sideEffects: false`;
- a package with rules declares `engine.dialect`, is built by an engine of that
  dialect, and `engineModule` points at the built rule module;
- component `dependencies` cover the imports — otherwise the build fails;
- a cross-provider donor is listed in `peerDependencies`;
- `doctor --strict` of a consuming application exits with `0`.
