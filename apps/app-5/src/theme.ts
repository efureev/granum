import { createThemeController } from '@feugene/granum/runtime'
import manifest from 'virtual:granum/themes'

/** Один контроллер на приложение; применение режима синхронное. */
export const themes = createThemeController(manifest)
