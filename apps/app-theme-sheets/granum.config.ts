import { defineGranumConfig } from '@feugene/granum/vite'
import { windEngine } from '@feugene/granum-engine-wind'

/**
 * Две темы сборки: основная `paper` — в общем листе, дополнительная `ink` —
 * своим листом. Страница дизайн-системы импортирует его модулем
 * `virtual:granum/themes/ink.css`, обычная страница за `ink` не платит, а
 * манифест несёт адрес ассета листа — для переключения в рантайме.
 */
export default defineGranumConfig({
  engine: windEngine(),
  providers: ['@granum-fixtures/themed-ds'],
  themes: [
    { theme: 'paper', default: true, modes: ['light', 'dark'] },
    { theme: 'ink', modes: ['light', 'dark', 'dim'] },
  ],
  appSources: { dirs: ['src'] },
})
