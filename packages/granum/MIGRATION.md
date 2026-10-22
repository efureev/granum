# Migration from `@feugene/unocss-preset-granular`

granum is the successor of the v1 preset: the same provider contract in
spirit, a different orchestrator — a provider manifest and its own Vite plugin
instead of `uno.config.ts` and a glob over `node_modules`. The v1 preset keeps
working; migrate one package at a time.

Step-by-step guides, mirrored in two languages:

- English: [`docs/en/migration.md`](../../docs/en/migration.md)
- Русский: [`docs/ru/migration.md`](../../docs/ru/migration.md)

## From 3.11 to 3.12

**Token pruning is on by default** (ADR-14 in `docs/decisions.md`). Without `pruneTokens` the
build now removes from the `tokens` and `themes` layers every declaration that nothing reaches:
the CSS of the selected components, the engine output, `consumes` and `dynamicTokens` of the
manifests, the application sources (`appSources`), the application's values and `keep`. A theme
that carries the values of every component of a package gives the application only what its
components read.

- A token the application reads past the build — a name assembled at runtime, a token from a CMS
  or from a file outside `appSources` — goes to `keep` (`pruneTokens: { keep: ['brand-*'] }`).
  `granum prune granum.config.ts` prints what is removed and why.
- The previous emission is one line away: `pruneTokens: { mode: 'off' }`.
- The report and `granum prune` now print `mode: 'on'` for a config without `pruneTokens`.

## From 3.9 to 3.10

3.10 lets a theme own the values of components: token names are the contract of the
component package, values belong to the theme (ADR-13 in `docs/decisions.md`). All of it
is additive — the provider contract (2) and the manifest format (3) stay, a provider built
with 3.10 is read by 3.9 with the same CSS — but three things behave differently:

- **A theme object with `extends` is merged with its parent.** Before, `extends` only gave
  component tokens and the object had to be complete; now the object may carry only its
  differences, and the parent's data fills the rest. An object whose parent had tokens the
  object lacked now gets them. The parent's data is read even if the parent is not a build
  theme.
- **A theme does not set hooks.** A hook (`hookTokens`) is an application knob: a theme
  value for it is the `doctor` finding `theme-token-foreign`. Make such a token a theme
  token of the component (read it without a fallback, let every theme give a value) or
  set it in the application's `tokenOverrides`.
- **The config checks a theme object with `extends` by shape only**; completeness is
  checked after the merge — a violation there is `ThemeDataError` with `reason`. The
  object's own `id` and `title` are required.
- **What a theme object inherits comes as the parent's theme data**: before component
  tokens, as for the parent itself. Only the object's own differences come after component
  tokens. Where the parent's data and a component's `themesDir` value disagree, an heir
  now shows what the parent shows.
- **A theme's `@supports` fallback for a token whose value in the pair comes from a
  component is no longer emitted**: it overrode the component value in browsers without the
  feature.

The type `GranumAppTheme` is a union of complete data and differences with `extends`:
code that reads the data fields of such a value narrows it by `extends` first.

New, optional: `version`, `targets` and `components` in theme data; a theme source folder
and `loadThemeSource`; `{ source }` catalog entries; `granum theme copy`; the findings
`theme-target-mismatch`, `theme-component-unknown`, `theme-token-foreign`.

## From 3.7 to 3.8

3.8 builds several themes at once. One **default** theme goes into the shared sheet
and under `:root`, as the single theme did before; every other build theme is
**additional** and gets a sheet of its own, loaded by the runtime when the
application switches to it. The config, the virtual modules, the theme manifest
and the runtime change shape — inside 3.x, by the owner's decision: the consumers
of granum 3 are the owner's own packages and applications, all moved at once. The provider
contract and the provider manifest do not change, so packages need no rebuild. The
reasoning is ADR-12 in `docs/decisions.md`.

Application:

| 3.7 | 3.8 |
|---|---|
| `theme: 'slate'` | `themes: ['slate']` |
| `previews: ['clay']` | another `themes` entry: `themes: [{ theme: 'slate', default: true }, 'clay']` |
| `modes: { names, define, tokenOverrides, strictTokens }` | `modes` of the theme's entry: `{ theme: 'slate', modes: { names, define, tokenOverrides, strictTokens } }`, or `modes: ['light', 'dark']` for names only |
| `modes.activation`, `modes.system` | `activation: { attribute, value, system }` — shared by all themes |
| `css.previews: 'separate'` | removed: an additional theme always has its own sheet |
| `import 'virtual:granum/previews.css'` | `import 'virtual:granum/themes.css'` |
| `import 'virtual:granum/previews/clay.css'` | `import 'virtual:granum/themes/clay.css'` |

- With several entries exactly one is marked `default: true`; no mark, two marks or
  an empty list are `InvalidConfigError('themes')`. One theme listed twice is
  `ThemeResolutionError('duplicate-theme')`.
- A theme without `modes` builds its default mode only — the default theme and an
  additional one alike. A preview used to bring all of its modes: list them.
- The old keys are `InvalidConfigError` with a hint to the new place, so a forgotten
  one fails the build instead of being ignored.

Theme manifest (`virtual:granum/themes`, `resolveThemeManifest`, `createThemeManifest`):

| 3.7 | 3.8 |
|---|---|
| `manifest.theme` | `manifest.defaultTheme` (id) and `findTheme(manifest)` / `defaultTheme(manifest)` (the entry) |
| `manifest.modes`, `manifest.defaultMode`, `manifest.extensions` | `manifest.themes[i].modes`, `.defaultMode`, `.extensions` |
| `manifest.previews[i].theme`, `.modes`, `.extensions` | `manifest.themes[i]` — same shape for every build theme |
| — | `manifest.themes[i].href` — the sheet address of an additional theme (none at config time) |
| `createThemeManifest({ theme, modes, defaultMode })` | `createThemeManifest({ themes: [{ id, title, modes, defaultMode, href? }], defaultTheme? })` |

Runtime:

| 3.7 | 3.8 |
|---|---|
| `controller.theme` — `{ id, title }` of the build | `controller.theme` — the current theme's manifest entry; `controller.themes()` lists them |
| — | `await controller.setTheme(id, { mode?, persist? })` — loads the sheet, then sets the pair; `controller.ready` |
| `subscribe(listener(mode))` | `subscribe(listener({ theme, mode }))` |
| `modeFromCookie(manifest, header)` → mode entry | `themeFromCookie(manifest, header)` → `{ theme, mode }` |
| `themeRootAttributes(manifest, mode)` | `themeRootAttributes(manifest, { theme?, mode? })` |
| `resolveThemeActivation(manifest, value)` → mode entry | → `{ theme, mode }` |
| — | `loadThemeSheet`, `themeSheetLink`, `readThemeSelection`, `themeSelectionKey` |

- The stored value stays compatible: the default theme's mode is still stored as the
  bare mode name; an additional theme is stored as `<theme>-<mode>`.
- The early script inserts `<link rel="stylesheet" blocking="render">` for an
  additional theme before setting its pair. A manifest built at config time has no
  sheet addresses, so such a script never picks an additional theme — the server
  sets that pair together with the `<link>` (`themeSheetLink`).
- An island of an additional theme needs its sheet: the page imports the module, or
  the application calls `loadThemeSheet` before showing it.

CSS:

- The default theme's `:root` goes under `:where(:root)` and its shared-formula
  boundary is the list of its pairs instead of `[data-theme]`: a pair of any theme on
  the root wins by specificity, and the cascade no longer depends on the order of the
  sheets. Own CSS that matched `:root, [data-theme]` from the granum output by text
  needs a look; values do not change.
- The engine's `dark:` variant covers the dark pairs of every build theme.
- Report fields: `themes { defaultTheme, themeSource, themes: [{ id, default, modes, modesSource }] }`
  instead of `themes { theme, themeSource, modes, modesSource, previews }`.

Provider: nothing to change.

## From 2.x to 3.0

3.0 turns a theme into data. A **theme** is a design language — the full set of
token values — and the application builds exactly one. A **mode** is a variant
inside the theme (`light`, `dark`, any other); modes switch at runtime through one
attribute on the root, `data-theme="<theme>-<mode>"` by default. The 2.x "theme
with `extends`" (`ocean` on top of `light`) is a mode now. The contract version is
`2`, the manifest format is `3`. The reasoning is ADR-11 in `docs/decisions.md`.

Provider:

- `theme.themes` (CSS files), `theme.defaultThemes`, `theme.tokenDefinitions`
  and `theme.tokenDefinitionsRef` are removed — `InvalidProviderError
  ('legacy-token-definitions')`. Declare a catalog instead:
  `theme: { registry: 'themes/registry.json', defaultTheme: 'paper', catalog: { paper: { title, data: 'themes/paper.json' }, ink: { title, extends: 'paper', data: 'themes/ink.json' } } }`.
  A theme is a `GranumThemeData` JSON: `root` (mode-independent tokens),
  `modes.<name> = { colorScheme, extends?, tokens, fallbacks? }`, `defaultMode`
  (`light` when omitted). Keep the selectors out: the application assigns them. A
  theme with `extends` in the catalog may hold only the differences — the build
  merges it with the parent and checks it against the registry
  (`theme-incomplete` names what is missing).
- Component `tokenDefinitions` and `tokenDefinitionsRef` are removed. Put the
  values into a folder and pass `themesDir: './themes'` to
  `defineGranumComponent`: `<dir>/<theme>/root.{json,css}` and
  `<dir>/<theme>/modes/<mode>.{json,css}` — JSON `{ "<token>": "<value>" }` or
  CSS with a single flat block. A component may ship tokens for another
  provider's themes: they apply when that theme is active.
- Set `contractVersion: 2` and rebuild. A provider without themes that keeps a
  format-2 manifest is still read; a format-2 manifest with themes is an
  `UnsupportedManifestVersionError`.
- A string dependency on the theme owner (`dependencies: ['@scope/tokens']`) is
  loaded by granum from the dependent package directory: applications no longer
  have to list it in `providers`.

Application:

- `themes` is replaced by `theme`, `previews` and `modes`; the old keys are
  `InvalidConfigError`s that name the new place:
  `themes.names` → `modes.names`, `themes.define` → `modes.define`,
  `themes.tokenOverrides` → `modes.tokenOverrides`,
  `themes.strictTokens` → `modes.strictTokens`.
- `modes.define.<name>` requires `extends` (a mode of the theme or another
  defined mode); `label` is `title`, `selector` and `tokensRef.as` are gone — the
  activation derives the selector. A mode name is a slug without a hyphen.
- `modes.tokenOverrides.root` goes to the mode-independent tokens,
  `modes.tokenOverrides.<mode>` to that mode; a key that is neither is a
  `ThemeResolutionError('unknown-mode')`. The selector form
  (`{ '.dark': { … } }`) is gone.
- Your own theme is an object in `theme`: complete data plus an optional
  `extends` (a catalog theme whose component tokens it builds on) and `sources`
  (files to watch in dev — editing them restarts the server).
- `.light`/`.dark` classes are no longer emitted. Activate a mode with the pair
  attribute; the `dark:` utility variant follows the dark modes of the theme.
- Runtime: `virtual:granum/themes` returns `{ theme, modes, defaultMode,
  activation, extensions }`. `createThemeController` switches modes:
  `get()`/`set()`/`list()`/`entry()` become `mode`/`setMode()`/`modes()`;
  storage keeps the mode name. A controller started on top of a pair already on
  the root keeps it. `createThemeScript`, `createCookieStorage`, `modeFromCookie`
  and `themeRootAttributes` cover the first frame and SSR.
- Report and `doctor --json`: `themes { names, namesSource }` became
  `themes { theme, themeSource, modes, modesSource, previews }`. Doctor reports
  theme warnings by their own codes (`component-theme-unknown`,
  `mode-extends-unresolved`, `mode-extends-cycle`) instead of `theme-warning` —
  update `--allow` lists. `token-conflict` covers package layers only.
- With `pruneTokens.mode: 'on'` the theme data and component tokens are pruned by
  reachability like any package layer.

## From 1.x to 2.0

2.0 breaks the application config and asks providers for a rebuild. The manifest
format and the contract version did not change: a manifest built by granum 1.x is
read by 2.0 and the other way round.

Application:

- A class in a class attribute of the application markup that neither the engine
  nor the build's CSS knows — a typo, a missing icon rule — now lands in the
  report's `unmatched` with its file, so `granum report --strict` and
  `granum audit --strict` fail on it. Fix the class or add the rule.
- A component imported from the provider package root
  (`import { GrChip } from '@feugene/granularity'`) or the root imported as a whole
  (`import * as`, `export * from`, `import()`) is a `ComponentRootImportError`
  under `js.guard`. Import components from `<package>/components/<Name>` or from
  `virtual:granum/components`; other root names (utilities, constants, types) are
  fine. The selection only sees a component by its subpath, and the root loads the
  whole package in dev and in SSR.
- An unknown key in `granum.config` is an `InvalidConfigError` with the path to
  the key and a hint — the nearest valid key for a typo, the new place for a v1
  preset key. Remove typos and leftovers such as `themes.themeFiles`,
  `pruneTokens.appSources`, `scan`. `defineGranumConfig` now takes and returns
  `GranumConfig`, so TypeScript reports an extra key in the editor.
- `js.virtualComponents` and `css.expandDirectives` are removed — delete them;
  neither did anything.
- In `themes`, a token key with `--` and a theme value that is not an object are
  errors. Within the `themes` layer every theme's files come first and its blocks
  after them, so `tokenOverrides` and `define` win over a provider theme shipped
  as a CSS file; selectors raised in specificity to work around that can go.
- Everything else is fixed behaviour; the list is in [`CHANGELOG.md`](./CHANGELOG.md).

Provider:

- Rebuild with granum 2.0. `granumProvider` embeds `@feugene/granum/contract` into
  `dist/granum/contract.js`, so a descriptor re-exported from a component entry
  no longer pulls granum at runtime, and SSR with external packages works while
  the application keeps granum in `devDependencies`. The package's `files` must
  cover the whole `dist`.
- If `dist` still imports another granum entry point at runtime (a re-export of
  `@feugene/granum/runtime`, an engine module using `@feugene/granum/engine`),
  list `@feugene/granum` in `peerDependencies`; otherwise the manifest gets
  `peer-missing`.

The engine `@feugene/granum-engine-wind` 2.0 is released alongside with a peer of
`^2.0.0`; its vocabulary fingerprint did not change, so no class recalculation.

## From 0.x to 1.0

Nothing to change. 1.0 adds no breaking changes to 0.9: it states what is now
frozen (the provider contract, the manifest format, the entry points, the shape
of `GranumConfig`, the layer names, the virtual module ids, the CLI commands
with their exit codes, the error classes) and what deliberately is not — above
all the engine's vocabulary fingerprint, which changes with every change to the
rule set. See §18 of [`docs/SPEC.md`](./docs/SPEC.md).

A provider's peer range is best kept wide (`>=1.0.0 <2.0.0`): a manifest built
by any granum 1.x is read by any other granum 1.x, and the application picks the
version.

## In short

Provider: `defineGranularComponent` → `defineGranumComponent`,
`defineGranularProvider` → `defineGranumProvider`; drop `packageBaseUrl`,
`cssFileAssetNames`, `styleAssetFileName`; rename `unocss` to `engine` and name
the vocabulary its rules are written against (`engine: { dialect, rules }`);
replace the three layout helpers and manual entries with
`granumProvider({ provider, engine })`; export `./granum.manifest.json`.

Application: delete `uno.config.ts`, `unocss` and `@unocss/*`; install
`@feugene/granum-engine-wind` and pass `engine: windEngine()` in
`granum.config.ts` — the application picks the engine, granum ships none; add
`granum(config)` to `vite.config.ts`; replace `virtual:uno.css` +
`virtual:uno:granular.css` with `virtual:granum.css`; put your own utility rules
into the engine factory (`windEngine({ rules })`), not into the granum config;
check `dist/granum-report.json` — `classes.unmatched` and `tokens.undefined`
must be empty or explained, and `providers[].lost` must be empty unless you
deliberately run an engine of another dialect.
