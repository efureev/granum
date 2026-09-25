/**
 * Точка входа `./node`: манифесты, эмиссия CSS, диагностика как функции
 * (ТЗ §7, §12). Node-only, без внешних зависимостей. Эмиссия и диагностика —
 * этапы 5–6.
 */
export * from './index'
export { clearCssCache, CSS_CACHE_MAX_ENTRIES, decodeCssDataUrl, getCssCacheSize, isCssDataUrl, readCss, readCssSync, resolveCssFilePath } from './node/css'
export type { CssBlock, CssDeclarationOccurrence, CssScanResult } from './node/cssDeclarations'
export { scanCssBlocks, scanCssDeclarations } from './node/cssDeclarations'
export type { ParsedTokenBlock, SkippedBlock, TokenSetFromCssOptions } from './node/cssTokens'
export { parseCssTokenBlocks, parseCssTokenBlocksFromText, tokenSetFromCss, tokenSetFromCssSync } from './node/cssTokens'
export {
  canonicalizeManifest,
  computeManifestHash,
  isPackageRelativePath,
  loadPackageManifest,
  locateManifest,
  MANIFEST_FILE_NAME,
  parseManifest,
  readManifestSync,
  serializeManifest,
  writeManifestSync,
} from './node/manifest'
export { materializeComponentRefs, materializeProviderRefs } from './node/materializeRefs'
export { extractTokenLiterals, extractTokenUses, scanTokenConsumption, unescapeCss } from './node/tokenScan'
