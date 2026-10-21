import { createThemeController } from '@feugene/granum/runtime'
import manifest from 'virtual:granum/themes'

export const themes = createThemeController(manifest)
export { manifest }
