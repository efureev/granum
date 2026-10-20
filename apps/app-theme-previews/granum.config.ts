import { defineGranumConfig } from '@feugene/granum/vite'
import { windEngine } from '@feugene/granum-engine-wind'

/**
 * Превью отдельным листом: тема `paper` активна, `ink` показывается рядом, но
 * её блоки уходят из общего листа в `virtual:granum/previews.css`. Его
 * импортирует только страница дизайн-системы — остальные превью не платят.
 */
export default defineGranumConfig({
  engine: windEngine(),
  providers: ['@granum-fixtures/themed-ds'],
  theme: 'paper',
  previews: ['ink'],
  modes: { names: ['light', 'dark'] },
  css: { previews: 'separate' },
  appSources: { dirs: ['src'] },
})
