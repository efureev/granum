export { expandApply, hasApply } from './build/apply'
/**
 * Точка входа `./build`: плагин сборки провайдера (ТЗ §6). Node-only, peer `vite`.
 */
export type { BoundaryViolation, BundleAnalysis, BundleAssetLike, BundleChunkLike, BundleLike, ComponentBundleInfo } from './build/graph'
export { analyzeBundle, findUndeclaredEdges } from './build/graph'
export type { AssetInfoLike, ChunkInfoLike, ComponentSource, ModuleOwner } from './build/layout'
export { classifyModule, classifyOutputFile, collectComponentSources, componentEntryFileName, granumAssetFileNames, granumChunkFileNames } from './build/layout'
export type { GranumProviderPluginOptions } from './build/plugin'
export { granumProvider } from './build/plugin'
