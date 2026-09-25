# Changelog

## Unreleased

- Contract v1 and resolver (stage 1): `defineGranumProvider` validates at registration
  (id, contract version, component names as path segments, token keys without `--`,
  `cssFiles` inside the component directory); `defineGranumComponent` normalises
  `cssFiles` to `components/<Name>/<file>` and keeps `sourceUrl`. `resolveGranum`
  accepts provider objects and loaded manifests, memoises by input identity and
  returns one `GranumResolution` for all channels; token values come from a single
  `collectTokenLayers` / `resolveTokenValue`. All errors extend `GranumError` with a `code`.
- Repository skeleton: entry points, CLI shell, boundary checks (stage 0).
