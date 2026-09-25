/**
 * Точка входа `./runtime`: переключение тем в браузере (ТЗ §11). Только типы,
 * чистый парсер селекторов и контроллер над DOM: ни FS, ни зависимостей.
 * Пара к нему — `virtual:granum/themes` плагина приложения.
 */
export { createThemeController, type GranumThemeController, type GranumThemeControllerOptions, type GranumThemeStorage, type GranumThemeTarget } from './runtime/controller'
export { type GranumThemeActivation, type GranumThemeEntry, type GranumThemeManifest, resolveThemeActivation, splitSelectorList } from './runtime/manifest'
