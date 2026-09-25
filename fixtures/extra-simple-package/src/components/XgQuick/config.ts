import { defineGranumComponent } from '@feugene/granum/contract'

/**
 * Композит: кросс-провайдерная зависимость (C-9) и объявленный CSS, который
 * SFC не импортирует — файл копируется в dist по декларации (B-3, INV-CSS-5).
 */
export const xgQuickConfig = defineGranumComponent(import.meta.url, {
  name: 'XgQuick',
  dependencies: ['@granum-fixtures/simple:XTest1'],
  cssFiles: ['./styles.css'],
})
