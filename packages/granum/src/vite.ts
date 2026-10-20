/**
 * Точка входа `./vite`: плагин приложения и `defineGranumConfig`.
 * Node-only, peer `vite`.
 */
export type * from './config'
export { defineGranumConfig } from './config'
export type { GranumPluginApi, GranumPluginOptions } from './vite/plugin'
export { granum, VIRTUAL_COMPONENTS, VIRTUAL_CSS, VIRTUAL_LAYER_PREFIX, VIRTUAL_THEMES } from './vite/plugin'
export type { GranumComponentResolver, GranumResolvedComponent, GranumResolverOptions } from './vite/resolver'
export { buildComponentIndex, granumResolver } from './vite/resolver'
export { InvalidConfigError, validateGranumConfig } from './vite/validateConfig'
