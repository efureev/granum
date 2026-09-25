/**
 * Точка входа `./vite`: плагин приложения и `defineGranumConfig` (ТЗ §10).
 * Node-only, peer `vite`.
 */
export type * from './config'
export { defineGranumConfig } from './config'
export type { GranumPluginOptions } from './vite/plugin'
export { granum, VIRTUAL_COMPONENTS, VIRTUAL_CSS, VIRTUAL_LAYER_PREFIX, VIRTUAL_THEMES } from './vite/plugin'
export { InvalidConfigError, validateGranumConfig } from './vite/validateConfig'
