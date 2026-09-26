import { defineGranumComponent } from '@feugene/granum/contract'

/** Вся отделка — в своём CSS: ни одной утилиты. */
export const plCardConfig = defineGranumComponent(import.meta.url, {
  name: 'PlCard',
  cssFiles: ['./styles.css'],
})
