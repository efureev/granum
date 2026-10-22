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

## A class in the application markup produces no CSS

A typo or a class with no engine rule in a class attribute of the application
markup lands in the report's `unmatched` together with the file it sits in. The
build line says `N without a rule`, `granum report` shows `✗ <class> ← src/App.vue`,
and `granum report --strict` and `granum audit --strict` fail. Judged are classes
from `class` and `className` (in JSX also a string in curly braces) and string
literals in `:class` that neither the engine nor the build's CSS has (utilities,
package CSS, the application's own CSS, SFC styles), nor a `.css` file in
`appSources` — including one imported as a string (`?raw`, `?inline`), which
never becomes an asset. A CSS module (`*.module.css`) does not count: its classes
are hashed and a literal in the markup does not match them. A class from a sheet
in `appSources` that nothing imports is not a finding either. A class assembled on the fly
(`clsx`, a template string with an interpolation) and the other words of the
sources are not judged — use `granum why-css <class>` for them. `doctor` does not
see the build's CSS and does not judge such classes.

In JS/TS and in `<script>` blocks of markup the attribute is looked for only in
strings and template strings: HTML in a string is judged, a regex `/class="…/`
and the code around it are not. In `.jsx` and `.tsx` the markup is the code
itself and the file text is searched, so such a regex gives a false finding
there: write it as `/class=["]…/` or keep the test outside `appSources.dirs`.

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

## The mode is not applied

- `granum doctor` → the `Theme` section and the build theme lines: is the right theme the
  default one, is the needed theme in the build and the mode in its set? The themes are the
  config's `themes`, without it the catalog owner's `defaultTheme`; the modes are the theme
  entry's `modes`, without them the theme's default mode and its `define`: a dark mode does not
  reach the build without `modes: ['light', 'dark']` — for the default theme or an additional one.
- A pair of an additional theme without its sheet gives the default theme's values: the sheet
  is loaded by the controller's `setTheme` (`loadThemeSheet`), the early script or a page
  importing `virtual:granum/themes/<id>.css`. The shared sheet has no blocks of additional themes.
- The root carries the pair `data-theme="<theme>-<mode>"`, not the mode name: `dark` without
  the theme matches no block. `virtual:granum/themes` lists the pairs;
  the controller and `createThemeScript` write them themselves.
- granum emits no `.light`/`.dark` classes: CSS relying on them moves
  to the attribute, and `dark:` utilities are built from the pairs of dark modes.
- `mode-extends-unresolved`: the base of a theme entry's `modes.define` is neither a mode of
  that theme nor another of its `define`; the mode inherits the default mode.
  `mode-extends-cycle` — `define` entries refer to each other in a circle.

## Theme and mode errors

| Error | Cause and what to do |
|---|---|
| `InvalidConfigError (themes)` | `themes` lists several themes and none is marked `default: true` (or two are), or the list is empty. Mark the one that goes under `:root`; a build without themes is a graph without a catalog owner and no `themes` |
| `InvalidConfigError (theme, previews, modes, css.previews)` | keys of earlier config forms: the build themes are listed in `themes`, modes in the theme entry's `modes`, the attribute and the system scheme in `activation`; an additional theme always has its own sheet |
| `ThemeResolutionError (unknown-theme)` | a `themes` entry names a theme absent from the catalog; the error lists the available ones. Without `themes` and without a `defaultTheme` in a catalog of several themes — the same error; so is a theme object's `extends` absent from the catalog |
| `ThemeResolutionError (duplicate-theme)` | one theme listed twice in `themes` (a theme object with a catalog theme's id included): the entries would have the same pairs |
| `ThemeResolutionError (unknown-mode)` | a name in an entry's `modes` or a `modes.tokenOverrides` key is neither a mode of that theme nor its `define` |
| `ThemeResolutionError (multiple-theme-owners)` | two providers of the graph declare a theme catalog; hand the extra themes to the application as objects in `themes` |
| `ThemeResolutionError (theme-owner-missing)` | a package has component tokens per theme, and its theme-owner dependency does not resolve from the package directory; install it or add it to `providers` |
| `ThemeResolutionError (theme-missing)` | `activation` is set, but the build has no themes: no provider of the graph declares a catalog and `themes` has no theme object. There is nothing to activate; add the theme owner or drop the option |
| `ThemeResolutionError (activation-collision)` | two pairs coincide: a `define` named like a mode of its theme, an `activation.value` template without `{mode}`, or without `{theme}` in a build of several themes with same-named modes |
| `ThemeDataError` | the data JSON of a build theme cannot be read or fails the schema; the field path is in the message. Rebuild the provider. For a theme object with `extends` — a violation after the merge with its parent, the cause is in `reason`: `theme-token-collision` (a value has one place — a section or `root`/`modes`), `invalid-theme-component-mode`, `theme-components-untargeted` (the section package is not named in `targets`) |
| `ThemeSourceError` | a theme source cannot be read; the path is in the message, the cause in `reason`: `theme-json-missing` (no folder or no `theme.json`), `theme-json-invalid` (not JSON, an unknown key, a mode with `tokens` — mode tokens live in `modes/<mode>.json`), `token-file-invalid` (not a JSON object of strings, a key with `--`, CSS not as one flat block), `duplicate-value-file` (`.json` and `.css` of one name), `unknown-mode-file` (a file of a mode `theme.json` does not declare — declare it, with an empty entry if need be), `empty-component-dir`, `unexpected-entry` (a stray file or folder — name it in `ignore`), `theme-data-invalid` (the data fail the check; the violation is in `dataReason`) |
| `InvalidProviderError (theme-source-unbuilt)` | a `{ source }` catalog theme of an unbuilt provider is picked: only the provider build resolves a source — build it. Such an entry that is not picked is no error |
| `ThemeResolutionError (theme-extends-cycle)` | theme objects extend each other in a cycle; the chain is in the message |
| `InvalidProviderError (theme-id-mismatch)` | the id in the source's `theme.json` differs from the catalog key |
| `InvalidProviderError (theme-incomplete)` | at provider build: a theme does not set registry tokens; the list looks like `dark:xh-bg`, `root:xh-radius` |
| `InvalidProviderError (invalid-theme-dir)` | a `themesDir` folder is not named by a theme id, a file is not named by a mode, an extra file, or both `.json` and `.css` for one mode |
| `InvalidProviderError (legacy-token-definitions)` | contract 1 theme keys are left in the provider: `theme.themes`, `defaultThemes`, `tokenDefinitions`, `tokenDefinitionsRef` |
| `UnsupportedManifestVersionError` | a format 2 manifest with themes: granum 3 does not read theme files — rebuild the provider with granum 3 |

`token-conflict` in `doctor` means two package layers on one token: a component over
the theme data or two components. The application's values (`define`, overrides,
the theme object) override the package on purpose and are not conflicts.
`component-theme-unknown` means a component ships tokens for a theme that no
catalog of the graph declares: for a companion supporting several design systems this is
normal, for a typo in a folder name it is a reason to fix it.

`theme-incomplete` in `doctor` means a build theme has no value for a required token in
at least one of its modes; the items list `light:th-ring`, `root:th-font`, and the message
gives the share. Most often it is an application theme object that lacks a registry token,
or an additional theme without `extends` that has no component tokens. An element with
such a theme's pair takes the token from another theme — the main theme's default mode,
whose block sits under `:where(:root)`, or an ancestor — or gets none: the main theme's
`root` literals sit only under its own pairs. A component token is needed in every mode,
even if the component reads it under one mode's selector: another mode's pair without a
value does not get it. Add the value to the theme data, point `extends` at a catalog theme
with the component tokens, or set the token in `modes.tokenOverrides` of its entry.

`theme-target-mismatch` — the theme is written for other versions of a package than the
build has: its `targets` range misses the version of the package manifest. The build
prints it too. Check what changed in the package: `theme-incomplete` names the values the
theme lacks. `theme-component-unknown` — the theme sets values for a component the package
declares neither as a component nor as a group: a removed component or a typo. `theme-token-foreign` — the theme sets a
token the component does not require from outside: a hook (a theme does not set hooks —
leave it to the application), a token the component assigns itself, a global token in a
component section (its place is `root`/`modes`) or a typo.

## A token override does not work

`granum tokens granum.config.ts @acme/ui:XhCard --deep` shows the chain of
layers for every mode. Common causes: `strictTokens: true` and the token is present neither
in the theme data nor in component tokens (`override-skipped`); a name with `--` in the config
(a shape error); a mode-independent token overridden in a mode instead of
the theme entry's `modes.tokenOverrides.root`, or the other way round; the override is written on another build theme.

## After pruning a variable resolves to nothing

`pruneTokens.mode: 'on'` removed a token the application reads itself. Make
sure `appSources.dirs` cover every source that consumes tokens; for names
assembled at runtime add `keep` in the config or `dynamicTokens` in the
component descriptor. Debugging: `granum prune granum.config.ts` prints what
is removed and why.

## `@apply` in the output

`apply-not-expanded` in `doctor`: the provider was built without
`granumProvider()`. `@apply` is expanded only when the provider is built
(ADR-3); the application does not expand directives: otherwise the
provider's classes would be expanded by the application's engine, possibly
with a different vocabulary. Rebuild the provider with `granumProvider()`; an
object-form provider too — then the application takes its manifest.

## `ApplyExpansionError` when building a provider

`@apply` substitutes the declarations of a flat rule; there is nowhere to put
a variant's condition or the second half of a class. The `reason` tells what
to do:

- `non-flat-rule` — a variant (`md:flex`, `hover:underline`) or a class made
  of several rules (`container`): put the class into the component markup or
  write the `@media`/`:hover` in CSS by hand;
- `unmatched-class` — the engine has no such rule: a typo or a class from
  another vocabulary;
- `nested-context` — the directive is inside `@media` or a nested rule: move
  it to a top-level rule.

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
