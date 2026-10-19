import { defineGranumComponent } from '@feugene/granum/contract'

/**
 * Токены кнопки для `paper` в обоих режимах и для `ink` только в светлом:
 * тёмный и `dim` у `ink` берутся по цепочкам — темы (`ink → paper`) и режима
 * (`dim → dark`).
 */
export const tdButtonConfig = defineGranumComponent(import.meta.url, {
  name: 'TdButton',
  themesDir: './themes',
})
