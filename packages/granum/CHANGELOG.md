# Changelog

## 0.1.0 — 2026-09-25

First release of the successor of `@feugene/unocss-preset-granular`. The
package has no dependencies (peer `vite ^8`), runs on Node ≥ 22, and ships
`docs/SPEC.md` and `MIGRATION.md`.

- Acceptance (stage 7): benchmark stands `apps/bench-{zero,one,pruned}` with a
  size budget (`scripts/report-css-budget.mjs`), CSS rule-set comparison of
  `bench-one` with the v1 preset snapshot (`compare-css.mjs`, 58 = 58 rules),
  byte comparison of the JS bundle with a build without the plugin
  (`compare-js.mjs`), determinism of the application CSS and report, user
  guides in `docs/ru` and `docs/en`, invariant registry with verification
  references and a test that every `INV-*` has one.
- Slow path for object-form providers (R-6): when `baseUrl` points at an existing `dist`,
  the application scans component files and reachable shared chunks with the engine
  extractor, collects consumed tokens and theme declarations, and feeds the resolver a
  synthetic manifest (`provider-scanned` warning; no bundle graph, so component edges
  are not verified). Instance donors of such providers are scanned too.
- Codegen: the provider registry target renders array entries (`xCardConfig,`) for
  `components: [ … ]` of the granum contract; the default `exports` entry points
  `import` at the flat `dist/components/<Name>/index.js` layout for grouped sources
  too; `--exports=import` / `entryStyle: 'import'` writes string subpaths without
  `types`. Fixture providers use marked blocks and `granum codegen --check` runs in
  `verify:fixtures`.
- Layer sizes in `granum-report.json` are now measured on the built CSS asset after
  minification, by `@layer` blocks (`sizesSource: 'bundle'`); the pre-minification
  emission sizes stay next to them as `emissionSizes`.
- `granumResolver(config, options)` from `./vite` for auto-import tools
  (`unplugin-vue-components` shape); in `components: 'imports'` mode PascalCase tags
  found in `appSources` join the selection when exactly one provider declares the name.
- In-process caches: manifests by file stat, engine output per class set — editing
  application sources in dev neither re-reads manifests nor regenerates the same
  utilities.
- Demo apps `app-2` (safelist of runtime-assembled classes plus `tokenOverrides`) and
  `app-4` (classes of nested SFC parts from the manifest plus the extra engine rules
  under `engine.variablePrefix`) ported from the v1 preset; all six v1 apps now run
  on granum.
- `granum codegen [<package-dir>] [--check] [--targets=barrel,exports,manifest,registry]`
  regenerates the standard provider registries from the command line; `--check`
  exits with `1` when they are stale.
- Diagnostics and CLI (stage 6): `granum doctor | explain | why-css | tokens | prune |
  report` work from manifests and `granum.config.*` without building the application
  (`report` reads `dist/granum-report.json`). `doctor` checks referenced files, `@apply`
  left in provider CSS, `!important`, the browser/node boundary of provider chunks,
  manifest warnings of selected components, dead safelist entries, undefined tokens,
  token conflicts and theme warnings; exit codes `0/1/2`, `--json`, `--strict`,
  `--deep`. `granum*` functions and `format*Report` formatters are exported from
  `./node`; the config loader (`loadGranumConfigFile`) too.
- Application plugin (stage 5): `granum(config)` Vite plugin orchestrates the pipeline
  from one resolution — `virtual:granum.css` with cascade layers `tokens, base, themes,
  components, utilities` (and per-layer slices), `virtual:granum/components` re-exporting
  the selection, `virtual:granum/themes` for the runtime, an import guard for components
  outside the selection, `components: 'imports'`, token pruning with app sources, and a
  build report (`granum-report.json`). `./runtime` ported (`createThemeController`).
  Demo apps `apps/app-{1,3,5,6}` with expectation-based verification.
- Provider build (stage 4): `granumProvider()` Vite plugin builds the entries from the
  component registry, routes chunks and CSS into the contract layout, analyses the
  bundle graph (component files, edges, undeclared dependencies), extracts classes
  and consumed tokens, copies declared CSS and theme files, expands `@apply`,
  materialises token refs, checks the browser/node boundary and `package.json#exports`,
  and writes `granum.manifest.json`. `./codegen` ported with a `manifestExport` target.
  `./node` gains CSS reading, token-set parsing, declaration scanning and token
  consumption scanning. Fixture providers rebuilt on the contract with manifest
  verification and a determinism check.
- Manifest (stage 3): `serializeManifest` / `writeManifestSync` produce the canonical
  `granum.manifest.json` with a content hash; `parseManifest` / `readManifestSync`
  validate format version, schema, package-relative paths, hash, entry layout and token
  keys in the documented order; `locateManifest` resolves a provider's manifest through
  its package `exports` without executing package code.
- Utility engine (stage 2): `createEngine()` on a vendored UnoCSS 66.7.5 core
  (`@unocss/core`, `preset-mini`, `rule-utils` without `magic-string`,
  `extractor-arbitrary-variants`) plus the rules of `@feugene/unocss-mini-extra-rules`
  ported onto it. `generate()` returns CSS, a `matched` map (rule, selector, source,
  layer) and `unmatched`; `extract()` ignores SFC, block and line comments. Output is
  byte-equal to `unocss` + `presetMini` + extra rules on the golden class set.
  `scripts/vendor-unocss.mjs` regenerates `src/engine/vendor/`; `THIRD_PARTY_NOTICES.md`
  ships with the package.
- Contract v1 and resolver (stage 1): `defineGranumProvider` validates at registration
  (id, contract version, component names as path segments, token keys without `--`,
  `cssFiles` inside the component directory); `defineGranumComponent` normalises
  `cssFiles` to `components/<Name>/<file>` and keeps `sourceUrl`. `resolveGranum`
  accepts provider objects and loaded manifests, memoises by input identity and
  returns one `GranumResolution` for all channels; token values come from a single
  `collectTokenLayers` / `resolveTokenValue`. All errors extend `GranumError` with a `code`.
- Repository skeleton: entry points, CLI shell, boundary checks (stage 0).
