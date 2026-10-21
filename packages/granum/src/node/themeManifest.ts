/**
 * Манифест тем для рантайма: темы сборки с режимами и парами, основная тема,
 * атрибут и шаблон активации — из той же резолюции, из которой эмитится CSS.
 * От селекции компонентов не зависит; адрес листа дополнительной темы
 * приносит тот, кто лист выпустил, — плагин сборки.
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

export interface ThemeManifestOptions {
  /** Адрес листа дополнительной темы по id; `undefined` — адреса нет (манифест до сборки). */
  readonly href?: (theme: string) => string | undefined
}

export function getThemeManifest(resolution: GranumResolution, options: ThemeManifestOptions = {}): GranumThemeManifest {
  const { themes } = resolution
  return {
    themes: themes.themes.map((entry) => {
      const href = entry.isDefault ? undefined : options.href?.(entry.theme.id)
      return {
        id: entry.theme.id,
        title: entry.theme.title,
        ...(entry.theme.data.version !== undefined ? { version: entry.theme.data.version } : {}),
        modes: entry.modes.map(modeEntry),
        defaultMode: entry.defaultMode,
        ...(href !== undefined ? { href } : {}),
        ...(entry.theme.data.extensions !== undefined ? { extensions: entry.theme.data.extensions } : {}),
      }
    }),
    defaultTheme: themes.default?.theme.id ?? '',
    activation: { attribute: themes.activation.attribute, value: themes.activation.value },
  }
}

/**
 * Тот же манифест без сборки и без скана приложения — для интеграций
 * хоста, которым пара нужна раньше Vite: скрипт в `<head>` вставляется на
 * этапе конфигурации. Адресов листов в нём нет: ассетов ещё нет.
 */
export function resolveThemeManifest(options: ThemeResolutionOptions): GranumThemeManifest {
  return getThemeManifest(resolveThemeOnly(options))
}
