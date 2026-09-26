export type { CodegenCommandOptions, CodegenCommandReport, CodegenTargetName } from './cli/codegen'
export { buildCodegenTargets, CODEGEN_TARGET_NAMES, formatCodegenReport, parseCodegenTargets, runCodegenCommand } from './cli/codegen'
export { ConfigLoadError, loadGranumConfigFile } from './cli/loadConfig'
export type { LoadedGranumConfig } from './cli/loadConfig'
export type * from './config'
export { defineGranumConfig } from './config'
/**
 * Точка входа `./node`: манифесты, эмиссия CSS, диагностика как функции
 * (ТЗ §7, §12). Node-only, без внешних зависимостей. Эмиссия и диагностика —
 * этапы 5–6.
 */
export * from './index'
export type { AppSourcesScan } from './node/appSources'
export { DEFAULT_APP_EXTENSIONS, listSourceFiles, scanAppSources } from './node/appSources'
export { clearCssCache, CSS_CACHE_MAX_ENTRIES, decodeCssDataUrl, getCssCacheSize, isCssDataUrl, readCss, readCssSync, resolveCssFilePath } from './node/css'
export type { CssBlock, CssDeclarationOccurrence, CssScanResult } from './node/cssDeclarations'
export { scanCssBlocks, scanCssDeclarations } from './node/cssDeclarations'
export type { LayerBlocks } from './node/cssLayerBlocks'
export { extractLayerBlocks } from './node/cssLayerBlocks'
export type { ParsedTokenBlock, SkippedBlock, TokenSetFromCssOptions } from './node/cssTokens'
export { parseCssTokenBlocks, parseCssTokenBlocksFromText, tokenSetFromCss, tokenSetFromCssSync } from './node/cssTokens'
export * from './node/diagnostics/index'
export { clearReextractCache, objectRulesAllowed, reconcileProviderEngines } from './node/dialects'
export type { ProviderClassSource, ProviderEngineDecision, ReconciledProviders, ReextractReason } from './node/dialects'
export type { EmittedCss, LayerName } from './node/emit'
export { emitCss, LAYER_NAMES, serializeThemeBlock, wrapLayers } from './node/emit'
export { boundaryKindOf, collectImportSpecifiers } from './node/imports'
export type { InlinedCssKind, InlinedCssSource } from './node/inlinedCss'
export { resolveInlinedCssSources, resolveProviderPath } from './node/inlinedCss'
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
export type { PreparedApp, PreparedWarning } from './node/prepare'
export { loadProviderInputs, materializeAppThemes, prepareApp, scanProviderInputs } from './node/prepare'
export type { PruneCssResult } from './node/pruneCssDeclarations'
export { pruneCssDeclarations } from './node/pruneCssDeclarations'
export type { BuildReportOptions, GranumBuildReport, LayerSize } from './node/report'
export { buildReport, bundleLayerSizes } from './node/report'
export { collectProviderInstances, providerDistDir, scanObjectProvider } from './node/scanProvider'
export type { GranumThemeManifestOptions } from './node/themeManifest'
export { getThemeManifest } from './node/themeManifest'
export type { PlanTokenPruneInput, PrunableSection, TokenKeepReason, TokenPrunePlan } from './node/tokenPrune'
export { planTokenPrune } from './node/tokenPrune'
export { extractTokenLiterals, extractTokenUses, scanTokenConsumption, unescapeCss } from './node/tokenScan'
