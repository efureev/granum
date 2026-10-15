import { defineGranumComponent } from '@feugene/granum/contract'

/**
 * Композит: кросс-провайдерная зависимость и объявленный CSS, который
 * SFC не импортирует — файл копируется в dist по декларации.
 */
export const xgQuickConfig = defineGranumComponent(import.meta.url, {
  name: 'XgQuick',
  dependencies: ['@granum-fixtures/simple:XTest1'],
  cssFiles: ['./styles.css'],
})
