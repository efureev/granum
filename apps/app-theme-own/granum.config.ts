import { defineGranumConfig } from '@feugene/granum/vite'
import { windEngine } from '@feugene/granum-engine-wind'
import { loadTheme } from './loadTheme.ts'

/**
 * Своя тема приложения поверх `paper`: данные из `src/theme/` дополняет до
 * полных маленькая функция стенда, `extends: 'paper'` даёт токены компонентов
 * для режимов, где тема их не задала. Свои токены кнопки — прямо в данных
 * режима: тема-объект идёт слоем после токенов компонентов (A-27). Правка
 * файлов темы в dev перезапускает сервер: конфиг читается один раз (A-33).
 */
export default defineGranumConfig({
  engine: windEngine(),
  providers: ['@granum-fixtures/themed-ds', '@granum-fixtures/themed-companion'],
  theme: loadTheme(new URL('./src/theme/', import.meta.url)),
  modes: {
    names: ['light', 'dark', 'sepia'],
    define: { sepia: { extends: 'light', title: 'Сепия', tokens: { 'th-bg': '#f4ecd8' } } },
    tokenOverrides: { root: { 'th-font': 'Inter, sans-serif' } },
  },
  appSources: { dirs: ['src'] },
})
