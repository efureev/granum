import { defineGranumConfig } from '@feugene/granum/vite'
import { windEngine } from '@feugene/granum-engine-wind'

/**
 * Набор режимов принадлежит приложению: тема `paper` даёт `light`/`dark`, в
 * сборке — три режима приложения, унаследовавшие `light` через `extends`.
 * Главный пример «extends темы granum 2 → режим».
 */
export default defineGranumConfig({
  engine: windEngine(),
  providers: ['@granum-fixtures/themes', '@granum-fixtures/simple'],
  components: ['@granum-fixtures/simple:XTokenized'],
  themes: [{
    theme: 'paper',
    modes: {
      names: ['emerald', 'ocean', 'crimson'],
      define: {
        emerald: { extends: 'light', tokens: { 'app-bg': '#052e1f', 'app-fg': '#d1fae5', 'app-accent': '#10b981', 'app-muted': '#059669', 'x-tokenized': '#34d399' }, title: 'Изумруд', colorScheme: 'dark' },
        ocean: { extends: 'light', tokens: { 'app-bg': '#e0f2fe', 'app-fg': '#0c4a6e', 'app-accent': '#0369a1', 'app-muted': '#0284c7', 'x-tokenized': '#0ea5e9' }, title: 'Океан', colorScheme: 'light' },
        crimson: { extends: 'light', tokensRef: new URL('./src/themes/crimson.css', import.meta.url).href, title: 'Багрянец', colorScheme: 'dark' },
      },
    },
  }],
  appSources: { dirs: ['src'] },
})
