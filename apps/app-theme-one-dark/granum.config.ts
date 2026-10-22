import { defineGranumConfig } from '@feugene/granum/vite'
import { windEngine } from '@feugene/granum-engine-wind'

/**
 * Пара к `app-theme-one-light`: тот же компонент и та же тема, но только тёмный
 * режим. В CSS обязаны остаться токены кнопки и их ссылки со значениями «Камня»
 * в тёмном режиме — и ни одного значения светлого.
 */
export default defineGranumConfig({
  engine: windEngine(),
  providers: ['@granum-fixtures/valued-ds'],
  components: [{ provider: '@granum-fixtures/valued-ds', names: ['VdButton'] }],
  themes: [{ theme: 'stone', modes: ['dark'] }],
  pruneTokens: { mode: 'on' },
  appSources: { dirs: ['src'] },
})
