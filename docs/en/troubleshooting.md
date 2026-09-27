# Troubleshooting

> 🇷🇺 Русская версия: [`../ru/troubleshooting.md`](../ru/troubleshooting.md).

The first step is always the same: `granum doctor granum.config.ts`. Below
are the symptoms it will not show by itself and what to do about them.

## The component built but rendered "naked"

The component's classes did not reach the CSS. Check the chain:

1. `granum explain granum.config.ts @acme/ui:XhCard` — is the component in
   the selection? `not-selected` means nobody selected it and nothing pulls it
   in through `dependencies`.
2. `granum why-css granum.config.ts p-4` — `Rule: none` means the engine has
   no rule: a typo or a hook class.
3. Is the class assembled in JS at runtime (`` `p-${n}` ``)? Then it must be
   in the descriptor's `safelist` — the provider build does not collect
   literals.

## A package class produced no CSS: the application engine speaks another dialect

granum neither runs the rules of a foreign vocabulary nor invents them.
`granum doctor` then reports `provider-dialect-mismatch` (plus
`engine-rules-skipped` if the package ships a rule module), and
`granum why-css granum.config.ts <class>` prints a `Vocabularies` section: which
engine built the package and for which vocabulary, and which dialect the
application runs. There are two ways out — run an engine of the package dialect,
or add the rule to your own factory (`windEngine({ rules: […] })`). Two
vocabularies cannot be mixed in one build. The classes themselves never vanish
silently: they are named in `provider-classes-dropped` and in `unmatched`.

## Why granum re-extracts package classes

The class list in a manifest was filtered by the engine of the package build,
and `vocabulary` in the `engine` block is the fingerprint of that very
implementation. Any rule of your own in the factory changes the application
fingerprint, so the list can no longer be trusted: the engine knows names the
package build did not, and would have found more classes in the same files.
Hence the re-extraction. It is the norm, not an error: a warning appears only on
a set difference (`provider-classes-recovered`, `provider-classes-dropped`).
The whole model is in [engines and dialects](./engines-and-dialects.md).

## `UndeclaredDependencyError` in the provider build

Component code imports a file from another component's directory and
`dependencies` does not declare it. Declare the dependency, or move the
shared code outside `components/<Name>/` (a helper outside component
directories is not an edge). Downgrade to a warning with
`granumProvider({ dependencyCheck: 'warn' })`.

## `ComponentOutsideSelectionError` in the application

The application imports a component that is not in the selection. Add it to
`components`, switch to `components: 'imports'` or relax the guard:
`js: { guard: 'warn' }`.

## `ManifestNotFoundError`

The provider package does not export `./granum.manifest.json`, or it was not
built. In the provider: `codegenTargets.manifestExport()` and `vite build`.
In a monorepo, check that the application sees the package `dist` (workspace
symlink) and that the provider build ran before the application build.

## `InvalidManifestError (hash-mismatch)`

The manifest was edited by hand or is corrupted. Rebuild the provider: the
manifest is produced only by the build.

## The theme is not applied

- `granum doctor` → the `Themes` section: is the name in the active set? The
  set is determined by `themes.names` → `themes.define` → `defaultThemes` →
  `['light']`.
- A provider theme file with an unusual selector: the runtime cannot derive
  the activation — set
  `granum(config, { themeManifest: { activations: { dark: { kind: 'class', value: 'dark' } } } })`.
- `theme-extends-unresolved`: `extends` points at a file theme — it is
  opaque; only structural values can be inherited.

## A token override does not work

`granum tokens granum.config.ts @acme/ui:XhCard --deep` shows the chain of
layers. Common causes: `strictTokens: true` and the token is declared by no
package layer (`override-skipped`); a name with `--` in the config
(registration error); the override targets a theme outside the active set.

## After pruning a variable resolves to nothing

`pruneTokens.mode: 'on'` removed a token the application reads itself. Make
sure `appSources.dirs` cover every source that consumes tokens; for names
assembled at runtime add `keep` in the config or `dynamicTokens` in the
component descriptor. Debugging: `granum prune granum.config.ts` prints what
is removed and why.

## `@apply` in the output

`apply-not-expanded` in `doctor`: the provider was built without
`granumProvider()`. For object-form providers `css: { expandDirectives: true }`
can be enabled in the application, but the right path is to rebuild the
provider.

## `node:fs` in the client bundle

`BoundaryViolationError`: provider browser code (often a component's
`config.ts`) imports `@feugene/granum/build`, `/vite`, `/node` or
`/codegen`. Browser code may only use `.`, `./contract`, `./engine`,
`./runtime`.

## The cascade order is wrong

Inside `@layer` the `!important` inversion applies: a declaration with
`!important` in the `components` layer beats unlayered application CSS.
`doctor` shows such places as `important-in-provider-css`. For applications
with unlayered legacy CSS there is `css: { layers: false }` — the same order
without wrappers.

## HMR did not pick up a class

Utilities are recomputed on changes of files from `appSources`. If a file
lies outside the listed directories, the class reaches neither dev nor the
build — extend `appSources.dirs`.
