# Migration from `@feugene/unocss-preset-granular`

granum is the successor of the v1 preset: the same provider contract in
spirit, a different orchestrator — a provider manifest and its own Vite plugin
instead of `uno.config.ts` and `node_modules` scanning. The v1 preset keeps
working; migrate one package at a time.

Step-by-step guides, mirrored in two languages:

- English: [`docs/en/migration.md`](../../docs/en/migration.md)
- Русский: [`docs/ru/migration.md`](../../docs/ru/migration.md)

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
