import { createThemeController } from '@feugene/granum/runtime'
import manifest from 'virtual:granum/themes'

/** Режимов `light`/`dark` в сборке нет: `initial: 'auto'` опирается на `colorScheme` из манифеста. */
export const themes = createThemeController(manifest)

export function themeLabel(name: string): string {
  return themes.modes().find(mode => mode.name === name)?.title ?? name
}
