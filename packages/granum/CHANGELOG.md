# Changelog

## Unreleased

- Application plugin (stage 5): `granum(config)` Vite plugin orchestrates the pipeline
  from one resolution — `virtual:granum.css` with cascade layers `tokens, base, themes,
  components, utilities` (and per-layer slices), `virtual:granum/components` re-exporting
  the selection, `virtual:granum/themes` for the runtime, an import guard for components
  outside the selection, `components: 'imports'`, token pruning with app sources, and a
  build report (`granum-report.json`). `./runtime` ported (`createThemeController`).
  Demo apps `apps/app-{1,3,5,6}` with expectation-based verification.
## Unreleased

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
