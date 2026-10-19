import { defineGranumConfig } from '@feugene/granum/vite'
import { windEngine } from '@feugene/granum-engine-wind'

/**
 * Тема `ink` — наследница `paper` в каталоге. Токены компонентов, которых у
 * `ink` нет, берутся по цепочкам: темы (`ink → paper`) и режима (`dim → dark`).
 * `paper` показывается рядом превью — полными блоками своих пар, не выходя под
 * `:root` (A-32).
 */
export default defineGranumConfig({
  engine: windEngine(),
  providers: ['@granum-fixtures/themed-ds', '@granum-fixtures/themed-companion'],
  theme: 'ink',
  previews: ['paper'],
  appSources: { dirs: ['src'] },
})
