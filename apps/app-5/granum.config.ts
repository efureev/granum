import { defineGranumConfig } from '@feugene/granum/vite'
import { windEngine } from '@feugene/granum-engine-wind'

/**
 * Два режима темы владельца, которого приложение не перечисляет: тему даёт
 * `@granum-fixtures/themes`, токены компонента для неё — сам компонент.
 * Манифест тем уходит рантайму через `virtual:granum/themes`.
 */
export default defineGranumConfig({
  engine: windEngine(),
  providers: ['@granum-fixtures/themes', '@granum-fixtures/simple'],
  components: ['@granum-fixtures/simple:XTokenized'],
  modes: { names: ['light', 'dark'] },
  appSources: { dirs: ['src'] },
})
