import { createThemeController } from '@feugene/granum/runtime'
import manifest from 'virtual:granum/themes'

/** Тем `light`/`dark` нет: `initial: 'auto'` опирается на `colorScheme` из манифеста. */
export const themes = createThemeController(manifest)

export function themeLabel(name: string): string {
  return themes.entry(name).label ?? name
}
