import { defineGranumConfig } from '@feugene/granum/vite'
import { windEngine } from '@feugene/granum-engine-wind'

/**
 * Тема `ink` — наследница `paper` в каталоге. Токены компонентов, которых у
 * `ink` нет, берутся по цепочкам: темы (`ink → paper`) и режима (`dim → dark`).
 * `paper` показывается рядом превью — полными блоками своих пар, не выходя под
 * `:root`.
 */
export default defineGranumConfig({
  engine: windEngine(),
  providers: ['@granum-fixtures/themed-ds', '@granum-fixtures/themed-companion'],
  themes: [
    { theme: 'ink', default: true, modes: ['light', 'dark', 'dim'] },
    { theme: 'paper', modes: ['light', 'dark'] },
  ],
  appSources: { dirs: ['src'] },
})
