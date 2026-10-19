/**
 * Манифест тем для рантайма (T-4): активная тема, её режимы с парами и
 * атрибут активации — из той же резолюции, из которой эмитится CSS. От
 * селекции компонентов не зависит.
 */
import type { GranumResolution } from '../core/resolve'
import type { GranumThemeManifest } from '../runtime/manifest'

export function getThemeManifest(resolution: GranumResolution): GranumThemeManifest {
  const { themes } = resolution
  const theme = themes.theme
  return {
    theme: { id: theme?.id ?? '', title: theme?.title ?? '' },
    modes: themes.modes.map(mode => ({
      name: mode.name,
      ...(mode.title !== undefined ? { title: mode.title } : {}),
      colorScheme: mode.colorScheme,
      value: mode.value,
    })),
    defaultMode: themes.defaultMode ?? '',
    activation: { attribute: themes.activation.attribute },
    ...(theme?.data.extensions !== undefined ? { extensions: theme.data.extensions } : {}),
  }
}
