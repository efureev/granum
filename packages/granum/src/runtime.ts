/**
 * Точка входа `./runtime`: режимы активной темы в браузере. Только типы,
 * чистые функции и контроллер над DOM: ни FS, ни зависимостей.
 * Пара к нему — `virtual:granum/themes` плагина приложения.
 */
export {
  createThemeController,
  DEFAULT_THEME_STORAGE_KEY,
  type GranumThemeController,
  type GranumThemeControllerOptions,
  type GranumThemeStorage,
  type GranumThemeTarget,
} from './runtime/controller'
export { type GranumModeEntry, type GranumPreviewEntry, type GranumThemeManifest, resolveThemeActivation, themeModeValue } from './runtime/manifest'
export {
  createCookieStorage,
  createThemeScript,
  createThemeScriptCode,
  type GranumCookieStorageOptions,
  type GranumThemeScriptCodeOptions,
  type GranumThemeScriptOptions,
  modeFromCookie,
  themeRootAttributes,
} from './runtime/script'
