/**
 * Манифест тем для рантайма (T-4): активная тема, её режимы с парами,
 * атрибут и шаблон активации, пары превью — из той же резолюции, из которой эмитится CSS. От
 * селекции компонентов не зависит.
 */
import type { GranumResolution } from '../core/resolve'
import type { ResolvedMode } from '../core/resolveThemes'
import type { GranumModeEntry, GranumThemeManifest } from '../runtime/manifest'
import type { ThemeResolutionOptions } from './themeStylesheet'
import { resolveThemeOnly } from './themeStylesheet'

function modeEntry(mode: ResolvedMode): GranumModeEntry {
  return {
    name: mode.name,
    ...(mode.title !== undefined ? { title: mode.title } : {}),
    colorScheme: mode.colorScheme,
    value: mode.value,
  }
}

export function getThemeManifest(resolution: GranumResolution): GranumThemeManifest {
  const { themes } = resolution
  const theme = themes.theme
  return {
    theme: { id: theme?.id ?? '', title: theme?.title ?? '' },
    modes: themes.modes.map(modeEntry),
    defaultMode: themes.defaultMode ?? '',
    activation: { attribute: themes.activation.attribute, value: themes.activation.value },
    ...(themes.previews.length > 0
      ? { previews: themes.previews.map(preview => ({ theme: { id: preview.theme.id, title: preview.theme.title }, modes: preview.modes.map(modeEntry) })) }
      : {}),
    ...(theme?.data.extensions !== undefined ? { extensions: theme.data.extensions } : {}),
  }
}

/**
 * Тот же манифест (T-17) без сборки и без скана приложения — для интеграций
 * хоста, которым пара нужна раньше Vite: скрипт режима в `<head>` вставляется
 * на этапе конфигурации.
 */
export function resolveThemeManifest(options: ThemeResolutionOptions): GranumThemeManifest {
  return getThemeManifest(resolveThemeOnly(options))
}
