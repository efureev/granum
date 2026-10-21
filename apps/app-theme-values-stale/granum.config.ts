import { defineGranumConfig } from '@feugene/granum/vite'
import { loadThemeSource } from '@feugene/granum/node'
import { windEngine } from '@feugene/granum-engine-wind'

/**
 * Тема, которая отстала от пакета компонентов: написана под 0.9, в сборке 1.0.
 * Находки — намеренные, их перечисляет `expected.mjs`.
 */
export default defineGranumConfig({
  engine: windEngine(),
  providers: ['@granum-fixtures/valued-ds'],
  themes: [
    { theme: 'stone', default: true },
    { theme: loadThemeSource(new URL('./src/themes/stale/', import.meta.url)) },
  ],
  appSources: { dirs: ['src'] },
})
