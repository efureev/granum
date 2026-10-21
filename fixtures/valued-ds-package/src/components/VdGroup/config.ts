import { defineGranumComponent } from '@feugene/granum/contract'

/**
 * Группа рендерит кнопку и читает её радиус: `--vd-button-radius` остаётся
 * токеном кнопки — в теме он в разделе `VdButton`, а не группы.
 */
export const vdGroupConfig = defineGranumComponent(import.meta.url, {
  name: 'VdGroup',
  dependencies: ['VdButton'],
})
