import { defineGranumConfig } from '@feugene/granum/vite'
import { windEngine } from '@feugene/granum-engine-wind'

/**
 * Один компонент, одна тема, один режим — из дизайн-системы, у которой тема
 * несёт значения всех её компонентов (ADR-13). Обрезка включена: в CSS обязаны
 * остаться только токены, которые читает кнопка, и токены, на которые они
 * ссылаются, — со значениями «Камня» в светлом режиме.
 */
export default defineGranumConfig({
  engine: windEngine(),
  providers: ['@granum-fixtures/valued-ds'],
  components: [{ provider: '@granum-fixtures/valued-ds', names: ['VdButton'] }],
  themes: [{ theme: 'stone', modes: ['light'] }],
  pruneTokens: { mode: 'on' },
  appSources: { dirs: ['src'] },
})
