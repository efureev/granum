import { defineGranumComponent } from '@feugene/granum/contract'

/** Режимонезависимый токен компонента: один `root.json` на тему. */
export const tdCardConfig = defineGranumComponent(import.meta.url, {
  name: 'TdCard',
  themesDir: './themes',
})
