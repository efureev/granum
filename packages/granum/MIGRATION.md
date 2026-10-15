# Migration from `@feugene/unocss-preset-granular`

granum is the successor of the v1 preset: the same provider contract in
spirit, a different orchestrator — a provider manifest and its own Vite plugin
instead of `uno.config.ts` and a glob over `node_modules`. The v1 preset keeps
working; migrate one package at a time.

Step-by-step guides, mirrored in two languages:

- English: [`docs/en/migration.md`](../../docs/en/migration.md)
- Русский: [`docs/ru/migration.md`](../../docs/ru/migration.md)

## From 1.x to 2.0

2.0 breaks the application config and asks providers for a rebuild. The manifest
format and the contract version did not change: a manifest built by granum 1.x is
read by 2.0 and the other way round.

Application:

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
