# Migration from `@feugene/unocss-preset-granular`

granum is the successor of the v1 preset: the same provider contract in
spirit, a different orchestrator — a provider manifest and its own Vite plugin
instead of `uno.config.ts` and a glob over `node_modules`. The v1 preset keeps
working; migrate one package at a time.

Step-by-step guides, mirrored in two languages:

- English: [`docs/en/migration.md`](../../docs/en/migration.md)
- Русский: [`docs/ru/migration.md`](../../docs/ru/migration.md)

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
