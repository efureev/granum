import { defineGranumComponent } from '@feugene/granum/contract'

/**
 * Значения кнопки — у тем. Тень — хук: ручка приложения со значением по
 * умолчанию, тема её не задаёт. Зазор кнопка ставит сама.
 */
export const vdButtonConfig = defineGranumComponent(import.meta.url, {
  name: 'VdButton',
  hookTokens: ['vd-button-shadow'],
})
