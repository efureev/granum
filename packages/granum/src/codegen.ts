/**
 * Точка входа `./codegen`: генерация реестров пакета-провайдера (B-13, B-14).
 *
 * Провайдер перечисляет компоненты в нескольких местах: root-barrel, subpath-
 * экспорты `package.json`, реестр провайдера. Пропуск любого не даёт ошибки
 * сборки — ломается что-то одно и молча. Node-only: читает и пишет файлы.
 *
 * @example
 * ```js
 * // scripts/generate-registry.mjs
 * import { fileURLToPath } from 'node:url'
 * import { codegenTargets, runRegistryCodegen } from '@feugene/granum/codegen'
 *
 * await runRegistryCodegen({
 *   packageDir: fileURLToPath(new URL('..', import.meta.url)),
 *   check: process.argv.includes('--check'),
 *   targets: [
 *     codegenTargets.barrel(),
 *     codegenTargets.packageExports(),
 *     codegenTargets.manifestExport(),
 *     ...codegenTargets.providerRegistry(),
 *   ],
 * })
 * ```
 */
import { barrel, manifestExport, markedBlock, packageExports, providerRegistry } from './codegen/targets'

export { replaceMarkedBlock, replacePackageExports } from './codegen/blocks'
export type { ReplaceMarkedBlockOptions, ReplacePackageExportsOptions } from './codegen/blocks'
export { collectGranumComponentEntries, collectGranumComponents, compareComponentNames, defaultConfigExportName } from './codegen/collectComponents'
export type { CollectComponentsOptions, GranumComponentEntry } from './codegen/collectComponents'
export { runRegistryCodegen } from './codegen/runRegistryCodegen'
export type { RegistryCodegenResult, RunRegistryCodegenOptions } from './codegen/runRegistryCodegen'
export { collectGranumSubcomponents, parseSubcomponents } from './codegen/subcomponents'
export type { CollectSubcomponentsOptions } from './codegen/subcomponents'
export type { GranumCodegenContext, GranumCodegenTarget } from './codegen/targets'
export { GranumCodegenError } from './core/errors'
export type { GranumCodegenReason } from './core/errors'

/** Готовые цели — объектом, чтобы имена вроде `barrel` не жили плоскими экспортами. */
export const codegenTargets = {
  barrel,
  packageExports,
  manifestExport,
  providerRegistry,
  markedBlock,
} as const
