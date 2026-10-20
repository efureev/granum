/**
 * Точка входа `./runtime`: темы и режимы сборки в браузере. Только типы,
 * чистые функции и контроллер над DOM: ни FS, ни зависимостей.
 * Пара к нему — `virtual:granum/themes` плагина приложения.
 */
export {
  createThemeController,
  DEFAULT_THEME_STORAGE_KEY,
  type GranumThemeController,
  type GranumThemeControllerOptions,
  type GranumThemeState,
  type GranumThemeStorage,
  type GranumThemeTarget,
} from './runtime/controller'
export {
  carryThemeMode,
  createThemeManifest,
  defaultTheme,
  findTheme,
  type GranumModeEntry,
  type GranumThemeManifest,
  type GranumThemeManifestEntry,
  type GranumThemeManifestInput,
  type GranumThemeSelection,
  type GranumThemeSelectionInput,
  isSelectableTheme,
  readThemeSelection,
  resolveThemeActivation,
  themeModeValue,
  themePairValue,
  themeSelectionKey,
} from './runtime/manifest'
export {
  createCookieStorage,
  createThemeScript,
  createThemeScriptCode,
  type GranumCookieStorageOptions,
  type GranumThemeScriptCodeOptions,
  type GranumThemeScriptOptions,
  themeFromCookie,
  themeRootAttributes,
} from './runtime/script'
export {
  type GranumSheetDocument,
  loadThemeSheet,
  THEME_SHEET_ATTRIBUTE,
  themeSheetLink,
  themeSheetMarker,
} from './runtime/sheets'
