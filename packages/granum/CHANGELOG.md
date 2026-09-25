# Changelog

## Unreleased

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
