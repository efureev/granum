import { defineGranumConfig } from '@feugene/granum/vite'

/**
 * Набор тем принадлежит приложению: провайдер поставляет `light`/`dark`,
 * в сборке — три темы приложения, унаследовавшие `light` через `extends`.
 */
export default defineGranumConfig({
  providers: ['@granum-fixtures/simple'],
  components: ['@granum-fixtures/simple:XTokenized'],
  themes: {
    define: {
      emerald: { extends: 'light', tokens: { 'app-bg': '#052e1f', 'app-fg': '#d1fae5', 'app-accent': '#10b981', 'app-muted': '#065f46', 'x-tokenized': '#34d399' }, label: 'Изумруд', colorScheme: 'dark' },
      ocean: { extends: 'light', tokens: { 'app-bg': '#e0f2fe', 'app-fg': '#0c4a6e', 'app-accent': '#0284c7', 'app-muted': '#7dd3fc', 'x-tokenized': '#0369a1' }, label: 'Океан', colorScheme: 'light' },
      crimson: { extends: 'light', tokensRef: new URL('./src/themes/crimson.css', import.meta.url).href, label: 'Багрянец', colorScheme: 'dark' },
    },
  },
  appSources: { dirs: ['src'] },
})
