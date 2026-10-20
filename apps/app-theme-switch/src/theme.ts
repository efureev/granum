import { createThemeController } from '@feugene/granum/runtime'
import manifest from 'virtual:granum/themes'

/**
 * Контроллер темы и режима поверх манифеста сборки. Пару, которую скрипт до
 * первого кадра уже поставил на корень, он узнаёт и не трогает; выбор хранит в
 * `localStorage` ключом `granum-theme`.
 */
export const themes = createThemeController(manifest)
export { manifest }
